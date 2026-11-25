// Beast AI for real coaching clients (/api/coach-ai). Used by My Coach (my-coach.html):
//   log      Describe it (Calculate now)
//   fridge   Meal Builder: a fridge photo
//   create   Meal Builder: meal ideas from the foods listed
//   exercise How to do it, for an exercise not in the library
// And for the coach (coach.html), only:
//   day      the meal plan builder (Calculate with Beast AI): one meal per line, numbers for each line
//   The coach's token must be in coaching_admins AND be MFA-verified (aal2). Coach calls have their own
//   limit (200 a day) and never count against any client or the shared client total.
// The browser sends the signed-in user's access token. The server checks it with Supabase, checks the user has an
// active coaching plan, and only then calls Anthropic. The Anthropic and service role keys never reach the browser.
// Limits: 40 calls per client per Melbourne day, and 300 shared across all clients per day (api usage table, 4b SQL).
// The prompts, validation and parsing are the demo's (api/demo-ai.js), shared through its _core export.

const { _core } = require('./demo-ai.js');
const { readInput, runLog, runDay, runFridge, runCreate, runExercise, send } = _core;

const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_3AdpZhYhif9JeP3rvmY2-Q_MuhFMGiw';   // public, as on the site
const CLIENT_LIMIT = 40;
const SHARED_LIMIT = 300;
const CLIENT_MODES = ['log', 'fridge', 'create', 'exercise'];
const COACH_LIMIT = 200;
const BUSY = { error: 'busy', message: 'Beast AI is resting for a moment. Please try again shortly.' };

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

// The assurance level in the token ('aal1' or 'aal2'). Read only after Supabase has accepted the token.
function tokenAal(token) {
  try {
    const part = String(token).split('.')[1] || '';
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).aal || null;
  } catch (e) { return null; }
}

// True if this user is the coach. Read with THEIR token: the coaching_admins policy itself needs is_coach(),
// which needs aal2, so this is a second, independent check of both the list and the MFA.
async function isCoach(token, userId) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/coaching_admins?select=user_id&user_id=eq.' + encodeURIComponent(userId) + '&limit=1', {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

// Counts a coach call against the coach's own day total only. { allowed, reason } or throws.
async function useCoachLimit(serviceKey) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/coach_ai_use_coach', {
    method: 'POST',
    headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limit: COACH_LIMIT })
  });
  if (!r.ok) throw new Error('coach usage counter ' + r.status);
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error('coach usage counter returned nothing');
  return { allowed: !!row.allowed, reason: row.reason };
}

// The coach's meal plan builder.
async function coachDay(req, res, token, user, anthropicKey, serviceKey) {
  let ok = false;
  try {
    ok = tokenAal(token) === 'aal2' && await isCoach(token, user.id);
  } catch (e) {
    return send(res, 503, BUSY);
  }
  if (!ok) return send(res, 403, { error: 'coach_only', message: 'The meal plan builder is for the coach, signed in with an authenticator code.' });
  const cid = Number((req.body || {}).clientId);
  if (!Number.isInteger(cid) || cid < 1) return send(res, 400, { error: 'bad_client' });
  const parsed = readInput(req.body || {});
  if (parsed.error) return send(res, parsed.status, { error: parsed.error });
  try {
    parsed.input.protein = await proteinFor(token, cid);
  } catch (e) {
    return send(res, 503, BUSY);
  }
  let limit;
  try {
    limit = await useCoachLimit(serviceKey);
  } catch (e) {
    console.error('coach-ai coach limit check failed:', e && e.message);
    return send(res, 503, BUSY);
  }
  if (!limit.allowed) return send(res, 429, { error: 'coach_limit', message: 'You have used today\'s 200 Beast AI calculations. They reset at midnight Melbourne time. You can type the numbers in yourself.' });
  try {
    return await runDay(anthropicKey, parsed.input, res);
  } catch (e) {
    console.error('coach-ai coach error:', e && e.stage, e && e.detail, e && e.message);
    return send(res, 502, { error: 'try_again', message: 'Beast AI could not answer that. Please try again, or type the numbers in yourself.' });
  }
}

// The client's protein powder answer from their onboarding, read with the caller's own token (row level
// security applies). { answer, brand } or null when not asked.
function proteinOf(onboarding) {
  const ob = onboarding && typeof onboarding === 'object' ? onboarding : {};
  if (!['yes', 'no', 'open'].includes(ob.proteinPowder)) return { answer: null };
  return { answer: ob.proteinPowder, brand: ob.proteinPowder === 'yes' ? String(ob.proteinBrand || '') : '' };
}

// The id and protein answer of this user's active coaching plan, read with THEIR token. Or null.
async function activePlan(token) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/coaching_clients?select=id,onboarding&status=eq.active&limit=1', {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? { id: rows[0].id, protein: proteinOf(rows[0].onboarding) } : null;
}

// A client's protein answer, read with the COACH's token (the coach can read every client, with MFA).
async function proteinFor(token, clientId) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/coaching_clients?select=onboarding&id=eq.' + encodeURIComponent(String(clientId)) + '&limit=1', {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('client read ' + r.status);
  const rows = await r.json();
  return proteinOf(Array.isArray(rows) && rows[0] ? rows[0].onboarding : null);
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

  let user = null, plan = null;
  try {
    user = await userFromToken(token);
  } catch (e) {
    return send(res, 503, BUSY);
  }
  if (!user) return send(res, 401, { error: 'sign_in', message: SIGN_IN });

  // The meal plan builder is the coach's. Nobody else can use it.
  if (req.body && req.body.mode === 'day') return coachDay(req, res, token, user, anthropicKey, serviceKey);

  try {
    plan = await activePlan(token);
  } catch (e) {
    return send(res, 503, BUSY);
  }
  if (!plan) return send(res, 403, { error: 'no_active_plan', message: 'Beast AI is part of an active coaching plan.' });
  const clientId = plan.id;

  const parsed = readInput(req.body || {});
  if (parsed.error) return send(res, parsed.status, { error: parsed.error });
  const input = parsed.input;
  input.protein = plan.protein;
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

module.exports._test = { userFromToken, activePlan, proteinOf, useLimit, limitMessage, tokenAal, isCoach, useCoachLimit, CLIENT_LIMIT, SHARED_LIMIT, COACH_LIMIT };
