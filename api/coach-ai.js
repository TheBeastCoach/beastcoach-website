// Beast AI for real coaching clients (/api/coach-ai). Used by My Coach (my-coach.html):
//   log      Describe it (Calculate now)
//   fridge   Meal Builder: a fridge photo
//   create   Meal Builder: meal ideas from the foods listed
//   exercise How to do it, for an exercise not in the library
// The browser sends the signed-in user's access token. The server checks it with Supabase, checks the user has an
// active coaching plan, and only then calls Anthropic. The Anthropic and service role keys never reach the browser.
// Limits: 40 calls per client per Melbourne day, and 300 shared across all clients per day (api usage table, 4b SQL).
// The prompts, validation and parsing are the demo's (api/demo-ai.js), shared through its _core export.

const { _core } = require('./demo-ai.js');
const { readInput, runLog, runFridge, runCreate, runExercise, send } = _core;

const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_3AdpZhYhif9JeP3rvmY2-Q_MuhFMGiw';   // public, as on the site
const CLIENT_LIMIT = 40;
const SHARED_LIMIT = 300;
const CLIENT_MODES = ['log', 'fridge', 'create', 'exercise'];

const SIGN_IN = 'Your sign-in has expired. Please sign in again.';

// The signed-in user for this token, or null.
async function userFromToken(token) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// The id of this user's active coaching plan, read with THEIR token, so row level security applies. Or null.
async function activePlanId(token) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/coaching_clients?select=id&status=eq.active&limit=1', {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

// Counts this call against the client and the shared day total. { allowed, reason } or throws.
async function useLimit(serviceKey, clientId) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/coach_ai_use', {
    method: 'POST',
    headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_client_id: clientId, p_client_limit: CLIENT_LIMIT, p_shared_limit: SHARED_LIMIT })
  });
  if (!r.ok) throw new Error('usage counter ' + r.status);
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error('usage counter returned nothing');
  return { allowed: !!row.allowed, reason: row.reason };
}

function limitMessage(reason) {
  if (reason === 'shared') {
    return { error: 'shared_limit', message: 'Beast AI has reached its estimates for the whole coaching team today. Try again tomorrow, or enter the numbers yourself.' };
  }
  return { error: 'client_limit', message: 'You have used today\'s Beast AI estimates. They reset at midnight Melbourne time. You can enter the numbers yourself.' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anthropicKey || !serviceKey) return send(res, 500, { error: 'not_configured' });

  const header = (req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(\S+)$/.exec(header);
  if (!m) return send(res, 401, { error: 'sign_in', message: SIGN_IN });
  const token = m[1];

  let user = null, clientId = null;
  try {
    user = await userFromToken(token);
    if (!user) return send(res, 401, { error: 'sign_in', message: SIGN_IN });
    clientId = await activePlanId(token);
  } catch (e) {
    return send(res, 503, { error: 'busy', message: 'Beast AI is resting for a moment. Please try again shortly.' });
  }
  if (!clientId) return send(res, 403, { error: 'no_active_plan', message: 'Beast AI is part of an active coaching plan.' });

  const parsed = readInput(req.body || {});
  if (parsed.error) return send(res, parsed.status, { error: parsed.error });
  const input = parsed.input;
  if (!CLIENT_MODES.includes(input.mode)) return send(res, 400, { error: 'bad_mode' });

  let limit;
  try {
    limit = await useLimit(serviceKey, clientId);
  } catch (e) {
    console.error('coach-ai limit check failed:', e && e.message);
    return send(res, 503, { error: 'busy', message: 'Beast AI is resting for a moment. Please try again shortly.' });
  }
  if (!limit.allowed) return send(res, 429, limitMessage(limit.reason));

  try {
    if (input.mode === 'log') return await runLog(anthropicKey, input, res);
    if (input.mode === 'fridge') return await runFridge(anthropicKey, input, res);
    if (input.mode === 'create') return await runCreate(anthropicKey, input, res);
    return await runExercise(anthropicKey, input, res);
  } catch (e) {
    console.error('coach-ai error:', e && e.stage, e && e.detail, e && e.message);
    return send(res, 502, { error: 'try_again', message: 'Beast AI could not answer that. Please try again, or enter the numbers yourself.' });
  }
};

module.exports._test = { userFromToken, activePlanId, useLimit, limitMessage, CLIENT_LIMIT, SHARED_LIMIT };
