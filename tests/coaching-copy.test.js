// Copy and asset checks for the coaching pages. Plain file checks, no browser needed.
// Run with: node --test tests/coaching-copy.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const COPY_FILES = ['index.html', 'coaching-demo.html', 'coaching-terms.html', 'coaching-health.html', 'coaching-privacy.html', 'docs/COACHING-DEMO.md'];
const SCREENS = ['today', 'add-meal', 'meal-builder', 'my-plan', 'progress', 'workout'];

for (const f of COPY_FILES) {
  test(`${f}: no week 6 refresh, no mid-point review and no em dashes`, () => {
    const t = read(f);
    assert.doesNotMatch(t, /week 6|week six|Week 6|plan refresh|mid-point|midpoint review|second plan/i, 'no Essential week-6 refresh');
    assert.doesNotMatch(t, /—|–/, 'no em or en dashes');
  });
}

test('the feature is called Meal Builder everywhere (no "Beast AI Meal Builder", no "Meal Log")', () => {
  for (const f of ['index.html', 'coaching-demo.html', 'docs/COACHING-DEMO.md']) {
    const t = read(f);
    assert.doesNotMatch(t, /Beast AI Meal Builder/, f);
    assert.doesNotMatch(t, /Meal Log\b/, f);
  }
});

test('the sales page shows the six portal screens, each under 200KB, with width and height set', () => {
  const html = read('index.html');
  for (const name of SCREENS) {
    const file = path.join(ROOT, 'coach-img', 'portal', name + '.jpg');
    assert.ok(fs.existsSync(file), name + '.jpg exists');
    assert.ok(fs.statSync(file).size < 200 * 1024, name + '.jpg is under 200KB');
    assert.ok(html.includes(`src="/coach-img/portal/${name}.jpg" width="390" height="844" loading="lazy"`), name + ' is lazy-loaded with its size');
  }
  assert.ok(html.includes('Inside your coaching portal'), 'section heading');
  for (const cap of ['See today at a glance', 'Log a meal in seconds', "Build meals from what's in your fridge", 'Your plan, day by day', 'Track your progress weekly', 'Log every set and rep']) {
    assert.ok(html.includes(cap), 'caption: ' + cap);
  }
});

test('the old Beast AI screenshots are gone from the site and the sales page', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'coach-img', 'ai-meal-builder.jpg')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'coach-img', 'ai-meal-log.jpg')), false);
  assert.doesNotMatch(read('index.html'), /ai-meal-(builder|log)\.jpg/);
});

test('the capture script and the package.json script are in place', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'capture-portal.js')));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.screenshots, 'node scripts/capture-portal.js');
  assert.ok(pkg.devDependencies['playwright-core'], 'playwright-core is a dev dependency');
});
