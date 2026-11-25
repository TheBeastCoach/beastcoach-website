// Tests for supabase/recipe-ratings-security.sql.
// Runs the real SQL in an in-memory Postgres (PGlite), with a stand-in for Supabase's auth.jwt() and roles.
// Starts from the OLD open policies, shows the leak, then runs the new SQL and checks each rule.
//
// Needs PGlite. Install it outside the repo, then point PGLITE_PATH at it:
//   mkdir -p /tmp/pglite && cd /tmp/pglite && npm init -y && npm install --no-save @electric-sql/pglite
//   PGLITE_PATH=/tmp/pglite/node_modules/@electric-sql/pglite node --test tests/security-sql.test.js
// Without PGLITE_PATH (and without the package) the tests are skipped with a message.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let PGlite = null, pgError = '';
try { PGlite = require(process.env.PGLITE_PATH || '@electric-sql/pglite').PGlite; }
catch (e) { pgError = 'PGlite not found. See the instructions at the top of this file.'; }
const SKIP = pgError ? { skip: pgError } : {};

const ALICE = { email: 'Alice@Example.com', role: 'authenticated' };   // mixed case in the token on purpose
const BOB = { email: 'bob@example.com' };

// Stand-in for Supabase: roles, the auth schema with jwt(), and the two tables as the dashboard uses them.
const SUPABASE_SHIM = `
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create table public.recipe_ratings (
  recipe_id  text not null,
  email      text not null,
  rating     int  not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (recipe_id, email)
);
create table public.recipe_ideas (
  id         bigint generated always as identity primary key,
  email      text not null,
  idea       text not null,
  created_at timestamptz not null default now()
);
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.recipe_ratings, public.recipe_ideas to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
alter table public.recipe_ratings enable row level security;
alter table public.recipe_ideas enable row level security;
-- The open policies the site has today (the problem)
create policy "old: anyone reads ratings" on public.recipe_ratings for select using (true);
create policy "old: anyone updates ratings" on public.recipe_ratings for update using (true);
create policy "old: anyone adds ratings" on public.recipe_ratings for insert with check (true);
create policy "old: anyone reads ideas" on public.recipe_ideas for select using (true);
create policy "old: anyone adds ideas" on public.recipe_ideas for insert with check (true);
insert into public.recipe_ratings (recipe_id, email, rating) values ('r1', 'alice@example.com', 4), ('r1', 'bob@example.com', 2);
`;

async function newDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  return db;
}
// Runs fn as a role with the given token claims, then goes back to the superuser.
async function asRole(db, role, claims, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims || {})]);
  try { return await fn(); }
  finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
async function expectError(promise, pattern) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, 'expected an error');
  assert.match(String(err.message), pattern);
}
const ratingOf = async (db, email) => (await db.query(`select rating from public.recipe_ratings where recipe_id = 'r1' and email = $1`, [email])).rows[0].rating;

test('before: the open policies let anyone read every email and change any rating (the problem)', SKIP, async () => {
  const db = await newDb();
  const rows = await asRole(db, 'anon', {}, () => db.query(`select email, rating from public.recipe_ratings`));
  assert.equal(rows.rows.length, 2, 'a logged-out visitor reads every rater and their email');
  await asRole(db, 'authenticated', ALICE, () => db.query(`update public.recipe_ratings set rating = 1 where email = 'bob@example.com'`));
  assert.equal(await ratingOf(db, 'bob@example.com'), 1, 'Alice changed Bob\'s rating');
  await db.close();
});

test('after: the new SQL applies, and running it a second time is harmless', SKIP, async () => {
  const db = await newDb();
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const names = (await db.query(`select policyname from pg_policies where schemaname = 'public' and tablename in ('recipe_ratings','recipe_ideas') order by policyname`)).rows.map(r => r.policyname);
  assert.deepEqual(names, ['ideas: submit own', 'ratings: add own', 'ratings: change own', 'ratings: read own'], 'only the new policies remain');
  await db.close();
});

test('logged out: no ratings, no emails, but the average and count from the summary', SKIP, async () => {
  const db = await newDb();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8'));
  assert.equal((await asRole(db, 'anon', {}, () => db.query(`select * from public.recipe_ratings`))).rows.length, 0, 'anon reads no rating rows');
  const s = await asRole(db, 'anon', {}, () => db.query(`select * from public.recipe_rating_summary('r1')`));
  assert.deepEqual(Object.keys(s.rows[0]), ['avg_rating', 'rating_count', 'my_rating'], 'the summary has no email column');
  assert.equal(Number(s.rows[0].avg_rating), 3);
  assert.equal(s.rows[0].rating_count, 2);
  assert.equal(s.rows[0].my_rating, null, 'no "my rating" when logged out');
  await expectError(asRole(db, 'anon', {}, () => db.query(`insert into public.recipe_ratings (recipe_id, email, rating) values ('r1','eve@example.com',5)`)), /row-level security|permission denied/);
  await expectError(asRole(db, 'anon', {}, () => db.query(`insert into public.recipe_ideas (email, idea) values ('eve@example.com','x')`)), /row-level security|permission denied/);
  assert.equal((await asRole(db, 'anon', {}, () => db.query(`select * from public.recipe_ideas`))).rows.length, 0, 'ideas are not readable from the website');
  await db.close();
});

test('signed in as Alice: she sees only her own rating, and her summary shows it', SKIP, async () => {
  const db = await newDb();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8'));
  const mine = await asRole(db, 'authenticated', ALICE, () => db.query(`select email, rating from public.recipe_ratings`));
  assert.deepEqual(mine.rows.map(r => r.email), ['alice@example.com'], 'only Alice\'s own row (the email match ignores case)');
  const s = await asRole(db, 'authenticated', ALICE, () => db.query(`select * from public.recipe_rating_summary('r1')`));
  assert.equal(Number(s.rows[0].my_rating), 4, 'my rating is Alice\'s 4');
  assert.equal(s.rows[0].rating_count, 2, 'the count covers everyone');
  await db.close();
});

test('Alice cannot read Bob\'s email, change Bob\'s rating, or add a rating under Bob\'s email', SKIP, async () => {
  const db = await newDb();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8'));
  const changed = await asRole(db, 'authenticated', ALICE, () => db.query(`update public.recipe_ratings set rating = 1 where email = 'bob@example.com' returning email`));
  assert.equal(changed.rows.length, 0, 'the update touches no rows: Bob\'s rating is not visible to Alice');
  assert.equal(await ratingOf(db, 'bob@example.com'), 2, 'Bob\'s rating is still 2');
  await expectError(asRole(db, 'authenticated', ALICE, () => db.query(`insert into public.recipe_ratings (recipe_id, email, rating) values ('r1','bob@example.com',5)`)), /row-level security/);
  await expectError(asRole(db, 'authenticated', ALICE, () => db.query(`insert into public.recipe_ratings (recipe_id, email, rating) values ('r1','bob@example.com',5) on conflict (recipe_id, email) do update set rating = excluded.rating`)), /row-level security/);
  await db.close();
});

test('Alice can add and change her own rating with the same upsert the dashboard uses', SKIP, async () => {
  const db = await newDb();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8'));
  const upsert = v => db.query(
    `insert into public.recipe_ratings (recipe_id, email, rating) values ('r2', $1, $2)
     on conflict (recipe_id, email) do update set rating = excluded.rating`, [ALICE.email.toLowerCase(), v]);
  await asRole(db, 'authenticated', ALICE, () => upsert(3));
  await asRole(db, 'authenticated', ALICE, () => upsert(5));
  const r2 = await db.query(`select rating from public.recipe_ratings where recipe_id = 'r2' and email = 'alice@example.com'`);
  assert.equal(r2.rows[0].rating, 5, 'a new rating, then a change, both saved');
  await db.close();
});

test('recipe ideas: you can submit under your own email only', SKIP, async () => {
  const db = await newDb();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8'));
  await asRole(db, 'authenticated', ALICE, () => db.query(`insert into public.recipe_ideas (email, idea) values ($1, 'Lentil curry')`, [ALICE.email.toLowerCase()]));
  await expectError(asRole(db, 'authenticated', ALICE, () => db.query(`insert into public.recipe_ideas (email, idea) values ('bob@example.com', 'Spoofed')`)), /row-level security/);
  const n = await db.query(`select count(*)::int as n from public.recipe_ideas`);
  assert.equal(n.rows[0].n, 1, 'only Alice\'s idea is stored; the spoofed one was refused');
  await db.close();
});

test('the summary function is the only public route to rating data: no emails, executable by anon and authenticated only', SKIP, async () => {
  const db = await newDb();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'recipe-ratings-security.sql'), 'utf8'));
  const body = (await db.query(`select pg_get_functiondef('public.recipe_rating_summary(text)'::regprocedure) as d`)).rows[0].d;
  assert.doesNotMatch(body, /select[^;]*\bemail\b\s*,/i, 'the function does not select emails out');
  assert.match(body, /security definer/i);
  const grants = (await db.query(`select grantee from information_schema.routine_privileges where routine_name = 'recipe_rating_summary' and privilege_type = 'EXECUTE' order by grantee`)).rows.map(r => r.grantee);
  assert.ok(grants.includes('anon') && grants.includes('authenticated'));
  assert.ok(!grants.includes('PUBLIC'));
  await db.close();
});
