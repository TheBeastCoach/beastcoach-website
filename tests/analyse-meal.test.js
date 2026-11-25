// Unit tests for api/analyse-meal.js: the daily cap, the per-IP hourly limit and the friendly messages.
// fetch is mocked, so no network calls and no keys are needed. Run with: node --test tests/analyse-meal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const handler = require(path.join(__dirname, '..', 'api', 'analyse-meal.js'));
const { clientIp, limitBody, DAILY_LIMIT, HOURLY_IP_LIMIT } = handler._test;
const SITE = 'https://www.beastcoach.fit';

function makeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; }
  };
}
function jsonResponse(status, obj) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function setEnv(overrides) {
  const env = Object.assign({ ANTHROPIC_API_KEY: 'sk-test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' }, overrides || {});
  for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
}
// routes: { limit: () => response, ai: () => response }. Records every call, in order.
function mockFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url: String(url), body, headers: opts && opts.headers });
    if (String(url).includes('/rest/v1/rpc/analyse_meal_use')) {
      return routes.limit ? routes.limit() : jsonResponse(200, [{ allowed: true, reason: 'ok' }]);
    }
    if (String(url).includes('api.anthropic.com')) {
      return routes.ai ? routes.ai() : jsonResponse(200, { content: [{ text: JSON.stringify({ name: 'Eggs', calories: 300, protein: 20, carbs: 2, fat: 22, description: 'Two eggs', confidence: 'high' }) }] });
    }
    throw new Error('unexpected fetch ' + url);
  };
  return calls;
}
function req(over) {
  return Object.assign({ method: 'POST', headers: { origin: SITE, 'x-real-ip': '203.0.113.7' }, body: { meal: 'two eggs on toast' }, socket: {} }, over || {});
}
const aiCalls = calls => calls.filter(c => c.url.includes('api.anthropic.com')).length;
const limitCalls = calls => calls.filter(c => c.url.includes('/rest/v1/rpc/analyse_meal_use'));

test.beforeEach(() => setEnv());
test.afterEach(() => { delete global.fetch; });

test('a normal request is counted first, then sent to Anthropic, and succeeds', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.name, 'Eggs');
  assert.equal(limitCalls(calls).length, 1, 'counted once');
  assert.equal(aiCalls(calls), 1, 'Anthropic called once');
  assert.ok(calls.indexOf(limitCalls(calls)[0]) < calls.findIndex(c => c.url.includes('api.anthropic.com')), 'counted before the AI call');
});

test('the counter gets the 300 a day cap and the 10 an hour IP limit', async () => {
  const calls = mockFetch({});
  await handler(req(), makeRes());
  const body = limitCalls(calls)[0].body;
  assert.equal(body.p_day_limit, 300);
  assert.equal(body.p_ip_limit, 10);
  assert.equal(body.p_ip, '203.0.113.7');
  assert.equal(DAILY_LIMIT, 300);
  assert.equal(HOURLY_IP_LIMIT, 10);
});

test('daily cap reached: 429 with a friendly message, and Anthropic is not called', async () => {
  const calls = mockFetch({ limit: () => jsonResponse(200, [{ allowed: false, reason: 'daily' }]) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'daily_limit');
  assert.match(res.body.message, /done all the estimates it can for today/);
  assert.equal(aiCalls(calls), 0, 'no AI call, so no spend');
});

test('per-IP limit reached: 429 with its own friendly message, and Anthropic is not called', async () => {
  const calls = mockFetch({ limit: () => jsonResponse(200, [{ allowed: false, reason: 'ip' }]) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'ip_limit');
  assert.match(res.body.message, /in the last hour/);
  assert.equal(aiCalls(calls), 0);
});

test('the counter is unreachable: 503 "busy", and no AI call (the limit must hold)', async () => {
  const calls = mockFetch({ limit: () => jsonResponse(500, { message: 'boom' }) });
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'busy');
  assert.equal(aiCalls(calls), 0);
});

test('no service key configured: 503 "busy", and no AI call', async () => {
  setEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(aiCalls(calls), 0);
  assert.equal(limitCalls(calls).length, 0);
});

test('a faked Origin is still refused, before any count or AI call', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req({ headers: { origin: 'https://evil.example', 'x-real-ip': '203.0.113.7' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0, 'nothing counted, nothing sent');
});

test('a bad meal description is refused before any count or AI call', async () => {
  const calls = mockFetch({});
  const res = makeRes();
  await handler(req({ body: { meal: 'x' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('limit messages: the daily and the per-IP wording are different and friendly', () => {
  assert.equal(limitBody('daily').error, 'daily_limit');
  assert.equal(limitBody('ip').error, 'ip_limit');
  assert.notEqual(limitBody('daily').message, limitBody('ip').message);
  assert.match(limitBody('daily').message, /Try again tomorrow, or enter the numbers yourself\./);
});

test('clientIp: the proxy\'s x-real-ip first, then the last x-forwarded-for entry, never the first (client-sent) one', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '198.51.100.4', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: {} }), '198.51.100.4');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': 'spoofed-by-client, 198.51.100.9' }, socket: {} }), '198.51.100.9', 'the first entry is ignored');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '192.0.2.1' } }), '192.0.2.1');
  assert.equal(clientIp({ headers: {}, socket: {} }), 'unknown');
});

test('the per-IP count uses the caller\'s IP, so a second IP is not held back by the first', async () => {
  const seen = [];
  mockFetch({ limit: () => jsonResponse(200, [{ allowed: true, reason: 'ok' }]) });
  const orig = global.fetch;
  global.fetch = async (url, opts) => { if (String(url).includes('analyse_meal_use')) seen.push(JSON.parse(opts.body).p_ip); return orig(url, opts); };
  await handler(req({ headers: { origin: SITE, 'x-real-ip': '198.51.100.1' } }), makeRes());
  await handler(req({ headers: { origin: SITE, 'x-real-ip': '198.51.100.2' } }), makeRes());
  assert.deepEqual(seen, ['198.51.100.1', '198.51.100.2']);
});
