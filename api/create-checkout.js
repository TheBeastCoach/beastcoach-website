// Creates a Stripe Checkout Session for The Discipline Path.
// Price is computed server-side from the same launch-deadline logic as the
// sales page, so the discount can't be spoofed from the client. Stripe's
// built-in promotion-code field is enabled, so discount codes created in the
// Stripe Dashboard work automatically at checkout.

const DEAL_ENDS_AT = new Date('2026-11-15T00:00:00+11:00').getTime();
const SITE_URL = 'https://www.beastcoach.fit';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) { return res.status(500).json({ error: 'Stripe is not configured' }); }

  const { email } = req.body || {};

  const amountCents = Date.now() < DEAL_ENDS_AT ? 3850 : 5500;

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('payment_method_types[0]', 'card');
  params.append('line_items[0][price_data][currency]', 'aud');
  params.append('line_items[0][price_data][product_data][name]', 'The Discipline Path');
  params.append('line_items[0][price_data][product_data][description]', 'A 7-step interactive discipline-building system, one-time purchase.');
  params.append('line_items[0][price_data][unit_amount]', String(amountCents));
  params.append('line_items[0][quantity]', '1');
  params.append('allow_promotion_codes', 'true');
  params.append('success_url', `${SITE_URL}/portal?purchase=success&session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${SITE_URL}/discipline-path?checkout=cancelled`);
  params.append('metadata[product]', 'discipline-path');
  if (email && typeof email === 'string') {
    params.append('customer_email', email.trim());
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await response.json();

    if (!response.ok) {
      console.error('Stripe error:', session);
      return res.status(502).json({ error: session.error?.message || 'Could not start checkout' });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout creation failed:', err);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
};
