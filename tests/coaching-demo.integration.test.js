// Integration test: coaching-demo.html in a real browser, calling the REAL api/demo-ai.js handler.
// Only the Anthropic and Supabase fetches are mocked, so this checks that the page reads exactly
// what the API returns, including every error case.
//
// Needs Playwright and a Chrome install. Not part of the repo's dependencies, so run it with:
//   npm install --no-save playwright-core
//   PLAYWRIGHT_CORE_PATH=$(pwd)/node_modules/playwright-core CHROME_PATH="/path/to/Chrome" node --test tests/coaching-demo.integration.test.js
// If playwright-core cannot be loaded the tests are skipped with a message.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const handler = require(path.join(ROOT, 'api', 'demo-ai.js'));

const DEMO_KEY = 'integration-demo-key';
process.env.ANTHROPIC_API_KEY = 'sk-test-integration';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_integration';
process.env.DEMO_KEY = DEMO_KEY;

let pw = null;
let pwError = '';
try { pw = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core'); }
catch (e) { pwError = 'playwright-core not found. See the instructions at the top of this file.'; }
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---- Controlled upstream replies (only these two services are mocked) ----
const state = { allowed: true, replies: {}, upstream: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    const body = JSON.parse(opts.body);
    const kind = promptKind(body.system);
    state.upstream.push({ kind, body });
    const make = state.replies[kind];
    if (!make) return new Response('no reply configured', { status: 500 });
    const reply = make(body);
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('/rest/v1/rpc/demo_ai_use')) {
    return new Response(JSON.stringify([{ allowed: state.allowed, used: state.allowed ? 1 : 200 }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, opts);
};

function promptKind(system) {
  if (String(system).startsWith('You look at a photo')) return 'fridge';
  if (String(system).startsWith('You are a practical meal coach')) return 'create';
  if (String(system).includes('A coach typed')) return 'day';
  if (String(system).includes('explain how to do one exercise')) return 'exercise';
  return 'log';
}

// Runs the real handler for each request the page makes to /api/demo-ai.
async function routeToHandler(route) {
  const req = route.request();
  const raw = req.postData();
  const res = {
    statusCode: 200, body: undefined,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
  await handler({ method: req.method(), headers: req.headers(), body: raw ? JSON.parse(raw) : {} }, res);
  await route.fulfill({ status: res.statusCode, contentType: 'application/json', body: JSON.stringify(res.body) });
}

// ---- Static server for the page (serves only coaching-demo.html) ----
function startServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const file = req.url.split('?')[0];
      const types = { '/coaching-demo.html': 'text/html', '/basic-targets.js': 'application/javascript' };
      if (types[file]) {
        res.setHeader('content-type', types[file]);
        res.end(fs.readFileSync(path.join(ROOT, file.slice(1))));
      } else { res.statusCode = 404; res.end(); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// A tiny valid PNG (the page sends it as JPEG after resizing, so the type is what matters to the API).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let browser, server, base;

async function openPage(query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/fonts.g*.com/**', r => r.abort());
  await page.route('**/api/demo-ai', routeToHandler);
  await page.goto(base + '/coaching-demo.html' + (query === undefined ? '?key=' + DEMO_KEY : query));
  await page.waitForSelector('#viewAs');
  return { ctx, page };
}

// Waits for a toast whose text contains the given phrase, then returns the full text.
async function toastWith(page, phrase) {
  await page.waitForFunction(p => {
    const t = document.getElementById('toast');
    return t.classList.contains('show') && t.textContent.includes(p);
  }, phrase, { timeout: 15000 });
  return page.textContent('#toast');
}

async function openSamToday(page) {
  await page.selectOption('#viewAs', 'client:c_sam');
  await page.waitForSelector('text=Week 2 of 12');
}

test.before(async () => {
  if (!pw) return;
  server = await startServer();
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
});

const SKIP = pwError ? { skip: pwError } : {};

test('log: the page shows the estimate the API returns', SKIP, async () => {
  state.replies = { log: () => ({ name: 'Peanut butter toast', calories: 420, protein: 14, carbs: 48, fat: 19, fibre: 6,
    items: [{ name: 'Bread', grams: 60, calories: 150 }], note: 'Standard portions.', confidence: 'medium' }) };
  const { ctx, page } = await openPage();
  await openSamToday(page);
  await page.fill('#describe', 'Two slices of toast with peanut butter');
  await page.click('button[data-act="aiDescribe"]');
  await page.waitForSelector('#r-name');
  assert.equal(await page.inputValue('#r-name'), 'Peanut butter toast');
  assert.equal(await page.inputValue('#r-calories'), '420');
  assert.equal(await page.inputValue('#r-protein'), '14');
  assert.equal(await page.inputValue('#r-fibre'), '6');
  assert.match(await page.textContent('#app'), /Bread \(60g\)/);
  await page.click('button[data-act="saveDescribe"]');
  await page.waitForSelector('text=Meal saved.');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('day: the coach gets back the lines exactly as typed with numbers from the API', SKIP, async () => {
  state.replies = { day: () => '```json\n' + JSON.stringify({ meals: [
    { calories: 480, protein: 30, carbs: 60, fat: 12, fibre: 8 },
    { calories: 600, protein: 45, carbs: 50, fat: 20, fibre: 9 }
  ] }) + '\n```' };
  const { ctx, page } = await openPage();
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="openClient"][data-id="c_sam"]');
  await page.click('button[data-act="coachTab"][data-tab="plan"]');
  await page.fill('#dayLines', 'Breakfast: 60g oats, 150g Greek yoghurt\nLunch: 150g chicken, 150g rice');
  await page.click('button[data-act="calcDay"]');
  await page.waitForSelector('input[data-f="label"][value="Breakfast"]');
  assert.equal(await page.inputValue('input[data-f="text"][value="60g oats, 150g Greek yoghurt"]'), '60g oats, 150g Greek yoghurt');
  assert.equal(await page.inputValue('input[data-f="calories"][value="480"]'), '480');
  assert.equal(await page.inputValue('input[data-f="text"][value="150g chicken, 150g rice"]'), '150g chicken, 150g rice');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('fridge then create: the photo items feed the meal, and the meal shows uses, steps and tip', SKIP, async () => {
  state.replies = {
    fridge: () => ({ items: ['eggs', 'spinach'] }),
    create: () => ({ meals: [{ name: 'Spinach and egg scramble', calories: 500, protein: 32, carbs: 20, fat: 30, fibre: 6,
      uses: ['3 eggs', '1 handful spinach'], pantry: ['1 tsp olive oil'], steps: ['Wilt the spinach', 'Add eggs and stir'],
      tip: 'Add a slice of toast for carbs', offTarget: false }] })
  };
  const start = state.upstream.length;
  const { ctx, page } = await openPage();
  await openSamToday(page);
  await page.click('button[data-act="addMode"][data-m="builder"]');
  await page.setInputFiles('#fridgeFile', { name: 'fridge.png', mimeType: 'image/png', buffer: PNG });
  await page.click('button[data-act="build"]');
  await page.waitForSelector('button[data-act="logBuilt"]');
  assert.match(await page.inputValue('#bText'), /eggs, spinach/);
  const card = await page.textContent('#app');
  assert.match(card, /Spinach and egg scramble/);
  assert.match(card, /3 eggs, 1 handful spinach, 1 tsp olive oil/);
  assert.match(card, /Wilt the spinach/);
  assert.match(card, /Tip: Add a slice of toast for carbs/);
  // The API asks for one retry when the meal misses the calorie target, so create is called twice.
  const kinds = state.upstream.slice(start).map(u => u.kind);
  assert.deepEqual(kinds, ['fridge', 'create', 'create']);
  await page.click('button[data-act="logBuilt"]');
  await page.waitForSelector('text=Meal logged.');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('422 not_food: friendly message, page still usable', SKIP, async () => {
  state.replies = { log: () => ({ error: 'not_food' }) };
  const { ctx, page } = await openPage();
  await openSamToday(page);
  await page.fill('#describe', 'the weather is nice today');
  await page.click('button[data-act="aiDescribe"]');
  await toastWith(page, 'does not look like food');
  assert.equal(await page.locator('#describe').count(), 1, 'describe box still there');
  assert.equal(await page.locator('#m-name').count(), 1, 'manual entry still there');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('422 ingredients: friendly message when no meal uses only the listed foods', SKIP, async () => {
  state.replies = { create: () => ({ meals: [{ name: 'Salmon bowl', calories: 500, protein: 40, carbs: 40, fat: 15, fibre: 5,
    uses: ['150 g salmon'], pantry: [], steps: ['Bake the salmon'], tip: '' }] }) };
  const { ctx, page } = await openPage();
  await openSamToday(page);
  await page.click('button[data-act="addMode"][data-m="builder"]');
  await page.fill('#bText', 'rice and eggs');
  await page.click('button[data-act="build"]');
  await toastWith(page, 'could not make a meal from only the food you listed');
  assert.equal(await page.locator('button[data-act="logBuilt"]').count(), 0, 'no meal card shown');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('429 daily_limit: friendly message, and no AI call made', SKIP, async () => {
  state.allowed = false;
  state.replies = { log: () => { throw new Error('should not be called'); } };
  const before = state.upstream.length;
  try {
    const { ctx, page } = await openPage();
    await openSamToday(page);
    await page.fill('#describe', 'two eggs');
    await page.click('button[data-act="aiDescribe"]');
    await toastWith(page, 'calls are used up');
    assert.equal(state.upstream.length, before, 'no upstream AI call');
    assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
    await ctx.close();
  } finally { state.allowed = true; }
});

test('401 demo_key: friendly message asking for the right key', SKIP, async () => {
  state.replies = { log: () => ({ name: 'never', calories: 1 }) };
  const { ctx, page } = await openPage('?key=not-the-right-key');
  await openSamToday(page);
  await page.fill('#describe', 'toast');
  await page.click('button[data-act="aiDescribe"]');
  await toastWith(page, 'demo key was not accepted');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('502 try_again: AI returns something that is not JSON, page shows a friendly message', SKIP, async () => {
  const quiet = console.error; console.error = () => {};
  try {
    state.replies = { log: () => 'Sorry, I cannot help with that.' };
    const { ctx, page } = await openPage();
    await openSamToday(page);
    await page.fill('#describe', 'toast');
    await page.click('button[data-act="aiDescribe"]');
    await toastWith(page, 'Beast AI could not answer');
    assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
    await ctx.close();
  } finally { console.error = quiet; }
});

// Coach publishes a training plan, then the client opens its training tab.
async function publishTraining(page, text) {
  await page.selectOption('#viewAs', 'coach');
  await page.click('button[data-act="openClient"][data-id="c_sam"]');
  await page.click('button[data-act="coachTab"][data-tab="plan"]');
  await page.fill('textarea[data-inp="trainDraft"]', text);
  await page.click('button[data-act="publish"]');
  await page.waitForSelector('text=Published to the client.');
  await page.selectOption('#viewAs', 'client:c_sam');
  await page.click('button[data-act="clientTab"][data-tab="plan"]');
}

test('How to do it: a library exercise opens from the library with no AI call', SKIP, async () => {
  state.replies = { exercise: () => { throw new Error('library exercise must not call AI'); } };
  const start = state.upstream.length;
  const { ctx, page } = await openPage();
  await openSamToday(page);
  await page.click('button[data-act="clientTab"][data-tab="plan"]');
  await page.locator('.ex-row', { has: page.locator('span', { hasText: /^Squat 3x8$/ }) }).locator('button[data-act="howTo"]').click();
  await page.waitForSelector('#sheetRoot .sheet');
  const sheet = await page.textContent('#sheetRoot');
  assert.match(sheet, /Squat/);
  assert.match(sheet, /Keep your knees in line with your toes/);
  assert.match(sheet, /Watch a video/);
  assert.equal(state.upstream.length, start, 'no AI call for a library exercise');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sheetRoot .sheet', { state: 'detached' });
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('How to do it: an exercise not in the library is written by Beast AI and then saved in the browser', SKIP, async () => {
  state.replies = { exercise: () => ({ name: 'Hammer curl', works: 'The biceps and forearms.',
    steps: ['Stand tall holding a dumbbell in each hand, palms facing your sides.', 'Keep your elbows by your sides.', 'Curl the weights up, keeping your thumbs pointing up.'],
    tips: ['Do not swing your body.'], mistakes: ['Moving your elbows forward.'], easier: 'Use lighter dumbbells.' }) };
  const { ctx, page } = await openPage();
  await publishTraining(page, 'Mon:\n- Hammer curl 3x10');
  const start = state.upstream.length;
  await page.locator('.ex-row', { hasText: 'Hammer curl' }).locator('button[data-act="howTo"]').click();
  await page.waitForSelector('#sheetRoot .sheet');
  const sheet = await page.textContent('#sheetRoot');
  assert.match(sheet, /Stand tall holding a dumbbell in each hand/);
  assert.match(sheet, /Written by Beast AI/);
  const kinds = state.upstream.slice(start).map(u => u.kind);
  assert.deepEqual(kinds, ['exercise']);
  // Open it again: it is saved in the browser, so no second AI call.
  await page.click('button[data-act="closeSheet"]');
  await page.locator('.ex-row', { hasText: 'Hammer curl' }).locator('button[data-act="howTo"]').click();
  await page.waitForSelector('#sheetRoot .sheet');
  assert.equal(state.upstream.length, start + 1, 'second open uses the saved guide');
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});

test('How to do it: not a real exercise shows the no-guide message for a Core client', SKIP, async () => {
  state.replies = { exercise: () => ({ error: 'not_exercise' }) };
  const { ctx, page } = await openPage();
  await publishTraining(page, 'Mon:\n- Toast and jam 2x');
  await page.locator('.ex-row', { hasText: 'Toast and jam' }).locator('button[data-act="howTo"]').click();
  await page.waitForSelector('#sheetRoot .sheet');
  assert.match(await page.textContent('#sheetRoot'), /No guide for this one yet\. Ask Stefan at your next check-in\./);
  assert.match(await page.textContent('#toast'), /does not look like an exercise/);
  assert.equal(page.errors.length, 0, 'no page errors: ' + page.errors.join('; '));
  await ctx.close();
});
