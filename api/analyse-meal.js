const SYSTEM_PROMPT = `You are a precise nutritionist AI for Beast Coach app. 
Analyse the meal described and return ONLY valid JSON in this exact format:
{
  "name": "meal name (short, max 40 chars)",
  "calories": 000,
  "protein": 00,
  "carbs": 00,
  "fat": 00,
  "description": "One sentence describing the meal and why these macros",
  "confidence": "high|medium|low"
}
Rules:
- All numbers are integers
- Base on standard portion sizes unless specified
- If multiple items described, sum all macros
- Never include markdown, code blocks or any text outside the JSON object`;

/* Limits. The Origin check below is not a real control: any client can send any Origin header.
   So every analysis is counted in Supabase, and the count decides whether Anthropic is called. */
const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
const DAILY_LIMIT = 300;       // analyses for the whole site per Melbourne day
const HOURLY_IP_LIMIT = 10;    // analyses per IP address in the last hour

// The caller's IP. Vercel sets x-real-ip; otherwise use the last x-forwarded-for entry, which is the one
// the nearest proxy added (the first entry is whatever the client sent).
function clientIp(req) {
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) return real;
  const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Counts this analysis and returns { allowed, reason }. Throws if the counter cannot be reached.
async function useLimits(serviceKey, ip) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/analyse_meal_use`, {
    method: 'POST',
    headers: Object.assign({ apikey: serviceKey, 'Content-Type': 'application/json' },
      String(serviceKey).startsWith('eyJ') ? { Authorization: 'Bearer ' + serviceKey } : {}),
    body: JSON.stringify({ p_ip: ip, p_day_limit: DAILY_LIMIT, p_ip_limit: HOURLY_IP_LIMIT })
  });
  if (!r.ok) throw new Error('usage counter ' + r.status);
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new Error('usage counter returned nothing');
  return { allowed: !!row.allowed, reason: row.reason };
}

// The message the demo page shows when a limit is hit.
function limitBody(reason) {
  if (reason === 'ip') {
    return { error: 'ip_limit', message: 'You have asked for a lot of estimates in the last hour. Try again in a little while, or enter the numbers yourself.' };
  }
  return { error: 'daily_limit', message: 'Beast AI has done all the estimates it can for today. Try again tomorrow, or enter the numbers yourself.' };
}

module.exports = async function handler(req, res) {
  // Only the Beast Coach site may call this (it spends API credit).
  const origin = req.headers.origin || '';
  const okOrigin = /^https:\/\/(www\.)?beastcoach\.fit$/.test(origin) || /^https:\/\/beastcoach-website[a-z0-9-]*\.vercel\.app$/.test(origin);
  if (okOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  if (!okOrigin) { return res.status(403).json({ error: 'Not allowed' }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { return res.status(500).json({ error: 'API not configured' }); }

  const { meal } = req.body || {};
  if (!meal || typeof meal !== 'string' || meal.trim().length < 2 || meal.length > 300) {
    return res.status(400).json({ error: 'Please describe a meal' });
  }

  // Count the analysis before calling Anthropic. If the counter is unreachable, refuse: the limit must hold.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { return res.status(503).json({ error: 'busy', message: 'Beast AI is resting for a moment. Please try again shortly.' }); }
  let limit;
  try {
    limit = await useLimits(serviceKey, clientIp(req));
  } catch (err) {
    console.error('analyse-meal limit check failed:', err && err.message);
    return res.status(503).json({ error: 'busy', message: 'Beast AI is resting for a moment. Please try again shortly.' });
  }
  if (!limit.allowed) { return res.status(429).json(limitBody(limit.reason)); }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: meal.trim() }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse response');
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Analysis failed. Please try again.' });
  }
};

module.exports._test = { clientIp, useLimits, limitBody, DAILY_LIMIT, HOURLY_IP_LIMIT };
