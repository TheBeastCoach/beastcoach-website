// The full recipes are gated: the endpoint refuses a missing or bad token, returns a recipe to a signed-in user,
// and no publicly served file contains ingredient or method text. Plain file checks plus the endpoint called
// directly with a stubbed Supabase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FULL = JSON.parse(fs.readFileSync(path.join(ROOT, 'private/recipes-full.json'), 'utf8'));
const endpoint = require(path.join(ROOT, 'api/recipes.js'));

function call(query, auth) {
  const res = { statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
  const req = { method: 'GET', query, headers: auth ? { authorization: auth } : {} };
  return endpoint(req, res).then(() => res);
}

// Stub Supabase: /auth/v1/user accepts only 'good-token'; the recipes table returns a row only for that token,
// as row-level security does (anonymous or bad tokens see no rows).
const realFetch = global.fetch;
function stubSupabase() {
  global.fetch = async (url, opts) => {
    const auth = (opts && opts.headers && opts.headers.Authorization) || '';
    const u = String(url);
    if (u.includes('/auth/v1/user') && auth === 'Bearer good-token') {
      return { ok: true, json: async () => ({ id: 'user-1', email: 'member@example.com' }) };
    }
    if (u.includes('/rest/v1/recipes_full') && auth === 'Bearer good-token') {
      const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const row = FULL.find(r => r.id === id);
      return { ok: true, json: async () => (row ? [{ data: row }] : []) };
    }
    return { ok: false, json: async () => ({}) };
  };
}
test.afterEach(() => { global.fetch = realFetch; });

test('the endpoint refuses a request with no token', async () => {
  stubSupabase();
  const res = await call({ id: FULL[0].id }, null);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.recipe, undefined, 'no recipe data without a token');
});

test('the endpoint refuses a bad token', async () => {
  stubSupabase();
  const res = await call({ id: FULL[0].id }, 'Bearer not-a-real-token');
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.recipe, undefined, 'no recipe data for a bad token');
});

test('the endpoint returns the full recipe to a signed-in user', async () => {
  stubSupabase();
  const r = FULL[0];
  const res = await call({ id: r.id }, 'Bearer good-token');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recipe.id, r.id);
  assert.deepEqual(res.body.recipe.ingredients, r.ingredients);
  assert.deepEqual(res.body.recipe.instructions, r.instructions);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('the endpoint returns 404 for an unknown recipe, and only to a signed-in user', async () => {
  stubSupabase();
  assert.equal((await call({ id: 'no-such-recipe' }, 'Bearer good-token')).statusCode, 404);
  assert.equal((await call({ id: FULL[0].id }, 'Bearer bad')).statusCode, 401);
});

test('the full recipe data is not in any deployed file: it is in Supabase, and the source folders are not deployed', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'recipes.js')), false, 'the public recipes.js is gone');
  assert.equal(fs.existsSync(path.join(ROOT, 'api/_recipes-full.js')), false, 'no full-recipe module under api/');
  const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map(l => l.trim());
  assert.ok(ignore.includes('private/'), 'private/ (the source data) is not deployed');
  assert.ok(ignore.includes('supabase/'), 'supabase/ (the table SQL) is not deployed');
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase/recipes-full.sql')), 'the table SQL exists for the owner to run');
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/recipes-full.sql'), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select on public\.recipes_full to authenticated/);
  assert.doesNotMatch(sql, /grant select on public\.recipes_full to anon/, 'no anonymous read');
});

// A whole-phrase match: the text is not part of a longer number or word (so "50g Greek yoghurt" does not match "150g Greek yoghurt").
function wholePhrase(body, text) {
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![0-9A-Za-z])' + esc + '(?![0-9A-Za-z])').test(body);
}

function publicFiles() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (/\.(html|js|css|json|txt|xml)$/.test(f) && fs.statSync(path.join(ROOT, f)).isFile()) out.push(f);
  }
  const rec = path.join(ROOT, 'recipes');
  if (fs.existsSync(rec)) for (const f of fs.readdirSync(rec)) if (f.endsWith('.html')) out.push('recipes/' + f);
  return out;
}

test('no publicly served file contains ingredient or method text from a full recipe', () => {
  const files = publicFiles();
  assert.ok(files.length > 20, 'the scan covers the public files');
  const texts = [];
  for (const r of FULL) for (const key of ['ingredients', 'instructions']) for (const item of (r[key] || [])) {
    if (typeof item === 'string' && item.length > 12) texts.push([r.id, item]);
  }
  for (const f of files) {
    const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const [id, text] of texts) {
      assert.ok(!wholePhrase(body, text), f + ' must not contain ' + id + ' text: ' + text.slice(0, 40));
    }
  }
});
