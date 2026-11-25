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
    if (u.includes('/rest/v1/coaching_admins')) return routes.admins ? routes.admins() : jsonResponse(200, []);
    if (u.includes('/rest/v1/rpc/coach_ai_use_coach')) return routes.coachLimit ? routes.coachLimit() : jsonResponse(200, [{ allowed: true, reason: 'ok' }]);
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

test('the day mode is coach-only: a client gets 403 coach_only, and no AI call or counter', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req({ body: { mode: 'day', text: 'Breakfast: oats' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'coach_only');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
  assert.equal(called(calls, '/rpc/coach_ai_use'), 0, 'no counter is touched');
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
  assert.doesNotMatch(limitMessage('client').message, /-|-/);
  assert.doesNotMatch(limitMessage('shared').message, /-|-/);
});

// The coach: a token whose payload says aal2 (signed in with an authenticator code).
const b64url = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const COACH_TOKEN = b64url({ alg: 'HS256' }) + '.' + b64url({ sub: 'coach-1', aal: 'aal2' }) + '.sig';
const AAL1_TOKEN = b64url({ alg: 'HS256' }) + '.' + b64url({ sub: 'coach-1', aal: 'aal1' }) + '.sig';
const DAY_AI = () => jsonResponse(200, { content: [{ text: JSON.stringify({ meals: [
  { calories: 420, protein: 25, carbs: 55, fat: 10, fibre: 8 }, { calories: 610, protein: 45, carbs: 60, fat: 18, fibre: 6 }] }) }] });
const coachReq = (token, body) => req({ headers: { authorization: 'Bearer ' + token }, body: body || { mode: 'day', clientId: 7, text: 'Breakfast: 60g oats, 1 banana\nLunch: 150g chicken, 150g rice' } });

test('coach (in coaching_admins, aal2): the meal plan builder returns numbers per line, counted on the coach\'s own limit of 200', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, [{ user_id: 'user-1' }]), ai: DAY_AI });
  const res = makeRes();
  await handler(coachReq(COACH_TOKEN), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.meals.length, 2);
  assert.equal(res.body.meals[0].label, 'Breakfast');
  const counter = calls.find(c => c.url.includes('/rpc/coach_ai_use_coach'));
  assert.deepEqual(counter.body, { p_limit: 200 });
  assert.equal(calls.filter(c => /\/rpc\/coach_ai_use$/.test(c.url)).length, 0, 'the client and shared counters are not touched');
  assert.equal(called(calls, 'status=eq.active'), 0, 'no client plan lookup (the client\'s own active plan is not used)');
  const adminCall = calls.find(c => c.url.includes('/rest/v1/coaching_admins'));
  assert.equal(adminCall.headers.Authorization, 'Bearer ' + COACH_TOKEN, 'the admin list is read with the coach\'s own token');
});

test('coach signed in without an authenticator code (aal1): 403 coach_only, no AI call', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, [{ user_id: 'user-1' }]), ai: DAY_AI });
  const res = makeRes();
  await handler(coachReq(AAL1_TOKEN), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'coach_only');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
  assert.equal(called(calls, '/rpc/coach_ai_use_coach'), 0);
});

test('an aal2 user who is not in coaching_admins: 403 coach_only, no AI call', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, []), ai: DAY_AI });
  const res = makeRes();
  await handler(coachReq(COACH_TOKEN), res);
  assert.equal(res.statusCode, 403);
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('coach over the daily limit: 429 coach_limit, no AI call', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, [{ user_id: 'user-1' }]), coachLimit: () => jsonResponse(200, [{ allowed: false, reason: 'coach' }]) });
  const res = makeRes();
  await handler(coachReq(COACH_TOKEN), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'coach_limit');
  assert.match(res.body.message, /200/);
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('the coach cannot use the client modes through the coach path (only day is coach-only; log still needs a client plan)', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, [{ user_id: 'user-1' }]), plan: () => jsonResponse(200, []) });
  const res = makeRes();
  await handler(coachReq(COACH_TOKEN, { mode: 'log', text: 'two eggs' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'no_active_plan');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('tokenAal reads the assurance level, and a broken token gives null', () => {
  const { tokenAal } = handler._test;
  assert.equal(tokenAal(COACH_TOKEN), 'aal2');
  assert.equal(tokenAal(AAL1_TOKEN), 'aal1');
  assert.equal(tokenAal('not-a-jwt'), null);
});

// Protein powder: the instruction the model gets depends on the client's own onboarding answer, read from the database.
const sysOf = calls => (calls.find(c => c.url.includes('api.anthropic.com')) || {}).body.system;
const onboardingRoute = ob => () => jsonResponse(200, [{ id: 7, onboarding: ob }]);

test('client Describe it: "no" tells the model never to suggest protein powder', async () => {
  const calls = mockFetch({ plan: onboardingRoute({ proteinPowder: 'no' }) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.match(sysOf(calls), /does not use it\. Never suggest or include protein powder/);
});

test('client: "yes" with a brand tells the model to use that brand and flavour', async () => {
  const calls = mockFetch({ plan: onboardingRoute({ proteinPowder: 'yes', proteinBrand: 'Brand X vanilla' }) });
  const res = makeRes();
  await handler(req(), res);
  assert.match(sysOf(calls), /uses the brand and flavour "Brand X vanilla"/);
});

test('client: "open" lets the model suggest protein powder', async () => {
  const calls = mockFetch({ plan: onboardingRoute({ proteinPowder: 'open' }) });
  const res = makeRes();
  await handler(req(), res);
  assert.match(sysOf(calls), /open to it\. You may suggest protein powder/);
});

test('a client who never answered (Not asked) is treated as "no": never suggested', async () => {
  const calls = mockFetch({ plan: onboardingRoute({}) });
  await handler(req(), makeRes());
  assert.match(sysOf(calls), /does not use it\. Never suggest/);
});

test('the protein answer comes from the database, not the request: a body that claims otherwise is ignored', async () => {
  const calls = mockFetch({ plan: onboardingRoute({ proteinPowder: 'no' }) });
  await handler(req({ body: { mode: 'log', text: 'two eggs', protein: { answer: 'open' }, proteinPowder: 'open' } }), makeRes());
  assert.match(sysOf(calls), /does not use it/);
  assert.doesNotMatch(sysOf(calls), /open to it/);
});

test('coach Calculate: the prompt uses THIS client\'s protein answer, read with the coach token', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, [{ user_id: 'user-1' }]), plan: onboardingRoute({ proteinPowder: 'open' }), ai: DAY_AI });
  const res = makeRes();
  await handler(coachReq(COACH_TOKEN, { mode: 'day', clientId: 7, text: 'Breakfast: oats\nLunch: rice' }), res);
  assert.equal(res.statusCode, 200);
  assert.match(sysOf(calls), /open to it\. You may suggest protein powder/);
  const read = calls.find(c => c.url.includes('/rest/v1/coaching_clients') && c.url.includes('select=onboarding'));
  assert.equal(read.headers.Authorization, 'Bearer ' + COACH_TOKEN, 'the client row is read with the coach\'s token, through row level security');
});

test('coach Calculate: a client id is required (400 bad_client), and no AI call is made without one', async () => {
  const calls = mockFetch({ admins: () => jsonResponse(200, [{ user_id: 'user-1' }]), ai: DAY_AI });
  const res = makeRes();
  await handler(coachReq(COACH_TOKEN, { mode: 'day', text: 'Lunch: rice' }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_client');
  assert.equal(called(calls, 'api.anthropic.com'), 0);
});

test('the protein rule for each answer, and nothing at all for the demo (no answer given)', () => {
  const { proteinRule } = require(path.join(__dirname, '..', 'api', 'demo-ai.js'))._core;
  assert.equal(proteinRule(undefined), '', 'the demo adds nothing');
  assert.match(proteinRule({ answer: 'no' }), /Never suggest or include protein powder/);
  assert.match(proteinRule({ answer: 'open' }), /You may suggest protein powder/);
  assert.match(proteinRule({ answer: 'yes', brand: 'Brand X' }), /"Brand X"/);
  assert.match(proteinRule({ answer: null }), /Never suggest/);
});
