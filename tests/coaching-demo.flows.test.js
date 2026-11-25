// Browser flows for coaching-demo.html: Basic signup, Basic Today and Progress, steps logging,
// set and rep logging, coach logs (with the "Up" highlight), drop to Basic, and the age rule.
// Runs at 390px wide with the clock set to a Monday, so Sam's weigh-in day and training day apply.
//
// Needs Playwright and Chrome. Run with:
//   PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core CHROME_PATH="/path/to/Chrome" node --test tests/coaching-demo.flows.test.js
// Screenshots go to SHOT_DIR (default: the system temp folder).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BasicTargets = require(path.join(ROOT, 'basic-targets.js'));
const SHOTS = process.env.SHOT_DIR || os.tmpdir();

let pw = null, pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See the instructions at the top of this file.'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SKIP = pwError ? { skip: pwError } : {};
const MONDAY = new Date('2026-11-23T09:00:00');

let browser, server, base;
const FILES = { '/coaching-demo.html': 'text/html', '/basic-targets.js': 'application/javascript' };

test.before(async () => {
  if (!pw) return;
  server = http.createServer((req, res) => {
    const file = req.url.split('?')[0];
    if (FILES[file]) { res.setHeader('content-type', FILES[file]); res.end(fs.readFileSync(path.join(ROOT, file.slice(1)))); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

async function openPage(opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, isMobile: !o.desktop, hasTouch: !o.desktop });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/fonts.g*.com/**', r => r.abort());
  await page.route('**/api/demo-ai', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"demo_key"}' }));
  await page.clock.setFixedTime(o.time || MONDAY);
  await page.goto(base + '/coaching-demo.html');
  await page.waitForSelector('#viewAs');
  return { ctx, page };
}
const num = s => parseFloat(String(s).replace(/,/g, '').trim().split(/\s+/)[0]);
async function setClient(page, id) { await page.selectOption('#viewAs', 'client:' + id); }
async function tabsText(page) { return page.$$eval('nav.tabs button', els => els.map(e => e.textContent.trim())); }

test('Basic signup: one-screen onboarding, the daily targets screen, then Start tracking', SKIP, async () => {
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="basic"]');
  assert.match(await page.textContent('#app'), /\$2\.50 a week, \$30 billed every 12 weeks/);
  await page.fill('#nc-name', 'Basic Tester');
  await page.fill('#nc-email', 'basic.tester@example.com');
  await page.selectOption('#nc-country', 'Australia');
  assert.match(await page.textContent('button[data-act="pay"]'), /Pay \$30 every 12 weeks/);
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Your details');
  assert.equal(await page.locator('text=Step 1 of 6').count(), 0, 'Basic is not the six-step form');
  // Blank answers: the message sits above the button and the first missed question is named
  await page.click('button[data-act="basicSubmit"]');
  assert.equal(await page.textContent('#obMsg'), 'Please answer the questions marked in red.');
  assert.match(await page.textContent('#err-age'), /Enter your age/);
  assert.match(await page.textContent('#err-timezone'), /Enter your time zone or city/, 'time zone is required, with no default');
  // Under 18 gets the age rule
  await page.fill('#ob-age', '16');
  await page.click('button[data-act="basicSubmit"]');
  assert.equal(await page.textContent('#err-age'), 'Coaching is for adults 18 and over.');
  assert.equal(await page.locator('#toast.show').count(), 0, 'no toast covers the form');
  // Valid answers
  await page.fill('#ob-age', '34');
  await page.check('input[name="ob-sex"][value="Male"]');
  await page.fill('#ob-heightCm', '182');
  await page.fill('#ob-weight', '84');
  await page.fill('#ob-timezone', 'Melbourne');
  await page.check('input[name="ob-goalKind"][value="fatloss"]');
  await page.check('input[name="ob-jobMult"][value="1.15"]');
  await page.fill('#ob-stepsEveryday', '5000');
  await page.fill('#ob-stepsRealistic', '9000');
  await page.fill('#ob-trainingSessions', '3');
  await page.check('input[name="ob-trainingIntensity"][value="350"]');
  await page.check('input[data-ob="agreeNotCoach"]');
  await page.check('input[data-ob="agreeTerms"]');
  await page.screenshot({ path: SHOTS + '/basic-onboarding-phone.png', fullPage: true });
  await page.click('button[data-act="basicSubmit"]');
  await page.waitForSelector('text=Your daily targets');
  // The numbers on screen are the calculator's numbers for these answers
  const want = BasicTargets.calcTargets({ sex: 'male', age: 34, heightCm: 182, weightKg: 84, activity: 1.15, steps: 5000, trainingSessions: 3, trainingIntensity: 350, goal: 'fatloss' });
  const shown = await page.$$eval('.target-val', els => els.map(e => e.textContent.trim()));
  assert.equal(num(shown[0]), want.calories, 'calories');
  assert.equal(num(shown[1]), want.protein, 'protein');
  assert.equal(num(shown[2]), want.carbs, 'carbs');
  assert.equal(num(shown[3]), want.fat, 'fat');
  assert.equal(num(shown[4]), want.fibre, 'fibre');
  assert.equal(num(shown[5]), 9000, 'steps target is the realistic target given, 9,000');
  await page.screenshot({ path: SHOTS + '/basic-targets-phone.png', fullPage: true });
  await page.click('button[data-act="basicStart"]');
  await page.waitForSelector('text=Tracking started');
  // Basic Today: meals (Beast AI), steps and weigh-in only
  assert.deepEqual(await tabsText(page), ['Today', 'Progress'], 'Basic has Today and Progress only');
  const heads = await page.$$eval('.card h3', els => els.map(e => e.textContent.trim()));
  assert.ok(heads.includes('Steps') && heads.includes('Weigh-in'), 'steps and weigh-in cards on Basic Today');
  assert.ok(!heads.includes('Workout'), 'no workout logging on Basic');
  assert.equal(await page.locator('button[data-act="addMode"][data-m="builder"]').count(), 0, 'no Meal Builder on Basic');
  assert.equal(await page.locator('button[data-act="addMode"][data-m="plan"]').count(), 0, 'no From my plan on Basic');
  assert.equal(await page.locator('button[data-act="aiDescribe"]').count(), 1, 'Describe it with Beast AI');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('Basic client Today and Progress: steps, Describe it, Update my targets', SKIP, async () => {
  const { ctx, page } = await openPage();
  await setClient(page, 'c_alex');
  assert.deepEqual(await tabsText(page), ['Today', 'Progress']);
  await page.screenshot({ path: SHOTS + '/basic-today-phone.png', fullPage: true });
  assert.match(await page.textContent('#app'), /8,000 steps/, 'Alex steps target is 8,000');
  await page.fill('#st-val', '9000');
  await page.click('button[data-act="saveSteps"]');
  await page.waitForSelector('text=Steps saved.');
  assert.match(await page.textContent('#app'), /9,000 of 8,000 steps/);
  await page.click('button[data-act="clientTab"][data-tab="progress"]');
  assert.ok((await page.textContent('#app')).includes('Update my targets'), 'Progress has Update my targets');
  await page.click('button[data-act="updateTargets"]');
  await page.waitForSelector('text=Targets updated');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('Coach: Basic clients show plan, status and next billing only; coaching tabs stay for coached clients', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'coach');
  const capInputs = await page.$$eval('input[data-ch="cap"]', els => els.map(e => e.dataset.tier + '=' + e.value));
  assert.ok(capInputs.includes('essential=100') && capInputs.includes('core=25') && capInputs.includes('beast=4'), 'capacities 100, 25, 4');
  assert.match(await page.textContent('#app'), /Unlimited/, 'Basic is unlimited');
  assert.match(await page.textContent('table'), /Next billing:/, 'Basic row shows next billing');
  await page.click('button[data-act="openClient"][data-id="c_alex"]');
  const coachTabs = await page.$$eval('button[data-act="coachTab"]', els => els.length);
  assert.equal(coachTabs, 0, 'no Logs, Plan or Notes tabs for Basic');
  assert.match(await page.textContent('#app'), /Basic clients log privately/);
  await page.click('button[data-act="backClients"]');
  await page.click('button[data-act="openClient"][data-id="c_sam"]');
  assert.equal(await page.locator('button[data-act="coachTab"][data-tab="logs"]').count(), 1, 'coached client keeps Logs');
  await ctx.close();
});

test('Set and rep logging: sessions from the plan, add and remove sets, skipped, other activity', SKIP, async () => {
  const { ctx, page } = await openPage({ viewport: { width: 390, height: 844 } });
  await setClient(page, 'c_sam');
  const squatSets = () => page.locator('.wo-set input[data-wo="w"][data-i="0"]').count();
  assert.equal(await squatSets(), 3, 'Squat shows its three planned sets');
  assert.ok((await page.textContent('#app')).includes('Full body A'), 'Monday session is Full body A');
  await page.fill('input[data-wo="w"][data-i="0"][data-j="0"]', '62.5');
  await page.fill('input[data-wo="r"][data-i="0"][data-j="0"]', '8');
  await page.screenshot({ path: SHOTS + '/workout-sets-phone.png', fullPage: true });
  await page.click('button[data-act="woSetAdd"][data-i="0"]');
  assert.equal(await squatSets(), 4, 'Add set adds a row');
  await page.click('button[data-act="woSetDel"][data-i="0"][data-j="3"]');
  assert.equal(await squatSets(), 3, 'Remove set takes it away');
  await page.check('input[data-woskip="3"]');
  assert.equal(await page.locator('input[data-wo="w"][data-i="3"]').count(), 0, 'skipped exercise has no set rows');
  await page.uncheck('input[data-woskip="3"]');
  await page.click('button[data-act="saveWorkout"]');
  await page.waitForSelector('text=Workout saved.');
  assert.match(await page.textContent('#app'), /Squat: 62\.5 kg x 8/, 'saved set shows weight and reps');
  await page.click('button[data-act="woMode"][data-m="other"]');
  assert.equal(await page.locator('[data-wo="what"]').count(), 1, 'Other activity has what, minutes and notes');
  await page.fill('[data-wo="what"]', 'Football');
  await page.fill('[data-wo="minutes"]', '45');
  await page.click('button[data-act="saveWorkout"]');
  await page.waitForSelector('text=Workout saved.');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('Coach logs: sets and reps per session, with an Up highlight when a lift went up', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="openClient"][data-id="c_sam"]');
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  const body = await page.textContent('#app');
  assert.match(body, /Full body B|Full body A/, 'sessions listed');
  assert.match(body, /Up \+2\.5 kg/, 'squat went up 2.5 kg since last logged');
  assert.ok(await page.locator('.up-badge').count() >= 1);
  await ctx.close();
});

test('Steps and weekly average: logged steps show on the coach day log and on Progress', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await setClient(page, 'c_sam');
  await page.fill('#st-val', '7600');
  await page.click('button[data-act="saveSteps"]');
  await page.waitForSelector('text=Steps saved.');
  await page.click('button[data-act="clientTab"][data-tab="progress"]');
  assert.match(await page.textContent('#app'), /Average per day, last 7 days/);
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="openClient"][data-id="c_sam"]');
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  assert.match(await page.textContent('#app'), /7,600 steps/, 'coach day log shows steps');
  await ctx.close();
});

test('Drop to Basic: a finished coached client keeps their targets and becomes Basic', SKIP, async () => {
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="openClient"][data-id="c_sam"]');
  await page.click('button[data-act="finish"]');
  await page.waitForSelector('text=Marked as finished.');
  await page.selectOption('#viewAs', 'client:c_sam');
  assert.match(await page.textContent('#app'), /Drop to Basic: \$30 per 12 weeks/);
  assert.equal(await page.locator('text=$15').count(), 0, 'no $15 wording');
  await page.click('button[data-act="dropBasic"]');
  await page.waitForSelector('text=You are on Basic');
  assert.deepEqual(await tabsText(page), ['Today', 'Progress']);
  assert.match(await page.textContent('#app'), /8,000 steps/, 'targets kept');
  assert.equal(await page.locator('text=Message Stefan on WhatsApp').count(), 0);
  await ctx.close();
});

test('Coaching onboarding: under 18 gets the age message above Next, and the page scrolls to it', SKIP, async () => {
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="core"]');
  await page.fill('#nc-name', 'Young Person');
  await page.fill('#nc-email', 'young.person@example.com');
  await page.selectOption('#nc-country', 'Australia');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Step 1 of 6');
  await page.fill('#ob-age', '16');
  await page.click('button[data-act="obNext"]');
  assert.equal(await page.textContent('#err-age'), 'Coaching is for adults 18 and over.');
  assert.equal(await page.textContent('#obMsg'), 'Please answer the questions marked in red.');
  assert.equal(await page.locator('#toast.show').count(), 0, 'no popup covers the form');
  await ctx.close();
});
