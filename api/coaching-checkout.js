// Starts a Stripe Checkout session for a coaching plan (POST /api/coaching-checkout).
// Body: { plan, name, email, agreeTerms, agreeHealth, news, renew }.
// Optional header Authorization: Bearer <the signed-in user's token>, needed only for renew (renewal discount, drop to Basic).
// The browser never sends a price. The price, the discount and the capacity check are all decided here.
const {
  PLANS, TERMS_VERSION, HEALTH_VERSION, RENEWAL_PERCENT, siteUrl, money, renewalCents, isEmail, clientIp,
  stripeCall, svc, anonRpc, userFromToken, userRead, underLimit
} = require('./_coaching.js');

const LIMIT_PER_HOUR = 20;

function send(res, status, body) { return res.status(status).json(body); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return send(res, 500, { error: 'not_configured', message: 'Checkout is not set up yet. Please email info@beastcoach.fit.' });

  const b = req.body || {};
  const plan = PLANS[b.plan] ? b.plan : null;
  if (!plan) return send(res, 400, { error: 'bad_plan', message: 'Choose a plan.' });
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length < 2 || name.length > 80) return send(res, 400, { error: 'bad_name', message: 'Enter your name.' });
  if (!isEmail(b.email)) return send(res, 400, { error: 'bad_email', message: 'Enter a valid email.' });
  if (b.agreeTerms !== true) return send(res, 400, { error: 'terms', message: 'Please agree to the terms to continue.' });
  if (b.agreeHealth !== true) return send(res, 400, { error: 'health', message: 'Please confirm you have read the health information.' });

  // Rate limit by IP: a stopgap against people hammering checkout. Stored in the database, so it holds across instances.
  let allowed;
  try { allowed = await underLimit('checkout:' + clientIp(req), LIMIT_PER_HOUR, 3600); }
  catch (e) { console.error('checkout rate limit check failed:', e.message); return send(res, 503, { error: 'busy', message: 'Please try again in a moment.' }); }
  if (!allowed) return send(res, 429, { error: 'rate_limited', message: 'Too many attempts. Please wait a while and try again.' });

  // Returning clients (renew, or drop to Basic) must be signed in. Their email is the verified one, not the form's.
  let email = b.email.trim().toLowerCase();
  let discount = false;
  if (b.renew === true) {
    const token = (/^Bearer\s+(\S+)$/.exec((req.headers && req.headers.authorization) || '') || [])[1];
    const user = token ? await userFromToken(token) : null;
    if (!user) return send(res, 401, { error: 'sign_in', message: 'Please sign in to renew.' });
    const rows = await userRead(token, 'coaching_clients?select=id,status,tier&status=eq.finished&order=created_at.desc&limit=1');
    if (!rows.length) return send(res, 403, { error: 'not_finished', message: 'Renewal is for clients whose 12 weeks have finished.' });
    email = String(user.email).trim().toLowerCase();
    discount = plan !== 'basic';
  }

  // Capacity, before any money is taken. The webhook checks again when the payment lands, and refunds if full by then.
  if (PLANS[plan].capacity) {
    let places;
    try { places = await anonRpc('coaching_places', {}); }
    catch (e) { console.error('places check failed:', e.message); return send(res, 503, { error: 'busy', message: 'Please try again in a moment.' }); }
    const row = (places || []).find(p => p.tier === plan);
    if (!row || row.places_left <= 0) {
      return send(res, 409, { error: 'full', message: PLANS[plan].name + ' is full at the moment. Join the waitlist and we will email you when a place opens.', waitlist: true });
    }
  }

  const P = PLANS[plan];
  const cents = discount ? renewalCents(P.cents) : P.cents;
  const site = siteUrl();
  const params = {
    mode: P.mode,
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': 'Beast Coach ' + P.name + (discount ? ' (renewal)' : ''),
    'line_items[0][price_data][product_data][description]': plan === 'basic'
      ? 'Basic: $30 AUD every 12 weeks, billed automatically'
      : '12 weeks of coaching, paid up front',
    customer_email: email,
    success_url: site + '/my-coach?paid=1&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: site + '/?checkout=cancelled#plans',
    'metadata[plan]': plan,
    'metadata[name]': name.slice(0, 80),
    'metadata[email]': email,
    'metadata[news]': b.news === true ? 'yes' : 'no',
    'metadata[terms_version]': TERMS_VERSION,
    'metadata[health_version]': HEALTH_VERSION,
    'metadata[renewal]': discount ? 'discount' : (b.renew === true ? 'basic_return' : 'no'),
    'metadata[discount_percent]': discount ? String(RENEWAL_PERCENT) : '0'
  };
  if (P.mode === 'subscription') {
    params['line_items[0][price_data][recurring][interval]'] = P.interval;
    params['line_items[0][price_data][recurring][interval_count]'] = String(P.intervalCount);
    params['subscription_data[metadata][plan]'] = plan;
    params['subscription_data[metadata][email]'] = email;
  }
  // Discipline Path codes from the Stripe dashboard work at checkout only for the Discipline Path, not coaching.

  try {
    const session = await stripeCall('POST', 'checkout/sessions', params);
    return send(res, 200, { url: session.url, amount: money(cents), discount: discount ? RENEWAL_PERCENT : 0 });
  } catch (e) {
    console.error('coaching checkout failed:', e.message);
    return send(res, 502, { error: 'stripe', message: 'Could not start checkout. Please try again, or email info@beastcoach.fit.' });
  }
};
module.exports._test = { RENEWAL_PERCENT };
