// Browser tests for the coach page (coach.html at /coach): sign-in, MFA enrol and challenge, and the coach screens.
// Supabase is replaced by an in-page fake (tables in memory, rpc, auth and auth.mfa), so no network and no keys.
// The database rules themselves (is_coach, aal2, health flag, pauses, check-in rules, capacity) are tested on a
// real Postgres in tests/coaching-portal-rls.test.js and supabase/coaching-portal-verify.sql.
//
// Run with: node --test tests/coach-portal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pw = null, pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See docs/COACHING-DEMO.md for how to install it (npm install).'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SKIP = pwError ? { skip: pwError } : {};
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
let browser, server, base;

/* ------------------------------------------------------------------ dates */
const MELB = 'Australia/Melbourne';
const ymd = (d, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone || MELB, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDaysStr = (s, n) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const TODAY = () => ymd(new Date());
const daysAgoIso = n => new Date(Date.now() - n * 86400000).toISOString();

/* ------------------------------------------------------------------ the fake supabase-js (runs in the page) */
const FAKE_SUPABASE = `
(function () {
  const S = window.__stub;
  S.factors = S.factors || [];
  window.__calls = [];
  const db = S.db;
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const DEFAULTS = { coaching_checkins: { status: 'scheduled' } };
  function run(st) {
    window.__calls.push({ kind: 'from', table: st.table, op: st.op, payload: clone(st.payload), filters: st.desc.slice() });
    if (S.fail && S.fail[st.table]) return { data: null, error: S.fail[st.table] };
    const rows = db[st.table] = db[st.table] || [];
    const match = rows.filter(r => st.filters.every(f => f(r)));
    if (st.op === 'select') {
      let out = match.slice();
      if (st.order) { const [c, desc] = st.order; out.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (desc ? -1 : 1)); }
      if (st.limit) out = out.slice(0, st.limit);
      return { data: clone(out), error: null };
    }
    if (st.op === 'insert') {
      (Array.isArray(st.payload) ? st.payload : [st.payload]).forEach(x => rows.push(Object.assign({ id: 'id-' + Math.random().toString(36).slice(2, 8) }, DEFAULTS[st.table] || {}, clone(x))));
      return { data: null, error: null };
    }
    if (st.op === 'update') { match.forEach(r => Object.assign(r, clone(st.payload))); return { data: null, error: null }; }
    if (st.op === 'delete') { db[st.table] = rows.filter(r => !match.includes(r)); return { data: null, error: null }; }
    if (st.op === 'upsert') {
      const key = st.onConflict || 'id';
      const ex = rows.find(r => String(r[key]) === String(st.payload[key]));
      if (ex) Object.assign(ex, clone(st.payload)); else rows.push(clone(st.payload));
      return { data: null, error: null };
    }
  }
  function from(table) {
    const st = { table, op: 'select', filters: [], desc: [], payload: null, order: null, limit: null, onConflict: null };
    const f = (desc, fn) => { st.desc.push(desc); st.filters.push(fn); return b; };
    const b = {
      select() { return b; },
      eq(c, v) { return f(c + '=' + v, r => String(r[c]) === String(v)); },
      gte(c, v) { return f(c + '>=' + v, r => r[c] >= v); },
      in(c, vs) { return f(c + ' in ' + vs.join('|'), r => vs.map(String).includes(String(r[c]))); },
      order(c, o) { st.order = [c, !!(o && o.ascending === false)]; return b; },
      limit(n) { st.limit = n; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      upsert(p, o) { st.op = 'upsert'; st.payload = p; st.onConflict = o && o.onConflict; return b; },
      delete() { st.op = 'delete'; return b; },
      then(res, rej) { return Promise.resolve(run(st)).then(res, rej); }
    };
    return b;
  }
  async function rpc(name, args) {
    window.__calls.push({ kind: 'rpc', name, args: clone(args) });
    if (name === 'coach_status') return { data: { admin: !!S.admin, aal: S.aal || 'aal1' }, error: null };
    if (name === 'coach_add_client') {
      if (S.full) return { data: { ok: false, error: 'That plan is full. Raise the capacity first, or choose another plan.' }, error: null };
      db.coaching_clients.push({ id: 900, email: args.p_email, name: args.p_name, tier: args.p_tier, status: 'awaiting_onboarding', onboarding: {}, created_at: new Date().toISOString() });
      db.coaching_customers.push({ id: 'cu-new', email: args.p_email, name: args.p_name, tier: args.p_tier, amount_cents: args.p_amount_cents, purchased_at: new Date().toISOString(), marketing_consent: false });
      return { data: { ok: true, client_id: 900 }, error: null };
    }
    if (name === 'coach_publish_plan') {
      const mine = db.coaching_plans.filter(p => String(p.client_id) === String(args.p_client_id));
      mine.forEach(p => { p.is_current = false; });
      const version = mine.length + 1;
      db.coaching_plans.push({ client_id: args.p_client_id, version, is_current: true, plan: clone(args.p_plan), created_at: new Date().toISOString() });
      return { data: { ok: true, version }, error: null };
    }
    if (name === 'coach_marketing_export') return { data: clone(S.exportRows || []), error: null };
    return { data: null, error: { message: 'no function ' + name } };
  }
  const QR = 'data:image/svg+xml;utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const mfa = {
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: S.aal || 'aal1' }, error: null }),
    listFactors: async () => ({ data: { all: clone(S.factors), totp: clone(S.factors.filter(f => f.factor_type === 'totp')) }, error: null }),
    enroll: async o => {
      window.__calls.push({ kind: 'mfa', name: 'enroll', args: clone(o) });
      const fct = { id: 'factor-' + (S.factors.length + 1), factor_type: 'totp', status: 'unverified', friendly_name: o.friendlyName, created_at: new Date().toISOString() };
      S.factors.push(fct);
      return { data: { id: fct.id, type: 'totp', totp: { qr_code: QR, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } }, error: null };
    },
    challenge: async o => { window.__calls.push({ kind: 'mfa', name: 'challenge', args: clone(o) }); return { data: { id: 'challenge-1' }, error: null }; },
    verify: async o => {
      window.__calls.push({ kind: 'mfa', name: 'verify', args: clone(o) });
      if (o.code !== '123456' || o.challengeId !== 'challenge-1') return { data: null, error: { message: 'Invalid TOTP code entered' } };
      S.aal = 'aal2'; return { data: {}, error: null };
    },
    challengeAndVerify: async o => {
      window.__calls.push({ kind: 'mfa', name: 'challengeAndVerify', args: clone(o) });
      if (o.code !== '123456') return { data: null, error: { message: 'Invalid TOTP code entered' } };
      const fct = S.factors.find(x => x.id === o.factorId); if (fct) fct.status = 'verified';
      S.aal = 'aal2'; return { data: {}, error: null };
    },
    unenroll: async o => { window.__calls.push({ kind: 'mfa', name: 'unenroll', args: clone(o) }); S.factors = S.factors.filter(x => x.id !== o.factorId); return { data: {}, error: null }; }
  };
  const auth = {
    getSession: async () => ({ data: { session: S.session || null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async ({ email, password }) => {
      window.__calls.push({ kind: 'auth', name: 'signInWithPassword', email });
      if (password !== S.password) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      S.session = { access_token: 'token-aal1', user: { id: 'coach-1', email } };
      return { data: { user: S.session.user, session: S.session }, error: null };
    },
    signOut: async () => { window.__calls.push({ kind: 'auth', name: 'signOut' }); S.session = null; return { error: null }; },
    mfa
  };
  window.supabase = { createClient: (url, key, opts) => { window.__createOpts = opts || null; return { from, rpc, auth }; } };
})();
`;

/* ------------------------------------------------------------------ seed data */
function seed(over) {
  const today = TODAY();
  const act10 = addDaysStr(today, -10);
  const coleMeals = [
    { id: 'm1', client_id: 3, log_date: today, name: 'Oats', calories: 450, protein: 25, carbs: 60, fat: 10, fibre: 8, source: 'plan', logged_at: daysAgoIso(0) },
    { id: 'm0', client_id: 3, log_date: addDaysStr(act10, -2), name: 'Baseline toast', calories: 300, protein: 10, carbs: 40, fat: 8, fibre: 2, source: 'typed', logged_at: daysAgoIso(12) }
  ];
  const db = {
    coaching_clients: [
      { id: 1, user_id: 'u1', email: 'hana@example.com', name: 'Hana Health', tier: 'core', status: 'awaiting_activation', start_date: today, activated_at: null, end_date: null,
        time_zone: 'Australia/Melbourne', whatsapp: '+61 400 000 001', created_at: daysAgoIso(2), health_flag: true, health_cleared_at: null, pause_days_used: 0,
        targets: { calories: 2100, protein: 160, carbs: 210, fat: 70, fibre: 30, steps: 9000 },
        onboarding: { timezone: 'Melbourne', proteinPowder: 'yes', proteinBrand: 'Brand X vanilla', health: { heart: 'yes', chest: 'no', other: 'no' }, healthClearance: true, likedFoods: ['Chicken', 'Rice', 'Banana'], likedOther: 'halloumi, chickpeas',
          avoid: 'mushrooms, olives', allergies: 'peanuts', trainingDays: ['Mon', 'Wed', 'Fri'], equipment: ['Dumbbells'], goal: 'Lose fat', weighInDay: 'Mon', weighInTime: '07:00', weightKg: 82 } },
      { id: 2, user_id: 'u2', email: 'erin@example.com', name: 'Erin Essential', tier: 'essential', status: 'active', start_date: act10, activated_at: act10 + 'T09:00:00+11:00', end_date: addDaysStr(act10, 84),
        time_zone: 'Australia/Melbourne', created_at: daysAgoIso(12), health_flag: false, pause_days_used: 0, targets: null, onboarding: { weighInDay: 'Mon' } },
      { id: 3, user_id: 'u3', email: 'cole@example.com', name: 'Cole Core', tier: 'core', status: 'active', start_date: act10, activated_at: act10 + 'T09:00:00+11:00', end_date: addDaysStr(act10, 84),
        time_zone: 'Europe/London', created_at: daysAgoIso(12), health_flag: false, pause_days_used: 0, targets: { calories: 2000, protein: 150, carbs: 200, fat: 70, fibre: 28, steps: 8000 },
        onboarding: { timezone: 'London', weighInDay: 'Mon', weighInTime: '07:00', weightKg: 90, trainingDays: ['Mon', 'Thu'] } },
      { id: 4, user_id: 'u4', email: 'bea@example.com', name: 'Bea Beast', tier: 'beast', status: 'paused', start_date: act10, activated_at: act10 + 'T09:00:00+11:00', end_date: addDaysStr(act10, 84),
        time_zone: 'Australia/Melbourne', created_at: daysAgoIso(12), health_flag: false, pause_days_used: 5, paused_at: daysAgoIso(2), targets: null, onboarding: {} },
      { id: 5, user_id: 'u5', email: 'bo@example.com', name: 'Bo Basic', tier: 'basic', status: 'active', start_date: act10, activated_at: act10 + 'T09:00:00+11:00', end_date: addDaysStr(act10, 84),
        time_zone: 'Australia/Melbourne', created_at: daysAgoIso(12), health_flag: false, pause_days_used: 0, targets: { calories: 1900 }, onboarding: {} },
      { id: 6, user_id: 'u6', email: 'fin@example.com', name: 'Fin Finished', tier: 'core', status: 'finished', start_date: addDaysStr(today, -120), activated_at: daysAgoIso(120), end_date: addDaysStr(today, -36),
        time_zone: 'Australia/Melbourne', created_at: daysAgoIso(121), health_flag: false, pause_days_used: 0, targets: null, onboarding: {} }
    ],
    coaching_capacity: [{ tier: 'essential', place_limit: 100 }, { tier: 'core', place_limit: 25 }, { tier: 'beast', place_limit: 4 }],
    coaching_customers: [
      { id: 'c1', email: 'cole@example.com', name: 'Cole Core', tier: 'core', amount_cents: 29900, purchased_at: daysAgoIso(12), marketing_consent: true, unsubscribed_at: null },
      { id: 'c2', email: 'erin@example.com', name: 'Erin Essential', tier: 'essential', amount_cents: 11000, purchased_at: daysAgoIso(12), marketing_consent: false, unsubscribed_at: null },
      { id: 'c3', email: 'old@example.com', name: 'Olly Old', tier: 'core', amount_cents: 29900, purchased_at: daysAgoIso(200), marketing_consent: false, unsubscribed_at: daysAgoIso(100) }
    ],
    coaching_plans: [{ client_id: 1, version: 1, is_current: true, created_at: daysAgoIso(1),
      plan: { meals: { 1: [{ label: 'Breakfast', name: 'Oats', text: 'Oats', calories: 450, protein: 25, carbs: 60, fat: 10, fibre: 8 }] }, training: 'Mon: Full body A\n- Squat 3x8' } }],
    coaching_meal_logs: coleMeals,
    coaching_workout_logs: [
      { id: 'w1', client_id: 3, log_date: addDaysStr(today, -3), kind: 'plan', what: 'Full body A', session: { exercises: [{ name: 'Squat', sets: [{ kg: 60, reps: 8 }] }] } },
      { id: 'w2', client_id: 3, log_date: today, kind: 'plan', what: 'Full body A', session: { exercises: [{ name: 'Squat', sets: [{ kg: 62.5, reps: 8 }, { kg: 62.5, reps: 7 }] }] } }
    ],
    coaching_step_logs: [{ client_id: 3, log_date: today, steps: 7400 }],
    coaching_weigh_ins: [{ client_id: 3, weigh_date: addDaysStr(today, -7), kg: 89.1 }],
    coaching_checkins: [{ id: 'k1', client_id: 2, type: 'Kick-off call', scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'scheduled' }],
    coaching_notes: [],
    coaching_settings: []
  };
  return Object.assign({ db, admin: true, password: 'right-password', exportRows: [{ email: 'cole@example.com', name: 'Cole Core', plan: 'core', purchased_on: addDaysStr(today, -12) }] }, over || {});
}
const COACH = { id: 'coach-1', email: 'stefan@example.com' };
const SIGNED_IN_AAL2 = () => seed({ session: { access_token: 'token-aal2', user: COACH }, aal: 'aal2', factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified', friendly_name: 'Phone', created_at: daysAgoIso(30) }] });

/* ------------------------------------------------------------------ server and browser */
test.before(async () => {
  if (!pw) return;
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    let file = path.join(ROOT, p);
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file = file + '.html';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function open(stub, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 900 }, timezoneId: MELB, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.aiCalls = [];
  await page.route(url => /^https?:\/\//.test(url.href) && !url.href.startsWith(base) && !/cdn\.jsdelivr\.net\/npm\/@supabase/.test(url.href), r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE }));
  await page.route(/\/api\/coach-ai$/, async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    page.aiCalls.push({ body, auth: r.request().headers().authorization });
    const lines = String(body.text || '').split('\n').filter(Boolean);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ meals: lines.map((l, i) => ({ label: l.split(':')[0], text: (l.split(':')[1] || '').trim(), calories: 100 + l.length, protein: 30, carbs: 50, fat: 12, fibre: 6 })) }) });
  });
  await page.addInitScript(s => { window.__stub = s; }, stub);
  await page.goto(base + '/coach');
  return { ctx, page };
}
const calls = page => page.evaluate(() => window.__calls);
const txt = (page, sel) => page.textContent(sel);
async function openClient(page, name) {
  await page.waitForSelector('#clientRows');
  await page.click(`button.btn-link:has-text("${name}")`);
  await page.waitForFunction(n => document.querySelector('.hero h1') && document.querySelector('.hero h1').textContent.includes(n) && !/Loading/.test(document.getElementById('app').textContent), name);
}
async function tab(page, label) {
  await page.click(`button.tab:has-text("${label}")`);
}

/* ------------------------------------------------------------------ sign-in and MFA */
test('signed out: the sign-in form, no "remember me", a wrong password is refused, and nothing else shows', SKIP, async () => {
  const { ctx, page } = await open(seed());
  await page.waitForSelector('#signinForm');
  assert.equal(await page.locator('input[type=checkbox]').count(), 0, 'no remember-me box');
  assert.match(await txt(page, '#app'), /no "remember me"/);
  await page.fill('#si-email', 'stefan@example.com');
  await page.fill('#si-pass', 'wrong');
  await page.click('#signinForm button[type=submit]');
  await page.waitForFunction(() => /did not match/.test(document.getElementById('si-err').textContent));
  assert.equal(await page.locator('#clientRows').count(), 0);
  // The session is kept for this tab only.
  assert.equal(await page.evaluate(() => window.__createOpts.auth.storage === window.sessionStorage), true, 'sessionStorage, not localStorage');
  assert.equal(page.errors.length, 0, page.errors.join('; '));
  await ctx.close();
});

test('a signed-in user who is not in coaching_admins sees "This page is for the coach only" and nothing else', SKIP, async () => {
  const { ctx, page } = await open(seed({ admin: false, session: { access_token: 't', user: { id: 'u9', email: 'client@example.com' } } }));
  await page.waitForSelector('#notCoach');
  const app = await txt(page, '#app');
  assert.equal(app.trim(), 'This page is for the coach only');
  assert.equal(await page.locator('nav.tabs').count(), 0);
  assert.equal((await calls(page)).filter(c => c.kind === 'from').length, 0, 'no coaching table is read');
  await ctx.close();
});

test('first sign-in: enrol with a QR code and a manual key, the backup advice is shown, and a right code opens the app', SKIP, async () => {
  const { ctx, page } = await open(seed());
  await page.waitForSelector('#signinForm');
  await page.fill('#si-email', 'stefan@example.com');
  await page.fill('#si-pass', 'right-password');
  await page.click('#signinForm button[type=submit]');
  await page.waitForSelector('#enrolCard');
  assert.match(await page.getAttribute('img.qr', 'src'), /^data:image\/svg\+xml/);
  assert.equal(await txt(page, '#mfaSecret'), 'JBSWY3DPEHPK3PXP');
  const advice = await txt(page, '#backupAdvice');
  assert.match(advice, /second authenticator/);
  assert.match(advice, /no recovery codes/);
  assert.match(advice, /Supabase dashboard/);
  await page.fill('#mfa-code', '000000');
  await page.click('#codeForm button[type=submit]');
  await page.waitForFunction(() => /did not work/.test(document.getElementById('code-err').textContent));
  await page.fill('#mfa-code', '123456');
  await page.click('#codeForm button[type=submit]');
  await page.waitForSelector('#clientRows');
  const c = await calls(page);
  assert.ok(c.some(x => x.kind === 'mfa' && x.name === 'enroll' && x.args.factorType === 'totp'));
  assert.ok(c.some(x => x.kind === 'mfa' && x.name === 'challengeAndVerify' && x.args.code === '123456'));
  assert.equal(page.errors.length, 0, page.errors.join('; '));
  await ctx.close();
});

test('every later sign-in: a challenge, then verify, then the app (the session becomes aal2)', SKIP, async () => {
  const stub = seed({ factors: [{ id: 'factor-1', factor_type: 'totp', status: 'verified', friendly_name: 'Phone' }] });
  const { ctx, page } = await open(stub);
  await page.waitForSelector('#signinForm');
  await page.fill('#si-email', 'stefan@example.com');
  await page.fill('#si-pass', 'right-password');
  await page.click('#signinForm button[type=submit]');
  await page.waitForSelector('#challengeCard');
  assert.equal((await calls(page)).filter(c => c.kind === 'from').length, 0, 'nothing is read before the code');
  await page.fill('#mfa-code', '123456');
  await page.click('#codeForm button[type=submit]');
  await page.waitForSelector('#clientRows');
  const c = (await calls(page)).filter(x => x.kind === 'mfa');
  assert.deepEqual(c.map(x => x.name), ['challenge', 'verify']);
  assert.equal(c[1].args.challengeId, 'challenge-1');
  assert.equal(await page.evaluate(() => window.__stub.aal), 'aal2');
  await ctx.close();
});

test('sign out: the session ends and the sign-in form is back', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await page.waitForSelector('#clientRows');
  await page.click('#signOutBtn');
  await page.waitForSelector('#signinForm');
  assert.ok((await calls(page)).some(c => c.kind === 'auth' && c.name === 'signOut'));
  await ctx.close();
});

/* ------------------------------------------------------------------ clients list */
test('clients list: status and plan filters, search by name or email, and badges for awaiting activation and health flags', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await page.waitForSelector('#clientRows');
  const visible = () => page.$$eval('[data-client-row]:not([hidden]) .btn-link', els => els.map(e => e.textContent));
  assert.equal((await visible()).length, 6);
  await page.selectOption('#fStatus', 'awaiting_activation');
  assert.deepEqual(await visible(), ['Hana Health']);
  await page.selectOption('#fStatus', '');
  await page.selectOption('#fTier', 'basic');
  assert.deepEqual(await visible(), ['Bo Basic']);
  await page.selectOption('#fTier', '');
  await page.fill('#fQ', 'cole@');
  assert.deepEqual(await visible(), ['Cole Core']);
  await page.fill('#fQ', '');
  const hana = await txt(page, '[data-client-row][data-id="1"]');
  assert.match(hana, /Awaiting activation/);
  assert.match(hana, /Health flag/);
  assert.doesNotMatch(await txt(page, '[data-client-row][data-id="3"]'), /Health flag/);
  assert.match(await txt(page, '[data-client-row][data-id="5"]'), /Private/, 'Basic logs are private');
  await ctx.close();
});

test('capacity: changing the place limit saves it', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await page.waitForSelector('#cap-core');
  await page.fill('#cap-core', '30');
  await page.dispatchEvent('#cap-core', 'change');
  await page.waitForFunction(() => window.__stub.db.coaching_capacity.find(r => r.tier === 'core').place_limit === 30);
  await ctx.close();
});

test('add client by hand: success tells you to have them sign in at beastcoach.fit/dashboard with that exact email; a full plan is refused', SKIP, async () => {
  let r = await open(SIGNED_IN_AAL2());
  let page = r.page;
  await page.waitForSelector('#ac-email');
  await page.fill('#ac-email', 'New.Person@Example.com');
  await page.fill('#ac-name', 'New Person');
  await page.selectOption('#ac-tier', 'essential');
  await page.fill('#ac-amount', '110');
  await page.click('button[data-act="addClient"]');
  await page.waitForSelector('#addResult');
  const msg = await txt(page, '#addResult');
  assert.match(msg, /beastcoach\.fit\/dashboard/);
  assert.match(msg, /New\.Person@Example\.com/);
  const call = (await calls(page)).find(c => c.name === 'coach_add_client');
  assert.deepEqual(call.args, { p_email: 'New.Person@Example.com', p_name: 'New Person', p_tier: 'essential', p_amount_cents: 11000, p_paid_on: TODAY() });
  await r.ctx.close();
  r = await open(Object.assign(SIGNED_IN_AAL2(), { full: true }));
  page = r.page;
  await page.waitForSelector('#ac-email');
  await page.fill('#ac-email', 'x@example.com'); await page.fill('#ac-name', 'X'); await page.selectOption('#ac-tier', 'beast'); await page.fill('#ac-amount', '699');
  await page.click('button[data-act="addClient"]');
  await page.waitForSelector('#addResult');
  assert.match(await txt(page, '#addResult'), /That plan is full/);
  await r.ctx.close();
});

/* ------------------------------------------------------------------ client page */
test('health flag: Activate stays disabled until "Cleared to start" is ticked, then a confirm step activates', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Hana Health');
  assert.match(await txt(page, '#healthBox'), /heart condition or high blood pressure/);
  assert.equal(await page.locator('button[data-act="askActivate"]').isDisabled(), true, 'disabled while the flag is open');
  await page.check('#clearedBox');
  await page.waitForFunction(() => window.__stub.db.coaching_clients.find(c => c.id === 1).health_cleared_at);
  await page.waitForFunction(() => !document.querySelector('button[data-act="askActivate"]').disabled);
  await page.click('button[data-act="askActivate"]');
  await page.waitForSelector('#confirmBox');
  assert.match(await txt(page, '#confirmBox'), /Activate Hana Health from/);
  await page.click('button[data-act="confirmYes"]');
  await page.waitForFunction(() => window.__stub.db.coaching_clients.find(c => c.id === 1).status === 'active');
  const upd = (await calls(page)).filter(c => c.table === 'coaching_clients' && c.op === 'update').map(c => c.payload);
  assert.ok(upd.some(p => p.status === 'active' && p.start_date === TODAY()), 'activate sends the status and the start date (the database sets activated_at and the end date)');
  await ctx.close();
});

test('pause and resume, each with a confirm step, and "Pause days used N of 14"', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Bea Beast');
  assert.equal((await txt(page, '#pauseDays')).trim(), '7 of 14', '5 used plus 2 days of this pause');
  await page.click('button[data-act="askResume"]');
  await page.waitForSelector('#confirmBox');
  await page.click('button[data-act="confirmYes"]');
  await page.waitForFunction(() => window.__stub.db.coaching_clients.find(c => c.id === 4).status === 'active');
  await page.click('button[data-act="backClients"]');
  await openClient(page, 'Cole Core');
  await page.click('button[data-act="askPause"]');
  await page.waitForSelector('#confirmBox');
  await page.click('button[data-act="confirmNo"]');
  assert.equal(await page.evaluate(() => window.__stub.db.coaching_clients.find(c => c.id === 3).status), 'active', 'Not now changes nothing');
  await page.click('button[data-act="askPause"]');
  await page.click('button[data-act="confirmYes"]');
  await page.waitForFunction(() => window.__stub.db.coaching_clients.find(c => c.id === 3).status === 'paused');
  await ctx.close();
});

test('check-ins: Essential with a kick-off call cannot book another; a London client gets times entered in Melbourne time, with their own time beside', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Erin Essential');
  await tab(page, 'Check-ins');
  assert.match(await txt(page, '#app'), /Essential includes one kick-off call\. Edit it or cancel it/);
  assert.equal(await page.locator('#ci-date').count(), 0);
  await page.click('button[data-act="backClients"]');
  await openClient(page, 'Cole Core');
  await tab(page, 'Check-ins');
  const date = addDaysStr(TODAY(), 3);
  await page.fill('#ci-date', date);
  await page.selectOption('#ci-time', '18:30');
  await page.dispatchEvent('#ci-time', 'change');
  assert.match(await txt(page, '#ciPreview'), /For the client that is .*\(Europe\/London\)/);
  await page.selectOption('#ci-type', 'Video call');
  await page.click('button[data-act="saveCheckin"]');
  await page.waitForFunction(() => window.__stub.db.coaching_checkins.some(c => c.client_id === 3));
  const saved = await page.evaluate(() => window.__stub.db.coaching_checkins.find(c => c.client_id === 3));
  const mel = new Intl.DateTimeFormat('en-CA', { timeZone: MELB, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(saved.scheduled_at));
  assert.equal(mel.replace(',', ''), `${date} 18:30`, 'stored as 6:30pm Melbourne time');
  assert.equal(saved.type, 'Video call');
  await page.waitForSelector('.client-time');
  assert.match(await txt(page, '.client-time'), /Client: .*\(Europe\/London\)/);
  // Edit, then cancel with a confirm step
  await page.click('button[data-act="editCheckin"]');
  await page.selectOption('#ci-time', '19:00');
  await page.click('button[data-act="saveCheckin"]');
  await page.waitForFunction(() => window.__calls.some(c => c.table === 'coaching_checkins' && c.op === 'update' && c.payload.scheduled_at));
  await page.click('button[data-act="askCancelCheckin"]');
  await page.click('button[data-act="confirmYes"]');
  await page.waitForFunction(() => window.__stub.db.coaching_checkins.find(c => c.client_id === 3).status === 'cancelled');
  await ctx.close();
});

// Read the meal rows currently on screen.
const rowsOnScreen = page => page.$$eval('.meal-row[data-row]', els => els.map(el => ({
  label: el.querySelector('input[data-f="label"]').value,
  text: el.querySelector('input[data-f="text"]').value,
  calories: Number(el.querySelector('input[data-f="calories"]').value)
})));
const savedDraft = page => page.evaluate(() => (window.__stub.db.coaching_plan_drafts || [])[0]);

test('plan editor: calculate row one, add row two, calculate row two: row one is unchanged (the overwrite bug)', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-text', '60g oats, 1 banana');
  await page.click('button[data-act="calcRow"][data-i="0"]');
  await page.waitForFunction(() => document.querySelector('#r0-calories').value !== '0');
  await page.click('button[data-act="addRow"]');
  await page.fill('#r1-label', 'Lunch');
  await page.fill('#r1-text', '150g chicken, 150g rice');
  await page.click('button[data-act="calcRow"][data-i="1"]');
  await page.waitForFunction(() => document.querySelector('#r1-calories').value !== '0');
  const rows = await rowsOnScreen(page);
  assert.equal(rows.length, 2, 'two rows');
  assert.equal(rows[0].label, 'Meal 1', 'row one keeps its label');
  assert.equal(rows[0].text, '60g oats, 1 banana', 'row one keeps its foods');
  assert.equal(rows[0].calories, 100 + 'Meal 1: 60g oats, 1 banana'.length, 'row one keeps its numbers');
  assert.equal(rows[1].calories, 100 + 'Lunch: 150g chicken, 150g rice'.length, 'row two got its own numbers');
  assert.equal(page.aiCalls.length, 2, 'each calculate sent one meal line');
  assert.equal(page.aiCalls[1].body.text, 'Lunch: 150g chicken, 150g rice', 'row two\'s call carries only row two');
  await ctx.close();
});

test('plan editor: a new meal typed in a fresh row never deletes the calculated rows above it', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-text', 'toast');
  await page.click('button[data-act="calcRow"][data-i="0"]');
  await page.waitForFunction(() => document.querySelector('#r0-calories').value !== '0');
  await page.click('button[data-act="addRow"]');
  await page.click('button[data-act="addRow"]');
  assert.equal((await rowsOnScreen(page)).length, 3, 'add row always appends');
  assert.equal((await rowsOnScreen(page))[0].text, 'toast', 'existing rows are untouched by add');
  await ctx.close();
});

test('plan editor: the draft is saved in the database as you type, survives a reload, and shows Draft saved', SKIP, async () => {
  const r1 = await open(SIGNED_IN_AAL2());
  let page = r1.page;
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-text', 'Oats and berries');
  await page.fill('#r0-label', 'Breakfast');
  await page.waitForFunction(() => /Draft saved/.test(document.getElementById('planStatus').textContent));
  assert.match(await txt(page, '#planStatus'), /Unpublished changes/);
  const saved = await savedDraft(page);
  assert.ok(saved, 'the draft is in coaching_plan_drafts');
  assert.equal(saved.client_id, 3);
  assert.equal(saved.draft.meals['1'][0].text, 'Oats and berries');
  // "Reload": a new page with the same database
  const db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stub)));
  await r1.ctx.close();
  const r2 = await open(db);
  page = r2.page;
  await page.waitForSelector('#clientRows');
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  assert.equal(await page.inputValue('#r0-text'), 'Oats and berries', 'the draft comes back after a reload');
  assert.equal(await page.inputValue('#r0-label'), 'Breakfast');
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'nothing is kept only in the browser');
  await r2.ctx.close();
});

test('plan editor: the client never sees a draft; Publish plan makes the plan visible, as a new version', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-text', 'Oats');
  await page.fill('#r0-calories', '400');
  await page.dispatchEvent('#r0-calories', 'input');
  assert.match(await txt(page, '#planStatus'), /Unpublished changes/, 'a change is not published');
  const before = await page.evaluate(() => window.__stub.db.coaching_plans.filter(p => p.client_id === 3).length);
  await page.click('button[data-act="publish"]');
  await page.waitForFunction(() => /version 1/.test(document.getElementById('planStatus').textContent));
  const after = await page.evaluate(() => window.__stub.db.coaching_plans.filter(p => p.client_id === 3));
  assert.equal(after.length, before + 1, 'a new version is added');
  const current = after.find(p => p.is_current);
  assert.equal(current.version, 1, 'the first publish is version 1 (this client had no plan before)');
  assert.equal(current.plan.meals['1'][0].text, 'Oats', 'the published meal is in the shape the client reads');
  assert.equal(after.filter(p => p.is_current).length, 1, 'one current plan');
  assert.match(await txt(page, '#planStatus'), /Published/);
  await ctx.close();
});

test('plan editor: copy this day to chosen days; copying over days that already have meals asks first', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-text', 'Oats');
  await page.click('button[data-act="addRow"]');
  await page.fill('#r1-text', 'Chicken');
  await page.click('button[data-act="pDay"][data-d="1"]');
  await page.check('input[data-copy-day="2"]');
  await page.check('input[data-copy-day="3"]');
  await page.click('button[data-act="copyDay"]');
  await page.waitForFunction(() => /Draft saved/.test(document.getElementById('planStatus').textContent));
  const tueThu = await page.evaluate(() => ({ tue: window.__stub.db.coaching_plan_drafts[0].draft.meals['2'].length, wed: window.__stub.db.coaching_plan_drafts[0].draft.meals['3'].length }));
  assert.deepEqual(tueThu, { tue: 2, wed: 2 }, 'copied to Tuesday and Wednesday');
  // Copy again to Tuesday, which now has meals: a confirm step first
  await page.click('button[data-act="pDay"][data-d="1"]');
  await page.check('input[data-copy-day="2"]');
  await page.click('button[data-act="copyDay"]');
  await page.waitForSelector('#confirmBox');
  assert.match(await txt(page, '#confirmBox'), /Replace the meals on Tuesday/);
  await page.click('button[data-act="confirmNo"]');
  assert.equal(await page.evaluate(() => window.__stub.db.coaching_plan_drafts[0].draft.meals['2'].length), 2, 'Not now changes nothing');
  await page.check('input[data-copy-day="2"]');   // Not now re-draws the page, so the tick is set again
  await page.click('button[data-act="copyDay"]');
  await page.click('button[data-act="confirmYes"]');
  await page.waitForFunction(() => window.__stub.db.coaching_plan_drafts[0].draft.meals['2'].length === 2);
  await ctx.close();
});

test('plan editor: each row can be moved up and down, and deleted with a confirm when it has foods', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-text', 'A');
  await page.click('button[data-act="addRow"]');
  await page.fill('#r1-text', 'B');
  await page.click('button[data-act="moveRow"][data-i="1"][data-dir="-1"]');
  assert.deepEqual((await rowsOnScreen(page)).map(r => r.text), ['B', 'A']);
  await page.click('button[data-act="delRow"][data-i="0"]');
  await page.click('button[data-act="confirmYes"]');
  assert.deepEqual((await rowsOnScreen(page)).map(r => r.text), ['A']);
  await ctx.close();
});

test('plan editor: the day totals change straight away when a row changes, and the keyboard stays put', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.click('button[data-act="addRow"]');   // the day starts empty: add the first meal
  await page.fill('#r0-calories', '650');
  await page.dispatchEvent('#r0-calories', 'input');
  assert.match(await txt(page, '#dayTotals'), /650/);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'r0-calories', 'focus did not move');
  await ctx.close();
});

test('protein powder: the coach sees the answer on the Overview; a client who never answered shows "Not asked"', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Hana Health');
  assert.match(await txt(page, '#app'), /Protein powder\s*Yes: Brand X vanilla/);
  await page.click('button[data-act="backClients"]');
  await openClient(page, 'Cole Core');
  assert.match(await txt(page, '#app'), /Protein powder\s*Not asked/);
  await tab(page, 'Targets and plan');
  assert.match(await txt(page, '.plan-inputs'), /Protein powder/, 'the Plan inputs panel has it too');
  await ctx.close();
});

test('targets: changing one saves the targets straight away', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Targets and plan');
  await page.fill('#t-steps', '9500');
  await page.dispatchEvent('#t-steps', 'change');
  await page.waitForFunction(() => window.__stub.db.coaching_clients.find(c => c.id === 3).targets.steps === 9500);
  await ctx.close();
});

test('logs: from activation, with sets and reps, a lift that went up, steps, and the baseline kept apart', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Logs');
  const logs = await txt(page, '#logsCard');
  assert.match(logs, /62\.5 kg x 8, 62\.5 kg x 7/);
  assert.match(logs, /Up \+2\.5 kg/);
  assert.match(logs, /7,400 steps/);
  assert.match(logs, /Logged before activation \(baseline\)/);
  await ctx.close();
});

test('notes: private, saved as you type', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Cole Core');
  await tab(page, 'Notes');
  await page.fill('#noteBox', 'Knee is better. Add lunges in week 3.');
  await page.waitForFunction(() => (window.__stub.db.coaching_notes[0] || {}).body === 'Knee is better. Add lunges in week 3.');
  assert.equal(await page.evaluate(() => window.__stub.db.coaching_notes[0].client_id), 3);
  await ctx.close();
});

test('a Basic client: plan, status and billing only, with no logs, plan editor or notes', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await openClient(page, 'Bo Basic');
  assert.match(await txt(page, '#app'), /Basic clients log privately/);
  assert.equal(await page.locator('button.tab:has-text("Logs")').count(), 0);
  assert.equal((await calls(page)).filter(c => c.table === 'coaching_meal_logs' && c.filters.includes('client_id=5')).length, 0, 'no Basic logs are read');
  await ctx.close();
});

/* ------------------------------------------------------------------ customers and settings */
test('customers: Export CSV holds only the database\'s consented, not-unsubscribed list (email, name, plan, date)', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await page.waitForSelector('#clientRows');
  await page.click('button[data-act="coachPage"][data-p="customers"]');
  await page.waitForSelector('#custRows');
  assert.equal(await page.locator('[data-cust-row]').count(), 3, 'every customer is listed');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="exportCsv"]')]);
  const file = await download.path();
  const csv = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(csv[0], 'email,name,plan,date');
  assert.equal(csv.length, 2);
  assert.match(csv[1], /^cole@example\.com,Cole Core,Core,\d{4}-\d{2}-\d{2}$/);
  assert.ok((await calls(page)).some(c => c.name === 'coach_marketing_export'), 'the list comes from the database function');
  // Unsubscribe with a confirm step, by exact row, never a pattern
  await page.click('button[data-act="askUnsub"][data-email="cole@example.com"]');
  await page.click('button[data-act="confirmYes"]');
  await page.waitForFunction(() => window.__stub.db.coaching_customers.find(c => c.id === 'c1').unsubscribed_at);
  const upd = (await calls(page)).find(c => c.table === 'coaching_customers' && c.op === 'update');
  assert.deepEqual(upd.filters, ['id in c1']);
  await ctx.close();
});

test('settings: the WhatsApp number is saved to coaching_settings, and a backup authenticator can be added', SKIP, async () => {
  const { ctx, page } = await open(SIGNED_IN_AAL2());
  await page.waitForSelector('#clientRows');
  await page.click('button[data-act="coachPage"][data-p="settings"]');
  await page.fill('#waNumber', '+61 400 123 456');
  await page.click('button[data-act="saveWhatsapp"]');
  await page.waitForFunction(() => (window.__stub.db.coaching_settings[0] || {}).coach_whatsapp === '+61 400 123 456');
  assert.equal(await page.evaluate(() => window.__stub.db.coaching_settings[0].id), true);
  assert.match(await txt(page, '#factorsCard'), /You have one authenticator\. Add a backup now\./);
  await page.click('button[data-act="addBackup"]');
  await page.waitForSelector('#backupCard img.qr');
  await page.fill('#mfa-code', '123456');
  await page.click('#codeForm button[type=submit]');
  await page.waitForFunction(() => window.__stub.factors.filter(f => f.status === 'verified').length === 2);
  await page.waitForFunction(() => !/Add a backup now/.test(document.getElementById('factorsCard').textContent));
  await ctx.close();
});

/* ------------------------------------------------------------------ safety */
test('coach.html: noindex, no secret keys, and not linked from any page on the site', () => {
  const html = fs.readFileSync(path.join(ROOT, 'coach.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html, /service_role|sb_secret_|SUPABASE_SERVICE_ROLE/);
  assert.doesNotMatch(html, /\u2014|\u2013/, 'no em or en dashes');
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== 'coach.html');
  const linking = pages.filter(f => /href="\/coach(\.html)?["?#]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(linking, [], 'no page links to /coach');
});
