// Checks the three draft agreement pages linked from the coaching onboarding:
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
  test(`${f}: noindex, the draft banner at the top, and no em dashes`, () => {
    const html = read(f);
    assert.match(html, /<meta name="robots" content="noindex/, 'noindex');
    assert.match(html, /DRAFT: not yet reviewed\. Do not rely on this yet\./, 'draft banner text');
    assert.ok(html.indexOf('DRAFT: not yet reviewed') < html.indexOf('<h1>'), 'the banner sits above the heading');
    assert.doesNotMatch(html, /—|–/, 'no em or en dashes');
    assert.match(html, /href="\/coaching"/, 'link back to the sales page');
  });
}

test('coaching-terms.html: plans, prices, billing, refunds, pausing, WhatsApp hours, renewal and Basic after 12 weeks', () => {
  const t = text(read('coaching-terms.html'));
  assert.match(t, /\$2\.50 a week, billed as \$30 every 12 weeks/);
  assert.match(t, /\$110 for 12 weeks, paid up front/);
  assert.match(t, /\$299 for 12 weeks, paid up front/);
  assert.match(t, /\$699 for 12 weeks, paid up front/);
  assert.match(t, /full refund if you ask before your plan starts/);
  assert.match(t, /no refunds once your plan has been delivered/);
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
