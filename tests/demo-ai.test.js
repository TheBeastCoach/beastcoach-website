// Unit tests for api/demo-ai.js. Run with: node --test tests/
// fetch is mocked, so no network calls and no API keys are needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const handler = require(path.join(__dirname, '..', 'api', 'demo-ai.js'));
const KEY = 'test-demo-key';
const SMALL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

function makeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

function setEnv(overrides) {
  const base = { ANTHROPIC_API_KEY: 'sk-test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', DEMO_KEY: KEY };
  const env = Object.assign({}, base, overrides || {});
  for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DEMO_KEY']) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
}

function jsonResponse(status, obj) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// routes: { cap: () => response, ai: (body) => response }. Records every call.
function mockFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url: String(url), body });
    if (String(url).includes('/rest/v1/rpc/demo_ai_use')) {
      return routes.cap ? routes.cap() : jsonResponse(200, [{ allowed: true, used: 1 }]);
    }
    if (String(url).includes('api.anthropic.com')) {
      return routes.ai(body, calls.filter(c => c.url.includes('anthropic')).length);
    }
    throw new Error('unexpected url ' + url);
  };
  return calls;
}

// Anthropic reply helper. text can be a string (raw model output).
function aiReply(text) {
  return jsonResponse(200, { content: [{ type: 'text', text }] });
}

async function call(body, opts) {
  const res = makeRes();
  const o = opts || {};
  await handler({
    method: o.method || 'POST',
    headers: o.noKey ? {} : { 'x-demo-key': o.key !== undefined ? o.key : KEY },
    body
  }, res);
  return res;
}

function silence() {
  const orig = console.error;
  console.error = () => {};
  return () => { console.error = orig; };
}

test.beforeEach(() => { setEnv(); });
test.afterEach(() => { delete global.fetch; });

test('rejects non-POST with 405', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  const res = await call({}, { method: 'GET' });
  assert.equal(res.statusCode, 405);
});

test('missing env var gives 500 not_configured', async () => {
  for (const missing of ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DEMO_KEY']) {
    setEnv({ [missing]: undefined });
    mockFetch({ ai: () => { throw new Error('should not call AI'); } });
    const res = await call({ mode: 'log', text: 'toast' });
    assert.equal(res.statusCode, 500, missing);
    assert.equal(res.body.error, 'not_configured', missing);
  }
});

test('missing or wrong demo key gives 401 demo_key', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  let res = await call({ mode: 'log', text: 'toast' }, { key: 'nope' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'demo_key');
  res = await call({ mode: 'log', text: 'toast' }, { noKey: true });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'demo_key');
});

test('bad mode gives 400', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  const res = await call({ mode: 'delete-everything', text: 'x' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_mode');
});

test('log returns the estimate with fibre and items', async () => {
  mockFetch({ ai: () => aiReply(JSON.stringify({ name: 'Toast and peanut butter', calories: 420.4, protein: 14, carbs: 48, fat: 19, fibre: 6,
    items: [{ name: 'Bread', grams: 60, calories: 150 }], note: 'Standard portions.', confidence: 'medium' })) });
  const res = await call({ mode: 'log', text: 'two slices of toast with peanut butter' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.name, 'Toast and peanut butter');
  assert.equal(res.body.calories, 420);
  assert.equal(res.body.fibre, 6);
  assert.deepEqual(res.body.items, [{ name: 'Bread', grams: 60, calories: 150 }]);
  assert.equal(res.body.confidence, 'medium');
});

test('log with text over 600 characters gives 400 too_long', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  const res = await call({ mode: 'log', text: 'a'.repeat(601) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'too_long');
});

test('log that is not food gives 422 not_food', async () => {
  mockFetch({ ai: () => aiReply('{"error":"not_food"}') });
  const res = await call({ mode: 'log', text: 'the weather is nice' });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, 'not_food');
});

test('numbers are clamped and rounded', async () => {
  mockFetch({ ai: () => aiReply(JSON.stringify({ name: 'X', calories: -50, protein: 1e9, carbs: 'n/a', fat: 2.6, fibre: 3 })) });
  const res = await call({ mode: 'log', text: 'something' });
  assert.equal(res.body.calories, 0);
  assert.equal(res.body.protein, 500);
  assert.equal(res.body.carbs, 0);
  assert.equal(res.body.fat, 3);
});

test('day keeps the coach lines as written and reads a code-fenced reply', async () => {
  const reply = '```json\n' + JSON.stringify({ meals: [
    { calories: 480, protein: 30, carbs: 60, fat: 12, fibre: 8 },
    { calories: 600, protein: 45, carbs: 50, fat: 20, fibre: 9 }
  ] }) + '\n```';
  mockFetch({ ai: () => aiReply(reply) });
  const res = await call({ mode: 'day', text: 'Breakfast: 60g oats, 150g Greek yoghurt\nLunch: 150g chicken, 150g rice' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.meals.length, 2);
  assert.deepEqual(res.body.meals[0], { label: 'Breakfast', text: '60g oats, 150g Greek yoghurt', calories: 480, protein: 30, carbs: 60, fat: 12, fibre: 8 });
  assert.equal(res.body.meals[1].label, 'Lunch');
  assert.equal(res.body.meals[1].text, '150g chicken, 150g rice');
});

test('day retries once when the count is wrong, then succeeds', async () => {
  const calls = mockFetch({ ai: (body, n) => aiReply(JSON.stringify({ meals: n === 1
    ? [{ calories: 1 }]
    : [{ calories: 300 }, { calories: 400 }] })) });
  const res = await call({ mode: 'day', text: 'Breakfast: eggs\nDinner: fish' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.meals[1].calories, 400);
  assert.equal(calls.filter(c => c.url.includes('anthropic')).length, 2);
});

test('day with no line breaks gives a useful label', async () => {
  mockFetch({ ai: () => aiReply(JSON.stringify({ meals: [{ calories: 100 }] })) });
  const res = await call({ mode: 'day', text: 'banana and yoghurt' });
  assert.equal(res.body.meals[0].label, 'Meal 1');
  assert.equal(res.body.meals[0].text, 'banana and yoghurt');
});

test('day rejects more than 20 lines', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  const text = Array.from({ length: 21 }, (_, i) => 'Meal ' + i + ': rice').join('\n');
  const res = await call({ mode: 'day', text });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'too_many_lines');
});

test('daily cap reached gives 429 and does not call the AI', async () => {
  const calls = mockFetch({
    cap: () => jsonResponse(200, [{ allowed: false, used: 200 }]),
    ai: () => { throw new Error('should not call AI'); }
  });
  const res = await call({ mode: 'log', text: 'toast' });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'daily_limit');
  assert.equal(calls.filter(c => c.url.includes('anthropic')).length, 0);
});

test('cap call sends the shared limit of 200 with the service key', async () => {
  const calls = mockFetch({ ai: () => aiReply('{"error":"not_food"}') });
  await call({ mode: 'log', text: 'hello there' });
  const capCall = calls.find(c => c.url.includes('demo_ai_use'));
  assert.deepEqual(capCall.body, { p_limit: 200 });
  assert.equal(DAILY_LIMIT_IS_200(), true);
});
function DAILY_LIMIT_IS_200() { return handler._test.DAILY_LIMIT === 200; }

test('fridge returns cleaned items', async () => {
  mockFetch({ ai: () => aiReply(JSON.stringify({ items: ['Eggs', 'eggs', 'Spinach', '', 'Greek yoghurt'] })) });
  const res = await call({ mode: 'fridge', image: { type: 'image/jpeg', data: SMALL_PNG } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, ['Eggs', 'Spinach', 'Greek yoghurt']);
});

test('fridge rejects a bad image type and a bad encoding', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  let res = await call({ mode: 'fridge', image: { type: 'image/gif', data: SMALL_PNG } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_image');
  res = await call({ mode: 'fridge', image: { type: 'image/png', data: 'not base64!!' } });
  assert.equal(res.body.error, 'bad_image');
});

test('fridge with no food gives 422', async () => {
  mockFetch({ ai: () => aiReply('{"error":"not_food"}') });
  const res = await call({ mode: 'fridge', image: { type: 'image/png', data: SMALL_PNG } });
  assert.equal(res.statusCode, 422);
});

test('create keeps to listed foods and retries once when the first try uses unlisted food', async () => {
  const good = { meals: [{ name: 'Chicken and rice', calories: 600, protein: 46, carbs: 60, fat: 14, fibre: 8,
    uses: ['150 g chicken thigh', '150 g rice'], pantry: ['1 tsp olive oil'], steps: ['Cook the chicken'], tip: 'Add spinach next time' }] };
  const bad = { meals: [{ name: 'Cheesy chicken', calories: 600, protein: 46, carbs: 60, fat: 14, fibre: 8,
    uses: ['150 g chicken thigh', '30 g parmesan'], pantry: [], steps: ['Melt'], tip: '' }] };
  const calls = mockFetch({ ai: (body, n) => aiReply(JSON.stringify(n === 1 ? bad : good)) });
  const res = await call({ mode: 'create', have: 'chicken thigh, rice', meal: 'Dinner', effort: '15 minutes', targets: { calories: 600, protein: 40, fibre: 8 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.meals[0].name, 'Chicken and rice');
  assert.equal(res.body.meals[0].offTarget.length, 0);
  assert.equal(calls.filter(c => c.url.includes('anthropic')).length, 2);
});

test('create gives 422 ingredients when no meal can use only the listed foods', async () => {
  const bad = { meals: [{ name: 'Mystery', calories: 500, protein: 30, carbs: 50, fat: 10, fibre: 5, uses: ['200 g salmon'], pantry: [], steps: [], tip: '' }] };
  mockFetch({ ai: () => aiReply(JSON.stringify(bad)) });
  const res = await call({ mode: 'create', have: 'chicken, rice', meal: 'Lunch', effort: '5 minutes' });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, 'ingredients');
});

test('create rejects a meal type or effort outside the list', async () => {
  mockFetch({ ai: () => { throw new Error('should not call AI'); } });
  const res = await call({ mode: 'create', have: 'chicken, rice', meal: 'Brunch', effort: '15 minutes' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_input');
});

test('target clamping for create', () => {
  const { cleanTargets } = handler._test;
  assert.deepEqual(cleanTargets({ calories: 99999, protein: -4, fibre: 'x', fat: 10 }), { calories: 3000 });
});

test('AI failure gives 502 try_again and logs the detail server-side', async () => {
  const restore = silence();
  let logged = '';
  console.error = (...a) => { logged = a.join(' '); };
  mockFetch({ ai: () => jsonResponse(500, { error: 'overloaded' }) });
  const res = await call({ mode: 'log', text: 'toast' });
  restore();
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: 'try_again' });
  assert.match(logged, /demo-ai error: ai/);
});

test('bad JSON from the AI gives 502 try_again', async () => {
  const restore = silence();
  mockFetch({ ai: () => aiReply('Sorry, I cannot help with that.') });
  const res = await call({ mode: 'log', text: 'toast' });
  restore();
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'try_again');
});

test('the 200 cap is checked before any AI call', async () => {
  let aiCalled = false;
  mockFetch({
    cap: () => jsonResponse(200, [{ allowed: false, used: 200 }]),
    ai: () => { aiCalled = true; return aiReply('{}'); }
  });
  await call({ mode: 'day', text: 'Lunch: rice' });
  assert.equal(aiCalled, false);
});
