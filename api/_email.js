// Transactional email for the coaching portal, sent with Resend (RESEND_API_KEY).
// This file sends ONLY the six transactional messages below. It has no marketing messages, and no function here
// takes a template name from a request. Marketing email is a separate matter, sent only from the consent list.
const { money, siteUrl, PLANS } = require('./_coaching.js');

const FROM = 'Stefan at Beast Coach <stefan@beastcoach.fit>';
const REPLY_TO = 'stefan@stefanbotha.com';
const KINDS = ['welcome', 'receipt', 'spot_filled', 'basic_renewed', 'basic_failed', 'basic_cancelled'];

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

const BUILDERS = { welcome, receipt, spot_filled: spotFilled, basic_renewed: basicRenewed, basic_failed: basicFailed, basic_cancelled: basicCancelled };

// Sends one transactional email. kind must be one of KINDS. Returns true when Resend accepted it.
async function sendEmail(kind, to, data) {
  if (!KINDS.includes(kind)) throw new Error('not a transactional email: ' + kind);
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

module.exports = { sendEmail, KINDS, FROM, REPLY_TO, gstLine, _build: BUILDERS };
