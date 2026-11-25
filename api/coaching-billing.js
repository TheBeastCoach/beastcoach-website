// Opens the Stripe Billing Portal for a Basic client, so they can update their card or cancel (POST /api/coaching-billing).
// The caller's token is checked with Supabase. Only their own active Basic plan is used. Nothing is taken from the page.
const { siteUrl, stripeCall, svc, userFromToken } = require('./_coaching.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'not_configured' });
  const token = (/^Bearer\s+(\S+)$/.exec((req.headers && req.headers.authorization) || '') || [])[1];
  const user = token ? await userFromToken(token) : null;
  if (!user) return res.status(401).json({ error: 'sign_in', message: 'Please sign in again.' });
  let rows;
  try {
    rows = await svc('GET', 'coaching_clients?select=stripe_customer_id&user_id=eq.' + encodeURIComponent(user.id) + '&tier=eq.basic&status=eq.active&order=created_at.desc&limit=1');
  } catch (e) { return res.status(503).json({ error: 'busy', message: 'Please try again in a moment.' }); }
  const customer = rows && rows[0] && rows[0].stripe_customer_id;
  if (!customer) return res.status(404).json({ error: 'no_basic', message: 'You do not have an active Basic plan.' });
  try {
    const portal = await stripeCall('POST', 'billing_portal/sessions', { customer, return_url: siteUrl() + '/my-coach' });
    return res.status(200).json({ url: portal.url });
  } catch (e) {
    console.error('billing portal failed:', e.message);
    return res.status(502).json({ error: 'stripe', message: 'Could not open billing right now. Please email info@beastcoach.fit.' });
  }
};
