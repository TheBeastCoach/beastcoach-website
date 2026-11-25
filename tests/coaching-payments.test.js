// Tests for the coaching payments: checkout (api/coaching-checkout.js), the webhook (api/coaching-webhook.js),
// the billing portal link (api/coaching-billing.js) and the transactional emails (api/_email.js).
// Stripe, Supabase and Resend are all mocked (global fetch). No network, no keys.
// Run with: node --test tests/coaching-payments.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
const checkout = require(path.join(ROOT, 'api', 'coaching-checkout.js'));
const webhook = require(path.join(ROOT, 'api', 'coaching-webhook.js'));
const billing = require(path.join(ROOT, 'api', 'coaching-billing.js'));
const email = require(path.join(ROOT, 'api', '_email.js'));
const { verifyStripeSignature } = require(path.join(ROOT, 'api', '_coaching.js'));

const WHSEC = 'whsec_test_coaching';
const TOKEN = 'token-user-1';
const json = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });

function env(over) {
  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', RESEND_API_KEY: 're_test_x',
    STRIPE_COACHING_WEBHOOK_SECRET: WHSEC, SITE_URL: 'https://preview.example.test' }, over || {});
}
// The fake world. routes can override any call; every call is recorded in order.
function mock(routes) {
  const r = routes || {};
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const body = opts && typeof opts.body === 'string' && !opts.body.startsWith('{') && u.includes('stripe') ? opts.body
      : opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined;
    calls.push({ url: u, method: (opts && opts.method) || 'GET', body, auth: opts && opts.headers && (opts.headers.Authorization || opts.headers.authorization) });
    if (u.includes('api.stripe.com/v1/checkout/sessions')) return r.session ? r.session(body) : json(200, { id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' });
    if (u.includes('api.stripe.com/v1/refunds')) return json(200, { id: 're_1' });
    if (u.includes('api.stripe.com/v1/billing_portal/sessions')) return json(200, { url: 'https://billing.stripe.com/p/session/x' });
    if (u.includes('api.resend.com')) return json(200, { id: 'em_1' });
    if (u.endsWith('/auth/v1/user')) return r.user ? r.user() : json(401, {});
    if (u.includes('/rest/v1/rpc/coaching_places')) return r.places ? r.places() : json(200, [{ tier: 'essential', places_left: 9 }, { tier: 'core', places_left: 5 }, { tier: 'beast', places_left: 3 }]);
    if (u.includes('/rest/v1/rpc/coaching_rate_hit')) return json(200, r.rate === undefined ? true : r.rate);
    if (u.includes('/rest/v1/rpc/coaching_begin_event')) return r.begin ? r.begin() : json(200, 'run');
    if (u.includes('/rest/v1/rpc/coaching_create_from_purchase')) return r.create ? r.create(body) : json(200, { ok: true, client_id: 9, repeat: false });
    if (u.includes('/rest/v1/rpc/coaching_finish_event')) return json(200, null);
    if (u.includes('/rest/v1/rpc/coaching_apply_refund')) return r.refund ? r.refund(body) : json(200, { found: true, email: 'sam@example.com', name: 'Sam', tier: 'core', cancelled: true });
    if (u.includes('/rest/v1/coaching_settings')) return json(200, [r.settings || { gst_registered: false, abn: null }]);
    if (u.includes('/rest/v1/coaching_clients')) return r.clients ? r.clients(u, body) : json(200, []);
    if (u.includes('/rest/v1/purchases')) return json(201, []);
    if (u.includes('/rest/v1/coaching_clients') && opts && opts.method === 'PATCH') return json(204, null);
    throw new Error('unexpected fetch ' + u);
  };
  return calls;
}
const resendTo = calls => calls.filter(c => c.url.includes('api.resend.com')).map(c => c.body.to[0]);
const resendKinds = calls => calls.filter(c => c.url.includes('api.resend.com')).map(c => c.body.subject);
const called = (calls, part) => calls.filter(c => c.url.includes(part));

// ---------------------------------------------------------------- a fake request and response
function fakeReq(raw, headers) {
  const em = new EventEmitter();
  em.method = 'POST'; em.headers = headers || {};
  setImmediate(() => { em.emit('data', Buffer.from(raw, 'utf8')); em.emit('end'); });
  return em;
}
function fakeRes() {
  return { statusCode: 200, body: undefined, headers: {}, ended: false,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }, end() { this.ended = true; return this; } };
}
function signed(event, secret, ts) {
  const raw = JSON.stringify(event);
  const t = String(ts == null ? Math.floor(Date.now() / 1000) : ts);
  const v1 = crypto.createHmac('sha256', secret || WHSEC).update(t + '.' + raw, 'utf8').digest('hex');
  return { raw, sig: 't=' + t + ',v1=' + v1 };
}
function checkoutEvent(over) {
  const obj = Object.assign({ id: 'cs_pay_1', mode: 'payment', payment_intent: 'pi_1', customer: 'cus_1', subscription: null,
    amount_total: 29900, currency: 'aud', metadata: { plan: 'core', name: 'Sam Client', email: 'sam@example.com', news: 'yes' } }, over || {});
  return { id: 'evt_' + Math.random().toString(36).slice(2, 8), type: 'checkout.session.completed', data: { object: obj } };
}
async function hook(event, opts) {
  const o = opts || {};
  const s = o.secret === null ? { raw: JSON.stringify(event), sig: 'bogus' } : signed(event, o.secret);
  const res = fakeRes();
  await webhook(fakeReq(s.raw, { 'stripe-signature': s.sig }), res);
  return res;
}
// The checkout endpoint, with a body and optional headers.
async function checkoutCall(body, headers) {
  const res = fakeRes();
  await checkout({ method: 'POST', body, headers: Object.assign({ 'x-forwarded-for': '203.0.113.7' }, headers || {}) }, res);
  return res;
}
const baseBody = over => Object.assign({ plan: 'core', name: 'Sam Client', email: 'sam@example.com', agreeTerms: true, agreeHealth: true, news: false }, over || {});

// ================================================================ checkout
test('checkout refuses a full plan (409, the waitlist offer) and creates no Stripe session', async () => {
  env(); const calls = mock({ places: () => json(200, [{ tier: 'core', places_left: 0 }]) });
  const res = await checkoutCall(baseBody());
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'full');
  assert.equal(res.body.waitlist, true);
  assert.equal(called(calls, 'checkout/sessions').length, 0, 'no Stripe session');
});

test('checkout needs both agreements, a name and a valid email (400), with no Stripe call', async () => {
  env(); const calls = mock({});
  assert.equal((await checkoutCall(baseBody({ agreeTerms: false }))).body.error, 'terms');
  assert.equal((await checkoutCall(baseBody({ agreeHealth: false }))).body.error, 'health');
  assert.equal((await checkoutCall(baseBody({ email: 'nope' }))).body.error, 'bad_email');
  assert.equal((await checkoutCall(baseBody({ plan: 'gold' }))).body.error, 'bad_plan');
  assert.equal(called(calls, 'checkout/sessions').length, 0);
});

test('checkout is rate limited by IP (429), and the count is kept in the database', async () => {
  env(); const calls = mock({ rate: false });
  const res = await checkoutCall(baseBody());
  assert.equal(res.statusCode, 429);
  assert.equal(called(calls, 'coaching_rate_hit')[0].body.p_key, 'checkout:203.0.113.7');
  assert.equal(called(calls, 'checkout/sessions').length, 0);
});

test('Core checkout: one payment in AUD at the server price, the consents and versions in the metadata, the email prefilled', async () => {
  env(); const calls = mock({});
  const res = await checkoutCall(baseBody({ news: true }));
  assert.equal(res.statusCode, 200);
  const body = called(calls, 'checkout/sessions')[0].body;
  assert.match(body, /mode=payment/);
  assert.match(body, /line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=29900/);
  assert.match(body, /price_data%5D%5Bcurrency%5D=aud/);
  assert.match(body, /metadata%5Bplan%5D=core/);
  assert.match(body, /metadata%5Bnews%5D=yes/);
  assert.match(body, /metadata%5Bterms_version%5D=2026-11-25/);
  assert.match(body, /metadata%5Bhealth_version%5D=2026-11-25/);
  assert.match(body, /customer_email=sam%40example\.com/);
  assert.match(body, /success_url=https%3A%2F%2Fpreview\.example\.test%2Fmy-coach/);
  assert.equal(res.body.amount, '$299 AUD');
});

test('Basic checkout is a subscription: $30 AUD every 12 weeks (interval week, count 12)', async () => {
  env(); const calls = mock({});
  await checkoutCall(baseBody({ plan: 'basic' }));
  const body = called(calls, 'checkout/sessions')[0].body;
  assert.match(body, /mode=subscription/);
  assert.match(body, /unit_amount%5D=3000/);
  assert.match(body, /%5Brecurring%5D%5Binterval%5D=week/);
  assert.match(body, /%5Brecurring%5D%5Binterval_count%5D=12/);
});

test('renewal: signed out, the discount is refused (401); a user with no finished plan is refused (403)', async () => {
  env(); mock({});
  assert.equal((await checkoutCall(baseBody({ renew: true }))).statusCode, 401);
  mock({ user: () => json(200, { id: 'u1', email: 'sam@example.com' }), clients: () => json(200, []) });
  const res = await checkoutCall(baseBody({ renew: true }), { authorization: 'Bearer ' + TOKEN });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'not_finished');
});

test('renewal 20% off: only for the signed-in finished client, at the server price, with their verified email', async () => {
  env();
  const calls = mock({ user: () => json(200, { id: 'u1', email: 'Verified.Sam@example.com' }), clients: () => json(200, [{ id: 3, status: 'finished', tier: 'core' }]) });
  const res = await checkoutCall(baseBody({ renew: true, email: 'someone.else@example.com' }), { authorization: 'Bearer ' + TOKEN });
  assert.equal(res.statusCode, 200);
  const body = called(calls, 'checkout/sessions')[0].body;
  assert.match(body, /unit_amount%5D=23920/, '299 less 20% is 239.20');
  assert.match(body, /metadata%5Brenewal%5D=discount/);
  assert.match(body, /metadata%5Bdiscount_percent%5D=20/);
  assert.match(body, /customer_email=verified\.sam%40example\.com/, 'the verified email, not the one typed in');
  assert.equal(res.body.discount, 20);
});

test('drop to Basic for a finished client: the Basic subscription, with no discount', async () => {
  env();
  const calls = mock({ user: () => json(200, { id: 'u1', email: 'sam@example.com' }), clients: () => json(200, [{ id: 3, status: 'finished', tier: 'core' }]) });
  await checkoutCall(baseBody({ plan: 'basic', renew: true }), { authorization: 'Bearer ' + TOKEN });
  const body = called(calls, 'checkout/sessions')[0].body;
  assert.match(body, /mode=subscription/);
  assert.match(body, /unit_amount%5D=3000/);
  assert.doesNotMatch(body, /discount_percent%5D=20/);
});

test('billing portal: the signed-in Basic client\'s own customer, and nothing for anyone else', async () => {
  env();
  const calls = mock({ user: () => json(200, { id: 'u1', email: 'sam@example.com' }), clients: () => json(200, [{ stripe_customer_id: 'cus_basic_1' }]) });
  const res = fakeRes();
  await billing({ method: 'POST', headers: { authorization: 'Bearer ' + TOKEN } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(called(calls, 'billing_portal')[0].body, /customer=cus_basic_1/);
  const res2 = fakeRes();
  mock({ user: () => json(401, {}) });
  await billing({ method: 'POST', headers: {} }, res2);
  assert.equal(res2.statusCode, 401);
});

// ================================================================ webhook: signatures and idempotency
test('the webhook rejects a bad signature (400) and writes nothing', async () => {
  env(); const calls = mock({});
  const res = await hook(checkoutEvent(), { secret: 'whsec_wrong' });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0, 'no database or email call');
});

test('signature check: an old timestamp is refused (replay), a fresh one is accepted', () => {
  const ev = { id: 'evt_x', type: 'x' };
  const old = signed(ev, WHSEC, Math.floor(Date.now() / 1000) - 3600);
  assert.equal(verifyStripeSignature(Buffer.from(old.raw), old.sig, WHSEC), false, 'an hour old is refused');
  const fresh = signed(ev, WHSEC);
  assert.equal(verifyStripeSignature(Buffer.from(fresh.raw), fresh.sig, WHSEC), true);
});

test('a resent event that already finished is skipped: no second client, no second email', async () => {
  env(); const calls = mock({ begin: () => json(200, 'done') });
  const res = await hook(checkoutEvent());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.duplicate, true);
  assert.equal(called(calls, 'coaching_create_from_purchase').length, 0);
  assert.equal(resendTo(calls).length, 0);
});

// ================================================================ webhook: checkout completed
test('Core paid: creates the client and the customer, sends the welcome and the receipt, and unlocks the Discipline Path', async () => {
  env(); const calls = mock({});
  const ev = checkoutEvent({ metadata: { plan: 'core', name: 'Sam Client', email: 'Sam@Example.com', news: 'no' } });
  const res = await hook(ev);
  assert.equal(res.statusCode, 200);
  const c = called(calls, 'coaching_create_from_purchase')[0].body;
  assert.equal(c.p_tier, 'core');
  assert.equal(c.p_email, 'sam@example.com', 'email lower-cased');
  assert.equal(c.p_marketing_consent, false, 'news not ticked: no marketing consent');
  assert.equal(c.p_amount_cents, 29900);
  assert.equal(c.p_payment_intent, 'pi_1');
  const subjects = resendKinds(calls);
  assert.ok(subjects.some(x => /Welcome/.test(x)), 'welcome sent');
  assert.ok(subjects.some(x => /receipt/i.test(x)), 'receipt sent');
  assert.equal(resendTo(calls).length, 2, 'welcome and receipt');
  const purchase = called(calls, '/rest/v1/purchases');
  assert.equal(purchase.length, 1, 'Core unlocks the Discipline Path');
  assert.equal(purchase[0].body.product, 'discipline-path');
  assert.equal(purchase[0].body.email, 'sam@example.com', 'the purchases row is keyed by email');
});

test('Essential paid: no Discipline Path purchase (only Core and The Beast unlock it)', async () => {
  env(); const calls = mock({});
  await hook(checkoutEvent({ metadata: { plan: 'essential', name: 'Erin', email: 'erin@example.com', news: 'yes' } }));
  assert.equal(called(calls, '/rest/v1/purchases').length, 0);
  assert.equal(called(calls, 'coaching_create_from_purchase').length, 1);
});

test('The Beast paid: the Discipline Path unlocks too', async () => {
  env(); const calls = mock({});
  await hook(checkoutEvent({ metadata: { plan: 'beast', name: 'Bo', email: 'bo@example.com', news: 'no' } }));
  assert.equal(called(calls, '/rest/v1/purchases').length, 1);
});

test('a full plan at payment time: the payment is refunded in full, the sorry email is sent, and no client is made', async () => {
  env(); const calls = mock({ create: () => json(200, { ok: false, reason: 'full' }) });
  const res = await hook(checkoutEvent({ payment_intent: 'pi_full_1' }));
  assert.equal(res.statusCode, 200);
  const refund = called(calls, 'api.stripe.com/v1/refunds');
  assert.equal(refund.length, 1);
  assert.match(refund[0].body, /payment_intent=pi_full_1/);
  assert.deepEqual(resendKinds(calls).length, 1);
  assert.match(resendKinds(calls)[0], /just filled/);
  assert.equal(called(calls, '/rest/v1/purchases').length, 0, 'no Discipline Path for a refunded payment');
});

test('a repeated create (the session was already handled) sends no second welcome or receipt', async () => {
  env(); const calls = mock({ create: () => json(200, { ok: true, client_id: 9, repeat: true }) });
  await hook(checkoutEvent());
  assert.equal(resendTo(calls).length, 0);
  assert.equal(called(calls, '/rest/v1/purchases').length, 0);
});

// ================================================================ webhook: Basic subscription
test('Basic renewal (invoice.paid, subscription_cycle): the plan runs 12 weeks more, and the renewed email goes out', async () => {
  env(); const calls = mock({ clients: () => json(200, [{ id: 5, email: 'bo@example.com', name: 'Bo', end_date: '2027-03-01', status: 'active' }]) });
  const ev = { id: 'evt_inv_1', type: 'invoice.paid', data: { object: { subscription: 'sub_1', billing_reason: 'subscription_cycle', amount_paid: 3000 } } };
  const res = await hook(ev);
  assert.equal(res.statusCode, 200);
  const patch = calls.find(c => c.method === 'PATCH');
  assert.equal(patch.body.end_date, '2027-05-24', '84 days after 1 March 2027');
  assert.deepEqual(resendKinds(calls).map(s => /renewed/.test(s)), [true]);
});

test('the first Basic payment (subscription_create) does not extend the plan again', async () => {
  env(); const calls = mock({ clients: () => json(200, [{ id: 5, email: 'bo@example.com', name: 'Bo', end_date: '2027-03-01', status: 'active' }]) });
  await hook({ id: 'evt_inv_2', type: 'invoice.paid', data: { object: { subscription: 'sub_1', billing_reason: 'subscription_create', amount_paid: 3000 } } });
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});

test('Basic payment failed: the client is emailed to update the card', async () => {
  env(); const calls = mock({ clients: () => json(200, [{ id: 5, email: 'bo@example.com', name: 'Bo', end_date: '2027-03-01', status: 'active' }]) });
  await hook({ id: 'evt_fail_1', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } } });
  assert.match(resendKinds(calls)[0], /update your card/);
  assert.deepEqual(resendTo(calls), ['bo@example.com']);
});

test('Basic cancelled (subscription deleted at the end of the paid period): finished, and the cancelled email', async () => {
  env(); const calls = mock({ clients: () => json(200, [{ id: 5, email: 'bo@example.com', name: 'Bo', end_date: '2027-03-01', status: 'active' }]) });
  await hook({ id: 'evt_del_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  const patch = calls.find(c => c.method === 'PATCH');
  assert.equal(patch.body.status, 'finished');
  assert.match(resendKinds(calls)[0], /cancelled/);
});

// ================================================================ refunds
test('a full refund cancels the plan and notes the customer (the spot frees up)', async () => {
  env(); const calls = mock({});
  await hook({ id: 'evt_ref_1', type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', amount: 29900, amount_refunded: 29900 } } });
  const rpc = called(calls, 'coaching_apply_refund')[0].body;
  assert.equal(rpc.p_payment_intent, 'pi_1');
  assert.equal(rpc.p_full, true);
  assert.match(rpc.p_note, /Refunded in full/);
});

test('a partial refund is noted but does not cancel the plan', async () => {
  env(); const calls = mock({});
  await hook({ id: 'evt_ref_2', type: 'charge.refunded', data: { object: { payment_intent: 'pi_2', amount: 29900, amount_refunded: 10000 } } });
  assert.equal(called(calls, 'coaching_apply_refund')[0].body.p_full, false);
});

test('a failure part way is not marked done, so Stripe retries it (500)', async () => {
  env(); const calls = mock({ create: () => json(500, { message: 'boom' }) });
  const res = await hook(checkoutEvent());
  assert.equal(res.statusCode, 500);
  assert.equal(called(calls, 'coaching_finish_event').length, 0, 'not finished, so the retry runs it');
});

// ================================================================ transactional emails
test('receipts in both GST modes: "No GST has been charged" now; a tax invoice with GST at 1/11 and the ABN when registered', () => {
  const off = email._build.receipt({ name: 'Sam', plan: 'core', amountCents: 29900, date: '1 December 2026', settings: { gst_registered: false, abn: null } });
  assert.match(off.text, /No GST has been charged\./);
  assert.match(off.html, /No GST has been charged\./);
  const on = email._build.receipt({ name: 'Sam', plan: 'core', amountCents: 29900, date: '1 December 2026', settings: { gst_registered: true, abn: '12345678901' } });
  assert.match(on.text, /Tax invoice\. The total includes GST of \$27\.18 AUD \(1\/11 of the price\)\. ABN 12345678901\./);
  assert.doesNotMatch(on.text, /No GST has been charged/);
});

test('every transactional email has a subject, an HTML and a plain text version, and no marketing wording', () => {
  const data = { name: 'Sam', plan: 'core', amountCents: 29900, date: '1 December 2026', endDate: '1 March 2027', settings: { gst_registered: false },
    subscription: true };
  for (const kind of email.KINDS) {
    const built = email._build[kind === 'spot_filled' ? 'spot_filled' : kind](data);
    assert.ok(built.subject && built.html && built.text, kind + ' has all three parts');
    assert.doesNotMatch(built.html + built.text, /\u2014|\u2013/, kind + ' has no em or en dashes');
    assert.doesNotMatch(built.html + built.text, /unsubscribe/i, kind + ' carries no marketing unsubscribe');
  }
  assert.equal(email.KINDS.length, 6);
});

test('sending: from Stefan at Beast Coach, reply-to Stefan, and only the transactional kinds', async () => {
  env(); const calls = mock({});
  assert.equal(await email.sendEmail('welcome', 'sam@example.com', { name: 'Sam', plan: 'core' }), true);
  const sent = calls.find(c => c.url.includes('api.resend.com')).body;
  assert.equal(sent.from, 'Stefan at Beast Coach <stefan@beastcoach.fit>');
  assert.equal(sent.reply_to, 'stefan@stefanbotha.com');
  await assert.rejects(() => email.sendEmail('marketing_blast', 'sam@example.com', {}), /not a transactional email/);
});

test('Stripe webhook: signature check uses the coaching secret, not the Discipline Path one', () => {
  env({ STRIPE_COACHING_WEBHOOK_SECRET: WHSEC, STRIPE_WEBHOOK_SECRET: 'whsec_discipline_only' });
  const ev = { id: 'evt_s', type: 'x' };
  const s = signed(ev, 'whsec_discipline_only');
  assert.equal(verifyStripeSignature(Buffer.from(s.raw), s.sig, WHSEC), false, 'a Discipline Path signature does not pass here');
});
