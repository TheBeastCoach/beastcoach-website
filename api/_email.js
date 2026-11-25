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

// GST wording. Not registered: "No GST has been charged." Registered: a tax invoice, with GST included (1/11) and the ABN.
function gstLine(settings, cents) {
  if (!settings || !settings.gst_registered) return { text: 'No GST has been charged.', tax: false };
  const gst = Math.round(cents / 11);
  return { text: 'Tax invoice. The total includes GST of ' + money(gst) + ' (1/11 of the price). ABN ' + (settings.abn || 'not set') + '.', tax: true };
}

// Shared layout: the site's colours, one column, plain text version kept alongside.
function layout(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title></head>
<body style="margin:0;background:#F4F7F2;font-family:Manrope,Arial,sans-serif;color:#1B3022;">
<div style="max-width:560px;margin:0 auto;padding:24px 20px;">
<div style="font-weight:800;letter-spacing:.06em;font-size:18px;margin-bottom:18px;">BEAST<span style="color:#2D6A4F">COACH</span></div>
<div style="background:#ffffff;border:1px solid #D5E0D8;border-radius:18px;padding:24px;">
${bodyHtml}
</div>
<p style="font-size:13px;color:#4c6354;margin:16px 0 0;">Beast Coach. Questions? Reply to this email.</p>
</div></body></html>`;
}
function button(href, label) {
  return `<p style="margin:20px 0 0;"><a href="${esc(href)}" style="display:inline-block;background:#F59E0B;color:#1B1200;font-weight:800;text-decoration:none;padding:13px 20px;border-radius:14px;">${esc(label)}</a></p>`;
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
  const html = layout('Welcome to Beast Coach', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:36px;margin:0 0 8px;">Welcome, ${first}</h1>
<p style="margin:0 0 14px;">Thanks for joining <b>${esc(planName(plan))}</b>. Here is what happens next:</p>
<ol style="padding-left:20px;margin:0 0 6px;">
<li style="margin-bottom:8px;">Sign in or create your account at <a href="${esc(site)}/dashboard" style="color:#2D6A4F;">beastcoach.fit/dashboard</a> with <b>this email address</b>. Use exactly this email, so your plan is linked to you.</li>
<li style="margin-bottom:8px;">Open My Coach and answer the onboarding questions. Stefan uses them to build your plan.</li>
<li style="margin-bottom:8px;">Stefan builds your plan and sets your start date. Logging opens when your plan is active.</li>
</ol>
${button(site + '/dashboard', 'Sign in to Beast Coach')}
<p style="margin:18px 0 0;">Reply to this email if you have a question.</p>
<p style="margin:12px 0 0;">Stefan</p>`);
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
  const html = layout('Your receipt', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:30px;margin:0 0 12px;">Your receipt</h1>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;">
<tr><td style="padding:8px 0;border-bottom:1px solid #EEF3EF;color:#4c6354;">Plan</td><td style="padding:8px 0;border-bottom:1px solid #EEF3EF;text-align:right;"><b>${esc(planName(plan))}</b></td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #EEF3EF;color:#4c6354;">Amount</td><td style="padding:8px 0;border-bottom:1px solid #EEF3EF;text-align:right;"><b>${esc(money(amountCents))}</b></td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #EEF3EF;color:#4c6354;">Date</td><td style="padding:8px 0;border-bottom:1px solid #EEF3EF;text-align:right;">${esc(date)}</td></tr>
</table>
<p style="margin:14px 0 0;font-size:14px;color:#3B4F43;">${esc(what)}.</p>
<p style="margin:10px 0 0;font-size:14px;color:#3B4F43;">${esc(gst.text)}</p>
<p style="margin:12px 0 0;font-size:13px;color:#4c6354;">Hi ${esc(name || 'there')}, keep this for your records.</p>`);
  return { subject: 'Your Beast Coach receipt', html, text };
}

function spotFilled({ name, plan, amountCents }) {
  const text = `Hi ${name || 'there'},

Thank you for trying to join ${planName(plan)}. Sorry: that plan filled up in the moment between you paying and us confirming your place, so we have refunded your payment of ${money(amountCents)} in full. The refund goes back to your card and can take a few days to show.

If you would like another plan, or to be told when a place opens, reply to this email and we will sort it out.

Stefan`;
  const html = layout('Sorry, that plan just filled', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:30px;margin:0 0 12px;">Sorry, that plan just filled</h1>
<p style="margin:0 0 12px;">Hi ${esc(name || 'there')}, thank you for trying to join <b>${esc(planName(plan))}</b>. The plan filled up in the moment between your payment and our confirmation.</p>
<p style="margin:0 0 12px;">We have refunded your payment of <b>${esc(money(amountCents))}</b> in full. It goes back to your card and can take a few days to show.</p>
<p style="margin:0 0 12px;">If you would like another plan, or to be told when a place opens, reply to this email.</p>
<p style="margin:12px 0 0;">Stefan</p>`);
  return { subject: 'Sorry, that plan just filled: your payment is refunded', html, text };
}

function basicRenewed({ name, amountCents, date, settings, endDate }) {
  const gst = gstLine(settings, amountCents);
  const text = `Hi ${name || 'there'},

Your Basic plan has renewed. We took ${money(amountCents)} on ${date}. Your plan now runs to ${endDate}.

${gst.text}

Manage or cancel any time from My Coach, Settings.

Stefan`;
  const html = layout('Basic renewed', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:30px;margin:0 0 12px;">Basic has renewed</h1>
<p style="margin:0 0 12px;">Hi ${esc(name || 'there')}, we took <b>${esc(money(amountCents))}</b> on ${esc(date)}. Your plan now runs to ${esc(endDate)}.</p>
<p style="margin:0 0 12px;font-size:14px;color:#3B4F43;">${esc(gst.text)}</p>
<p style="margin:0 0 12px;">You can manage or cancel any time from My Coach, Settings.</p>
${button(siteUrl() + '/my-coach', 'Open My Coach')}`);
  return { subject: 'Your Basic plan has renewed', html, text };
}

function basicFailed({ name }) {
  const text = `Hi ${name || 'there'},

We could not take the latest payment for your Basic plan. Please update your card so your plan keeps running.

Update it from My Coach, Settings: ${siteUrl()}/my-coach

If you have already fixed it, you can ignore this email.

Stefan`;
  const html = layout('Please update your card', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:30px;margin:0 0 12px;">Please update your card</h1>
<p style="margin:0 0 12px;">Hi ${esc(name || 'there')}, we could not take the latest payment for your Basic plan. Please update your card so your plan keeps running.</p>
${button(siteUrl() + '/my-coach', 'Update my card')}
<p style="margin:14px 0 0;font-size:13px;color:#4c6354;">If you have already fixed it, you can ignore this email.</p>`);
  return { subject: 'Please update your card for Basic', html, text };
}

function basicCancelled({ name, endDate }) {
  const text = `Hi ${name || 'there'},

Your Basic plan is cancelled. You can keep using it until ${endDate}. Your history stays in My Coach.

Thank you for training with Beast Coach. If you change your mind, you can start Basic again from the Work With Me page.

Stefan`;
  const html = layout('Basic is cancelled', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:30px;margin:0 0 12px;">Basic is cancelled</h1>
<p style="margin:0 0 12px;">Hi ${esc(name || 'there')}, your Basic plan is cancelled. You can keep using it until ${esc(endDate)}. Your history stays in My Coach.</p>
<p style="margin:0 0 12px;">Thank you for training with Beast Coach.</p>
<p style="margin:12px 0 0;">Stefan</p>`);
  return { subject: 'Your Basic plan is cancelled', html, text };
}

// The client's duplicate payment: refunded, and how to sign in.
function alreadyOpen({ name, plan, existingPlan, amountCents }) {
  const site = siteUrl();
  const text = `Hi ${name || 'there'},

We have refunded your payment of ${money(amountCents)} for ${planName(plan)}. Your email already has an active ${planName(existingPlan)} plan with Beast Coach, so we did not open a second one. The refund goes back to your card and can take a few days to show.

If you are signed in already, you can see your plan at beastcoach.fit/dashboard. If you meant to change plans, reply to this email and tell us which plan you want. We will sort it out with you.

Stefan`;
  const html = layout('Your payment has been refunded', `
<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:30px;margin:0 0 12px;">Your payment has been refunded</h1>
<p style="margin:0 0 12px;">Hi ${esc(name || 'there')}, we have refunded your payment of <b>${esc(money(amountCents))}</b> for <b>${esc(planName(plan))}</b>. Your email already has an active <b>${esc(planName(existingPlan))}</b> plan with Beast Coach, so we did not open a second one.</p>
<p style="margin:0 0 12px;">The refund goes back to your card and can take a few days to show.</p>
<p style="margin:0 0 12px;">Sign in at beastcoach.fit/dashboard with this email to see your plan. If you meant to change plans, reply to this email and tell us which plan you want.</p>
${button(site + '/dashboard', 'Sign in to Beast Coach')}
<p style="margin:12px 0 0;">Stefan</p>`);
  return { subject: 'Your payment has been refunded: you already have a plan', html, text };
}

// ---------- owner alerts: plain and short, for Stefan only
function ownerBox(title, rows, extra) {
  const trs = rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#4c6354;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;"><b>${esc(v)}</b></td></tr>`).join('');
  return `<h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:28px;margin:0 0 10px;">${esc(title)}</h1>
<table role="presentation" style="border-collapse:collapse;font-size:15px;">${trs}</table>${extra || ''}`;
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
    html: layout('New coaching purchase', ownerBox('New coaching purchase', rows, `<p style="margin:14px 0 0;"><a href="${esc(link)}" style="color:#2D6A4F;">Open the coach page</a></p>`)),
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
