// Transactional email for the coaching portal, sent with Resend (RESEND_API_KEY).
// This file sends ONLY the six transactional messages below. It has no marketing messages, and no function here
// takes a template name from a request. Marketing email is a separate matter, sent only from the consent list.
const { money, siteUrl, PLANS } = require('./_coaching.js');

const FROM = 'Stefan at Beast Coach <stefan@beastcoach.fit>';
const REPLY_TO = 'stefan@stefanbotha.com';
const OWNER = 'stefan@stefanbotha.com';
// Messages to clients.
const CLIENT_KINDS = ['welcome', 'receipt', 'spot_filled', 'basic_renewed', 'basic_failed', 'basic_cancelled', 'already_open'];
// Alerts to the owner (Stefan). Always sent to OWNER, whatever address the caller passes.
const OWNER_KINDS = ['owner_purchase', 'owner_duplicate', 'owner_refund', 'owner_basic_failed', 'owner_basic_cancelled', 'owner_discipline'];
const KINDS = CLIENT_KINDS.concat(OWNER_KINDS);

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const planName = key => (PLANS[key] && PLANS[key].name) || 'Coaching';

// Brand tokens (docs/BRAND.md). Email cannot read brand.css, so the values are repeated here.
const GROUND = '#0B0C0A', SURFACE = '#141511', LINE = '#26281F', INK = '#F4F5EE', SOFT = '#C7C9BE', MUTED = '#A3A69A', LIME = '#C6F432', AMBER = '#FFC21F';
const FONT = "'Hanken Grotesk',Arial,Helvetica,sans-serif";
const LOGO_URL = 'https://www.beastcoach.fit/beastcoach-email-logo.png';

// GST wording. Not registered: "No GST has been charged." Registered: a tax invoice, with GST included (1/11) and the ABN.
function gstLine(settings, cents) {
  if (!settings || !settings.gst_registered) return { text: 'No GST has been charged.', tax: false };
  const gst = Math.round(cents / 11);
  return { text: 'Tax invoice. The total includes GST of ' + money(gst) + ' (1/11 of the price). ABN ' + (settings.abn || 'not set') + '.', tax: true };
}

// Email building blocks. Tables for layout, inline styles only.
const H = (html, size) => `<h1 style="margin:0 0 12px;font-family:${FONT};font-weight:700;font-size:${size}px;line-height:1.15;color:${INK};">${html}</h1>`;
const P = (html, extra) => `<p style="margin:0 0 12px;font-family:${FONT};font-size:16px;line-height:1.55;color:${SOFT};${extra || ''}">${html}</p>`;
const SMALL = (html, extra) => `<p style="margin:0 0 12px;font-family:${FONT};font-size:14px;line-height:1.55;color:${MUTED};${extra || ''}">${html}</p>`;
const B = html => `<b style="color:${INK};">${html}</b>`;
const A = (href, label) => `<a href="${esc(href)}" style="color:${LIME};text-decoration:underline;">${label}</a>`;

// Shared layout: dark ground, one card, logo as a hosted PNG, footer in muted text. Max width 600px.
function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${GROUND};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${GROUND}" style="background:${GROUND};width:100%;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:0 0 20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:12px;"><img src="${LOGO_URL}" width="44" height="44" alt="Beast Coach" style="display:block;border:0;width:44px;height:44px;"></td>
<td style="vertical-align:middle;font-family:${FONT};font-weight:700;font-size:18px;letter-spacing:2px;color:${INK};white-space:nowrap;">BEAST <span style="color:${AMBER};">COACH</span></td>
</tr></table>
</td></tr>
<tr><td style="background:${SURFACE};border:1px solid ${LINE};border-radius:20px;padding:32px 28px;">
${bodyHtml}
</td></tr>
<tr><td style="padding:20px 0 0 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${MUTED};">
<p style="margin:0 0 8px;">Beast Coach online coaching. General fitness and nutrition guidance, not medical advice.</p>
<p style="margin:0;">Beast Coach. Questions? Reply to this email.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
// Primary button: a lime pill inside a table cell (no VML).
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;"><tr><td align="center" style="border-radius:999px;background:${LIME};"><a href="${esc(href)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:${LIME};color:${GROUND};font-family:${FONT};font-size:16px;font-weight:700;line-height:1.2;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
}

function welcome({ name, plan }) {
  const first = esc((name || '').split(' ')[0] || 'there');
  const site = siteUrl();
  const text = `Hi ${name || 'there'},

Thanks for joining ${planName(plan)} with Beast Coach. Here is what happens next:

1. Sign in or create your account at ${site}/dashboard with this email address. Use exactly this email, so your plan is linked to you.
2. Open My Coach and answer the onboarding questions. Stefan uses them to build your plan.
3. Stefan builds your plan and sets your start date. Logging opens when your plan is active.

Reply to this email if you have a question.

Stefan`;
  const html = layout('Welcome to Beast Coach',
    H('Welcome, ' + first, 30)
    + P('Thanks for joining ' + B(esc(planName(plan))) + '. Here is what happens next:')
    + `<ol style="margin:0 0 6px;padding-left:20px;font-family:${FONT};font-size:16px;line-height:1.55;color:${SOFT};">
<li style="margin:0 0 10px;">Sign in or create your account at ${A(site + '/dashboard', 'beastcoach.fit/dashboard')} with ${B('this email address')}. Use exactly this email, so your plan is linked to you.</li>
<li style="margin:0 0 10px;">Open My Coach and answer the onboarding questions. Stefan uses them to build your plan.</li>
<li style="margin:0 0 10px;">Stefan builds your plan and sets your start date. Logging opens when your plan is active.</li>
</ol>`
    + button(site + '/dashboard', 'Sign in to Beast Coach')
    + P('Reply to this email if you have a question.', 'margin-top:20px;')
    + P('Stefan', 'margin-bottom:0;'));
  return { subject: 'Welcome to Beast Coach: your next steps', html, text };
}

function receipt({ name, plan, amountCents, date, settings, subscription }) {
  const gst = gstLine(settings, amountCents);
  const what = subscription ? 'Every 12 weeks, billed automatically' : 'One payment, for 12 weeks';
  const text = `Receipt from Beast Coach

Plan: ${planName(plan)}
Amount: ${money(amountCents)}
Date: ${date}
${what}

${gst.text}

Questions? Reply to this email.`;
  const td = `padding:10px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:16px;`;
  const html = layout('Your receipt',
    H('Your receipt', 28)
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr><td style="${td}color:${MUTED};">Plan</td><td style="${td}text-align:right;color:${INK};font-weight:700;">${esc(planName(plan))}</td></tr>
<tr><td style="${td}color:${MUTED};">Amount</td><td style="${td}text-align:right;color:${INK};font-weight:700;">${esc(money(amountCents))}</td></tr>
<tr><td style="${td}color:${MUTED};">Date</td><td style="${td}text-align:right;color:${INK};">${esc(date)}</td></tr>
</table>`
    + SMALL(esc(what) + '.', 'margin-top:14px;')
    + SMALL(esc(gst.text), 'margin-top:10px;')
    + SMALL('Hi ' + esc(name || 'there') + ', keep this for your records.', 'margin-top:12px;margin-bottom:0;'));
  return { subject: 'Your Beast Coach receipt', html, text };
}

function spotFilled({ name, plan, amountCents }) {
  const text = `Hi ${name || 'there'},

Thank you for trying to join ${planName(plan)}. Sorry: that plan filled up in the moment between you paying and us confirming your place, so we have refunded your payment of ${money(amountCents)} in full. The refund goes back to your card and can take a few days to show.

If you would like another plan, or to be told when a place opens, reply to this email and we will sort it out.

Stefan`;
  const html = layout('Sorry, that plan just filled',
    H('Sorry, that plan just filled', 28)
    + P('Hi ' + esc(name || 'there') + ', thank you for trying to join ' + B(esc(planName(plan))) + '. The plan filled up in the moment between your payment and our confirmation.')
    + P('We have refunded your payment of ' + B(esc(money(amountCents))) + ' in full. It goes back to your card and can take a few days to show.')
    + P('If you would like another plan, or to be told when a place opens, reply to this email.')
    + P('Stefan', 'margin-bottom:0;'));
  return { subject: 'Sorry, that plan just filled: your payment is refunded', html, text };
}

function basicRenewed({ name, amountCents, date, settings, endDate }) {
  const gst = gstLine(settings, amountCents);
  const text = `Hi ${name || 'there'},

Your Basic plan has renewed. We took ${money(amountCents)} on ${date}. Your plan now runs to ${endDate}.

${gst.text}

Manage or cancel any time from My Coach, Settings.

Stefan`;
  const html = layout('Basic renewed',
    H('Basic has renewed', 28)
    + P('Hi ' + esc(name || 'there') + ', we took ' + B(esc(money(amountCents))) + ' on ' + esc(date) + '. Your plan now runs to ' + esc(endDate) + '.')
    + SMALL(esc(gst.text))
    + P('You can manage or cancel any time from My Coach, Settings.')
    + button(siteUrl() + '/my-coach', 'Open My Coach'));
  return { subject: 'Your Basic plan has renewed', html, text };
}

function basicFailed({ name }) {
  const text = `Hi ${name || 'there'},

We could not take the latest payment for your Basic plan. Please update your card so your plan keeps running.

Update it from My Coach, Settings: ${siteUrl()}/my-coach

If you have already fixed it, you can ignore this email.

Stefan`;
  const html = layout('Please update your card',
    H('Please update your card', 28)
    + P('Hi ' + esc(name || 'there') + ', we could not take the latest payment for your Basic plan. Please update your card so your plan keeps running.')
    + button(siteUrl() + '/my-coach', 'Update my card')
    + SMALL('If you have already fixed it, you can ignore this email.', 'margin-top:14px;'));
  return { subject: 'Please update your card for Basic', html, text };
}

function basicCancelled({ name, endDate }) {
  const text = `Hi ${name || 'there'},

Your Basic plan is cancelled. You can keep using it until ${endDate}. Your history stays in My Coach.

Thank you for training with Beast Coach. If you change your mind, you can start Basic again from the Work With Me page.

Stefan`;
  const html = layout('Basic is cancelled',
    H('Basic is cancelled', 28)
    + P('Hi ' + esc(name || 'there') + ', your Basic plan is cancelled. You can keep using it until ' + esc(endDate) + '. Your history stays in My Coach.')
    + P('Thank you for training with Beast Coach.')
    + P('Stefan', 'margin-bottom:0;'));
  return { subject: 'Your Basic plan is cancelled', html, text };
}

// The client's duplicate payment: refunded, and how to sign in.
function alreadyOpen({ name, plan, existingPlan, amountCents }) {
  const site = siteUrl();
  const text = `Hi ${name || 'there'},

We have refunded your payment of ${money(amountCents)} for ${planName(plan)}. Your email already has an active ${planName(existingPlan)} plan with Beast Coach, so we did not open a second one. The refund goes back to your card and can take a few days to show.

If you are signed in already, you can see your plan at beastcoach.fit/dashboard. If you meant to change plans, reply to this email and tell us which plan you want. We will sort it out with you.

Stefan`;
  const html = layout('Your payment has been refunded',
    H('Your payment has been refunded', 28)
    + P('Hi ' + esc(name || 'there') + ', we have refunded your payment of ' + B(esc(money(amountCents))) + ' for ' + B(esc(planName(plan))) + '. Your email already has an active ' + B(esc(planName(existingPlan))) + ' plan with Beast Coach, so we did not open a second one.')
    + P('The refund goes back to your card and can take a few days to show.')
    + P('Sign in at beastcoach.fit/dashboard with this email to see your plan. If you meant to change plans, reply to this email and tell us which plan you want.')
    + button(site + '/dashboard', 'Sign in to Beast Coach')
    + P('Stefan', 'margin-top:14px;margin-bottom:0;'));
  return { subject: 'Your payment has been refunded: you already have a plan', html, text };
}

// ---------- owner alerts: plain and short, for Stefan only
function ownerBox(title, rows, extra) {
  const td = `padding:8px 0;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:15px;`;
  const trs = rows.map(([k, v]) => `<tr><td style="${td}padding-right:16px;color:${MUTED};vertical-align:top;">${esc(k)}</td><td style="${td}color:${INK};font-weight:700;word-wrap:break-word;">${esc(v)}</td></tr>`).join('');
  return H(esc(title), 26)
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${trs}</table>${extra || ''}`;
}
function ownerText(title, rows, tail) {
  return title + '\n\n' + rows.map(([k, v]) => k + ': ' + v).join('\n') + (tail ? '\n\n' + tail : '');
}
function ownerPurchase({ name, email, plan, amountCents, marketing, kind }) {
  const what = kind === 'renewal' ? 'Renewal (20% off)' : kind === 'drop_to_basic' ? 'Drop to Basic' : 'New purchase';
  const rows = [['Type', what], ['Name', name || '-'], ['Email', email], ['Plan', planName(plan)], ['Amount', money(amountCents)],
    ['Marketing emails ticked', marketing ? 'Yes' : 'No']];
  const link = siteUrl() + '/coach';
  return { subject: 'New coaching purchase: ' + planName(plan) + ', ' + (name || email),
    html: layout('New coaching purchase', ownerBox('New coaching purchase', rows, `<p style="margin:16px 0 0;font-family:${FONT};font-size:16px;">${A(link, 'Open the coach page')}</p>`)),
    text: ownerText('New coaching purchase', rows, 'Open the coach page: ' + link) };
}
function ownerDuplicate({ name, email, plan, existingPlan, amountCents }) {
  const rows = [['Email', email], ['Name', name || '-'], ['Paid for', planName(plan)], ['Already has an open plan', planName(existingPlan)],
    ['Refunded', money(amountCents) + ' (refunded automatically)']];
  return { subject: 'Duplicate payment refunded: ' + email,
    html: layout('Duplicate payment refunded', ownerBox('Duplicate payment refunded', rows)),
    text: ownerText('Duplicate payment refunded', rows, 'The client has been emailed. If they meant to change plans, reply to them.') };
}
function ownerRefund({ name, email, plan, amountCents, full, outcome }) {
  const rows = [['Email', email], ['Name', name || '-'], ['Plan', planName(plan)], ['Refunded', money(amountCents) + (full ? ' (in full)' : ' (part)')], ['What happened', outcome]];
  return { subject: (full ? 'Refund done: ' : 'Partial refund: ') + email,
    html: layout('Refund', ownerBox(full ? 'Refund done' : 'Partial refund', rows)),
    text: ownerText(full ? 'Refund done' : 'Partial refund', rows) };
}
function ownerBasicFailed({ name, email }) {
  const rows = [['Email', email], ['Name', name || '-'], ['Plan', 'Basic'], ['What happened', 'The payment failed. The client has been emailed to update their card.']];
  return { subject: 'Basic payment failed: ' + email, html: layout('Basic payment failed', ownerBox('Basic payment failed', rows)),
    text: ownerText('Basic payment failed', rows) };
}
function ownerBasicCancelled({ name, email }) {
  const rows = [['Email', email], ['Name', name || '-'], ['Plan', 'Basic'], ['What happened', 'Cancelled. The plan is finished.']];
  return { subject: 'Basic cancelled: ' + email, html: layout('Basic cancelled', ownerBox('Basic cancelled', rows)),
    text: ownerText('Basic cancelled', rows) };
}
function ownerDiscipline({ email, amountCents, date, reference }) {
  const rows = [['Buyer', email], ['Amount', money(amountCents)], ['Date', date], ['Stripe reference', reference]];
  return { subject: 'Discipline Path purchase: ' + email, html: layout('Discipline Path purchase', ownerBox('Discipline Path purchase', rows)),
    text: ownerText('Discipline Path purchase', rows) };
}

const BUILDERS = { welcome, receipt, spot_filled: spotFilled, basic_renewed: basicRenewed, basic_failed: basicFailed, basic_cancelled: basicCancelled,
  already_open: alreadyOpen, owner_purchase: ownerPurchase, owner_duplicate: ownerDuplicate, owner_refund: ownerRefund,
  owner_basic_failed: ownerBasicFailed, owner_basic_cancelled: ownerBasicCancelled, owner_discipline: ownerDiscipline };

// Sends one transactional email. kind must be one of KINDS. Returns true when Resend accepted it.
async function sendEmail(kind, to, data) {
  if (!KINDS.includes(kind)) throw new Error('not a transactional email: ' + kind);
  if (OWNER_KINDS.includes(kind)) to = OWNER;   // owner alerts never go anywhere else
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.error('RESEND_API_KEY is not set; email not sent:', kind); return false; }
  const msg = BUILDERS[kind](data || {});
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: msg.subject, html: msg.html, text: msg.text })
  });
  if (!r.ok) { console.error('Resend refused ' + kind + ': ' + r.status); return false; }
  return true;
}

// The same send, but a failure is logged and never thrown. Used where a purchase must not be affected by email.
async function sendEmailSafe(kind, to, data) {
  try { return await sendEmail(kind, to, data); }
  catch (e) { console.error('email ' + kind + ' failed: ' + e.message); return false; }
}

module.exports = { sendEmail, sendEmailSafe, KINDS, CLIENT_KINDS, OWNER_KINDS, OWNER, FROM, REPLY_TO, gstLine, _build: BUILDERS };
