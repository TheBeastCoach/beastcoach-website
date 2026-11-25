// Browser tests for scheduled check-ins, and for Basic "Maintain" in the demo.
// Check-ins happen on WhatsApp, outside the portal. The portal only shows when they are.
// Run with the same environment as the other coaching browser tests (see docs/COACHING-DEMO.md):
//   PLAYWRIGHT_CORE_PATH=... CHROME_PATH=... node --test tests/coaching-round3.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BasicTargets = require(path.join(ROOT, 'basic-targets.js'));

let pw = null, pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See the instructions in docs/COACHING-DEMO.md.'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SKIP = pwError ? { skip: pwError } : {};

// Monday 23 Nov 2026, 9am Melbourne (AEDT, UTC+11). Sam's next check-in is two days after today (Wed 25 Nov) at 6:30pm Melbourne.
const MON_9AM_MEL = new Date('2026-11-22T22:00:00Z');

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

async function openPage(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 390, height: 844 }, isMobile: !o.desktop, hasTouch: !o.desktop, timezoneId: 'Australia/Melbourne' });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.route('**/fonts.g*.com/**', r => r.abort());
  await page.route('**/api/demo-ai', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"demo_key"}' }));
  await page.clock.setFixedTime(o.time || MON_9AM_MEL);
  await page.goto(base + '/coaching-demo.html');
  await page.waitForSelector('#viewAs');
  return { ctx, page };
}
const noErrors = (page, label) => assert.equal(page.errors.length, 0, (label || 'page') + ' has no page errors: ' + page.errors.join('; '));
const toText = async (page, sel) => ((await page.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();
async function coachCheckins(page, id) {
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="clients"]');
  await page.click(`button[data-act="openClient"][data-id="${id}"]`);
  await page.click('button[data-act="coachTab"][data-tab="checkins"]');
}
async function setClient(page, id) { await page.selectOption('#viewAs', 'client:' + id); }

// ---------------------------------------------------------------------------
// Client side: the Today card
// ---------------------------------------------------------------------------

test('Sam (Core) sees the next check-in on Today, with the time in Melbourne and the WhatsApp line', SKIP, async () => {
  const { ctx, page } = await openPage();
  await setClient(page, 'c_sam');
  assert.equal(await page.locator('#checkinCard').count(), 1, 'the card shows');
  assert.equal(await toText(page, '#checkinCard h3'), 'Next check-in: Wed 25 Nov, 6:30pm');
  assert.match(await toText(page, '#checkinCard'), /I'll contact you on WhatsApp at this time\./);
  assert.doesNotMatch(await toText(page, '#checkinCard'), /Melbourne time/, 'no second time when the client is in Melbourne');
  noErrors(page);
  await ctx.close();
});

test('a client in another zone sees their own time, with the Melbourne time beside it', SKIP, async () => {
  const { ctx, page } = await openPage();
  // Sam is moved to London for this test. 6:30pm in Melbourne is 7:30am in London, the same day.
  await page.evaluate(() => { clientById('c_sam').ob.timezone = 'London'; persist(); });
  await setClient(page, 'c_sam');
  assert.equal(await toText(page, '#checkinCard h3'), 'Next check-in: Wed 25 Nov, 7:30am');
  assert.equal(await toText(page, '#checkinCard .mini'), '(Melbourne time 6:30pm)');
  noErrors(page);
  await ctx.close();
});

test('the card is hidden when nothing is scheduled, and a cancelled check-in is not shown to the client', SKIP, async () => {
  const { ctx, page } = await openPage();
  await coachCheckins(page, 'c_sam');
  await page.click('button[data-act="cancelCheckin"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Check-in cancelled'));
  await setClient(page, 'c_sam');
  assert.equal(await page.locator('#checkinCard').count(), 0, 'no card when nothing is scheduled');
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// Coach side: schedule, edit and cancel
// ---------------------------------------------------------------------------

test('Core: the coach schedules, edits and cancels a check-in, and the client card follows each change (at 390px)', SKIP, async () => {
  const { ctx, page } = await openPage();
  await coachCheckins(page, 'c_sam');
  // Core gets every type
  assert.deepEqual(await page.$$eval('#ci-type option', os => os.map(o => o.value)), ['Kick-off call', 'Check-in', 'Video call']);
  // Schedule a video call on Tue 1 Dec at 7:00pm Melbourne time
  await page.fill('#ci-date', '2026-12-01');
  await page.selectOption('#ci-time', '19:00');
  await page.selectOption('#ci-type', 'Video call');
  await page.click('button[data-act="saveCheckin"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Check-in saved'));
  const list = await page.locator('.card', { hasText: 'Check-ins' }).last().textContent();
  assert.match(list, /Video call/);
  assert.match(list, /Upcoming/);
  assert.match(list, /Tue 1 Dec, 7:00pm/);
  assert.match(list, /Melbourne time/);
  // Cancel the seeded Thursday check-in: the card moves to the Tuesday one
  await page.click('[data-act="cancelCheckin"][data-id="ci_sam_next"]');
  await setClient(page, 'c_sam');
  assert.equal(await toText(page, '#checkinCard h3'), 'Next check-in: Tue 1 Dec, 7:00pm');
  // Edit the Tuesday one to 8:00pm (the only check-in with an Edit button)
  await coachCheckins(page, 'c_sam');
  await page.click('button[data-act="editCheckin"]');
  await page.waitForSelector('button[data-act="saveCheckin"]:has-text("Save changes")');
  await page.selectOption('#ci-time', '20:00');
  await page.click('button[data-act="saveCheckin"]');
  await setClient(page, 'c_sam');
  assert.equal(await toText(page, '#checkinCard h3'), 'Next check-in: Tue 1 Dec, 8:00pm');
  // Cancel it: nothing left, so the card goes
  await coachCheckins(page, 'c_sam');
  await page.click('[data-act="cancelCheckin"]:not([data-id="ci_sam_next"])');
  await setClient(page, 'c_sam');
  assert.equal(await page.locator('#checkinCard').count(), 0);
  noErrors(page);
  await ctx.close();
});

test('Core: a check-in cannot be scheduled in the past', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await coachCheckins(page, 'c_sam');
  await page.fill('#ci-date', '2026-11-01');
  await page.click('button[data-act="saveCheckin"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Pick a time in the future'));
  noErrors(page);
  await ctx.close();
});

test('Essential: the coach gets only the kick-off call, and only one of them', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await coachCheckins(page, 'c_mia');
  assert.deepEqual(await page.$$eval('#ci-type option', os => os.map(o => o.value)), ['Kick-off call'], 'only Kick-off call');
  await page.fill('#ci-date', '2026-11-30');
  await page.selectOption('#ci-time', '18:00');
  await page.click('button[data-act="saveCheckin"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Check-in saved'));
  // The form is replaced: no second check-in can be made
  assert.equal(await page.locator('#ci-date').count(), 0, 'no form for a second check-in');
  assert.match(await page.textContent('#app'), /Essential includes one kick-off call\. Edit it or cancel it to change the time\./);
  // The client sees the kick-off on Today
  await setClient(page, 'c_mia');
  assert.equal(await toText(page, '#checkinCard .eyebrow'), 'Kick-off call');
  assert.equal(await toText(page, '#checkinCard h3'), 'Next check-in: Mon 30 Nov, 6:00pm');
  noErrors(page);
  await ctx.close();
});

test('Essential: a second kick-off is refused even if someone tries to force it', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await coachCheckins(page, 'c_mia');
  await page.fill('#ci-date', '2026-11-30');
  await page.click('button[data-act="saveCheckin"]');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Check-in saved'));
  // Bypass the form: call the save handler directly with a second kick-off
  const msg = await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<input id="ci-date" value="2026-12-02"><select id="ci-time"><option>18:00</option></select><select id="ci-type"><option>Kick-off call</option></select>'); ACT.saveCheckin(); return document.getElementById('toast').textContent; });
  assert.match(msg, /Essential includes one kick-off call/);
  assert.equal(await page.evaluate(() => clientById('c_mia').checkins.filter(x => x.status !== 'cancelled').length), 1);
  noErrors(page);
  await ctx.close();
});

test('Basic: no check-ins at all: no tab, no scheduling, no card', SKIP, async () => {
  const { ctx, page } = await openPage({ desktop: true, viewport: { width: 1280, height: 900 } });
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="coachPage"][data-p="clients"]');
  await page.click('button[data-act="openClient"][data-id="c_alex"]');
  assert.equal(await page.locator('button[data-act="coachTab"][data-tab="checkins"]').count(), 0, 'no Check-ins tab');
  assert.equal(await page.locator('button[data-act="saveCheckin"]').count(), 0);
  await setClient(page, 'c_alex');
  assert.equal(await page.locator('#checkinCard').count(), 0, 'no card on Basic Today');
  assert.doesNotMatch(await page.textContent('#app'), /Check-in|check-in/, 'no check-in wording at all on Basic');
  noErrors(page);
  await ctx.close();
});

test('the WhatsApp button stays on The Beast only (Jordan has it, Sam does not)', SKIP, async () => {
  const { ctx, page } = await openPage();
  await setClient(page, 'c_jordan');
  assert.equal(await page.locator('a', { hasText: 'Message Stefan on WhatsApp' }).count(), 1, 'The Beast has the button');
  await setClient(page, 'c_sam');
  assert.equal(await page.locator('a', { hasText: 'Message Stefan on WhatsApp' }).count(), 0, 'Core does not');
  noErrors(page);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// Basic: Maintain gives exactly the maintenance calories
// ---------------------------------------------------------------------------

test('New client on Basic with Maintain: the daily calories equal the calculated maintenance', SKIP, async () => {
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'new');
  await page.click('button[data-act="buy"][data-t="basic"]');
  await page.fill('#nc-name', 'Maintain Mo');
  await page.fill('#nc-email', 'maintain.mo@example.com');
  await page.selectOption('#nc-country', 'Australia');
  await page.click('button[data-act="pay"]');
  await page.waitForSelector('text=Your details');
  await page.fill('#ob-age', '41');
  await page.check('input[name="ob-sex"][value="Female"]');
  await page.fill('#ob-heightCm', '168');
  await page.fill('#ob-weight', '69');
  await page.fill('#ob-timezone', 'Melbourne');
  await page.check('input[name="ob-goalKind"][value="maintain"]');
  await page.check('input[name="ob-jobMult"][value="1.25"]');
  await page.fill('#ob-stepsEveryday', '6000');
  await page.fill('#ob-stepsRealistic', '9000');
  await page.fill('#ob-trainingSessions', '3');
  await page.check('input[name="ob-trainingIntensity"][value="350"]');
  await page.check('input[data-ob="agreeNotCoach"]');
  await page.check('input[data-ob="agreeTerms"]');
  await page.click('button[data-act="basicSubmit"]');
  await page.waitForSelector('text=Your daily targets');
  const result = await page.evaluate(() => {
    const c = db.clients.find(x => x.name === 'Maintain Mo');
    const t = BasicTargets.calcTargets(basicInputs(c.ob, c.ob.weightKg));
    return { shown: c.targets.calories, maintenance: t.maintenance, goal: c.ob.goalKind };
  });
  assert.equal(result.goal, 'maintain');
  assert.equal(result.shown, result.maintenance, 'calories are exactly maintenance');
  assert.match(await page.textContent('.target-val'), /\d/);
  noErrors(page);
  await ctx.close();
});

// The seed is relative to today: move the clock on and Sam's dates move with it.
test('seeded dates follow today: check-in two days ahead, the latest Monday weigh-ins, and a start 30 days back', SKIP, async () => {
  // Monday 7 Dec 2026, 9am Melbourne
  const { ctx, page } = await openPage({ time: new Date('2026-12-06T22:00:00Z') });
  await setClient(page, 'c_sam');
  assert.equal(await toText(page, '#checkinCard h3'), 'Next check-in: Wed 9 Dec, 6:30pm', 'two days after today');
  const seeded = await page.evaluate(() => {
    const c = clientById('c_sam');
    return { start: c.startDate, weighIns: c.weighIns.map(w => w.date), checkin: c.checkins[0].date };
  });
  assert.equal(seeded.start, '2026-11-07', 'started 30 days before 7 Dec');
  assert.deepEqual(seeded.weighIns, ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'], 'the four latest Mondays before today');
  assert.equal(seeded.checkin, '2026-12-09');
  noErrors(page);
  await ctx.close();
});
