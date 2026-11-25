// Checks the three agreement pages linked from the coaching onboarding:
// /coaching-terms, /coaching-health and /coaching-privacy. Plain file checks, no browser needed.
// Run with: node --test tests/coaching-legal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const text = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const PAGES = ['coaching-terms.html', 'coaching-health.html', 'coaching-privacy.html'];

for (const f of PAGES) {
  test(`${f}: indexable, no draft wording, and no em dashes`, () => {
    const html = read(f);
    assert.doesNotMatch(html, /<meta name="robots" content="noindex/, 'no noindex tag');
    assert.doesNotMatch(html, /draft|DRAFT|not yet reviewed/i, 'no draft wording');
    assert.doesNotMatch(html, /\u2014|\u2013/, 'no em or en dashes');
    assert.match(html, /href="\/coaching"/, 'link back to the sales page');
  });
}

test('coaching-terms.html: refunds keep the policy and say nothing takes away Consumer Law rights', () => {
  const t = text(read('coaching-terms.html'));
  assert.match(t, /You get a full refund if you ask before your plan starts\./);
  assert.match(t, /Once your plan has been delivered, we do not give refunds for it, except where the Australian Consumer Law gives you a right to one\./);
  assert.match(t, /Nothing in these terms limits your rights under the Australian Consumer Law\./);
  assert.doesNotMatch(t, /There are no refunds/i, 'the absolute wording is gone');
});

test('coaching-terms.html: plans, prices, billing, refunds, pausing, WhatsApp hours, renewal and Basic after 12 weeks', () => {
  const t = text(read('coaching-terms.html'));
  assert.match(t, /\$2\.50 a week, billed as \$30 every 12 weeks/);
  assert.match(t, /\$110 for 12 weeks, paid up front/);
  assert.match(t, /\$299 for 12 weeks, paid up front/);
  assert.match(t, /\$699 for 12 weeks, paid up front/);
  assert.match(t, /full refund if you ask before your plan starts/);
  assert.match(t, /we do not give refunds for it, except where the Australian Consumer Law gives you a right to one/);
  assert.match(t, /Core and The Beast can be paused for up to 2 weeks/);
  assert.match(t, /reply within 2 hours during Australian business hours, Melbourne time/);
  assert.match(t, /renew at 20% off/);
  assert.match(t, /drop to Basic for \$30 every 12 weeks/);
});

test('coaching-health.html: a coach, not a dietitian, nutritionist or doctor; general guidance; see a doctor first', () => {
  const t = text(read('coaching-health.html'));
  assert.match(t, /Stefan is a coach\. He is not a dietitian, a nutritionist or a doctor\./);
  assert.match(t, /general guidance/);
  assert.match(t, /not medical advice/);
  assert.match(t, /See a doctor first if/);
  assert.match(t, /You take medication/);
});

test('coaching-privacy.html: what is collected, who sees it, AI providers, export or delete, and what is kept after deletion', () => {
  const t = text(read('coaching-privacy.html'));
  assert.match(t, /onboarding answers/);
  assert.match(t, /meals, steps, workouts and weigh-ins/);
  assert.match(t, /Stefan can see your onboarding answers and your logs/);
  assert.match(t, /nobody at Beast Coach can see your meals, steps, workouts or weigh-ins/);
  assert.match(t, /meal text and meal photos you send to Beast AI are sent to an AI provider/);
  assert.match(t, /Export or delete your data/);
  assert.match(t, /customer record/);
  assert.match(t, /name, email, what you bought and when, and your email choices/);
  assert.match(t, /tax records/);
});

test('the coaching onboarding links each agreement to its page, and the link opens in a new tab', () => {
  const html = read('coaching-demo.html');
  // The links are built by docLink(), so check the helper opens a new tab and each agreement uses it.
  assert.match(html, /function docLink\(href, label\) \{ return `<a href="\$\{href\}" target="_blank" rel="noopener">\$\{label\}<\/a>`; \}/, 'docLink opens a new tab');
  for (const p of ['/coaching-terms', '/coaching-health', '/coaching-privacy']) {
    assert.ok(html.includes(`docLink('${p}'`), 'an agreement links to ' + p);
  }
  assert.ok(html.includes("obAgree(ob, 'agreeTerms'"), 'terms agreement');
  assert.ok(html.includes("obAgree(ob, 'agreeNotCoach'"), 'not-a-coach agreement');
  assert.ok(html.includes("obAgree(ob, 'agreeConsent'"), 'consent agreement');
});

test('coaching.html: every price is written in Australian dollars, with the AUD note near the plans', () => {
  const html = read('coaching.html');
  const t = text(html);
  assert.match(t, /Prices in Australian dollars\. Your bank converts at checkout\./);
  // A dollar amount must be followed by AUD (no bare prices), except the cents-free note "normally $37 AUD".
  const bare = [...t.matchAll(/\$\d+(?:\.\d+)?(?![\d.])(?! AUD)/g)].map(m => m[0] + ' @ ' + t.slice(Math.max(0, m.index - 30), m.index + 12));
  assert.deepEqual(bare, [], 'bare prices: ' + bare.join(' | '));
  assert.match(t, /\$299 AUD for 12 weeks/);
  assert.match(t, /\$2\.50 AUD a week/);
  assert.match(t, /\$30 AUD billed every 12 weeks/);
});

test('The Beast: WhatsApp reply hours in Melbourne time, and overseas video calls are booked to suit both zones (sales page and terms)', () => {
  const sales = text(read('coaching.html'));
  const terms = text(read('coaching-terms.html'));
  assert.match(sales, /Replies within 2 hours during Australian business hours, Melbourne time/);
  assert.match(sales, /Overseas\? Video calls are booked at a time that suits both time zones/);
  assert.match(terms, /reply within 2 hours during Australian business hours, Melbourne time/);
  assert.match(terms, /If you are overseas, video calls are booked at a time that suits both your time zone and ours\./);
});
