// Brand checks for the homepage (index.html) and brand.css: contrast of the text and display colour pairs,
// and that the page uses only the brand fonts. Pure file reads, no browser.
// Run with: node --test tests/brand.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'brand.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function token(name) {
  const m = new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})\\s*;').exec(css);
  assert.ok(m, 'brand.css defines --' + name + ' as a 6-digit hex colour');
  return m[1];
}

function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ground = token('ground');
const groundAlt = token('ground-alt');
const surface = token('surface');
const surfaceRaised = token('surface-raised');

test('body and small text reach 4.5:1 on every background they sit on', () => {
  const textPairs = [
    ['ink', ground], ['ink', surface], ['ink', surfaceRaised], ['ink', groundAlt],
    ['ink-soft', ground], ['ink-soft', surface], ['ink-soft', groundAlt],
    ['muted', ground], ['muted', surface], ['muted', surfaceRaised], ['muted', groundAlt],
    ['lime', ground], ['lime', surface], ['lime', groundAlt],
    ['amber', ground], ['amber', surface], ['amber', surfaceRaised],
    ['orange', ground], ['orange', surface]
  ];
  for (const [fg, bg] of textPairs) {
    const ratio = contrast(token(fg), bg);
    assert.ok(ratio >= 4.5, '--' + fg + ' on ' + bg + ' is ' + ratio.toFixed(2) + ':1, needs 4.5:1');
  }
});

test('button labels reach 4.5:1 on the lime and orange buttons', () => {
  const onAccent = token('on-accent');
  assert.ok(contrast(onAccent, token('lime')) >= 4.5, 'lime button label');
  assert.ok(contrast(onAccent, token('orange')) >= 4.5, 'orange button label');
  assert.ok(contrast(onAccent, token('amber')) >= 4.5, 'amber button label');
});

test('display headings and big numbers reach 3:1 on the background', () => {
  const displayPairs = [['ink', ground], ['ink', groundAlt], ['ink', surface], ['lime', ground], ['amber', ground], ['orange', ground]];
  for (const [fg, bg] of displayPairs) {
    const ratio = contrast(token(fg), bg);
    assert.ok(ratio >= 3, '--' + fg + ' on ' + bg + ' is ' + ratio.toFixed(2) + ':1, display needs 3:1');
  }
  // The gradient runs from lime through amber to orange; each stop is a display colour.
  for (const stop of ['lime', 'amber', 'orange']) {
    assert.ok(contrast(token(stop), ground) >= 3, 'gradient stop ' + stop);
  }
});

test('homepage loads the brand fonts and no longer uses Bebas Neue or Manrope', () => {
  assert.doesNotMatch(html, /Bebas/i, 'Bebas Neue is removed from the homepage');
  assert.doesNotMatch(html, /Manrope/i, 'Manrope is removed from the homepage');
  assert.match(html, /family=Big\+Shoulders\+Display:wght@700;800;900/, 'Big Shoulders Display 700, 800, 900 loaded');
  assert.match(html, /family=Hanken\+Grotesk:wght@400;500;600;700/, 'Hanken Grotesk 400, 500, 600, 700 loaded');
  assert.match(html, /<link rel="stylesheet" href="\/brand\.css"/, 'homepage links brand.css');
});
