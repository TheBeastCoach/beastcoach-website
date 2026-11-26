// Search and AI metadata: JSON-LD parses, robots and sitemap match the pages, public pages are indexable,
// and no gated recipe text appears on a public page. Plain file checks, no browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PUBLIC = ['index.html', 'app.html', 'about.html', 'features.html', 'recipes.html', 'advent.html', 'challenge.html',
  'beast-challenge.html', '30-day-challenge.html', 'walking-study.html', 'calculator.html', 'terms.html', 'privacy.html',
  'privacy-policy.html', 'coaching-terms.html', 'coaching-health.html', 'coaching-privacy.html', 'discipline-path.html'];
const TEASERS = fs.readdirSync(path.join(ROOT, 'recipes')).filter(f => f.endsWith('.html')).map(f => 'recipes/' + f);
const NOT_INDEXED = ['coach.html', 'my-coach.html', 'dashboard.html', 'coaching-demo.html'];

test('every public page and recipe teaser has JSON-LD that parses, with Organization and WebSite', () => {
  for (const f of [...PUBLIC, ...TEASERS]) {
    const html = read(f);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length >= 1, f + ' has JSON-LD');
    const types = blocks.flatMap(b => JSON.parse(b[1])['@graph'].map(n => n['@type']));
    assert.ok(types.includes('Organization') && types.includes('WebSite'), f + ' has Organization and WebSite');
  }
});

test('the homepage has Person, Service with four AUD offers, and a FAQPage matching its visible questions', () => {
  const html = read('index.html');
  const graph = JSON.parse([...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)][0][1])['@graph'];
  const person = graph.find(n => n['@type'] === 'Person');
  assert.equal(person.name, 'Stefan Botha');
  assert.equal(person.jobTitle, 'Online coach and founder of Beast Coach');
  const service = graph.find(n => n['@type'] === 'Service');
  assert.deepEqual(service.offers.map(o => o.name), ['Basic', 'Essential', 'Core', 'The Beast']);
  assert.ok(service.offers.every(o => o.priceCurrency === 'AUD'));
  const faq = graph.find(n => n['@type'] === 'FAQPage');
  const visible = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  assert.deepEqual(faq.mainEntity.map(q => q.name), visible);
});

test('robots.txt allows all crawlers and blocks the logged-in paths, and points at the sitemap', () => {
  const txt = read('robots.txt');
  for (const bot of ['*', 'Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'ClaudeBot', 'Claude-Web', 'PerplexityBot', 'Google-Extended']) {
    assert.match(txt, new RegExp('User-agent: ' + bot.replace(/[*-]/g, m => '\\' + m) + '\\nAllow: /'), bot + ' is allowed');
  }
  for (const p of ['/coach$', '/my-coach', '/dashboard', '/coaching-demo', '/api/']) assert.ok(txt.includes('Disallow: ' + p), p);
  assert.match(txt, /Sitemap: https:\/\/www\.beastcoach\.fit\/sitemap\.xml/);
});

test('the sitemap lists only real public pages, with lastmod, and no logged-in page', () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.length >= 40, 'every public page and teaser is listed');
  assert.equal([...xml.matchAll(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)].length, locs.length, 'every URL has a lastmod');
  for (const loc of locs) {
    const p = loc.replace('https://www.beastcoach.fit', '').replace(/^\//, '');
    const file = p === '' ? 'index.html' : (fs.existsSync(path.join(ROOT, p + '.html')) ? p + '.html' : null);
    assert.ok(file, loc + ' maps to a page');
    assert.doesNotMatch(read(file), /<meta name="robots" content="noindex/, loc + ' is indexable');
  }
  assert.ok(locs.includes('https://www.beastcoach.fit/changes'), '/changes is in the sitemap now it is published');
  for (const hidden of ['/coach', '/my-coach', '/dashboard', '/coaching-demo', '/program', '/program-classic']) {
    assert.ok(!locs.includes('https://www.beastcoach.fit' + hidden), hidden + ' is not in the sitemap');
  }
});

test('logged-in pages are noindex', () => {
  for (const f of NOT_INDEXED) assert.match(read(f), /<meta name="robots" content="noindex/, f);
});

test('every public page has a unique title and a meta description', () => {
  const titles = new Set();
  for (const f of [...PUBLIC, ...TEASERS]) {
    const html = read(f);
    const t = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
    assert.ok(t && t.trim().length > 5, f + ' has a title');
    assert.ok(!titles.has(t), f + ' title is unique: ' + t);
    titles.add(t);
    assert.match(html, /<meta name="description" content="[^"]{20,}"/, f + ' has a description');
  }
});

test('no gated recipe ingredient or method text appears on a public page', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(read('recipes.js') + ';this.RECIPES = RECIPES;', sandbox);
  const publicText = [...PUBLIC, ...TEASERS].map(read).join('\n');
  for (const r of sandbox.RECIPES) {
    for (const key of ['ingredients', 'instructions']) {
      for (const item of (r[key] || [])) {
        const text = typeof item === 'string' ? item : (item && (item.text || item.name || item.step)) || '';
        if (text.length > 12) assert.ok(!publicText.includes(text), r.id + ' ' + key + ' text is not public: ' + text.slice(0, 40));
      }
    }
  }
});
