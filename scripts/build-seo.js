// Builds the search and AI metadata for the public site:
//  - JSON-LD in <head> of every public page (Organization and WebSite everywhere; Person, Service and
//    FAQPage on the homepage, where the FAQ is the visible one on the page).
//  - The one-line founder bio in the footer of every public page that uses the shared footer.
//  - sitemap.xml for every public page and recipe teaser page.
// Run from the repo root: node scripts/build-seo.js   (safe to re-run; it replaces its own blocks)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SITE = 'https://www.beastcoach.fit';
const TODAY = '2026-11-27';
const IG = 'https://www.instagram.com/stefanhealth_/';
const LI = 'https://www.linkedin.com/in/stefan-botha/';
const TT = 'https://www.tiktok.com/@beast_health_app';
const BIO = 'Stefan Botha, founder of Beast Coach, is based in Melbourne. He lost 70kg, reached his goal in March 2026, and has kept it off since.';

// Public pages: file, URL path, and whether they are in the sitemap. Logged-in and course pages are not listed.
const PUBLIC = ['index', 'app', 'about', 'features', 'recipes', 'advent', 'challenge', 'beast-challenge', '30-day-challenge',
  'walking-study', 'calculator', 'terms', 'privacy', 'privacy-policy', 'coaching-terms', 'coaching-health', 'coaching-privacy', 'discipline-path'];
const SKIP_SITEMAP = ['coach', 'my-coach', 'dashboard', 'coaching-demo', 'program', 'program-classic'];

const ORG_ID = SITE + '/#organization';
const orgGraph = [
  { '@type': 'Organization', '@id': ORG_ID, name: 'Beast Coach', url: SITE + '/', logo: SITE + '/beastcoach-email-logo.png',
    founder: { '@type': 'Person', name: 'Stefan Botha' }, sameAs: [IG, LI, TT] },
  { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: 'Beast Coach', publisher: { '@id': ORG_ID } },
];
const personNode = { '@type': 'Person', '@id': SITE + '/#stefan', name: 'Stefan Botha', jobTitle: 'Online coach and founder of Beast Coach',
  description: 'Stefan Botha is the founder of Beast Coach, based in Melbourne, Australia. He has 24 years in product development. He lost 70kg, reached his goal in March 2026, and has kept it off since. He builds free tools people use and improves them from user feedback.',
  sameAs: [IG, LI, TT], knowsAbout: ['weight loss', 'nutrition', 'high-protein recipes', 'product development'],
  address: { '@type': 'PostalAddress', addressLocality: 'Melbourne', addressCountry: 'AU' }, worksFor: { '@id': ORG_ID } };
const serviceNode = { '@type': 'Service', name: 'Online 1:1 coaching', serviceType: 'Online coaching', provider: { '@id': ORG_ID }, url: SITE + '/',
  areaServed: 'Online', offers: [
    { '@type': 'Offer', name: 'Basic', price: '30', priceCurrency: 'AUD', description: '$2.50 AUD a week, billed as $30 AUD every 12 weeks. Self-guided.' },
    { '@type': 'Offer', name: 'Essential', price: '110', priceCurrency: 'AUD', description: '12 weeks of online coaching.' },
    { '@type': 'Offer', name: 'Core', price: '299', priceCurrency: 'AUD', description: '12 weeks of online coaching.' },
    { '@type': 'Offer', name: 'The Beast', price: '699', priceCurrency: 'AUD', description: '12 weeks of online coaching.' },
  ].map(o => Object.assign(o, { url: SITE + '/' })) };

function visibleFaq(html) {
  const out = [];
  const re = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(html))) {
    const q = clean(m[1]), a = clean(m[2]);
    if (q && a) out.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
  }
  return out;
}
function clean(h) {
  return h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function urlFor(name) { return name === 'index' ? SITE + '/' : SITE + '/' + name; }
function jsonScript(graph) {
  return '<script type="application/ld+json" id="seo-jsonld">\n' + JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2) + '\n</script>';
}
function teaserNames() { return fs.readdirSync(path.join(ROOT, 'recipes')).filter(f => f.endsWith('.html')).map(f => 'recipes/' + f.replace(/\.html$/, '')); }

function applyPage(name, file) {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<script type="application\/ld\+json" id="seo-jsonld">[\s\S]*?<\/script>\n?/g, '');
  let graph = orgGraph.slice();
  if (name === 'index') {
    graph = graph.concat([personNode, serviceNode]);
    const faq = visibleFaq(html);
    if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq });
  }
  if (!/<\/head>/.test(html)) throw new Error(file + ': no </head>');
  html = html.replace('</head>', jsonScript(graph) + '\n</head>');
  if (html.includes('site-footer-note">© 2026 Beast Coach</p>') && !html.includes(BIO)) {
    html = html.replace('<p class="site-footer-note">© 2026 Beast Coach</p>', '<p class="site-footer-note">© 2026 Beast Coach</p>\n    <p class="site-footer-note">' + BIO + '</p>');
  }
  fs.writeFileSync(file, html);
  return graph.length;
}

// Footer bio in the shared footer template, so the next footer copy carries it too.
const footerTpl = path.join(ROOT, 'docs/site-chrome/footer.html');
let tpl = fs.readFileSync(footerTpl, 'utf8');
if (!tpl.includes(BIO)) tpl = tpl.replace('<p class="site-footer-note">© 2026 Beast Coach</p>', '<p class="site-footer-note">© 2026 Beast Coach</p>\n    <p class="site-footer-note">' + BIO + '</p>');
fs.writeFileSync(footerTpl, tpl);

const pages = [];
for (const n of PUBLIC) { const f = path.join(ROOT, n + '.html'); pages.push({ name: n, file: f }); }
for (const t of teaserNames()) pages.push({ name: t, file: path.join(ROOT, t + '.html') });
for (const p of pages) applyPage(p.name, p.file);

// Sitemap, with each file's last commit date (today for files with uncommitted changes).
const dirty = new Set(execSync('git status --porcelain', { cwd: ROOT }).toString().split('\n').map(l => l.slice(3).trim()).filter(Boolean));
function lastmod(rel) {
  if (dirty.has(rel)) return TODAY;
  const d = execSync(`git log -1 --format=%cs -- "${rel}"`, { cwd: ROOT }).toString().trim();
  return d || TODAY;
}
const entries = pages.filter(p => !SKIP_SITEMAP.includes(p.name)).map(p => {
  const rel = path.relative(ROOT, p.file);
  return `  <url>\n    <loc>${urlFor(p.name)}</loc>\n    <lastmod>${lastmod(rel)}</lastmod>\n  </url>`;
});
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries.join('\n') + '\n</urlset>\n');
console.log('pages', pages.length, 'sitemap urls', entries.length);
