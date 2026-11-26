// Static checks for the coaching links: the menu's "Work With Me" sits before Dashboard, the App Beta tile is gone,
// and the changed copy has no em or en dashes. Plain file checks; no browser needed.
// Run with: node --test tests/coaching-links.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

for (const f of ['app.html', 'beast-challenge.html']) {
  test(`${f}: the menu has Work With Me, placed before Dashboard`, () => {
    const html = read(f);
    const w = html.indexOf('href="/">Work With Me');
    const d = html.indexOf('href="/dashboard">Dashboard');
    assert.ok(w > -1, 'Work With Me links to the homepage');
    assert.ok(d > -1, 'the Dashboard link is still there');
    assert.ok(w < d, 'Work With Me comes before Dashboard');
  });
}

test('dashboard.html: App Beta is gone, and the hire tile links to /coaching with the agreed copy', () => {
  const html = read('dashboard.html');
  assert.doesNotMatch(html, /App Beta/);
  assert.match(html, /id="hireCoachTile" href="\/"/);
  assert.match(html, /Hire me as your personal coach/);
  assert.match(html, /4 options available/);
});

test('the changed pages have no em or en dashes', () => {
  for (const f of ['dashboard.html', 'app.html', 'beast-challenge.html']) {
    const html = read(f);
    const menuAndTile = html.slice(html.indexOf('Work With Me') - 100, html.indexOf('Work With Me') + 100);
    assert.doesNotMatch(menuAndTile, /[—–]/, f + ' menu');
  }
  const hire = read('dashboard.html').match(/<a class="tile coach-tile" id="hireCoachTile"[\s\S]*?<\/a>/)[0];
  assert.doesNotMatch(hire, /[—–]/, 'the hire tile copy');
});

// ---------------------------------------------------------------------------
// The homepage switch: / is the coaching sales page, /app is the app, /coaching redirects (301) to /.
// ---------------------------------------------------------------------------
const vercel = JSON.parse(read('vercel.json'));

test('/coaching and /coaching.html redirect to / permanently (301)', () => {
  const r = vercel.redirects || [];
  const hit = src => r.find(x => x.source === src);
  assert.deepEqual([hit('/coaching').destination, hit('/coaching').statusCode], ['/', 301]);
  assert.deepEqual([hit('/coaching.html').destination, hit('/coaching.html').statusCode], ['/', 301]);
});

test('the homepage (/) is the coaching sales page, with its own canonical and social tags', () => {
  const html = read('index.html');
  assert.match(html, /<title>Online coaching with Stefan \| Beast Coach<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.beastcoach\.fit\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.beastcoach\.fit\/">/);
  assert.match(html, /<meta property="og:title" content="Online coaching with Stefan \| Beast Coach">/);
  assert.match(html, /<meta name="description" content="Online coaching with Stefan/);
});

test('the app page is at /app (app.html), with its canonical, and keeps its title', () => {
  const html = read('app.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.beastcoach\.fit\/app">/);
  assert.match(html, /<title>Beast Coach — We All Have A Beast In Us<\/title>/);
  assert.match(html, /id="early-access"/, 'the early access anchor still works on /app');
});

test('old app anchors on / are sent on to /app with the anchor (the hash never reaches a server)', () => {
  const html = read('index.html');
  assert.match(html, /APP_ANCHORS = \["early-access", "features", "pricing"/);
  assert.match(html, /window\.location\.replace\("\/app#" \+ h\)/);
});

test('the homepage passes sign-in and sign-up links on to /app', () => {
  assert.match(read('index.html'), /access_token=\|refresh_token=\|type=recovery\|token_hash=\|\[\?&\]code=/);
});

test('the site menu on the homepage, the app and the shared-header pages: Work With Me, The App, then the rest', () => {
  for (const f of ['index.html', 'app.html', 'about.html', 'features.html', 'privacy.html', 'beast-challenge.html']) {
    const html = read(f);
    // the first match of each link in the page (the homepage marks its own item with aria-current)
    const at = re => { const m = re.exec(html); return m ? m.index : -1; };
    const w = at(/href="\/"[^>]*>Work With Me/), a = at(/href="\/app"[^>]*>The App/), d = at(/href="\/dashboard"[^>]*>Dashboard/);
    assert.ok(w > -1 && a > -1 && d > -1, f + ' has Work With Me, The App and Dashboard');
    assert.ok(w < a && a < d, f + ': Work With Me, then The App, then Dashboard');
  }
});

test('no page still links to /coaching or to index.html (the old homepage file)', () => {
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== 'coach.html');
  for (const f of files) {
    const html = read(f);
    assert.doesNotMatch(html, /href="\/coaching"/, f + ' links to /coaching');
    assert.doesNotMatch(html, /href="index\.html/, f + ' links to index.html');
  }
});

test('the coaching checkout returns to the homepage, not /coaching', () => {
  assert.match(read('api/coaching-checkout.js'), /cancel_url: site \+ '\/\?checkout=cancelled#plans'/);
});
