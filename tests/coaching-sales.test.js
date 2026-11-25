// Browser checks for the sales page (coaching.html): the spot counts, console errors, the portal screens,
// and the layout at 390px, 768px and 1280px. The spots are answered by a stub, so no Supabase call is made.
// Run with: PLAYWRIGHT_CORE_PATH=... CHROME_PATH=... node --test tests/coaching-sales.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pw = null, pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See the instructions in docs/COACHING-DEMO.md.'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SKIP = pwError ? { skip: pwError } : {};
const TYPES = { '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
let browser, server, base;

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

const SPOTS = [
  { tier: 'essential', place_limit: 100, taken: 63, places_left: 37 },
  { tier: 'core', place_limit: 25, taken: 22, places_left: 3 },
  { tier: 'beast', place_limit: 4, taken: 4, places_left: 0 }
];
async function openSales(width, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 700, hasTouch: width < 700 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  // Fonts are blocked in these tests on purpose, so their ERR_FAILED console messages are expected.
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) page.errors.push(m.text()); });
  page.requests = [];
  page.on('request', r => page.requests.push(r.url()));
  await page.route('**/fonts.g*.com/**', r => r.abort());
  await page.route('**/fonts.gstatic.com/**', r => r.abort());
  // The live spot counts: answered by a stub (or an error, when testing the fallback)
  await page.route('**/rest/v1/rpc/coaching_places', r => o.rpcFails
    ? r.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST202"}' })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SPOTS) }));
  await page.goto(base + '/coaching');
  await page.waitForLoadState('load');
  // Scroll through so the lazy images load
  // Lazy images load when they come into view, so bring each one into view in turn.
  for (const el of await page.$$('img[loading="lazy"]')) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(120); }
  await page.evaluate(() => window.scrollTo(0, 0));
  // The phone strip scrolls sideways, so its lazy images load only when they come into view: swipe it through.
  await page.evaluate(async () => { document.querySelectorAll('.portal-strip').forEach(el => { el.scrollLeft = el.scrollWidth; }); await new Promise(r => setTimeout(r, 300)); document.querySelectorAll('.portal-strip').forEach(el => { el.scrollLeft = 0; }); });
  await page.waitForTimeout(400);
  return { ctx, page };
}

test('the spot counts update from the live counter: badges, the table, and Full with a waitlist when a plan is full', SKIP, async () => {
  const { ctx, page } = await openSales(1280);
  assert.equal(await page.textContent('[data-places="essential"]'), '37 spots left');
  assert.equal(await page.textContent('[data-places="core"]'), '3 spots left');
  assert.equal(await page.textContent('[data-places="beast"]'), 'Full right now');
  assert.equal(await page.textContent('[data-left="beast"]'), 'Full');
  assert.equal((await page.getAttribute('[data-cta="beast"]', 'data-waitlist')).startsWith('mailto:'), true, 'the full plan links to the waitlist');
  assert.match(await page.textContent('[data-cta="beast"]'), /Join the waitlist/);
  assert.deepEqual(page.errors, [], 'no console errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('if the counter is unreachable, the static wording stays and the page still works', SKIP, async () => {
  const { ctx, page } = await openSales(390, { rpcFails: true });
  assert.match(await page.textContent('[data-places="essential"]'), /spots left/);
  await ctx.close();
});

for (const width of [390, 768, 1280]) {
  test(`layout at ${width}px: no horizontal overflow, every image loads, no console errors`, SKIP, async () => {
    const { ctx, page } = await openSales(width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'no horizontal scroll (overflow ' + overflow + 'px)');
    const broken = await page.$$eval('img', imgs => imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
    assert.deepEqual(broken, [], 'no broken images');
    const portal = await page.$$eval('.portal-strip img', imgs => imgs.map(i => ({ w: i.getAttribute('width'), h: i.getAttribute('height'), loading: i.getAttribute('loading'), ok: i.naturalWidth > 0 })));
    assert.equal(portal.length, 6, 'six portal screens');
    assert.ok(portal.every(p => p.w === '390' && p.h === '844' && p.loading === 'lazy' && p.ok), 'each has size, lazy loading and loads');
    assert.ok(!page.requests.some(u => /ai-meal-(builder|log)\.jpg/.test(u)), 'no old Beast AI screenshots requested');
    assert.deepEqual(page.errors, [], 'no console errors: ' + page.errors.join('; '));
    if (process.env.SHOT_DIR) {
      const sec = page.locator('.portal-strip').locator('xpath=..');
      await sec.screenshot({ path: path.join(process.env.SHOT_DIR, `sales-portal-${width}.png`) });
    }
    await ctx.close();
  });
}

test('the portal strip swipes on a phone (scrolls sideways with snap points) and is a grid on desktop', SKIP, async () => {
  const phone = await openSales(390);
  const strip = await phone.page.evaluate(() => {
    const el = document.querySelector('.portal-strip'), cs = getComputedStyle(el);
    return { overflowX: cs.overflowX, snap: cs.scrollSnapType, scrollable: el.scrollWidth > el.clientWidth, display: cs.display };
  });
  assert.equal(strip.overflowX, 'auto');
  assert.match(strip.snap, /x mandatory/);
  assert.equal(strip.scrollable, true, 'there is more to swipe to');
  assert.equal(strip.display, 'flex');
  await phone.ctx.close();

  const desk = await openSales(1280);
  const grid = await desk.page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.portal-strip'));
    return { display: cs.display, cols: cs.gridTemplateColumns.split(' ').length, overflowX: cs.overflowX };
  });
  assert.equal(grid.display, 'grid');
  assert.equal(grid.cols, 3, 'three across on desktop');
  assert.equal(grid.overflowX, 'visible');
  await desk.ctx.close();
});
