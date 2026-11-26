// Browser tests for the sales page checkout step (coaching.html): the plan buttons open the step, both agreements
// are required, a full plan shows the waitlist view, and a good answer goes to Stripe's page.
// The checkout API is stubbed in the page, so no Stripe or Supabase call is made.
// Run with: node --test tests/coaching-checkout-page.test.js
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

// reply: what /api/coaching-checkout answers. calls: every request body the page sent.
async function open(reply) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Australia/Melbourne' });
  const page = await ctx.newPage();
  page.errors = []; page.calls = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.route(url => /^https?:\/\//.test(url.href) && !url.href.startsWith(base), r => r.abort());
  await page.route(/\/api\/coaching-checkout$/, async r => {
    page.calls.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  await page.route(/\/stub-stripe$/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe test page</h1>' }));
  await page.goto(base + '/');
  await page.waitForLoadState('domcontentloaded');
  return { ctx, page };
}

test('the plan buttons open a short step: name, email, both agreements required, and the news box unticked', SKIP, async () => {
  const { ctx, page } = await open({ status: 200, body: { url: base + '/stub-stripe' } });
  await page.click('button[data-buy="core"]');
  assert.equal(await page.locator('#buyModal').isVisible(), true);
  assert.match(await page.textContent('#buyPrice'), /Core: \$299 AUD for 12 weeks/);
  assert.equal(await page.isChecked('#buyTerms'), false, 'terms are not pre-ticked');
  assert.equal(await page.isChecked('#buyHealth'), false, 'health is not pre-ticked');
  assert.equal(await page.isChecked('#buyNews'), false, 'news is optional and unticked');
  assert.match(await page.textContent('#buyStep'), /Prices in Australian dollars\. Your bank converts at checkout\./);
  await ctx.close();
});

test('without both agreements the step does not go to checkout, and says what is missing', SKIP, async () => {
  const { ctx, page } = await open({ status: 200, body: { url: base + '/stub-stripe' } });
  await page.click('button[data-buy="essential"]');
  await page.fill('#buyName', 'Erin Client');
  await page.fill('#buyEmail', 'erin@example.com');
  await page.click('#buyGo');
  assert.match(await page.textContent('#buyErr'), /agree to the terms/);
  await page.check('#buyTerms');
  await page.click('#buyGo');
  assert.match(await page.textContent('#buyErr'), /health information/);
  assert.equal(page.calls.length, 0, 'nothing was sent to checkout');
  await ctx.close();
});

test('a full plan shows the "That plan is full" view with the waitlist offer, not a payment page', SKIP, async () => {
  const { ctx, page } = await open({ status: 409, body: { error: 'full', waitlist: true, message: 'The Beast is full at the moment. Join the waitlist and we will email you when a place opens.' } });
  await page.click('button[data-buy="beast"]');
  await page.fill('#buyName', 'Bo Client');
  await page.fill('#buyEmail', 'bo@example.com');
  await page.check('#buyTerms'); await page.check('#buyHealth');
  await page.click('#buyGo');
  await page.waitForSelector('#buyFull:not([hidden])');
  assert.match(await page.textContent('#buyFullMsg'), /The Beast is full/);
  assert.match(await page.getAttribute('#buyWait', 'href'), /^mailto:info@beastcoach\.fit\?subject=/);
  assert.equal(page.calls[0].plan, 'beast');
  await ctx.close();
});

test('a good answer goes to the checkout page the server gives; the news box is sent as the client chose it', SKIP, async () => {
  const { ctx, page } = await open({ status: 200, body: { url: base + '/stub-stripe', amount: '$299 AUD' } });
  await page.click('button[data-buy="core"]');
  await page.fill('#buyName', 'Sam Client');
  await page.fill('#buyEmail', 'sam@example.com');
  await page.check('#buyTerms'); await page.check('#buyHealth'); await page.check('#buyNews');
  await Promise.all([page.waitForURL(/stub-stripe/), page.click('#buyGo')]);
  assert.match(await page.textContent('h1'), /Stripe test page/);
  assert.deepEqual(page.calls[0], { plan: 'core', name: 'Sam Client', email: 'sam@example.com', agreeTerms: true, agreeHealth: true, news: true });
  await ctx.close();
});

test('the cancel return says nothing was charged, and Escape closes the step', SKIP, async () => {
  const { ctx, page } = await open({ status: 200, body: { url: base + '/stub-stripe' } });
  await page.goto(base + '/?checkout=cancelled');
  assert.match(await page.textContent('body'), /Checkout was cancelled\. Nothing has been charged\./);
  await page.click('button[data-buy="basic"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#buyModal').isHidden(), true);
  assert.equal(page.errors.length, 0, page.errors.join('; '));
  await ctx.close();
});
