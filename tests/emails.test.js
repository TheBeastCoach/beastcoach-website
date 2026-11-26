// Tests for the transactional email templates (api/_email.js): every template renders an HTML and a plain text
// body in the brand (docs/BRAND.md), with the hosted logo, no dashes in visible text and no old fonts or colours.
// No network, no keys. Run with: node --test tests/emails.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const email = require(path.join(ROOT, 'api', '_email.js'));

const LOGO = 'https://www.beastcoach.fit/beastcoach-email-logo.png';
const LIME = '#C6F432';
const OLD = [/Bebas Neue/i, /Manrope/i, /#1B3022/i, /#F59E0B/i, /#C5D3C8/i];

// Sample data for every kind. Templates that take no button or no owner field ignore the extras.
const SAMPLE = {
  welcome: { name: 'Sam Lee', plan: 'core' },
  receipt: { name: 'Sam Lee', plan: 'core', amountCents: 29900, date: '1 December 2026', settings: { gst_registered: false }, subscription: false },
  spot_filled: { name: 'Sam Lee', plan: 'core', amountCents: 29900 },
  basic_renewed: { name: 'Sam Lee', amountCents: 3000, date: '1 December 2026', settings: { gst_registered: true, abn: '12345678901' }, endDate: '1 March 2027' },
  basic_failed: { name: 'Sam Lee' },
  basic_cancelled: { name: 'Sam Lee', endDate: '1 March 2027' },
  already_open: { name: 'Sam Lee', plan: 'core', existingPlan: 'essential', amountCents: 29900 },
  owner_purchase: { name: 'Sam Lee', email: 'sam@example.com', plan: 'core', amountCents: 29900, marketing: true, kind: 'new' },
  owner_duplicate: { name: 'Sam Lee', email: 'sam@example.com', plan: 'core', existingPlan: 'essential', amountCents: 29900 },
  owner_refund: { name: 'Sam Lee', email: 'sam@example.com', plan: 'core', amountCents: 29900, full: true, outcome: 'Refunded after a duplicate checkout.' },
  owner_basic_failed: { name: 'Sam Lee', email: 'sam@example.com' },
  owner_basic_cancelled: { name: 'Sam Lee', email: 'sam@example.com' },
  owner_discipline: { email: 'sam@example.com', amountCents: 9900, date: '1 December 2026', reference: 'pi_test_123' }
};
// Templates with a primary (lime) button. Owner alerts use a plain link instead.
const WITH_BUTTON = ['welcome', 'basic_renewed', 'basic_failed', 'already_open'];

// Visible text: the HTML with tags, style and script blocks removed.
function visibleText(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function buildFor(kind) {
  assert.ok(email._build[kind], kind + ' has a builder');
  return email._build[kind](SAMPLE[kind]);
}

for (const kind of email.KINDS) {
  test(`${kind}: subject, HTML and plain text bodies exist`, () => {
    const msg = buildFor(kind);
    assert.ok(typeof msg.subject === 'string' && msg.subject.length > 0, 'subject');
    assert.ok(typeof msg.html === 'string' && msg.html.startsWith('<!DOCTYPE html>'), 'html body');
    assert.ok(typeof msg.text === 'string' && msg.text.length > 0, 'plain text body');
  });

  test(`${kind}: HTML has no script, no style block, no external stylesheet`, () => {
    const { html } = buildFor(kind);
    assert.doesNotMatch(html, /<script/i, 'no script');
    assert.doesNotMatch(html, /<style/i, 'no style block');
    assert.doesNotMatch(html, /<link\b/i, 'no external stylesheet link');
    assert.doesNotMatch(html, /@import/i, 'no @import');
  });

  test(`${kind}: no em or en dash in the visible text or the plain text`, () => {
    const msg = buildFor(kind);
    assert.doesNotMatch(visibleText(msg.html), /[–—]|&mdash;|&ndash;/, 'html has no dash');
    assert.doesNotMatch(msg.text, /[–—]/, 'plain text has no dash');
  });

  test(`${kind}: the logo is the hosted PNG at beastcoach.fit`, () => {
    const { html } = buildFor(kind);
    assert.ok(html.includes(`src="${LOGO}"`), 'logo image URL');
    assert.doesNotMatch(html, /<svg/i, 'no inline SVG logo');
  });

  test(`${kind}: no Bebas Neue, Manrope or old colours`, () => {
    const msg = buildFor(kind);
    for (const re of OLD) assert.doesNotMatch(msg.html, re, 'old font or colour ' + re);
  });

  if (WITH_BUTTON.includes(kind)) {
    test(`${kind}: has a lime pill button`, () => {
      const { html } = buildFor(kind);
      const anchors = html.match(/<a [^>]*background:#C6F432[^>]*>[^<]+<\/a>/g) || [];
      assert.ok(anchors.length >= 1, 'a lime anchor');
      assert.match(anchors[0], /border-radius:999px/, 'pill radius');
      assert.match(anchors[0], /color:#0B0C0A/, 'dark text on lime');
    });
  }
}

test('logo PNG: in the repo root, 200px square, under 30KB', () => {
  const file = path.join(ROOT, 'beastcoach-email-logo.png');
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(16), 200, 'width');
  assert.equal(buf.readUInt32BE(20), 200, 'height');
  assert.ok(buf.length < 30 * 1024, 'under 30KB, got ' + buf.length);
});
