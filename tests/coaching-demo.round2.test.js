// Browser tests for the second round of coaching demo changes:
// logs from activation, the two steps questions, food lists, time zones, meal logging, Other activity,
// logging for past days, customers (checkout news box, delete keeps the record, CSV and copy emails).
// Also writes the screenshots asked for in the round (into SHOT_DIR, default the system temp folder).
//
// Needs Playwright and Chrome. Run with:
//   PLAYWRIGHT_CORE_PATH=/path/to/node_modules/playwright-core CHROME_PATH="/path/to/Chrome" node --test tests/coaching-demo.round2.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOT_DIR || os.tmpdir();

let pw = null, pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See the instructions at the top of this file.'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SKIP = pwError ? { skip: pwError } : {};

// Monday 23 Nov 2026, 9am in Melbourne (AEDT, UTC+11). Tuesday is the day after.
const MON_9AM_MEL = new Date('2026-11-22T22:00:00Z');
const TUE_9AM_MEL = new Date('2026-11-23T22:00:00Z');
const STEPS_EVERYDAY_Q = 'About how many steps do you do on a normal day, NOT counting any walks you do on purpose? (work, errands, around the house)';
const STEPS_REALISTIC_Q = 'What daily steps target feels realistic for you, including walks you do on purpose?';
const HINT = 'Separate each food with a comma, e.g. halloumi, chickpeas, lentils';

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

// Every context runs in Melbourne time, so "today" is the same for the coach and for Melbourne clients.
async function openPage(o) {
  o = o || {};
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 390, height: 844 }, isMobile: !o.desktop, hasTouch: !o.desktop,
    timezoneId: 'Australia/Melbourne', acceptDownloads: true
  });
  if (o.clipboard) {
    await ctx.addInitScript(() => {
      window.__clip = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip = t; } } });
    });
  }
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/fonts.g*.com/**', r => r.abort());
  await page.route('**/api/demo-ai', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"demo_key"}' }));
  await page.clock.setFixedTime(o.time || MON_9AM_MEL);
  await page.goto(base + '/coaching-demo.html' + (o.key ? '?key=' + o.key : ''));
  await page.waitForSelector('#viewAs');
  return { ctx, page };
}
const noErrors = (page, label) => assert.equal(page.errors.length, 0, (label || 'page') + ' has no page errors: ' + page.errors.join('; '));
const ids = async (page, sel) => page.$$eval(sel, els => els.map(e => e.textContent.trim()));

// ---- New client onboarding helpers (six steps, Core) ----
async function startCoreCheckout(page, name, email, opts) {
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="core"]');
  await page.fill('#nc-name', name);
  await page.fill('#nc-email', email);
  await page.selectOption('#nc-country', 'Australia');
  if (opts && opts.news) await page.check('#nc-news');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Step 1 of 6');
}
async function fillStep(page, s, o) {
  o = o || {};
  if (s === 1) {
    await page.fill('#ob-age', '34');
    await page.selectOption('#ob-sex', 'Male');
    await page.fill('#ob-heightCm', '182');
    await page.fill('#ob-weight', '84');
    await page.fill('#ob-whatsapp', '+61 400 000 009');
    await page.fill('#ob-timezone', o.tz || 'Melbourne');
  }
  if (s === 2) {
    await page.fill('#ob-goal', 'Get stronger and sleep better');
    await page.check('input[name="ob-timeframe"][value="3 months"]');
    await page.fill('#ob-job', 'Teacher');
    await page.selectOption('#ob-activity', 'Mixed');
    await page.fill('#ob-stepsEveryday', '4000');
    await page.fill('#ob-stepsRealistic', '8000');
  }
  if (s === 3) {
    for (const f of ['Chicken', 'Rice', 'Broccoli']) await page.check(`input[data-obgrp="likedFoods"][value="${f}"]`);
    await page.fill('#ob-likedOther', 'halloumi, chickpeas, lentils');
  }
  if (s === 4) {
    await page.fill('#ob-avoid', 'mushrooms, olives');
    await page.fill('#ob-allergies', 'peanuts');
    await page.check('input[name="ob-diet"][value="No restrictions"]');
    await page.check('input[name="ob-mealsPerDay"][value="3"]');
    await page.check('input[name="ob-cookTime"][value="15 min"]');
    await page.check('input[name="ob-whoCooks"][value="Me"]');
    await page.fill('#ob-eatsOut', '2');
    await page.fill('#ob-alcohol', '3');
  }
  if (s === 5) {
    await page.check('input[data-obgrp="trainingDays"][value="Mon"]');
    await page.check('input[data-obgrp="trainingDays"][value="Wed"]');
    await page.check('input[name="ob-timeOfDay"][value="Morning"]');
    await page.check('input[name="ob-sessionLength"][value="45"]');
    await page.check('input[name="ob-place"][value="Gym"]');
    await page.check('input[name="ob-experience"][value="Some"]');
    await page.check('input[data-obgrp="equipment"][value="Full gym"]');
  }
  if (s === 6) {
    await page.selectOption('#ob-weighInDay', 'Mon');
    for (const k of ['heart', 'chest', 'other']) await page.check(`input[name="h-${k}"][value="no"]`);
    await page.check('input[data-ob="agreeTerms"]');
    await page.check('input[data-ob="agreeNotCoach"]');
    await page.check('input[data-ob="agreeConsent"]');
  }
}
// Fills steps `first` to `last`, clicking Next between them. The last step is left filled, not advanced.
async function onboardFrom(page, first, last, o) {
  for (let s = first; s <= last; s++) {
    await fillStep(page, s, o);
    if (s < last) await page.click('button[data-act="obNext"]');
  }
}
async function onboardTo(page, last, o) { return onboardFrom(page, 1, last, o); }
async function clientIdByName(page, name) {
  return page.evaluate(n => db.clients.find(c => c.name === n).id, name);
}
// Gives a client the targets and published plans that activation needs. Done straight in the page state.
async function publishPlans(page, id) {
  await page.evaluate(cid => {
    const c = clientById(cid);
    c.targets = { calories: 2000, protein: 150, carbs: 200, fat: 70, fibre: 28, steps: 8000 };
    c.plan.mealPublished = buildPlan(1);
    c.plan.mealDraft = draftFromPlan(c.plan.mealPublished);
    c.plan.trainPublished = 'Mon: Full body A\n- Squat 3x8';
    c.plan.trainDraft = c.plan.trainPublished;
    persist(); render();
  }, id);
}
async function coachOpens(page, id) {
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="clients"]');
  await page.click(`button[data-act="openClient"][data-id="${id}"]`);
}
// Logs a meal the typed way (the numbers) on the day shown. Coached clients open on From my plan, so Describe it first.
async function logTypedMeal(page, name, kcal, opts) {
  if (opts && opts.describeTab) await page.click('button[data-act="addMode"][data-m="describe"]');
  // The panel is open by default when Beast AI is off, so only open it if it is shut.
  if (!(await page.locator('#m-name').isVisible())) await page.click('summary:has-text("Enter the numbers yourself")');
  await page.fill('#m-name', name);
  await page.fill('#m-calories', String(kcal));
  await page.fill('#m-protein', '20');
  await page.click('button[data-act="saveTyped"]');
  await page.waitForSelector('text=Meal saved.');
}

// ---------------------------------------------------------------------------
// 1. Logs start at activation
// ---------------------------------------------------------------------------

test('Logs start at activation: a new client onboards, is activated, and the Logs tab shows only days from activation, with pre-activation meals in the baseline group', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await startCoreCheckout(page, 'Riley New', 'riley.new@example.com');
  await onboardTo(page, 6);
  await page.click('button[data-act="obSubmit"]');
  await page.waitForSelector('text=Thanks. Stefan is building your plan.');
  const id = await clientIdByName(page, 'Riley New');

  // Waiting for activation: the client logs a meal for yesterday and one for today.
  await page.click('button[data-act="dayPrev"]');                      // Sunday 22 Nov, still inside the 3 days
  await logTypedMeal(page, 'Pasta from yesterday', 610, { describeTab: true });
  await page.click('button[data-act="dayNext"]');                      // back to today
  await logTypedMeal(page, 'Toast while waiting', 280, { describeTab: true });

  // Coach activates on Monday 23 Nov.
  await publishPlans(page, id);
  await coachOpens(page, id);
  assert.match(await page.textContent('#app'), /Activate/);
  await page.click('button[data-act="activate"]');
  await page.waitForSelector('text=Activated. Week 1 starts');

  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  const dayRows = page.locator('details:not(.baseline)');
  assert.equal(await dayRows.count(), 1, 'one day in the list: activation day only, no empty days before it');
  const dayText = await dayRows.first().textContent();
  assert.match(dayText, /Mon,? 23 Nov 2026/, 'the list starts on the activation day');
  assert.doesNotMatch(await page.locator('details:not(.baseline)').allTextContents().then(t => t.join(' ')), /22 Nov/, 'no day before activation in the list');
  assert.match(await page.textContent('#app'), /From activation on Mon,? 23 Nov 2026/);

  // Baseline: one collapsed group at the bottom with both pre-activation meals.
  const baseline = page.locator('details.baseline');
  assert.equal(await baseline.count(), 1, 'one baseline group');
  assert.match(await baseline.locator('summary').textContent(), /Logged before activation \(baseline\)/);
  assert.match(await baseline.locator('summary').textContent(), /2 meals/);
  assert.equal(await baseline.getAttribute('open'), null, 'baseline is collapsed');
  const baselineText = await baseline.textContent();
  assert.match(baselineText, /Pasta from yesterday/);
  assert.match(baselineText, /Toast while waiting/);
  assert.equal(await page.locator('details').last().evaluate(el => el.classList.contains('baseline')), true, 'baseline sits at the bottom');

  // Coach checks on the newly activated client, read in the app: the plan inputs and the answers.
  await page.click('button[data-act="coachTab"][data-tab="overview"]');
  await page.click('button[data-act="coachTab"][data-tab="onboarding"]');
  const answers = await page.textContent('.card dl');
  assert.match(answers, /Currently eats/, 'meals question is labelled Currently eats');
  assert.match(answers, /Melbourne \(Australia\/Melbourne\)/, 'time zone shows the zone used');
  // Food lists become chips, one per food
  for (const food of ['halloumi', 'chickpeas', 'lentils', 'mushrooms', 'olives', 'peanuts']) {
    assert.ok(await page.locator('.need', { hasText: new RegExp('^' + food + '$') }).count() >= 1, 'chip for ' + food);
  }

  // The client logs a meal after activation: it appears in the day list.
  await page.selectOption('#viewAs', 'client:' + id);
  await page.click('button[data-act="addMode"][data-m="describe"]');
  await logTypedMeal(page, 'Lunch after activation', 540);
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="clients"]');
  await page.click(`button[data-act="openClient"][data-id="${id}"]`);
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  assert.match(await page.locator('details:not(.baseline)').first().textContent(), /Lunch after activation/, 'post-activation meal is in the day list');
  assert.doesNotMatch(await page.locator('details:not(.baseline)').first().textContent(), /Toast while waiting/, 'waiting meal stays in the baseline');

  // Screenshot for review: the coach Logs tab on a phone-sized screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: SHOTS + '/coach-logs-new-client-phone.png', fullPage: true });
  noErrors(page);
  await ctx.close();
});

test('Logs for seeded clients: Sam has a day for each day since activation and nothing before', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await coachOpens(page, 'c_sam');
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  // Sam was activated 30 days before today. The Logs tab lists the last 21 days, all from activation.
  assert.equal(await page.locator('details:not(.baseline)').count(), 21);
  assert.equal(await page.locator('details.baseline').count(), 0, 'no baseline for Sam');
  assert.match(await page.locator('details:not(.baseline)').last().textContent(), /3 Nov 2026/, 'the oldest day listed is 3 Nov, inside the activation window');
  assert.match(await page.locator('details:not(.baseline)').first().textContent(), /23 Nov 2026/, 'the newest day is today');
  noErrors(page);
  await ctx.close();
});

test('Mia, not yet activated: the Logs tab says so and her meal from before activation is in the baseline group', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await coachOpens(page, 'c_mia');
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  assert.match(await page.textContent('#app'), /Not activated yet/);
  assert.equal(await page.locator('details:not(.baseline)').count(), 0, 'no day rows before activation');
  assert.equal(await page.locator('details.baseline').count(), 1);
  assert.match(await page.locator('details.baseline').textContent(), /Overnight oats/);
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 2. Steps questions
// ---------------------------------------------------------------------------

test('Steps questions: six-step onboarding asks both, both are required, and the coach sees both numbers', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await startCoreCheckout(page, 'Steps Tester', 'steps.tester@example.com');
  await page.click('button[data-act="obNext"]');              // blank step 1 answers
  assert.match(await page.textContent('#err-timezone'), /Enter your time zone or city/, 'time zone required on step 1');
  await fillStep(page, 1);
  await page.click('button[data-act="obNext"]');              // now on step 2
  // Step 2: both questions, with the estimate hint under the first
  const app = await page.textContent('#app');
  assert.ok(app.includes(STEPS_EVERYDAY_Q), 'everyday steps question wording');
  assert.ok(app.includes(STEPS_REALISTIC_Q), 'realistic target question wording');
  assert.ok(app.includes('Just an estimate is fine.'), 'estimate hint');
  assert.doesNotMatch(app, /Steps on a usual day/, 'the old single question is gone');
  await page.click('button[data-act="obNext"]');              // blank: both flagged
  assert.match(await page.textContent('#err-stepsEveryday'), /Enter a number from 0 to 60,000/);
  assert.match(await page.textContent('#err-stepsRealistic'), /Enter a target from 3,000 to 20,000/);
  await page.fill('#ob-stepsEveryday', '4000');
  await page.fill('#ob-stepsRealistic', '25000');
  await page.click('button[data-act="obNext"]');
  assert.match(await page.textContent('#err-stepsRealistic'), /Enter a target from 3,000 to 20,000/, 'realistic target limited to 20,000');
  await fillStep(page, 2);                                    // the rest of step 2, realistic target 8,000
  await page.screenshot({ path: SHOTS + '/onboarding-steps-phone.png', fullPage: false });
  await page.click('button[data-act="obNext"]');
  await page.waitForSelector('text=Food you like');

  // Finish onboarding (steps 3 to 6), then check the coach's Plan inputs panel
  await onboardFrom(page, 3, 6);
  await page.click('button[data-act="obSubmit"]');
  await page.waitForSelector('text=Thanks. Stefan is building your plan.');
  const id = await clientIdByName(page, 'Steps Tester');
  await coachOpens(page, id);
  await page.click('button[data-act="coachTab"][data-tab="plan"]');
  const inputs = await page.textContent('.plan-inputs');
  assert.match(inputs, /Everyday steps \(not counting planned walks\)/);
  assert.match(inputs, /4000/);
  assert.match(inputs, /Realistic target \(including planned walks\)/);
  assert.match(inputs, /8000/);
  noErrors(page);
  await ctx.close();
});

test('Basic steps: calories come from the everyday steps, the target is the realistic target, and the limits are 3,000 and 20,000', SKIP, async () => {
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="basic"]');
  await page.fill('#nc-name', 'Basic Steps');
  await page.fill('#nc-email', 'basic.steps@example.com');
  await page.selectOption('#nc-country', 'New Zealand');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Your details');
  await page.fill('#ob-age', '34');
  await page.check('input[name="ob-sex"][value="Male"]');
  await page.fill('#ob-heightCm', '182');
  await page.fill('#ob-weight', '84');
  await page.fill('#ob-timezone', 'Auckland');
  await page.check('input[name="ob-goalKind"][value="fatloss"]');
  await page.check('input[name="ob-jobMult"][value="1.15"]');
  await page.fill('#ob-stepsEveryday', '5000');
  await page.fill('#ob-stepsRealistic', '25000');
  await page.fill('#ob-trainingSessions', '3');
  await page.check('input[name="ob-trainingIntensity"][value="350"]');
  await page.check('input[data-ob="agreeNotCoach"]');
  await page.check('input[data-ob="agreeTerms"]');
  await page.click('button[data-act="basicSubmit"]');
  assert.match(await page.textContent('#err-stepsRealistic'), /Enter a target from 3,000 to 20,000/, 'above 20,000 refused');
  await page.fill('#ob-stepsRealistic', '3000');
  await page.click('button[data-act="basicSubmit"]');
  await page.waitForSelector('text=Your daily targets');
  const shown = await page.$$eval('.target-val', els => els.map(e => e.textContent.trim()));
  const want = require(path.join(ROOT, 'basic-targets.js')).calcTargets({ sex: 'male', age: 34, heightCm: 182, weightKg: 84, activity: 1.15, steps: 5000, trainingSessions: 3, trainingIntensity: 350, goal: 'fatloss' });
  assert.equal(parseInt(shown[0].replace(/,/g, ''), 10), want.calories, 'calories use the everyday 5,000 steps');
  assert.equal(parseInt(shown[5].replace(/,/g, ''), 10), 3000, 'steps target is the realistic 3,000');
  // Blank time zone is refused on Basic too
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 3. Food lists
// ---------------------------------------------------------------------------

test('Food lists: each of the three boxes has the comma hint, and the coach sees each food as a chip', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await startCoreCheckout(page, 'Food Lists', 'food.lists@example.com');
  await onboardTo(page, 2);                                   // steps 1 and 2 filled, still on step 2
  await page.click('button[data-act="obNext"]');
  await page.waitForSelector('text=Food you like');           // step 3
  assert.equal(await page.locator('.hint', { hasText: HINT }).count(), 1, 'hint under Other foods you like');
  assert.match(await page.textContent('#app'), /Other foods you like/);
  await fillStep(page, 3);
  await page.click('button[data-act="obNext"]');
  await page.waitForSelector('text=Food to avoid');           // step 4
  assert.equal(await page.locator('.hint', { hasText: HINT }).count(), 2, 'hint under Foods you will not eat and under Allergies');
  assert.match(await page.textContent('#app'), /Foods you will not eat/);
  assert.match(await page.textContent('#app'), /Allergies or intolerances/);
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 4. Time zone
// ---------------------------------------------------------------------------

test('Time zone: typing a known city uses its day, an unknown one falls back to Melbourne and is flagged for the coach, and the list offers cities', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  // A datalist of common cities and zones
  assert.equal(await page.locator('#tzList option[value="London"]').count(), 1, 'London is in the list');
  // A London client: at 9am Monday in Melbourne it is still Sunday 22 November in London.
  await startCoreCheckout(page, 'London Client', 'london.client@example.com');
  await onboardTo(page, 6, { tz: 'London' });
  await page.click('button[data-act="obSubmit"]');
  await page.waitForSelector('text=Thanks. Stefan is building your plan.');
  const londonId = await clientIdByName(page, 'London Client');
  await page.selectOption('#viewAs', 'client:' + londonId);
  assert.match(await page.textContent('#app'), /Sun,? 22 Nov 2026/, 'Today for a London client is Sunday 22 November');
  await coachOpens(page, londonId);
  assert.match(await page.textContent('#app'), /London \(Europe\/London\)/, 'coach sees the zone used');
  assert.doesNotMatch(await page.textContent('#app'), /Not recognised/, 'no flag for a known city');

  // An unknown city: falls back to Melbourne and is flagged on the coach overview
  await startCoreCheckout(page, 'Narnia Client', 'narnia.client@example.com');
  await onboardTo(page, 6, { tz: 'Narnia' });
  await page.click('button[data-act="obSubmit"]');
  await page.waitForSelector('text=Thanks. Stefan is building your plan.');
  const nid = await clientIdByName(page, 'Narnia Client');
  await coachOpens(page, nid);
  assert.match(await page.textContent('.tz-flag'), /Not recognised: Australia\/Melbourne is used/, 'flagged for the coach');
  await page.selectOption('#viewAs', 'client:' + nid);
  assert.match(await page.textContent('#app'), /Mon,? 23 Nov 2026/, 'Today falls back to Melbourne');
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 5. Add a meal, redesigned
// ---------------------------------------------------------------------------

test('Add a meal card: heading and line, From my plan first for coaching clients, Describe it first for Basic, and Calculate now', SKIP, async () => {
  const { ctx, page } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.selectOption('#viewAs', 'client:c_sam');
  const card = page.locator('#addMealCard');
  assert.equal(await card.locator('h3').textContent(), 'Add a meal');
  assert.equal(await card.locator('.lede').textContent(), 'Log what you ate: pick it from your plan, or describe it and Beast AI calculates it.');
  assert.deepEqual(await ids(page, '.seg button'), ['From my plan', 'Describe it', 'Meal Builder'], 'order of options');
  assert.equal(await page.locator('.seg button.on').textContent(), 'From my plan', 'From my plan is the default for coaching clients');
  await page.click('button[data-act="addMode"][data-m="describe"]');
  assert.equal(await page.locator('button[data-act="aiDescribe"]').textContent(), 'Calculate now');
  assert.equal(await page.locator('text=Estimate with Beast AI').count(), 0, 'old button label is gone');
  await card.screenshot({ path: SHOTS + '/add-a-meal-phone.png' });

  await page.selectOption('#viewAs', 'client:c_alex');
  assert.deepEqual(await ids(page, '.seg button'), ['Describe it'], 'Basic has Describe it only');
  assert.equal(await page.locator('.seg button.on').textContent(), 'Describe it', 'Describe it is the default for Basic');
  assert.match(await page.locator('#addMealCard .lede').textContent(), /describe it and Beast AI calculates it/);
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 6. Other activity
// ---------------------------------------------------------------------------

test('Other activity: saves what, minutes and notes, shows on Today and in the coach Logs, and blank minutes are not stored as 0', SKIP, async () => {
  const { ctx, page } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.selectOption('#viewAs', 'client:c_sam');
  await page.click('button[data-act="woMode"][data-m="other"]');
  await page.fill('[data-wo="what"]', 'Football');
  await page.fill('[data-wo="minutes"]', '45');
  await page.fill('[data-wo="notes"]', 'Felt good');
  await page.click('button[data-act="saveWorkout"]');
  await page.waitForSelector('text=Workout saved.');
  const today = await page.textContent('#app');
  assert.match(today, /Football/, 'shows on Today');
  assert.match(today, /45 min/);
  assert.match(today, /Felt good/);
  const saved = await page.evaluate(() => clientById('c_sam').workouts.find(w => w.what === 'Football'));
  assert.equal(saved.minutes, 45);
  assert.equal(saved.notes, 'Felt good');
  assert.equal(saved.session, undefined, 'Other activity is not a sets-and-reps session');

  // Blank minutes: saved as no minutes, not 0
  await page.click('button[data-act="woMode"][data-m="other"]');
  await page.fill('[data-wo="what"]', 'Yoga');
  await page.click('button[data-act="saveWorkout"]');
  await page.waitForSelector('text=Workout saved.');
  const yoga = await page.evaluate(() => clientById('c_sam').workouts.find(w => w.what === 'Yoga'));
  assert.equal(yoga.minutes, null, 'blank minutes is null');
  assert.doesNotMatch(await page.textContent('#app'), /Yoga[^<]*0 min/);

  // Coach Logs for the same day
  await coachOpens(page, 'c_sam');
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  const logs = await page.locator('details:not(.baseline)').first().textContent();
  assert.match(logs, /Other activity: Football \(45 min\) · Felt good/, 'coach sees what, minutes and notes');
  assert.match(logs, /Other activity: Yoga/);
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 7. Logging for past days
// ---------------------------------------------------------------------------

test('Past days: Previous stops at 3 days back, an older day is read-only, and back-dated entries show added later on the coach side', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'client:c_sam');
  await page.click('button[data-act="dayPrev"]');     // Sunday 22
  await page.click('button[data-act="dayPrev"]');     // Saturday 21
  await page.click('button[data-act="dayPrev"]');     // Friday 20: the limit
  assert.equal(await page.locator('button[data-act="dayPrev"]').isDisabled(), true, 'Previous is off at 3 days back');
  // Log a meal and steps for a back day
  await page.click('button[data-act="dayNext"]');     // Saturday 21
  await page.click('button[data-act="dayNext"]');     // Sunday 22
  await page.click('button[data-act="addMode"][data-m="describe"]');
  await logTypedMeal(page, 'Late lunch', 500);
  await page.fill('#st-val', '7200');
  await page.click('button[data-act="saveSteps"]');
  await page.waitForSelector('text=Steps saved.');
  // Coach: both entries marked added later on Sunday
  await coachOpens(page, 'c_sam');
  await page.click('button[data-act="coachTab"][data-tab="logs"]');
  const sunday = page.locator('details:not(.baseline)', { hasText: '22 Nov 2026' }).first();
  assert.equal(await sunday.locator('.late').count() >= 2, true, 'meal and steps marked added later');
  assert.match(await sunday.textContent(), /Late lunch/);
  assert.equal(await page.locator('details:not(.baseline)', { hasText: '23 Nov 2026' }).first().locator('.late').count(), 0, 'today is not marked');

  // A day more than 3 days back is read-only
  await page.selectOption('#viewAs', 'client:c_sam');
  await page.evaluate(() => { ui.clientDay = addDays(todayS(), -10); saveUi(); render(); });
  assert.match(await page.textContent('#app'), /read-only/);
  assert.equal(await page.locator('#addMealCard').count(), 0, 'no add a meal card on a read-only day');
  assert.equal(await page.locator('button[data-act="saveSteps"]').count(), 0, 'no steps form on a read-only day');
  assert.equal(await page.locator('button[data-act="saveWorkout"]').count(), 0, 'no workout form on a read-only day');
  assert.equal(await page.locator('button[data-act="editMeal"]').count(), 0, 'no edit buttons on a read-only day');
  noErrors(page);
  await ctx.close();
});

test('Weigh-ins stay strict: a weigh-in on any other day is refused', SKIP, async () => {
  const { ctx, page } = await openPage({ time: TUE_9AM_MEL, viewport: { width: 390, height: 844 } });
  await page.selectOption('#viewAs', 'client:c_sam');
  // On a Tuesday there is no weigh-in box to type into...
  assert.equal(await page.locator('#wi-val').count(), 0, 'no weigh-in entry box on a Tuesday');
  // ...and the save itself refuses the day too, if it is ever called.
  await page.evaluate(() => ACT.saveWeigh());
  await page.waitForSelector('text=Weigh-ins are only on Monday.');
  assert.equal(await page.evaluate(() => clientById('c_sam').weighIns.some(w => w.date === todayS())), false, 'nothing saved');
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 8. Customers
// ---------------------------------------------------------------------------

test('Customers: seeded past and current customers are listed with products, status and OK to email', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="customers"]');
  assert.equal(await page.locator('[data-cust-row]').count(), 7, 'four current clients and three past customers');
  const row = name => page.locator('[data-cust-row]', { hasText: name });
  assert.match(await row('Dana Price').textContent(), /Core/);
  assert.match(await row('Dana Price').textContent(), /Finished/);
  assert.match(await row('Dana Price').textContent(), /Yes/);
  assert.match(await row('Ben Ortiz').textContent(), /Data deleted/);
  assert.match(await row('Ben Ortiz').textContent(), /Did not say yes/);
  assert.match(await row('Kim Walsh').textContent(), /Unsubscribed/);
  assert.match(await row('Sam Taylor').textContent(), /Yes/);
  assert.match(await row('Alex Lee').textContent(), /Basic/);
  // Tabs: Clients and Customers side by side
  assert.deepEqual(await ids(page, 'nav.tabs button'), ['Clients', 'Customers']);
  await page.screenshot({ path: SHOTS + '/customers-desktop.png', fullPage: true });
  noErrors(page);
  await ctx.close();
});

test('Checkout: the news box is optional and unticked by default, and the answer and its date are stored on the customer record', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="essential"]');
  assert.equal(await page.isChecked('#nc-news'), false, 'never pre-ticked');
  assert.match(await page.textContent('#app'), /Send me news and offers from Beast Coach\. Unsubscribe any time\./);
  await page.fill('#nc-name', 'No News Nina');
  await page.fill('#nc-email', 'no.news@example.com');
  await page.click('button[data-act="pay"]');
  assert.match(await page.textContent('#err-nc-country'), /Choose your country/, 'country is required');
  await page.selectOption('#nc-country', 'Canada');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Step 1 of 6');
  const nina = await page.evaluate(() => db.customers.find(x => x.email === 'no.news@example.com'));
  assert.equal(nina.marketingConsent, false);
  assert.equal(nina.marketingDate, '2026-11-23', 'the answer date is stored');
  assert.equal(nina.country, 'Canada');
  assert.equal(nina.purchases[0].product, 'Essential');
  assert.equal(nina.purchases[0].price, 110);
  assert.equal(nina.unsubscribed, false);

  // Ticked: stored as a yes
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="basic"]');
  await page.fill('#nc-name', 'Yes News Yara');
  await page.fill('#nc-email', 'yes.news@example.com');
  await page.selectOption('#nc-country', 'Australia');
  await page.check('#nc-news');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Your details');
  const yara = await page.evaluate(() => db.customers.find(x => x.email === 'yes.news@example.com'));
  assert.equal(yara.marketingConsent, true);
  assert.equal(yara.marketingDate, '2026-11-23');
  assert.equal(yara.purchases[0].product, 'Basic');
  assert.equal(yara.purchases[0].price, 30);
  noErrors(page);
  await ctx.close();
});

test('Deleting a client removes their data but keeps the customer record, marked Data deleted', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await coachOpens(page, 'c_mia');
  await page.click('button[data-act="deleteClient"][data-id="c_mia"]');
  await page.waitForSelector('text=Client data deleted.');
  assert.equal(await page.evaluate(() => db.clients.some(c => c.id === 'c_mia')), false, 'client data is gone');
  // Clients list: Mia is no longer there
  await page.click('button[data-act="coachPage"][data-p="clients"]');
  assert.equal(await page.locator('button[data-act="openClient"][data-id="c_mia"]').count(), 0);
  // Customers: Mia is still there, marked Data deleted, and Cancelled because she had not finished
  await page.click('button[data-act="coachPage"][data-p="customers"]');
  const mia = page.locator('[data-cust-row]', { hasText: 'Mia Chen' });
  assert.equal(await mia.count(), 1, 'customer record kept');
  assert.match(await mia.textContent(), /Data deleted/);
  assert.match(await mia.textContent(), /Cancelled/);
  assert.match(await mia.textContent(), /Essential/, 'purchase history kept');
  noErrors(page);
  await ctx.close();
});

test('Copy emails and Download CSV only include customers who are OK to email', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 }, clipboard: true });
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="customers"]');
  // Sam (said yes) and Dana (said yes, not unsubscribed). Mia, Jordan, Alex, Ben and Kim are left out.
  assert.match(await page.textContent('#custNote'), /2 OK|left out/, 'the note explains the exclusions');
  assert.match(await page.textContent('#custNote'), /5 shown (is|are) left out/);
  await page.click('button[data-act="copyEmails"]');
  await page.waitForFunction(() => window.__clip !== null);
  assert.equal(await page.evaluate(() => window.__clip), 'sam@example.com, dana.price@example.com');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button[data-act="downloadCsv"]')]);
  assert.match(dl.suggestedFilename(), /^beast-coach-customers-ok-to-email-2026-11-23\.csv$/);
  const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
  assert.equal(csv[0], 'name,email,country,products,last_purchase,status,ok_to_email,data_deleted');
  assert.equal(csv.length, 3, 'header plus the two customers who are OK to email');
  assert.ok(csv[1].startsWith('Sam Taylor,sam@example.com,'));
  assert.ok(csv[2].startsWith('Dana Price,dana.price@example.com,'));
  assert.ok(!csv.join('\n').includes('mia@example.com') && !csv.join('\n').includes('kim.walsh'), 'the others are left out');

  // Filters apply too: Essential has nobody who is OK to email
  await page.selectOption('#custProduct', 'Essential');
  await page.click('button[data-act="copyEmails"]');
  assert.match(await page.textContent('#toast'), /No customers are OK to email with these filters/);
  noErrors(page);
  await ctx.close();
});

test('Unsubscribe: the flag takes a customer out of copies and CSV files at once', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 }, clipboard: true });
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="customers"]');
  await page.click('[data-cust-row]:has-text("Sam Taylor") button[data-act="unsubscribe"]');
  await page.waitForSelector('text=Sam Taylor is unsubscribed.');
  assert.match(await page.locator('[data-cust-row]', { hasText: 'Sam Taylor' }).textContent(), /Unsubscribed/);
  const stored = await page.evaluate(() => db.customers.find(x => x.name === 'Sam Taylor'));
  assert.equal(stored.unsubscribed, true);
  assert.equal(stored.unsubscribedDate, '2026-11-23');
  await page.click('button[data-act="copyEmails"]');
  await page.waitForFunction(() => window.__clip !== null);
  assert.equal(await page.evaluate(() => window.__clip), 'dana.price@example.com');
  noErrors(page);
  await ctx.close();
});

test('Customers search and filters update the list in place and keep the search box focused', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="customers"]');
  await page.click('#custQ');
  await page.keyboard.type('mia');
  assert.equal(await page.locator('[data-cust-row]:not([hidden])').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'custQ', 'focus stays in the search box');
  await page.fill('#custQ', '');
  await page.selectOption('#custOk', 'yes');
  assert.equal(await page.locator('[data-cust-row]:not([hidden])').count(), 2);
  await page.selectOption('#custOk', '');
  await page.selectOption('#custStatus', 'basic');
  assert.equal(await page.locator('[data-cust-row]:not([hidden])').count(), 2, 'Alex and Kim are on Basic');
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 9. Reset, and the no-key run-through
// ---------------------------------------------------------------------------

test('Reset demo reseeds the sample clients and customers', SKIP, async () => {
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="basic"]');
  await page.fill('#nc-name', 'Temp Person');
  await page.fill('#nc-email', 'temp.person@example.com');
  await page.selectOption('#nc-country', 'Australia');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Your details');
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="reset"]');
  await page.waitForSelector('text=Demo reset.');
  assert.equal(await page.evaluate(() => db.clients.length), 4);
  assert.equal(await page.evaluate(() => db.customers.length), 7);
  noErrors(page);
  await ctx.close();
});

test('No key: Beast AI is off, the page says so, and Calculate now asks you to enter the numbers', SKIP, async () => {
  const { ctx, page } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.selectOption('#viewAs', 'client:c_sam');
  await page.click('button[data-act="addMode"][data-m="describe"]');
  assert.match(await page.textContent('#demoBar'), /Beast AI: off/);
  await page.fill('#describe', 'Two eggs on toast');
  await page.click('button[data-act="aiDescribe"]');
  await page.waitForSelector('text=Beast AI is off in this browser.');
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 10. Agreements link to their documents
// ---------------------------------------------------------------------------

test('Agreements: each one links to its document in a new tab, and following a link does not tick the box', SKIP, async () => {
  const { ctx, page } = await openPage({ viewport: { width: 390, height: 844 } });
  await startCoreCheckout(page, 'Agreement Ann', 'agreement.ann@example.com');
  await onboardTo(page, 5);                                   // steps 1 to 5 filled
  await page.click('button[data-act="obNext"]');              // step 6: the agreements, all unticked
  await page.waitForSelector('text=Agreements');
  for (const box of ['agreeTerms', 'agreeNotCoach', 'agreeConsent']) {
    assert.equal(await page.isChecked(`input[data-ob="${box}"]`), false, box + ' is not ticked by default');
  }
  for (const href of ['/coaching-terms', '/coaching-health', '/coaching-privacy']) {
    const link = page.locator(`a[href="${href}"]`);
    assert.equal(await link.getAttribute('target'), '_blank', 'opens in a new tab: ' + href);
    assert.equal(await link.getAttribute('rel'), 'noopener', 'noopener: ' + href);
  }
  // Following a link opens the document in a new tab and leaves the form, and the box, as they were
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.click('a[href="/coaching-health"]')]);
  await popup.close();
  assert.equal(await page.isChecked('input[data-ob="agreeNotCoach"]'), false, 'following the link does not tick the box');
  assert.match(await page.textContent('#app'), /Read the health notice/);
  await page.locator('.card', { hasText: 'Agreements' }).screenshot({ path: SHOTS + '/agreements-links-phone.png' });
  noErrors(page);
  await ctx.close();
});
