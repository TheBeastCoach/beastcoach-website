// Browser tests for dashboard.html (recipe ratings and ideas).
// Supabase is replaced by a recording stub, so these tests check what the page asks for and shows:
// the dashboard never reads other people's emails.
// The database rules themselves are tested in tests/security-sql.test.js.
//
// Needs Playwright and Chrome. Run with:
//   PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core CHROME_PATH="/path/to/Chrome" node --test tests/security-pages.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pw = null, pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See the instructions at the top of this file.'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SKIP = pwError ? { skip: pwError } : {};

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
let browser, server, base;

// Stands in for the Supabase browser library. Records every call; answers from window.__stub.
const FAKE_SUPABASE = `
(function () {
  window.__calls = [];
  window.__stub = window.__stub || {};
  function chain(table, path) {
    const c = {};
    ['select','eq','order','limit','single','maybeSingle','in','gte','lte'].forEach(m => {
      c[m] = (...args) => { window.__calls.push({ kind: 'from', table, method: m, args, path: path.concat([m]) }); return chain(table, path.concat([m])); };
    });
    ['insert','upsert','update','delete'].forEach(m => {
      c[m] = (...args) => { window.__calls.push({ kind: 'from', table, method: m, args }); return chain(table, path.concat([m])); };
    });
    c.then = (res, rej) => Promise.resolve({ data: (window.__stub.tables || {})[table] || [], error: (window.__stub.writeError && path.some(p => p === 'insert' || p === 'upsert')) ? { message: 'denied' } : null }).then(res, rej);
    return c;
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: window.__stub.session || null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({})
    },
    rpc: async (name, args) => { window.__calls.push({ kind: 'rpc', name, args }); return { data: window.__stub.rpc || [], error: window.__stub.rpcError || null }; },
    from: table => chain(table, [])
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

async function openPage(urlPath, stub, opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Australia/Melbourne' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route(url => /^https?:\/\//.test(url.href) && !url.href.startsWith(base), r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE }));
  await page.addInitScript(s => { window.__stub = s; }, stub || {});
  await page.goto(base + urlPath);
  await page.waitForLoadState('domcontentloaded');
  return { ctx, page };
}
const callsOf = page => page.evaluate(() => window.__calls);
const ratingsReads = calls => calls.filter(c => c.kind === 'from' && c.table === 'recipe_ratings' && c.method === 'select');
const SIGNED_IN = { email: 'Alice@Example.com' };

// ---------------------------------------------------------------------------
// dashboard.html: ratings and ideas
// ---------------------------------------------------------------------------

test('logged out: the rating summary comes from the summary function, with no emails read', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { rpc: [{ avg_rating: 4.5, rating_count: 2, my_rating: null }], session: null });
  await page.evaluate(() => loadRatingFor('r1'));
  const calls = await callsOf(page);
  const rpc = calls.find(c => c.kind === 'rpc');
  assert.ok(rpc, 'calls the summary function');
  assert.equal(rpc.name, 'recipe_rating_summary');
  assert.deepEqual(rpc.args, { p_recipe_id: 'r1' });
  assert.equal(ratingsReads(calls).length, 0, 'no direct read of recipe_ratings');
  assert.match(await page.textContent('#rating-summary'), /4\.5 \/ 5 · 2 ratings/);
  assert.equal(await page.locator('#rating-stars .star.filled').count(), 5, 'stars show the average (4.5 rounds to 5)');
  assert.equal(await page.evaluate(() => document.getElementById('rating-stars').classList.contains('readonly')), true, 'logged out stars are read-only');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('logged out with no ratings yet: says so, and asks nobody for emails', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { rpc: [{ avg_rating: null, rating_count: 0, my_rating: null }], session: null });
  await page.evaluate(() => loadRatingFor('r9'));
  assert.equal(await page.textContent('#rating-summary'), 'No ratings yet');
  assert.equal(ratingsReads(await callsOf(page)).length, 0);
  await ctx.close();
});

test('signed in: my rating comes from the summary, and the stars are mine to change', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { rpc: [{ avg_rating: 3.0, rating_count: 3, my_rating: 4 }], session: { user: SIGNED_IN } });
  await page.evaluate(() => { currentUser = { email: 'Alice@Example.com' }; return loadRatingFor('r1'); });
  assert.equal(await page.locator('#rating-stars .star.filled').count(), 4, 'my rating of 4 shows');
  assert.match(await page.textContent('#rating-summary'), /3\.0 \/ 5 · 3 ratings/);
  assert.equal(ratingsReads(await callsOf(page)).length, 0, 'no direct read of other ratings');
  await ctx.close();
});

test('signed in: picking a star saves my own rating with the upsert, under my email in lower case', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { rpc: [{ avg_rating: null, rating_count: 0, my_rating: null }], session: { user: SIGNED_IN } });
  await page.evaluate(() => { currentUser = { email: 'Alice@Example.com' }; return loadRatingFor('r1'); });
  await page.evaluate(() => showView('recipe-detail'));
  await page.locator('#rating-stars .star').nth(4).click();
  await page.waitForTimeout(150);
  const upsert = (await callsOf(page)).find(c => c.kind === 'from' && c.method === 'upsert');
  assert.ok(upsert, 'a rating upsert was sent');
  assert.equal(upsert.table, 'recipe_ratings');
  assert.deepEqual(upsert.args[0], { recipe_id: 'r1', email: 'alice@example.com', rating: 5 });
  assert.deepEqual(upsert.args[1], { onConflict: 'recipe_id,email' });
  await ctx.close();
});

test('signed in: a recipe idea is submitted under my own email, in lower case', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { session: { user: SIGNED_IN } });
  await page.evaluate(() => { currentUser = { email: 'Alice@Example.com' }; });
  await page.evaluate(() => showView('recipes'));
  await page.fill('#idea-text', 'A lentil curry with spinach');
  await page.click('#idea-submit-btn');
  await page.waitForFunction(() => /Thanks/.test(document.getElementById('idea-msg').textContent));
  const ins = (await callsOf(page)).find(c => c.kind === 'from' && c.method === 'insert' && c.table === 'recipe_ideas');
  assert.deepEqual(ins.args[0], { email: 'alice@example.com', idea: 'A lentil curry with spinach' });
  await ctx.close();
});

test('an idea that the database refuses shows the try-again message', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { session: { user: SIGNED_IN }, writeError: true });
  await page.evaluate(() => { currentUser = { email: 'alice@example.com' }; });
  await page.evaluate(() => showView('recipes'));
  await page.fill('#idea-text', 'Something');
  await page.click('#idea-submit-btn');
  await page.waitForFunction(() => /Couldn't submit that/.test(document.getElementById('idea-msg').textContent));
  await ctx.close();
});

test('a summary error shows "Ratings coming soon" and does not break the page', SKIP, async () => {
  const { ctx, page } = await openPage('/dashboard', { rpc: [], rpcError: { message: 'function missing' }, session: null });
  await page.evaluate(() => loadRatingFor('r1'));
  assert.equal(await page.textContent('#rating-summary'), 'Ratings coming soon');
  await ctx.close();
});

// ---------------------------------------------------------------------------
