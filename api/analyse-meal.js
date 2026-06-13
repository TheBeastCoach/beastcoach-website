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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { return res.status(500).json({ error: 'API not configured' }); }

  const { meal } = req.body || {};
  if (!meal || typeof meal !== 'string' || meal.trim().length < 2) {
    return res.status(400).json({ error: 'Please describe a meal' });
  }

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
