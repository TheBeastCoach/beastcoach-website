// Captures the coaching portal screens for the sales page, as Sam (seeded demo client).
// Phone viewport 390x844 at 2x. Demo-only UI is hidden with ?shot=1 (screenshot mode only).
// Output: coach-img/portal/{today,add-meal,meal-builder,my-plan,progress,workout}.jpg, each under 200KB.
//
// Run from the repo root:  npm run screenshots
// Needs Chrome. Set CHROME_PATH if it is not at the default macOS location.
// The demo runs in the browser only, so no Beast AI or Supabase calls are made.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'coach-img', 'portal');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAX_BYTES = 200 * 1024;
// Monday 23 Nov 2026, 9am in Melbourne: Sam's weigh-in day and his Monday training session.
const CLOCK = new Date('2026-11-22T22:00:00Z');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    timezoneId: 'Australia/Melbourne'
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.clock.setFixedTime(CLOCK);
  await page.goto(base + '/coaching-demo.html?shot=1');
  await page.waitForSelector('#viewAs', { state: 'attached' });
  // The view switcher is hidden in screenshot mode, so set it and fire its change event directly.
  await page.evaluate(() => { const s = document.getElementById('viewAs'); s.value = 'client:c_sam'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForSelector('#addMealCard, #app h1', { state: 'attached' });

  // Toasts are hidden in screenshot mode, so wait for their text instead of for a visible element.
  const waitToast = text => page.waitForFunction(t => document.getElementById('toast').textContent.includes(t), text);
  const settle = () => page.evaluate(() => document.fonts.ready).then(() => page.waitForTimeout(250));
  const top = () => page.evaluate(() => window.scrollTo(0, 0));
  const scrollTo = sel => page.locator(sel).first().evaluate(el => el.scrollIntoView({ block: 'start' }));

  // Writes the current phone-sized view as a JPEG, lowering the quality until it is under 200KB.
  async function shot(name) {
    await page.evaluate(() => document.activeElement && document.activeElement.blur());   // no focus ring in the capture
    await settle();
    let quality = 88, buf;
    do {
      buf = await page.screenshot({ type: 'jpeg', quality, scale: 'device' });
      if (buf.length <= MAX_BYTES) break;
      quality -= 8;
    } while (quality >= 40);
    fs.writeFileSync(path.join(OUT, name + '.jpg'), buf);
    console.log(`${name}.jpg  ${Math.round(buf.length / 1024)}KB  quality ${quality}`);
  }

  // Today: steps logged, one meal from the plan, the check-in card at the top.
  await page.fill('#st-val', '7400');
  await page.click('button[data-act="saveSteps"]');
  await waitToast('Steps saved.');
  await page.click('button[data-act="addMode"][data-m="plan"]');
  await page.locator('button[data-act="logPlan"]').nth(2).click();
  await waitToast('Logged from your plan.');

  // Add a meal, From my plan (the default for coaching clients).
  await scrollTo('#addMealCard');
  await shot('add-meal');

  // Meal Builder: the fridge-and-macros tab.
  await page.click('button[data-act="addMode"][data-m="builder"]');
  await scrollTo('#addMealCard');
  await shot('meal-builder');
  await page.click('button[data-act="addMode"][data-m="plan"]');

  // Workout logging: Monday's session, with sets and reps filled in.
  const sets = { 0: [[62.5, 8], [62.5, 8], [62.5, 7]], 1: [[22.5, 10], [22.5, 10], [22.5, 10]], 2: [[50, 8], [50, 8], [50, 8]] };
  for (const [ex, rows] of Object.entries(sets)) {
    for (let j = 0; j < rows.length; j++) {
      await page.fill(`input[data-wo="w"][data-i="${ex}"][data-j="${j}"]`, String(rows[j][0]));
      await page.fill(`input[data-wo="r"][data-i="${ex}"][data-j="${j}"]`, String(rows[j][1]));
    }
  }
  await scrollTo('.wo-sets');
  await page.evaluate(() => window.scrollBy(0, -60));
  await shot('workout');
  await page.click('button[data-act="saveWorkout"]');
  await waitToast('Workout saved.');

  await top();
  await shot('today');

  await page.click('button[data-act="clientTab"][data-tab="plan"]');
  await top();
  await shot('my-plan');

  await page.click('button[data-act="clientTab"][data-tab="progress"]');
  await top();
  await shot('progress');

  await browser.close();
  server.close();
  if (errors.length) {
    console.error('Page errors during capture:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
})().catch(err => { console.error(err); process.exit(1); });
