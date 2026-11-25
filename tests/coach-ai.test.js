// Unit tests for api/coach-ai.js (Beast AI for real coaching clients). fetch is mocked: no network, no keys.
// Run with: node --test tests/coach-ai.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const handler = require(path.join(__dirname, '..', 'api', 'coach-ai.js'));
const { limitMessage, CLIENT_LIMIT, SHARED_LIMIT } = handler._test;
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test-access-token';

function makeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}
function jsonResponse(status, obj) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function setEnv(over) {
  const env = Object.assign({ ANTHROPIC_API_KEY: 'sk-test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' }, over || {});
  for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
}
// routes: { user, plan, limit, ai }. Each is a function returning a response. Records every call in order.
function mockFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url: u, body, headers: opts && opts.headers });
    if (u.endsWith('/auth/v1/user')) return routes.user ? routes.user() : jsonResponse(200, { id: 'user-1', email: 'client@example.com' });
    if (u.includes('/rest/v1/coaching_clients')) return routes.plan ? routes.plan() : jsonResponse(200, [{ id: 7 }]);
    if (u.includes('/rest/v1/rpc/coach_ai_use')) return routes.limit ? routes.limit() : jsonResponse(200, [{ allowed: true, reason: 'ok' }]);
    if (u.includes('api.anthropic.com')) {
      return routes.ai ? routes.ai(body) : jsonResponse(200, { content: [{ text: JSON.stringify({ name: 'Eggs on toast', calories: 380, protein: 18, carbs: 30, fat: 19, fibre: 4, items: [], note: 'Standard portions.', confidence: 'high' }) }] });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return calls;
}
function req(over) {
  return Object.assign({ method: 'POST', headers: { authorization: 'Bearer ' + TOKEN }, body: { mode: 'log', text: 'two eggs on toast' } }, over || {});
}
const called = (calls, part) => calls.filter(c => c.url.includes(part)).length;

test.beforeEach(() => setEnv());
test.afterEach(() => { delete global.fetch; });

test('no token: 401 sign_in, and nothing is called', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req({ headers: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'sign_in');
  assert.equal(calls.length, 0, 'no Supabase or AI call');
});

test('a malformed Authorization header is treated as no token', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req({ headers: { authorization: 'Basic abc' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('a bad or expired token: 401, and no Anthropic call', async () => {
  const calls = mockFetch({ user: () => jsonResponse(401, { message: 'invalid JWT' }) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'sign_in');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('a signed-in user with no active coaching plan: 403, and no Anthropic call', async () => {
  const calls = mockFetch({ plan: () => jsonResponse(200, []) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'no_active_plan');
  assert.equal(called(calls, 'rpc/coach_ai_use'), 0, 'the limit is not used up either');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('the plan is read with the user\'s own token (row level security applies), not the service key', async () => {
  const calls = mockFetch({});
  await handler(req(), makeRes());
  const plan = calls.find(c => c.url.includes('/rest/v1/coaching_clients'));
  assert.equal(plan.headers.Authorization, 'Bearer ' + TOKEN);
  assert.ok(!JSON.stringify(plan.headers).includes('sb_secret_test'), 'the service key is not used to read the plan');
});

test('over the client limit: 429 client_limit with a friendly message, and no Anthropic call', async () => {
  const calls = mockFetch({ limit: () => jsonResponse(200, [{ allowed: false, reason: 'client' }]) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'client_limit');
  assert.match(res.body.message, /reset at midnight Melbourne time/);
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('over the shared daily cap: 429 shared_limit with a friendly message, and no Anthropic call', async () => {
  const calls = mockFetch({ limit: () => jsonResponse(200, [{ allowed: false, reason: 'shared' }]) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'shared_limit');
  assert.match(res.body.message, /whole coaching team today/);
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('the limit is counted for this client, with the 40 and 300 numbers', async () => {
  const calls = mockFetch({});
  await handler(req(), makeRes());
  const rpc = calls.find(c => c.url.includes('rpc/coach_ai_use'));
  assert.equal(rpc.body.p_client_id, 7);
  assert.equal(rpc.body.p_client_limit, 40);
  assert.equal(rpc.body.p_shared_limit, 300);
  assert.equal(CLIENT_LIMIT, 40);
  assert.equal(SHARED_LIMIT, 300);
});

test('the limit is counted before the AI is called', async () => {
  const calls = mockFetch({});
  await handler(req(), makeRes());
  const rpcAt = calls.findIndex(c => c.url.includes('rpc/coach_ai_use'));
  const aiAt = calls.findIndex(c => c.url.includes('api.anthropic.com'));
  assert.ok(rpcAt >= 0 && aiAt > rpcAt);
});

test('a valid Describe it request returns the estimate', async () => {
  mockFetch({});
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.name, 'Eggs on toast');
  assert.equal(res.body.calories, 380);
});

test('the day mode is coach-only: a client gets 400 bad_mode', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req({ body: { mode: 'day', text: 'Breakfast: eggs' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_mode');
  assert.equal(called(calls, 'rpc/coach_ai_use'), 0);
});

test('an unreachable usage counter: 503 busy, and no Anthropic call (the limit must hold)', async () => {
  const calls = mockFetch({ limit: () => jsonResponse(500, { message: 'boom' }) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'busy');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('a Supabase outage while checking the token: 503 busy, not a crash', async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 503);
});

test('missing keys: 500 not_configured, and nothing is called', async () => {
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(calls.length, 0);
});

test('GET is refused', async () => {
  const res = makeRes();
  await handler(req({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('the friendly limit messages are plain English', () => {
  assert.doesNotMatch(limitMessage('client').message, /—|–/);
  assert.doesNotMatch(limitMessage('shared').message, /—|–/);
});
