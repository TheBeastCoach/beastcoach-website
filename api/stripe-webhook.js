// Stripe webhook: on checkout.session.completed, records the purchase in
// Supabase so the member portal can check "has this email bought the
// Discipline Path" without touching Stripe directly.
//
// Vercel settings required (Dashboard -> Project -> Settings -> Environment Variables):
//   STRIPE_SECRET_KEY         (already used by create-checkout.js)
//   STRIPE_WEBHOOK_SECRET     (from the Stripe Dashboard webhook endpoint, starts with whsec_)
//   SUPABASE_SERVICE_ROLE_KEY (Supabase -> Project Settings -> API -> service_role key, NOT the anon key)
//
// Stripe Dashboard setup required:
//   Add an endpoint pointing at https://www.beastcoach.fit/api/stripe-webhook
//   listening for the "checkout.session.completed" event, then copy its
//   signing secret into STRIPE_WEBHOOK_SECRET above.

const crypto = require('crypto');

const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';

module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const computedSig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(computedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { return res.status(405).end(); }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !serviceRoleKey) {
    console.error('Webhook not fully configured (missing env vars)');
    return res.status(500).end();
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];

  if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
    console.error('Invalid Stripe webhook signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = (session.customer_details && session.customer_details.email) || session.customer_email;

    if (email) {
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/purchases`, {
          method: 'POST',
          headers: {
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            stripe_session_id: session.id,
            stripe_customer_id: session.customer,
            amount_cents: session.amount_total,
            currency: session.currency,
            product: (session.metadata && session.metadata.product) || 'discipline-path'
          })
        });
        if (!resp.ok) {
          console.error('Failed to record purchase in Supabase:', await resp.text());
        }
      } catch (err) {
        console.error('Error writing purchase to Supabase:', err);
      }
    } else {
      console.error('checkout.session.completed with no email on session', session.id);
    }
  }

  return res.status(200).json({ received: true });
};
