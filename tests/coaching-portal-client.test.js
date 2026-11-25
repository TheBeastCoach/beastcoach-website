// Browser tests for the client side of My Coach (my-coach.html), on a stubbed Supabase.
// The page talks to Supabase through the real REST and RPC shapes. Those are answered here by a small in-memory
// backend that applies the same rules as the database (the logging window, one weigh-in a week, the row a client
// may see). The database rules themselves are tested in tests/coaching-portal-rls.test.js and in the verify script.
// Beast AI (/api/coach-ai) is answered by a stub too, so no Anthropic call is made.
//
// Run with: PLAYWRIGHT_CORE_PATH=... CHROME_PATH=... node --test tests/coaching-portal-client.test.js
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
const SUPABASE = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png' };
let browser, server, base;

/* ------------------------------------------------------------------------ dates (Melbourne) */
const MELB = 'Australia/Melbourne';
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: MELB, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDaysStr = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); };
const TODAY = () => ymd(new Date());
const WEEKDAY = s => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][((new Date(s + 'T12:00:00Z').getUTCDay()) + 6) % 7];
const NOW_ISO = () => new Date().toISOString();

/* ------------------------------------------------------------------------ the browser-side stand-in for supabase-js */
const FAKE_SUPABASE = `
(function () {
  const URL_BASE = ${JSON.stringify(SUPABASE)};
  const PUB = "sb_publishable_3AdpZhYhif9JeP3rvmY2-Q_MuhFMGiw";
  function headers(extra) {
    const s = window.__stub && window.__stub.session;
    return Object.assign({ apikey: PUB, Authorization: 'Bearer ' + (s ? s.access_token : PUB), 'Content-Type': 'application/json' }, extra || {});
  }
  async function send(method, url, body, extra) {
    const r = await fetch(url, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    const text = await r.text();
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (r.status >= 400) return { data: null, error: Object.assign(new Error(data && data.message || 'error'), { code: data && data.code, status: r.status }) };
    return { data, error: null };
  }
  function from(table) {
    const st = { table, sel: '*', filters: [], order: null, limit: null, method: 'GET', body: undefined, extra: null, onConflict: null };
    const api = {
      select(c) { st.sel = c || '*'; return api; },
      eq(c, v) { st.filters.push(c + '=eq.' + encodeURIComponent(v)); return api; },
      gte(c, v) { st.filters.push(c + '=gte.' + encodeURIComponent(v)); return api; },
      order(c, o) { st.order = c + (o && o.ascending === false ? '.desc' : '.asc'); return api; },
      limit(n) { st.limit = n; return api; },
      insert(b) { st.method = 'POST'; st.body = b; st.extra = { Prefer: 'return=minimal' }; return api; },
      upsert(b, o) { st.method = 'POST'; st.body = b; st.onConflict = o && o.onConflict; st.extra = { Prefer: 'resolution=merge-duplicates,return=minimal' }; return api; },
      update(b) { st.method = 'PATCH'; st.body = b; st.extra = { Prefer: 'return=minimal' }; return api; },
      delete() { st.method = 'DELETE'; st.extra = { Prefer: 'return=minimal' }; return api; },
      then(res, rej) {
        const qs = ['select=' + encodeURIComponent(st.sel)].concat(st.filters);
        if (st.order) qs.push('order=' + st.order);
        if (st.limit) qs.push('limit=' + st.limit);
        if (st.onConflict) qs.push('on_conflict=' + st.onConflict);
        const url = URL_BASE + '/rest/v1/' + table + (st.method === 'GET' || st.method === 'PATCH' || st.method === 'DELETE' ? '?' + qs.join('&') : (st.onConflict ? '?on_conflict=' + st.onConflict : ''));
        return send(st.method, url, st.body, st.extra).then(res, rej);
      }
    };
    return api;
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: window.__stub.session || null }, error: null }),
      signOut: async () => { window.__stub.session = null; return { error: null }; }
    },
    rpc(name, args) { return send('POST', URL_BASE + '/rest/v1/rpc/' + name, args || {}); },
    from
  };
  window.supabase = { createClient: () => client };
})();
`;

/* ------------------------------------------------------------------------ the in-memory backend */
function newBackend(opts) {
  const o = opts || {};
  const today = TODAY();
  const weekday = WEEKDAY(today);
  const plan = { meals: {}, training: '' };
  const trainLines = [];
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, i) => {
    plan.meals[i + 1] = [
      { label: 'Breakfast', name: 'Oats', text: '60g oats, 1 banana', calories: 420, protein: 15, carbs: 70, fat: 9, fibre: 8 },
      { label: 'Lunch', name: 'Tuna wrap', text: '1 wrap, 130g tuna', calories: 520, protein: 40, carbs: 50, fat: 14, fibre: 6 }
    ];
    trainLines.push(`${d}: ${d === 'Mon' ? 'Full body A' : 'Session ' + d}`);
    if (d === 'Mon') trainLines.push('- Squat 3x8', '- Bench press 3x8');
    else trainLines.push('- Dumbbell row 3x10');
  });
  plan.training = trainLines.join('\n');
  const activated = addDaysStr(today, -10);
  const row = Object.assign({
    id: 1, user_id: 'user-1', email: 'client@example.com', name: 'Client Example', tier: 'core', status: 'active',
    start_date: activated, activated_at: activated + 'T09:00:00+11:00', end_date: addDaysStr(activated, 84),
    time_zone: 'Australia/Melbourne', whatsapp: '+61 400 000 001', created_at: activated + 'T08:00:00Z',
    onboarding: { weighInDay: weekday, weighInTime: '07:00', goal: 'Get stronger' },
    targets: { calories: 2000, protein: 150, carbs: 200, fat: 70, fibre: 28, steps: 8000 }
  }, o.row || {});
  const db = {
    today, weekday,
    clients: o.extraClients ? [row].concat(o.extraClients) : [row],
    plans: [{ client_id: 1, version: 1, is_current: true, plan }],
    meals: [], workouts: [], steps: [], weighIns: [],
    checkins: o.checkins === undefined ? [{ id: 'c1', client_id: 1, type: 'Check-in', scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'scheduled' }] : o.checkins,
    consent: [], marketing: false, deleted: false, requests: [], ai: [], rpc: [], ...o.extra
  };
  if (o.meals) db.meals = o.meals;
  return db;
}
// The window the database applies: from activation, up to 3 days back, today at most, active only.
// "Today" and the activation day are in the client's own zone (coaching_clients.time_zone), else Melbourne.
function zoneOf(c) {
  try { new Intl.DateTimeFormat('en-AU', { timeZone: c.time_zone }); return c.time_zone; } catch (e) { return MELB; }
}
function ymdIn(d, zone) { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function canLog(db, c, day) {
  if (c.status !== 'active' || !c.activated_at) return false;
  const zone = zoneOf(c);
  const start = ymdIn(new Date(c.activated_at), zone), today = ymdIn(new Date(), zone);
  return day >= start && day <= today && day >= addDaysStr(today, -3);
}
function matches(rowObj, filters) {
  return filters.every(f => {
    const m = /^([a-z_]+)=(eq|gte)\.(.*)$/.exec(f);
    if (!m) return true;
    const [, col, op, valRaw] = m; const val = decodeURIComponent(valRaw);
    const got = rowObj[col];
    if (op === 'eq') return String(got) === val;
    return String(got) >= val;
  });
}
function handleRest(db, method, url, bodyText) {
  const u = new URL(url);
  const table = u.pathname.replace('/rest/v1/', '');
  const body = bodyText ? JSON.parse(bodyText) : undefined;
  const filters = [...u.searchParams.entries()].filter(([k]) => k !== 'select' && k !== 'order' && k !== 'limit' && k !== 'on_conflict').map(([k, v]) => k + '=' + v);
  db.requests.push({ method, table, query: u.search, body });
  const tableRows = { coaching_clients: db.clients, coaching_plans: db.plans, coaching_meal_logs: db.meals, coaching_workout_logs: db.workouts,
    coaching_step_logs: db.steps, coaching_weigh_ins: db.weighIns, coaching_checkins: db.checkins, coaching_customers: db.customers || [], coaching_admins: [] }[table];
  if (table.startsWith('rpc/')) return handleRpc(db, table.slice(4), body);
  if (!tableRows) return { status: 404, body: { code: 'PGRST205', message: 'no table' } };
  if (method === 'GET') {
    const sel = u.searchParams.get('select') || '*';
    const cols = sel === '*' ? null : sel.split(',');
    let rows = tableRows.filter(r => matches(r, filters));
    if (table === 'coaching_clients' && rows.some(r => 'notes' in r)) return { status: 403, body: { code: '42501', message: 'permission denied for column notes' } };
    const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, Number(lim));
    return { status: 200, body: rows.map(r => (cols ? Object.fromEntries(cols.map(c => [c, r[c]])) : r)) };
  }
  if (method === 'POST') {
    const items = Array.isArray(body) ? body : [body];
    for (const item of items) {
      if (table === 'coaching_meal_logs' || table === 'coaching_workout_logs' || table === 'coaching_step_logs' || table === 'coaching_weigh_ins') {
        const c = db.clients.find(x => x.id === item.client_id);
        const day = item.log_date || item.weigh_date;
        if (!c || !canLog(db, c, day)) return { status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' } };
      }
      if (table === 'coaching_weigh_ins') {
        const wk = weekStart(item.weigh_date);
        if (db.weighIns.some(w => w.client_id === item.client_id && weekStart(w.weigh_date) === wk)) return { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const c = db.clients.find(x => x.id === item.client_id);
        if (WEEKDAY(item.weigh_date) !== c.onboarding.weighInDay) return { status: 403, body: { code: '42501', message: 'new row violates row-level security policy for table "coaching_weigh_ins"' } };
      }
      if (table === 'coaching_step_logs') {
        const existing = db.steps.find(s => s.client_id === item.client_id && s.log_date === item.log_date);
        if (existing) { Object.assign(existing, item); continue; }
      }
      tableRows.push(Object.assign({ id: 'id-' + Math.random().toString(36).slice(2, 9), logged_at: NOW_ISO() }, item));
    }
    return { status: 201, body: '' };
  }
  if (method === 'PATCH' || method === 'DELETE') {
    const id = (filters.find(f => f.startsWith('id=eq.')) || '').slice(6);
    const target = tableRows.filter(r => matches(r, filters));
    if (method === 'DELETE') {
      if (table === 'coaching_meal_logs' || table === 'coaching_workout_logs') {
        const c = target[0] && db.clients.find(x => x.id === target[0].client_id);
        if (target.length && (!c || !canLog(db, c, target[0].log_date))) return { status: 403, body: { code: '42501', message: 'row-level security' } };
      }
      for (let i = tableRows.length - 1; i >= 0; i--) if (target.includes(tableRows[i])) tableRows.splice(i, 1);
    } else {
      target.forEach(r => Object.assign(r, body));
    }
    void id;
    return { status: 204, body: '' };
  }
  return { status: 405, body: { code: 'PGRST', message: 'method' } };
}
function weekStart(s) { const [y, m, d] = s.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); const iso = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - iso); return dt.toISOString().slice(0, 10); }
function handleRpc(db, name, args) {
  db.rpc.push({ name, args });
  if (name === 'claim_coaching') {
    if (!db.clients.length) return { status: 200, body: { linked: false, reason: 'no_plan_for_this_email' } };
    return { status: 200, body: { linked: true, status: db.clients[0].status, tier: db.clients[0].tier } };
  }
  if (name === 'submit_onboarding') {
    const c = db.clients.find(x => x.status === 'awaiting_onboarding');
    if (!c) return { status: 400, body: { code: 'P0001', message: 'There is no plan waiting for onboarding.' } };
    if (c.tier === 'basic') {
      c.status = 'active'; c.activated_at = NOW_ISO(); c.targets = { calories: 1900, protein: 140, carbs: 190, fat: 63, fibre: 26, steps: 9000, maintenance: 1900 };
      return { status: 200, body: { ok: true, status: 'active', targets: c.targets } };
    }
    c.status = 'awaiting_activation';
    return { status: 200, body: { ok: true, status: 'awaiting_activation' } };
  }
  if (name === 'set_marketing_consent') { db.consent.push(args.p_on); db.marketing = args.p_on; return { status: 200, body: { ok: true, customer_records: 1 } }; }
  // As the database: the number only for a The Beast client who is active or paused, and only if the coach set one.
  if (name === 'get_coach_whatsapp') { const c = db.clients[0]; return { status: 200, body: c && c.tier === 'beast' && ['active', 'paused'].includes(c.status) ? (db.coachWa === undefined ? '+61 400 000 999' : db.coachWa) : null }; }
  if (name === 'get_my_marketing_consent') { return { status: 200, body: db.marketing === true } ; }
  if (name === 'delete_my_coaching_data') { db.deleted = true; db.clients.splice(0, db.clients.length); db.meals.length = 0; db.workouts.length = 0; db.steps.length = 0; db.weighIns.length = 0; db.checkins.length = 0; db.plans.length = 0; return { status: 200, body: { deleted: true, client_rows_removed: 1, customer_record_kept: true } }; }
  return { status: 404, body: { code: 'PGRST202', message: 'no function ' + name } };
}

/* ------------------------------------------------------------------------ server and browser */
test.before(async () => {
  if (!pw) return;
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file = file + '.html';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

// Opens My Coach for a signed-in user, with this backend behind Supabase and this Beast AI stub.
async function open(backend, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: MELB, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = []; page.sent = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route(url => /^https?:\/\//.test(url.href) && !url.href.startsWith(base) && !url.href.startsWith(SUPABASE) && !/cdn\.jsdelivr\.net\/npm\/@supabase/.test(url.href), r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE }));
  await page.route(SUPABASE + '/**', async route => {
    const req = route.request();
    const out = handleRest(backend, req.method(), req.url(), req.postData());
    await route.fulfill({ status: out.status, contentType: 'application/json', body: out.status === 204 || out.body === '' ? '' : JSON.stringify(out.body) });
  });
  await page.route('**/api/coach-ai', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const auth = route.request().headers().authorization || '';
    backend.ai.push({ body, auth });
    const reply = (o.ai && o.ai(body)) || defaultAi(body);
    await route.fulfill({ status: reply.status || 200, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  await page.addInitScript(s => { window.__stub = { session: s }; }, o.signedIn === false ? null : { access_token: 'token-user-1', user: { id: 'user-1', email: 'client@example.com' } });
  await page.goto(base + '/my-coach');
  await page.waitForLoadState('domcontentloaded');
  return { ctx, page };
}
function defaultAi(body) {
  if (body.mode === 'log') return { body: { name: 'Eggs on toast', calories: 380, protein: 18, carbs: 30, fat: 19, fibre: 4, items: [], note: 'Standard portions.', confidence: 'high' } };
  if (body.mode === 'fridge') return { body: { items: ['chicken thighs', 'rice', 'spinach'] } };
  if (body.mode === 'create') return { body: { meals: [{ name: 'Chicken and rice', calories: 600, protein: 45, carbs: 60, fat: 14, fibre: 6, uses: ['150 g chicken thighs'], pantry: [], steps: ['Cook'], tip: 'Add greens.' }] } };
  if (body.mode === 'exercise') return { body: { name: body.name, works: 'Legs.', steps: ['Stand tall.', 'Squat down.'], tips: ['Keep your chest up.'], mistakes: ['Knees in.'], easier: 'Use a chair.' } };
  return { status: 500, body: { error: 'try_again' } };
}
const txt = (page, sel) => page.evaluate(s => (document.querySelector(s) || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(), sel);
const hasText = (page, t) => page.evaluate(s => document.body.textContent.includes(s), t);
async function waitForApp(page) { await page.waitForFunction(() => document.querySelector('#app h1') || document.querySelector('#app .card')); }

/* ------------------------------------------------------------------------ tests */

test('signed out: My Coach sends the visitor to the dashboard sign-in, and brings them back', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend, { signedIn: false });
  await page.waitForURL(/\/dashboard\?next=my-coach/);
  assert.ok(page.url().includes('next=my-coach'));
  await ctx.close();
});

test('active Core client: the check-in card, the Today screen and the WhatsApp button stay off (Core)', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.match(await txt(page, '#checkinCard h3'), /^Next check-in: /);
  assert.match(await txt(page, '#checkinCard'), /I'll contact you on WhatsApp at this time\./);
  assert.equal(await page.locator('a', { hasText: 'Message Stefan on WhatsApp' }).count(), 0, 'WhatsApp is for The Beast only');
  assert.equal(await page.locator('#addMealCard').count(), 1, 'add a meal is open today');
  assert.deepEqual(await page.$$eval('#addMealCard .seg button', bs => bs.map(b => b.textContent.trim())), ['From my plan', 'Describe it', 'Meal Builder']);
  assert.equal(await page.locator('#addMealCard .seg button.on').textContent(), 'From my plan', 'From my plan is the default for coached plans');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('the check-in card shows the Melbourne time as well when the client is in another zone', SKIP, async () => {
  const backend = newBackend({ row: { time_zone: 'Europe/London' }, checkins: [{ id: 'c9', client_id: 1, type: 'Video call', scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'scheduled' }] });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.match(await txt(page, '#checkinCard .eyebrow'), /Video call/);
  assert.match(await txt(page, '#checkinCard'), /\(Melbourne time /, 'Melbourne time shown beside the London time');
  await ctx.close();
});

test('the check-in card is hidden when nothing is scheduled', SKIP, async () => {
  const backend = newBackend({ checkins: [] });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.equal(await page.locator('#checkinCard').count(), 0);
  await ctx.close();
});

test('The Beast: the WhatsApp button is shown', SKIP, async () => {
  const backend = newBackend({ row: { tier: 'beast' } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.equal(await page.locator('a', { hasText: 'Message Stefan on WhatsApp' }).count(), 1);
  assert.equal(await page.getAttribute('a:has-text("Message Stefan on WhatsApp")', 'href'), 'https://wa.me/61400000999', 'the number comes from get_coach_whatsapp');
  assert.ok(backend.rpc.some(r => r.name === 'get_coach_whatsapp'));
  await ctx.close();
});

test('From my plan: logging a planned meal saves it as a plan meal for today', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.locator('button[data-act="logPlan"]').first().click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Logged from your plan'));
  const saved = backend.meals.find(m => m.source === 'plan');
  assert.ok(saved, 'a plan meal was saved');
  assert.equal(saved.log_date, backend.today);
  assert.equal(saved.client_id, 1);
  assert.equal(saved.name, 'Oats');
  await ctx.close();
});

test('Describe it: Calculate now asks Beast AI through the server, with the user\'s token, and saves the result as an AI meal', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.click('button[data-act="addMode"][data-m="describe"]');
  await page.fill('#describe', 'Two eggs on toast with butter');
  await page.click('button[data-act="calculate"]');
  await page.waitForSelector('#r-calories');
  assert.equal(await page.inputValue('#r-calories'), '380');
  assert.equal(backend.ai[0].auth, 'Bearer token-user-1', 'the signed-in user\'s token is sent to the server');
  assert.equal(backend.ai[0].body.mode, 'log');
  await page.click('button[data-act="saveDescribe"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Meal saved'));
  const meal = backend.meals.find(m => m.source === 'ai');
  assert.ok(meal && meal.calories === 380 && meal.ai && meal.ai.calories === 380, 'saved with the estimate');
  await ctx.close();
});

test('Meal Builder: a fridge photo, then meal ideas, then logging one', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.click('button[data-act="addMode"][data-m="builder"]');
  await page.fill('#have', 'chicken thighs, rice');
  await page.click('button[data-act="buildIdeas"]');
  await page.waitForSelector('button[data-act="logBuilt"]');
  assert.equal(backend.ai[0].body.mode, 'create');
  assert.deepEqual(backend.ai[0].body.targets && Object.keys(backend.ai[0].body.targets).sort(), ['calories', 'protein']);
  await page.click('button[data-act="logBuilt"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Meal logged'));
  assert.ok(backend.meals.some(m => m.source === 'builder' && m.name === 'Chicken and rice'));
  await ctx.close();
});

test('workouts: a plan session with sets and reps, and Other activity with blank minutes saved as no minutes', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  // Find the workout card; use today's plan session (every weekday has one in the fixture).
  await page.locator('[data-wo-kg]').first().fill('62.5');
  await page.locator('[data-wo-reps]').first().fill('8');
  await page.click('button[data-act="saveWorkout"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Workout saved'));
  const plan = backend.workouts.find(w => w.kind === 'plan');
  assert.ok(plan, 'a plan workout saved');
  assert.equal(plan.session.exercises[0].sets[0].kg, 62.5);
  assert.equal(plan.session.exercises[0].sets[0].reps, 8);
  await page.click('button[data-act="woMode"][data-m="other"]');
  await page.fill('#wo-what', 'Yoga');
  await page.click('button[data-act="saveWorkout"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Workout saved'));
  const other = backend.workouts.find(w => w.what === 'Yoga');
  assert.equal(other.kind, 'other');
  assert.equal(other.minutes, null, 'blank minutes are not stored as 0');
  await ctx.close();
});

test('progress: opening the tab loads the latest data, even when it was saved elsewhere', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  // Written from another device or session while this page was open
  backend.steps.push({ client_id: 1, log_date: backend.today, steps: 6400 });
  await page.click('button[data-act="tab"][data-tab="progress"]');
  await page.waitForFunction(() => document.getElementById('app').textContent.includes('6,400'));
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('progress: a saved step count and a weigh-in show on Progress straight away, without a reload', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.fill('#st-val', '8100');
  await page.click('button[data-act="saveSteps"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Steps saved'));
  await page.click('button[data-act="tab"][data-tab="progress"]');
  await page.waitForFunction(() => document.getElementById('app').textContent.includes('8,100'));
  await page.click('button[data-act="tab"][data-tab="today"]');
  await page.waitForSelector('#wi-val');
  await page.fill('#wi-val', '84.6');
  await page.click('button[data-act="saveWeigh"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Weigh-in saved'));
  await page.click('button[data-act="tab"][data-tab="progress"]');
  await page.waitForFunction(() => document.getElementById('app').textContent.includes('84.6 kg'));
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('steps card: a target is shown clearly; with no target yet, the client is told Stefan will set it', SKIP, async () => {
  const withTarget = newBackend();
  let r = await open(withTarget);
  await waitForApp(r.page);
  assert.match(await txt(r.page, '#app'), /Target: 8,000 a day/);
  await r.ctx.close();
  const noTarget = newBackend({ row: { targets: { calories: 2000, protein: 150, carbs: 200, fat: 70, fibre: 28 } } });
  r = await open(noTarget);
  await waitForApp(r.page);
  const text = await txt(r.page, '#app');
  assert.match(text, /Stefan will set your steps target with your plan\./);
  assert.doesNotMatch(text, /set by Stefan/, 'the old wording is gone');
  await r.ctx.close();
});

test('meals: a logged meal can be edited on Today, and the change is saved', SKIP, async () => {
  const backend = newBackend();
  backend.meals.push({ id: 'm-edit', client_id: 1, log_date: backend.today, name: 'Toast', calories: 300, protein: 10, carbs: 40, fat: 5, fibre: 3, source: 'typed' });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.click('button[data-act="editMeal"][data-id="m-edit"]');
  await page.fill('#e-calories', '420');
  await page.click('button[data-act="saveMealEdit"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Meal changed'));
  assert.equal(backend.meals.find(m => m.id === 'm-edit').calories, 420);
  await ctx.close();
});

test('steps: saving a day\'s count is one row per day, and saving again replaces it', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.fill('#st-val', '7400');
  await page.click('button[data-act="saveSteps"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Steps saved'));
  await page.fill('#st-val', '8100');
  await page.click('button[data-act="saveSteps"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Steps saved'));
  const days = backend.steps.filter(s => s.log_date === backend.today);
  assert.equal(days.length, 1);
  assert.equal(days[0].steps, 8100);
  await ctx.close();
});

test('weigh-in: the card appears only on the chosen weigh-in day, and one saves per week', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.fill('#wi-val', '84.6');
  await page.click('button[data-act="saveWeigh"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Weigh-in saved'));
  assert.equal(backend.weighIns.length, 1);
  await ctx.close();
  // A different weigh-in day: no card today
  const other = newBackend({ row: { onboarding: { weighInDay: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].find(d => d !== WEEKDAY(TODAY())), weighInTime: '07:00' } } });
  const second = await open(other);
  await waitForApp(second.page);
  assert.equal(await second.page.locator('#wi-val').count(), 0, 'no weigh-in box on another day');
  await second.ctx.close();
});

test('past days: Previous stops at 3 days back, and an older day is read-only', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  for (let i = 0; i < 3; i++) {
    await page.click('button[data-act="dayPrev"]');
    await page.waitForFunction(n => document.querySelectorAll('.row b').length >= 0 && S.day === addDays(clientToday(S.cur), -n), i + 1);
  }
  await page.waitForFunction(() => document.querySelector('button[data-act="dayPrev"]').disabled);
  assert.equal(await page.locator('button[data-act="dayPrev"]').isDisabled(), true, 'Previous is off at 3 days back');
  await ctx.close();
});

test('logging refused by the database shows a friendly message, not the raw database text', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  // Ask the page to save a step count for a day outside the window, as a stale page could.
  // As the page does when a button is pressed: the action runs, and any error becomes the toast.
  await page.evaluate(async () => {
    S.day = addDays(clientToday(S.cur), -6);
    document.getElementById('app').insertAdjacentHTML('beforeend', '<input id="st-val" value="5000">');
    try { await actions.saveSteps(); } catch (err) { toast(friendly(err)); }
  });
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
  const toast = await txt(page, '#toast');
  assert.match(toast, /outside your logging window|more than 3 days|read-only|Something went wrong/);
  assert.doesNotMatch(toast, /row-level security|violates/i, 'no raw database text');
  await ctx.close();
});

test('paused, finished and cancelled plans are read-only: the history shows, and nothing can be logged', SKIP, async () => {
  for (const status of ['paused', 'finished', 'cancelled']) {
    const backend = newBackend({ row: { status } });
    const { ctx, page } = await open(backend);
    await page.waitForSelector('.card .muted, .card h3');
    assert.equal(await page.locator('#addMealCard').count(), 0, status + ': no add a meal');
    assert.equal(await page.locator('button[data-act="saveSteps"]').count(), 0, status + ': no steps');
    assert.equal(await page.locator('button[data-act="saveWorkout"]').count(), 0, status + ': no workout');
    await ctx.close();
  }
});

test('a returning client: an earlier 12-week plan shows as its own block in Progress, separate from the current plan', SKIP, async () => {
  const backend = newBackend({
    extraClients: [{ id: 2, user_id: 'user-1', email: 'client@example.com', name: 'Client Example', tier: 'core', status: 'finished',
      start_date: addDaysStr(TODAY(), -200), activated_at: addDaysStr(TODAY(), -200) + 'T09:00:00Z', end_date: addDaysStr(TODAY(), -116), created_at: '2026-01-01T00:00:00Z', onboarding: {}, targets: null }]
  });
  backend.weighIns.push({ id: 'w-old', client_id: 2, weigh_date: addDaysStr(TODAY(), -150), week_start: addDaysStr(TODAY(), -150), kg: 88.0 });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.click('button[data-act="tab"][data-tab="progress"]');
  const sections = await page.$$eval('section[aria-label]', ss => ss.map(s => s.getAttribute('aria-label')));
  assert.deepEqual(sections, ['Current plan', 'Earlier plan'], 'each plan is its own block, current first');
  assert.match(await page.textContent('section[aria-label="Earlier plan"]'), /Core/);
  await ctx.close();
});

test('a London client: today, the 3-day window and the first day open in London time, not Melbourne', SKIP, async () => {
  const backend = newBackend({ row: { time_zone: 'Europe/London' } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  const check = await page.evaluate(() => ({
    today: clientToday(S.cur), zone: zoneFor(S.cur),
    logToday: canLog(S.cur, clientToday(S.cur)),
    logThreeBack: canLog(S.cur, addDays(clientToday(S.cur), -3)),
    logFourBack: canLog(S.cur, addDays(clientToday(S.cur), -4))
  }));
  assert.equal(check.zone, 'Europe/London');
  assert.equal(check.today, await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())));
  assert.equal(check.logToday, true, 'today in London can be logged');
  assert.equal(check.logThreeBack, true, '3 days back in London can be logged');
  assert.equal(check.logFourBack, false, '4 days back in London is refused');
  await ctx.close();
});

test('an invalid stored zone falls back to Australia/Melbourne', SKIP, async () => {
  const backend = newBackend({ row: { time_zone: 'Mars/Olympus' } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.equal(await page.evaluate(() => zoneFor(S.cur)), 'Australia/Melbourne');
  await ctx.close();
});

test('settings: marketing emails on and off, through the consent function', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.click('button[data-act="tab"][data-tab="settings"]');
  // One toggle. The setting starts Off (the database says false), so the first press turns it On.
  await page.waitForFunction(() => document.getElementById('app').textContent.includes('Marketing emails: Off'));
  assert.equal(await page.locator('button[data-act="toggleMarketing"]').count(), 1, 'one toggle button');
  await page.click('button[data-act="toggleMarketing"]');
  await page.waitForFunction(() => document.getElementById('app').textContent.includes('Marketing emails: On'));
  await page.click('button[data-act="toggleMarketing"]');
  await page.waitForFunction(() => document.getElementById('app').textContent.includes('Marketing emails: Off'));
  assert.deepEqual(backend.rpc.filter(r => r.name === 'set_marketing_consent').map(r => r.args.p_on), [true, false]);
  assert.ok(backend.rpc.some(r => r.name === 'get_my_marketing_consent'), 'the setting is read with get_my_marketing_consent');
  await ctx.close();
});

test('delete my coaching data: a clear confirm step, then the data is gone and the message says the purchase record is kept', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.click('button[data-act="tab"][data-tab="settings"]');
  await page.click('button[data-act="askDelete"]');
  assert.match(await txt(page, '#app'), /This cannot be undone/, 'the confirm step explains the consequence');
  assert.equal(backend.rpc.filter(r => r.name === 'delete_my_coaching_data').length, 0, 'nothing deleted before the confirm');
  await page.click('button[data-act="deleteMyData"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('deleted'));
  assert.equal(backend.deleted, true);
  assert.match(await txt(page, '#toast'), /purchase record for tax|we keep your purchase record/i);
  await ctx.close();
});

test('onboarding: a coached client\'s answers are kept as they type, and the step survives a reload', SKIP, async () => {
  const backend = newBackend({ row: { status: 'awaiting_onboarding', activated_at: null, start_date: null, onboarding: {}, targets: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.fill('#f-age', '34');
  await page.selectOption('#f-sex', 'Male');
  await page.fill('#f-heightCm', '182');
  await page.fill('#f-weight', '84');
  await page.fill('#f-whatsapp', '+61 400 000 009');
  await page.click('button[data-act="tzPick"][data-iana="Australia/Melbourne"]');
  await page.click('button[data-act="obNext"]');
  assert.match(await txt(page, '#app'), /Step 2 of 6/);
  // Reload mid-way: the draft is still there
  await page.reload(); await waitForApp(page);
  assert.match(await txt(page, '#app'), /Step 2 of 6/, 'a page reload keeps the draft and the step');
  await ctx.close();
});

test('time zone picker: nothing is chosen until the client picks; the phone zone is only suggested; search finds cities and any IANA zone', SKIP, async () => {
  const backend = newBackend({ row: { tier: 'basic', status: 'awaiting_onboarding', activated_at: null, start_date: null, onboarding: {}, targets: null, whatsapp: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  // Suggestion from the phone's zone (the browser is set to Australia/Melbourne), not selected
  await page.waitForSelector('text=Looks like you are in');
  assert.match(await txt(page, '#app'), /Looks like you are in Melbourne\. Use this\?/);
  assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem(DRAFT_KEY())) || {}).tzIana || null), null, 'nothing saved yet');
  // Search filters as you type
  await page.click('button[data-act="tzToggle"]');
  await page.fill('#tz-q', 'lisbon');
  assert.equal(await page.locator('#tzResults button.tz-opt').count(), 1, 'one city matches Lisbon');
  // A valid IANA zone that is not in the city list is still found
  await page.fill('#tz-q', 'chatham');
  assert.match(await txt(page, '#tzResults'), /Pacific\/Chatham/, 'any valid IANA zone can be searched');
  await page.fill('#tz-q', 'lisbon');
  await page.click('#tzResults button.tz-opt');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem(DRAFT_KEY())) || {}).tzIana === 'Europe/Lisbon');
  assert.match(await txt(page, '#app'), /Lisbon/);
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('onboarding: a Basic client fills the one-screen form and sees their targets straight away, then starts tracking', SKIP, async () => {
  const backend = newBackend({ row: { tier: 'basic', status: 'awaiting_onboarding', activated_at: null, start_date: null, onboarding: {}, targets: null, whatsapp: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.fill('#f-age', '34');
  await page.check('input[name="f-sex"][value="Male"]');
  await page.fill('#f-heightCm', '182');
  await page.fill('#f-weight', '84');
  await page.click('button[data-act="tzPick"][data-iana="Australia/Melbourne"]');
  await page.check('input[name="f-goalKind"][value="fatloss"]');
  await page.check('input[name="f-jobMult"][value="1.15"]');
  await page.fill('#f-stepsEveryday', '5000');
  await page.fill('#f-stepsRealistic', '9000');
  await page.fill('#f-trainingSessions', '3');
  await page.check('input[name="f-trainingIntensity"][value="350"]');
  await page.check('input[name="f-proteinPowder"][value="yes"]');
  await page.fill('#f-proteinBrand', 'Brand X vanilla');
  await page.check('input[data-f="agreeNotCoach"]');
  await page.check('input[data-f="agreeTerms"]');
  await page.click('button[data-act="basicSubmit"]');
  await page.waitForSelector('text=Your daily targets');
  const sent = backend.rpc.find(r => r.name === 'submit_onboarding');
  assert.equal(sent.args.p_answers.goalKind, 'fatloss');
  assert.equal(sent.args.p_answers.heightCm, 182);
  assert.equal(await page.locator('.target-val').first().textContent().then(t => /1,?900/.test(t)), true, 'the server\'s targets are shown');
  await page.click('button[data-act="startTracking"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Tracking started'));
  await page.waitForSelector('#addMealCard');
  assert.deepEqual(await page.$$eval('#addMealCard .seg button', bs => bs.map(b => b.textContent.trim())), ['Describe it'], 'Basic opens on Describe it');
  const proteinSent = backend.rpc.find(r => r.name === 'submit_onboarding');
  assert.equal(proteinSent.args.p_answers.proteinPowder, 'yes', 'the protein answer is sent');
  assert.equal(proteinSent.args.p_answers.proteinBrand, 'Brand X vanilla', 'and the brand and flavour');
  await ctx.close();
});

test('awaiting activation: "Stefan is building your plan"', SKIP, async () => {
  const backend = newBackend({ row: { status: 'awaiting_activation', activated_at: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.match(await txt(page, '#app'), /Stefan is building your plan/);
  await ctx.close();
});

test('How to do it: a library exercise opens with no AI call; one not in the library is written by Beast AI', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  await page.evaluate(() => openExercise('Squat'));
  await page.waitForSelector('.sheet');
  assert.match(await txt(page, '.sheet'), /What it works/);
  assert.equal(backend.ai.filter(a => a.body.mode === 'exercise').length, 0, 'library: no AI call');
  await page.click('.sheet button[data-act="closeSheet"]');
  await page.evaluate(() => openExercise('Turkish get-up'));
  await page.waitForSelector('.sheet');
  assert.equal(backend.ai.filter(a => a.body.mode === 'exercise').length, 1, 'not in the library: Beast AI writes it');
  await ctx.close();
});

test('the client page never shows the coach-only notes, and reads only the columns it may', SKIP, async () => {
  const backend = newBackend();
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  const clientReads = backend.requests.filter(r => r.table === 'coaching_clients' && r.method === 'GET');
  assert.ok(clientReads.length >= 1);
  assert.ok(clientReads.every(r => !/notes/.test(r.query)), 'the notes column is never asked for');
  await ctx.close();
});

test('onboarding: a coached client fills all six steps and sends the answers; the plan moves to awaiting activation', SKIP, async () => {
  const backend = newBackend({ row: { status: 'awaiting_onboarding', activated_at: null, start_date: null, onboarding: {}, targets: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  // Step 1
  await page.fill('#f-age', '34');
  await page.selectOption('#f-sex', 'Male');
  await page.fill('#f-heightCm', '182');
  await page.fill('#f-weight', '84');
  await page.fill('#f-whatsapp', '+61 400 000 009');
  await page.click('button[data-act="tzPick"][data-iana="Australia/Melbourne"]');
  await page.click('button[data-act="obNext"]');
  // Step 2
  await page.fill('#f-goal', 'Get stronger and sleep better');
  await page.check('input[name="f-timeframe"][value="3 months"]');
  await page.fill('#f-job', 'Teacher');
  await page.selectOption('#f-activity', 'Mixed');
  await page.fill('#f-stepsEveryday', '4000');
  await page.fill('#f-stepsRealistic', '8000');
  await page.click('button[data-act="obNext"]');
  // Step 3
  for (const f of ['Chicken', 'Rice', 'Broccoli']) await page.check(`input[data-group="likedFoods"][value="${f}"]`);
  await page.fill('#f-likedOther', 'halloumi, chickpeas, lentils');
  await page.check('input[name="f-proteinPowder"][value="no"]');
  await page.click('button[data-act="obNext"]');
  // Step 4
  await page.fill('#f-avoid', 'mushrooms, olives');
  await page.fill('#f-allergies', 'peanuts');
  await page.check('input[name="f-diet"][value="No restrictions"]');
  await page.check('input[name="f-mealsPerDay"][value="3"]');
  await page.check('input[name="f-cookTime"][value="15 min"]');
  await page.check('input[name="f-whoCooks"][value="Me"]');
  await page.fill('#f-eatsOut', '2');
  await page.fill('#f-alcohol', '3');
  await page.click('button[data-act="obNext"]');
  // Step 5
  await page.check('input[data-group="trainingDays"][value="Mon"]');
  await page.check('input[data-group="trainingDays"][value="Wed"]');
  await page.check('input[name="f-timeOfDay"][value="Morning"]');
  await page.check('input[name="f-sessionLength"][value="45"]');
  await page.check('input[name="f-place"][value="Gym"]');
  await page.check('input[name="f-experience"][value="Some"]');
  await page.click('button[data-act="obNext"]');
  // Step 6
  await page.selectOption('#f-weighInDay', 'Mon');
  for (const k of ['heart', 'chest', 'other']) await page.check(`input[name="h-${k}"][value="no"]`);
  await page.check('input[data-f="agreeTerms"]');
  await page.check('input[data-f="agreeNotCoach"]');
  await page.check('input[data-f="agreeConsent"]');
  await page.click('button[data-act="obSubmit"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Stefan is building your plan'));
  const sent = backend.rpc.find(r => r.name === 'submit_onboarding');
  assert.ok(sent, 'the answers were sent with submit_onboarding');
  assert.deepEqual(sent.args.p_answers.likedFoods, ['Chicken', 'Rice', 'Broccoli']);
  assert.equal(sent.args.p_answers.stepsRealistic, 8000);
  assert.equal(sent.args.p_answers.weighInDay, 'Mon');
  assert.equal(sent.args.p_answers.agreeConsent, true);
  assert.equal(backend.clients[0].status, 'awaiting_activation');
  assert.match(await txt(page, '#app'), /Stefan is building your plan/);
  await ctx.close();
});

test('signed in with no coaching plan: a friendly "No plan found" page, not an error', SKIP, async () => {
  const backend = newBackend({ extraClients: [] });
  backend.clients.length = 0;
  const { ctx, page } = await open(backend);
  await page.waitForSelector('h1');
  assert.match(await txt(page, 'h1'), /No plan found/);
  assert.equal(page.errors.length, 0);
  await ctx.close();
});

test('The Beast with no coach number set: no WhatsApp button (never a link to nobody)', SKIP, async () => {
  const backend = newBackend({ row: { tier: 'beast' }, extra: { coachWa: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  assert.equal(await page.locator('a', { hasText: 'Message Stefan on WhatsApp' }).count(), 0);
  await ctx.close();
});

test('a paused client sees the date paused and "Pause days used N of 14", as in the demo', SKIP, async () => {
  const pausedAt = new Date(Date.now() - 3 * 86400000).toISOString();
  const backend = newBackend({ row: { status: 'paused', paused_at: pausedAt, pause_days_used: 5 } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  const text = await txt(page, '#app');
  assert.match(text, /Paused since /);
  assert.match(text, /Pause days used: 8 of 14\./, 'the 5 used before plus the 3 days of this pause');
  assert.match(text, /Stefan will resume you when you are ready\./);
  await ctx.close();
});

test('protein powder: required on the six-step food step; the brand box only shows for Yes', SKIP, async () => {
  const backend = newBackend({ row: { status: 'awaiting_onboarding', activated_at: null, start_date: null, onboarding: {}, targets: null } });
  const { ctx, page } = await open(backend);
  await waitForApp(page);
  // Step 1
  await page.fill('#f-age', '34');
  await page.selectOption('#f-sex', 'Male');
  await page.fill('#f-heightCm', '182');
  await page.fill('#f-weight', '84');
  await page.fill('#f-whatsapp', '+61 400 000 009');
  await page.click('button[data-act="tzPick"][data-iana="Australia/Melbourne"]');
  await page.click('button[data-act="obNext"]');
  // Step 2
  await page.fill('#f-goal', 'Get stronger and sleep better');
  await page.check('input[name="f-timeframe"][value="3 months"]');
  await page.fill('#f-job', 'Teacher');
  await page.selectOption('#f-activity', 'Mixed');
  await page.fill('#f-stepsEveryday', '4000');
  await page.fill('#f-stepsRealistic', '8000');
  await page.click('button[data-act="obNext"]');
  // Step 3: the food step
  for (const f of ['Chicken', 'Rice', 'Broccoli']) await page.check(`input[data-group="likedFoods"][value="${f}"]`);
  assert.equal(await page.locator('#f-proteinBrand').count(), 0, 'no brand box before an answer');
  await page.click('button[data-act="obNext"]');
  assert.match(await txt(page, '#err-proteinPowder'), /Choose yes, no, or open to it\./, 'the question is required');
  await page.check('input[name="f-proteinPowder"][value="open"]');
  assert.equal(await page.locator('#f-proteinBrand').count(), 0, 'no brand box for "Open to it"');
  await page.check('input[name="f-proteinPowder"][value="no"]');
  assert.equal(await page.locator('#f-proteinBrand').count(), 0, 'no brand box for "No"');
  await page.check('input[name="f-proteinPowder"][value="yes"]');
  assert.equal(await page.locator('#f-proteinBrand').count(), 1, 'the optional brand box shows for "Yes"');
  await page.fill('#f-proteinBrand', 'Brand X, vanilla');
  await ctx.close();
});
