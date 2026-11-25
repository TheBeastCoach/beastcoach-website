// Shared server code for the coaching checkout, the coaching webhook and the billing portal.
// Nothing here is sent to the browser. The service role key is used only by these server functions.
// Prices are set here, in AUD cents. The browser sends a plan name, never a price.
const crypto = require('crypto');

const SUPABASE_URL = 'https://jgbcgbdbmqtsozwlllfj.supabase.co';
// Public, as on the site (the same key the portal pages use).
const PUBLISHABLE_KEY = 'sb_publishable_3AdpZhYhif9JeP3rvmY2-Q_MuhFMGiw';
const SITE_URL_DEFAULT = 'https://www.beastcoach.fit';
const TERMS_VERSION = '2026-11-25';
const HEALTH_VERSION = '2026-11-25';
const RENEWAL_PERCENT = 20;

// Each plan: name, price in cents, and how Stripe takes it.
// Basic is a subscription, one charge every 12 weeks. The others are paid once, up front, for 12 weeks.
const PLANS = {
  basic:    { name: 'Basic',     cents: 3000,  mode: 'subscription', interval: 'week', intervalCount: 12, discipline: false, capacity: false },
  essential: { name: 'Essential', cents: 11000, mode: 'payment',     discipline: false, capacity: true },
  core:     { name: 'Core',      cents: 29900, mode: 'payment',      discipline: true,  capacity: true },
  beast:    { name: 'The Beast', cents: 69900, mode: 'payment',      discipline: true,  capacity: true }
};

function siteUrl() { return (process.env.SITE_URL || SITE_URL_DEFAULT).replace(/\/$/, ''); }

// Money as people read it: "$299 AUD". Cents in, whole dollars out when there are no cents.
function money(cents) {
  const v = Math.round(cents) / 100;
  return '$' + (Number.isInteger(v) ? v.toLocaleString('en-AU') : v.toFixed(2)) + ' AUD';
}
// The price after a renewal discount, in cents (rounded down to the cent).
function renewalCents(cents) { return Math.floor(cents * (100 - RENEWAL_PERCENT) / 100); }

function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254; }

// The real IP of the caller (Vercel puts it first in x-forwarded-for). Used for rate limits only.
function clientIp(req) {
  const xf = (req.headers && req.headers['x-forwarded-for']) || '';
  return String(xf).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ---------------------------------------------------------------- Stripe
async function stripeCall(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('Stripe ' + r.status + ': ' + ((data.error && data.error.message) || 'request failed')); e.stripe = data; throw e; }
  return data;
}

// Stripe's signature check: HMAC-SHA256 of "timestamp.payload", compared in constant time, and no older than 5 minutes.
function verifyStripeSignature(rawBody, sigHeader, secret, nowSeconds) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  String(sigHeader).split(',').forEach(p => { const i = p.indexOf('='); if (i > 0) parts[p.slice(0, i)] = p.slice(i + 1); });
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const now = nowSeconds == null ? Math.floor(Date.now() / 1000) : nowSeconds;
  if (Math.abs(now - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody.toString('utf8'), 'utf8').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex')); } catch (e) { return false; }
}

// ---------------------------------------------------------------- Supabase
// Server calls with the service role (writes, and reads the browser must never do).
async function svc(method, path, body, prefer) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!r.ok) { const e = new Error('Supabase ' + r.status + ' on ' + path + ': ' + (data && data.message ? data.message : text)); e.status = r.status; throw e; }
  return data;
}
// A public read (the same as the portal pages: publishable key, no user).
async function anonRpc(name, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error('rpc ' + name + ' ' + r.status);
  return r.json();
}
// The signed-in user for this token, or null. Checked with Supabase, never trusted from the browser.
async function userFromToken(token) {
  if (!token) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id && u.email ? u : null;
}
// Reads with the USER's token, so row level security decides what they see.
async function userRead(token, path) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

// Is this caller under the limit? Stored in the database, so it holds across serverless instances.
async function underLimit(key, limit, windowSeconds) {
  const ok = await svc('POST', 'rpc/coaching_rate_hit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  return ok === true;
}

module.exports = {
  SUPABASE_URL, PUBLISHABLE_KEY, PLANS, TERMS_VERSION, HEALTH_VERSION, RENEWAL_PERCENT,
  siteUrl, money, renewalCents, isEmail, clientIp,
  stripeCall, verifyStripeSignature,
  svc, anonRpc, userFromToken, userRead, underLimit
};
