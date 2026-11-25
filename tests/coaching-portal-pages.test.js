// Browser tests for the login side of the coaching portal: the My Coach tile on dashboard.html, and the /my-coach redirect.
// The Supabase library is replaced by a stub, so the tests choose what the sign-in and claim_coaching() return.
// The database rules are tested in tests/coaching-portal-rls.test.js.
//
// Run with: PLAYWRIGHT_CORE_PATH=... CHROME_PATH=... node --test tests/coaching-portal-pages.test.js
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
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
let browser, server, base;

// Stands in for the Supabase browser library. window.__stub decides: the session, and what claim_coaching returns.
const FAKE_SUPABASE = `
(function () {
  window.__calls = [];
  function chain() {
    const c = {};
    ['select','eq','order','limit','single','maybeSingle','in'].forEach(m => { c[m] = () => chain(); });
    ['insert','upsert','update','delete'].forEach(m => { c[m] = () => chain(); });
    c.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return c;
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: window.__stub.session || null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { window.__calls.push({ kind: 'signOut' }); return {}; },
      signInWithPassword: async () => ({ data: {}, error: null })
    },
    rpc: async (name, args) => {
      window.__calls.push({ kind: 'rpc', name, args });
      if (name === 'claim_coaching') {
        if (window.__stub.claimError) return { data: null, error: window.__stub.claimError };
        return { data: window.__stub.claim || { linked: false, reason: 'no_plan_for_this_email' }, error: null };
      }
      return { data: null, error: null };
    },
    from: () => chain()
  };
  window.supabase = { createClient: () => client };
})();
`;

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
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function openPage(urlPath, stub) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Australia/Melbourne' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(url => /^https?:\/\//.test(url.href) && !url.href.startsWith(base) && !/cdn\.jsdelivr\.net\/npm\/@supabase/.test(url.href), r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE }));
  await page.addInitScript(s => { window.__stub = s; }, stub || {});
  await page.goto(base + urlPath);
  await page.waitForLoadState('domcontentloaded');
  return { ctx, page };
}
const SIGNED_IN = { user: { id: 'u-1', email: 'client@example.com', user_metadata: { full_name: 'Client Example' } } };

// ---------------------------------------------------------------------------
// /my-coach
// ---------------------------------------------------------------------------

test('/my-coach signed out: sends the visitor to the dashboard sign-in, and brings them back after', SKIP, async () => {
  const { ctx, page } = await openPage('/my-coach', { session: null });
  await page.waitForURL(/\/dashboard\?next=my-coach/);
  assert.ok(page.url().includes('/dashboard?next=my-coach'));
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

// The status screens, the onboarding and the client portal are tested in tests/coaching-portal-client.test.js.

test('the My Coach page carries no secret keys (only the public publishable key)', SKIP, async () => {
  const html = fs.readFileSync(path.join(ROOT, 'my-coach.html'), 'utf8');
  assert.match(html, /sb_publishable_/);
  assert.doesNotMatch(html, /service_role|sb_secret_|SUPABASE_SERVICE_ROLE/);
  assert.match(html, /<meta name="robots" content="noindex/);
});

// ---------------------------------------------------------------------------
// dashboard.html: the My Coach tile
// ---------------------------------------------------------------------------

test('dashboard: a signed-in client with a plan sees the My Coach tile, and it links to /my-coach', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { session: SIGNED_IN, claim: { linked: true, status: 'active', tier: 'core' } });
  await page.waitForFunction(() => document.getElementById('myCoachTile').style.display !== 'none');
  assert.equal(await page.getAttribute('#myCoachTile', 'href'), '/my-coach');
  assert.match(await page.textContent('#myCoachTile'), /My Coach/);
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('dashboard: a signed-in user with no plan does not see the tile', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { session: SIGNED_IN, claim: { linked: false, reason: 'no_plan_for_this_email' } });
  await page.waitForFunction(() => window.__calls && window.__calls.some(c => c.name === 'claim_coaching'));
  assert.equal(await page.evaluate(() => document.getElementById('myCoachTile').style.display), 'none');
  await ctx.close();
});

test('dashboard: if the claim call fails, the tile stays hidden and the dashboard still works', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { session: SIGNED_IN, claimError: { message: 'function not found' } });
  await page.waitForFunction(() => window.__calls && window.__calls.some(c => c.name === 'claim_coaching'));
  assert.equal(await page.evaluate(() => document.getElementById('myCoachTile').style.display), 'none', 'tile hidden');
  await page.waitForFunction(() => /Welcome back/.test(document.getElementById('dash-greeting').textContent));
  assert.equal(page.errors.length, 0, 'the dashboard raises no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('dashboard: a signed-in visitor who came from /my-coach is sent straight back there', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard?next=my-coach', { session: SIGNED_IN, claim: { linked: true, status: 'active', tier: 'core' } });
  await page.waitForURL(/\/my-coach$/);
  assert.ok(page.url().endsWith('/my-coach'));
  await ctx.close();
});
