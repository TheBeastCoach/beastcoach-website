// Stripe webhook for the coaching plans (POST /api/coaching-webhook). A separate endpoint from the Discipline Path
// webhook (api/stripe-webhook.js), so a change here cannot break course purchases, and each has its own signing secret.
//
// Events: checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted, charge.refunded.
// Every event is recorded first (coaching_begin_event). A resent event that already finished is skipped. An event that
// failed part way is retried by Stripe, and running it again is safe because each step is idempotent.
const {
  PLANS, verifyStripeSignature, stripeCall, svc, money
} = require('./_coaching.js');
const { sendEmail, sendEmailSafe } = require('./_email.js');

module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Today in Melbourne, as YYYY-MM-DD.
function melbToday(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date()); }
function addDays(ymd, n) { const [y, m, d] = ymd.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n, 12)); return x.toISOString().slice(0, 10); }
function niceDate(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }); }

async function settings() {
  const rows = await svc('GET', 'coaching_settings?select=gst_registered,abn&limit=1');
  return rows && rows[0] ? rows[0] : { gst_registered: false, abn: null };
}

// A checkout that paid for a plan: create the client, the customer record, the emails, and the Discipline Path (Core, Beast).
async function onCheckoutCompleted(s) {
  const plan = s.metadata.plan;
  const email = String(s.metadata.email || (s.customer_details && s.customer_details.email) || s.customer_email || '').trim().toLowerCase();
  const name = s.metadata.name || (s.customer_details && s.customer_details.name) || '';
  const news = s.metadata.news === 'yes';
  const cents = s.amount_total;
  const wording = news ? 'Send me news and offers from Beast Coach. Unsubscribe any time.' : 'Not ticked: no news and offers.';
  const paid = await svc('POST', 'rpc/coaching_create_from_purchase', {
    p_session_id: s.id, p_email: email, p_name: name, p_tier: plan, p_amount_cents: cents, p_currency: s.currency || 'aud',
    p_marketing_consent: news, p_consent_wording: wording, p_payment_intent: s.payment_intent || null,
    p_stripe_customer_id: s.customer || null, p_subscription_id: s.subscription || null, p_paid_on: melbToday()
  });
  if (!paid.ok) {
    // The plan filled up, or the email already has an open plan, between checkout and now: refund in full.
    if (s.mode === 'payment' && s.payment_intent) {
      await stripeCall('POST', 'refunds', { payment_intent: s.payment_intent, 'metadata[reason]': paid.reason });
    }
    if (paid.reason === 'full') {
      await sendEmail('spot_filled', email, { name, plan, amountCents: cents });
      await sendEmailSafe('owner_refund', null, { name, email, plan, amountCents: cents, full: true,
        outcome: 'The plan was full at payment time. Nothing was created. Refunded in full.' });
    } else if (paid.reason === 'already_open') {
      // Tell the client, and tell Stefan with both plans. Emails never affect the refund.
      await sendEmailSafe('already_open', email, { name, plan, existingPlan: paid.existing_tier, amountCents: cents });
      await sendEmailSafe('owner_duplicate', null, { name, email, plan, existingPlan: paid.existing_tier, amountCents: cents });
    } else {
      console.error('Refunded a checkout that could not be turned into a plan (' + paid.reason + '): session ' + s.id);
    }
    return;
  }
  if (paid.repeat) return;   // already handled on an earlier attempt: no second welcome, receipt or purchase
  const st = await settings();
  const today = melbToday();
  await sendEmail('welcome', email, { name, plan });
  await sendEmail('receipt', email, { name, plan, amountCents: cents, date: niceDate(today), settings: st, subscription: plan === 'basic' });
  if (PLANS[plan] && PLANS[plan].discipline) {
    // The Discipline Path unlocks for this email, in the same shape the course's own purchase flow writes.
    await svc('POST', 'purchases', {
      email, stripe_session_id: s.id, stripe_customer_id: s.customer || null, amount_cents: cents,
      currency: s.currency || 'aud', product: 'discipline-path'
    }, 'resolution=merge-duplicates');
  }
  // Stefan is told about every purchase: new, renewal (20% off), or Drop to Basic.
  const meta = s.metadata || {};
  const kind = meta.renewal === 'discount' ? 'renewal' : meta.renewal === 'basic_return' ? 'drop_to_basic' : 'new';
  await sendEmailSafe('owner_purchase', null, { name, email, plan, amountCents: cents, marketing: news, kind });
}

async function clientForSubscription(subId) {
  const rows = await svc('GET', 'coaching_clients?select=id,email,name,end_date,status&stripe_subscription_id=eq.' + encodeURIComponent(subId) + '&limit=1');
  return rows && rows[0] ? rows[0] : null;
}

async function handle(event) {
  const o = event.data.object;
  if (event.type === 'checkout.session.completed') {
    if (o.metadata && PLANS[o.metadata.plan]) await onCheckoutCompleted(o);
    return;
  }
  if (event.type === 'invoice.paid') {
    // The first Basic payment starts the plan at checkout, so only the later renewals extend it.
    if (!o.subscription || o.billing_reason !== 'subscription_cycle') return;
    const c = await clientForSubscription(o.subscription);
    if (!c) return;
    const base = c.end_date && c.end_date > melbToday() ? c.end_date : melbToday();
    const end = addDays(base, 84);
    await svc('PATCH', 'coaching_clients?id=eq.' + c.id, { end_date: end });
    await sendEmail('basic_renewed', c.email, { name: c.name, amountCents: o.amount_paid, date: niceDate(melbToday()), settings: await settings(), endDate: niceDate(end) });
    return;
  }
  if (event.type === 'invoice.payment_failed') {
    if (!o.subscription) return;
    const c = await clientForSubscription(o.subscription);
    if (c) {
      await sendEmail('basic_failed', c.email, { name: c.name });
      await sendEmailSafe('owner_basic_failed', null, { name: c.name, email: c.email });
    }
    return;
  }
  if (event.type === 'customer.subscription.deleted') {
    // Stripe sends this at the end of the paid period (cancel at period end), so the plan finishes now.
    const c = await clientForSubscription(o.id);
    if (!c) return;
    const today = melbToday();
    await svc('PATCH', 'coaching_clients?id=eq.' + c.id, { status: 'finished', end_date: c.end_date && c.end_date < today ? c.end_date : today });
    await sendEmail('basic_cancelled', c.email, { name: c.name, endDate: niceDate(today) });
    await sendEmailSafe('owner_basic_cancelled', null, { name: c.name, email: c.email });
    return;
  }
  if (event.type === 'charge.refunded') {
    const full = o.amount_refunded >= o.amount;
    const note = (full ? 'Refunded in full' : 'Partly refunded') + ' ' + money(o.amount_refunded) + ' on ' + niceDate(melbToday());
    // A Basic subscription's payment comes with its invoice. The subscription is what to stop.
    let subId = null;
    if (o.invoice) {
      const inv = await stripeCall('GET', 'invoices/' + o.invoice);
      subId = inv.subscription || null;
    }
    let cancelled = false;
    if (subId && full) {
      // Stop the subscription now, so the client is never charged again. Already gone (a retry) is fine.
      try { await stripeCall('DELETE', 'subscriptions/' + subId); }
      catch (e) { if (!(e.stripe && e.stripe.error && e.stripe.error.code === 'resource_missing')) throw e; }
    }
    const r = await svc('POST', 'rpc/coaching_apply_refund', { p_payment_intent: o.payment_intent || null, p_full: full, p_note: note, p_subscription_id: subId });
    cancelled = !!(r && r.cancelled);
    const who = r && r.found ? { email: r.email, name: r.name, tier: r.tier } : { email: (o.billing_details && o.billing_details.email) || 'unknown', name: '', tier: subId ? 'basic' : '' };
    const outcome = full
      ? (subId ? 'Subscription cancelled now, and the plan is finished. The client will not be charged again.' : (cancelled ? 'Plan cancelled. The place is free.' : 'Refund noted. No open plan was found to cancel.'))
      : 'Partial refund noted. The plan is unchanged.';
    await sendEmailSafe('owner_refund', null, { name: who.name, email: who.email, plan: who.tier || 'basic', amountCents: o.amount_refunded, full, outcome });
    return;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.STRIPE_COACHING_WEBHOOK_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Coaching webhook is not configured (missing env vars)');
    return res.status(500).end();
  }
  const raw = await readRawBody(req);
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
    return res.status(400).json({ error: 'bad_signature' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'bad_payload' }); }

  const state = await svc('POST', 'rpc/coaching_begin_event', { p_event_id: event.id, p_type: event.type });
  if (state === 'done') return res.status(200).json({ received: true, duplicate: true });
  try {
    await handle(event);
    await svc('POST', 'rpc/coaching_finish_event', { p_event_id: event.id });
    return res.status(200).json({ received: true });
  } catch (e) {
    // Not marked done, so Stripe's retry runs it again.
    console.error('coaching webhook failed for ' + event.type + ' ' + event.id + ': ' + e.message);
    return res.status(500).json({ error: 'retry' });
  }
};
module.exports._test = { handle, onCheckoutCompleted, melbToday, addDays };
