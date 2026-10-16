// Creates a Stripe Checkout Session for the optional one-off $5 Beast Challenge donation.
// The amount is fixed here on the server, so it can't be changed from the browser.
// The existing stripe-webhook.js records it in "purchases" with product "challenge-support";
// the dashboard only unlocks the Discipline Path for product "discipline-path", so a
// donation never unlocks anything.

const SITE_URL = 'https://www.beastcoach.fit';
const AMOUNT_CENTS = 500;

// Send people back to the site they came from (production or a Vercel preview).
function returnBase(origin) {
  if (typeof origin !== 'string') return SITE_URL;
  if (origin === 'https://www.beastcoach.fit' || origin === 'https://beastcoach.fit') return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return SITE_URL;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) { return res.status(500).json({ error: 'Stripe is not configured' }); }

  const { email, from } = req.body || {};
  const base = returnBase(req.headers.origin);
  const fromDashboard = from === 'dashboard';

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('submit_type', 'donate');
  params.append('payment_method_types[0]', 'card');
  params.append('line_items[0][price_data][currency]', 'aud');
  params.append('line_items[0][price_data][product_data][name]', 'Beast Coach donation');
  params.append('line_items[0][price_data][product_data][description]', 'Optional one-off $5 to help pay for building and maintaining the free Beast Coach tools and recipes.');
  params.append('line_items[0][price_data][unit_amount]', String(AMOUNT_CENTS));
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', fromDashboard ? `${base}/dashboard?donation=thanks` : `${base}/beast-challenge?support=thanks`);
  params.append('cancel_url', fromDashboard ? `${base}/dashboard` : `${base}/beast-challenge`);
  params.append('metadata[product]', 'challenge-support');
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
    console.error('Support checkout failed:', err);
    return res.status(500).json({ error: 'Could not start checkout' });
  }
};
