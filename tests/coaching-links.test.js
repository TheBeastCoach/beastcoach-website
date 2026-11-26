// Static checks for the coaching links: the menu's "Work With Me" sits before Dashboard, the App Beta tile is gone,
// and the changed copy has no em or en dashes. Plain file checks; no browser needed.
// Run with: node --test tests/coaching-links.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

for (const f of ['index.html', 'beast-challenge.html']) {
  test(`${f}: the menu has Work With Me, placed before Dashboard`, () => {
    const html = read(f);
    const w = html.indexOf('href="/coaching">Work With Me');
    const d = html.indexOf('href="/dashboard">Dashboard');
    assert.ok(w > -1, 'Work With Me links to /coaching');
    assert.ok(d > -1, 'the Dashboard link is still there');
    assert.ok(w < d, 'Work With Me comes before Dashboard');
  });
}

test('dashboard.html: App Beta is gone, and the hire tile links to /coaching with the agreed copy', () => {
  const html = read('dashboard.html');
  assert.doesNotMatch(html, /App Beta/);
  assert.match(html, /id="hireCoachTile" href="\/coaching"/);
  assert.match(html, /Hire me as your personal coach/);
  assert.match(html, /4 options available/);
});

test('the changed pages have no em or en dashes', () => {
  for (const f of ['dashboard.html', 'index.html', 'beast-challenge.html']) {
    const html = read(f);
    const menuAndTile = html.slice(html.indexOf('Work With Me') - 100, html.indexOf('Work With Me') + 100);
    assert.doesNotMatch(menuAndTile, /[—–]/, f + ' menu');
  }
  const hire = read('dashboard.html').match(/<a class="tile coach-tile" id="hireCoachTile"[\s\S]*?<\/a>/)[0];
  assert.doesNotMatch(hire, /[—–]/, 'the hire tile copy');
});
