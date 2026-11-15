// Beast AI for the Discipline Path (Meal Log and Meal Creator).
// Only signed-in people who bought the Discipline Path can use it, with a daily limit.
// Needs these Vercel environment variables: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Needs supabase/beast-ai.sql to have been run once.

const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3AdpZhYhif9JeP3rvmY2-Q_MuhFMGiw';
const DAILY_LIMIT = 20;      // uses per person per day (Melbourne time)
const MAX_TEXT = 600;        // characters of what the person types
const PRODUCT = 'discipline-path';
const MODEL = 'claude-haiku-4-5-20251001';

const LOG_PROMPT = `You are a careful nutritionist for Beast Coach. The person describes what they ate.
Return ONLY valid JSON in exactly this shape:
{"name":"short meal name, max 40 chars","calories":0,"protein":0,"carbs":0,"fat":0,"low":0,"high":0,"items":[{"name":"item","grams":0,"calories":0}],"note":"one short sentence","confidence":"high|medium|low"}
Rules:
- All numbers are integers. low and high are the likely calorie range.
- Use standard portions when none are given and say so in the note.
- If the text is not about food, return {"error":"not_food"}.
- No markdown and no text outside the JSON.`;

const CREATE_PROMPT = `You are a practical meal coach for Beast Coach. The person gives what food they have and optional targets.
Return ONLY valid JSON in exactly this shape:
{"meals":[{"name":"short name, max 40 chars","calories":0,"protein":0,"carbs":0,"fat":0,"uses":["ingredient"],"steps":["short step"],"tip":"one short sentence"}]}
Rules:
- Give 1 to 3 meals. All numbers are integers.
- Mostly use what they have. You may add basic pantry items (oil, salt, spices) and say so in tip.
- Aim for their targets if given, otherwise a balanced high protein meal around 500 kcal.
- If the text is not about food, return {"error":"not_food"}.
- No markdown and no text outside the JSON.`;

function send(res, status, body) {
  res.status(status).json(body);
}

async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id && u.email ? { id: u.id, email: String(u.email).toLowerCase().trim() } : null;
}

async function hasPurchased(email, serviceKey) {
  const url = `${SUPABASE_URL}/rest/v1/purchases?select=id&email=eq.${encodeURIComponent(email)}&product=eq.${PRODUCT}&limit=1`;
  const r = await fetch(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!r.ok) throw new Error('purchase check failed');
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function useOne(userId, serviceKey) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/beast_ai_use`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: userId, p_limit: DAILY_LIMIT })
  });
  if (!r.ok) throw new Error('usage check failed');
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { allowed: !!(row && row.allowed), used: row ? row.used : 0 };
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no json');
  return JSON.parse(t.slice(start, end + 1));
}

function int(n, max) {
  n = Math.round(Number(n));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
}

function cleanLog(p) {
  const items = Array.isArray(p.items) ? p.items.slice(0, 8).map(i => ({
    name: String(i.name || '').slice(0, 40), grams: int(i.grams, 5000), calories: int(i.calories, 5000)
  })) : [];
  const calories = int(p.calories, 5000);
  return {
    name: String(p.name || 'Meal').slice(0, 40),
    calories, protein: int(p.protein, 500), carbs: int(p.carbs, 800), fat: int(p.fat, 500),
    low: int(p.low || Math.round(calories * 0.88), 5000), high: int(p.high || Math.round(calories * 1.12), 5000),
    items, note: String(p.note || '').slice(0, 200),
    confidence: ['high', 'medium', 'low'].includes(p.confidence) ? p.confidence : 'medium'
  };
}

function cleanCreate(p) {
  const meals = Array.isArray(p.meals) ? p.meals.slice(0, 3).map(m => ({
    name: String(m.name || 'Meal').slice(0, 40),
    calories: int(m.calories, 5000), protein: int(m.protein, 500), carbs: int(m.carbs, 800), fat: int(m.fat, 500),
    uses: Array.isArray(m.uses) ? m.uses.slice(0, 12).map(x => String(x).slice(0, 40)) : [],
    steps: Array.isArray(m.steps) ? m.steps.slice(0, 8).map(x => String(x).slice(0, 200)) : [],
    tip: String(m.tip || '').slice(0, 200)
  })) : [];
  return { meals };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anthropicKey || !serviceKey) return send(res, 500, { error: 'not_configured' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return send(res, 401, { error: 'sign_in' });

  const body = req.body || {};
  const mode = body.mode;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (mode !== 'log' && mode !== 'create') return send(res, 400, { error: 'bad_mode' });
  if (text.length < 2) return send(res, 400, { error: 'empty' });
  if (text.length > MAX_TEXT) return send(res, 400, { error: 'too_long' });

  try {
    const user = await getUser(token);
    if (!user) return send(res, 401, { error: 'sign_in' });
    if (!(await hasPurchased(user.email, serviceKey))) return send(res, 403, { error: 'not_purchased' });

    const use = await useOne(user.id, serviceKey);
    if (!use.allowed) return send(res, 429, { error: 'daily_limit', limit: DAILY_LIMIT });

    const ai = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: mode === 'log' ? 500 : 1200,
        system: mode === 'log' ? LOG_PROMPT : CREATE_PROMPT,
        messages: [{ role: 'user', content: text }]
      })
    });
    if (!ai.ok) throw new Error('ai ' + ai.status);
    const data = await ai.json();
    const parsed = parseJson(data.content && data.content[0] && data.content[0].text);
    if (parsed.error) return send(res, 422, { error: 'not_food' });

    const result = mode === 'log' ? cleanLog(parsed) : cleanCreate(parsed);
    if (mode === 'create' && result.meals.length === 0) throw new Error('empty result');
    return send(res, 200, { result, used: use.used, limit: DAILY_LIMIT });
  } catch (e) {
    console.error('beast-ai error:', e && e.message);
    return send(res, 502, { error: 'try_again' });
  }
};

module.exports._test = { parseJson, cleanLog, cleanCreate, DAILY_LIMIT };
