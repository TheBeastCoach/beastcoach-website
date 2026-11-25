// Row level security tests for the coaching portal database (supabase/coaching.sql + supabase/coaching-portal.sql).
//
// These run the real SQL in Postgres (PGlite: Postgres compiled to run in Node, no Docker needed). Supabase is
// imitated just enough to test the rules: the roles anon, authenticated and service_role; the auth schema with
// auth.uid() and auth.jwt() reading the request claims; auth.users; and Supabase's default table grants,
// which the revokes in the SQL must take away.
//
// Each test acts as one of: anon, client A, client B, client G, client P, a basic client, an unconfirmed user,
// a confirmed user with no plan, a coach without MFA (aal1) and a coach with MFA (aal2).
//
// Run with: node --test tests/coaching-portal-rls.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const BasicTargets = require(path.join(__dirname, '..', 'basic-targets.js'));

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Users (auth.users). The ids are fixed so the claims below can name them.
const U = {
  A: { id: '00000000-0000-4000-8000-00000000000a', email: 'a@example.com', confirmed: true },          // core client, active
  B: { id: '00000000-0000-4000-8000-00000000000b', email: 'b@example.com', confirmed: true },          // essential client, active
  G: { id: '00000000-0000-4000-8000-00000000000c', email: 'g@example.com', confirmed: true },          // awaiting activation
  P: { id: '00000000-0000-4000-8000-00000000000d', email: 'p@example.com', confirmed: true },          // core, paused
  BA: { id: '00000000-0000-4000-8000-00000000000e', email: 'ba@example.com', confirmed: true },        // basic, active
  BO: { id: '00000000-0000-4000-8000-00000000000f', email: 'bo@example.com', confirmed: true },        // basic, awaiting onboarding
  C: { id: '00000000-0000-4000-8000-0000000000c0', email: 'coach@example.com', confirmed: true },      // the coach (in coaching_admins)
  U: { id: '00000000-0000-4000-8000-0000000000d0', email: 'unconfirmed@example.com', confirmed: false },
  N: { id: '00000000-0000-4000-8000-0000000000e0', email: 'NEW.Client@Example.com', confirmed: true }, // confirmed, matches a row in another case
  X: { id: '00000000-0000-4000-8000-0000000000f0', email: 'stranger@example.com', confirmed: true },   // confirmed, no plan at all
};

const SHIM = `
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase gives new public tables full access to these roles by default. The SQL must take it back.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// The fixture. Dates are relative to today in Melbourne, so the tests keep working on any day.
function fixtureSql() {
  const u = Object.values(U).map(x => `('${x.id}', '${x.email}', ${x.confirmed ? 'now() - interval \'2 days\'' : 'null'})`).join(',\n');
  const todayDay = `(array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from public.melbourne_today())::int]`;
  return `
insert into auth.users (id, email, email_confirmed_at) values ${u};
insert into public.coaching_admins (user_id) values ('${U.C.id}');

insert into public.coaching_clients (user_id, email, name, tier, status, activated_at, start_date, onboarding, targets)
values
  ('${U.A.id}', 'a@example.com', 'Client A', 'core', 'active', now() - interval '10 days', public.melbourne_today() - 10,
     jsonb_build_object('weighInDay', ${todayDay}, 'timezone', 'Melbourne'), '{"calories": 2000}'),
  ('${U.B.id}', 'b@example.com', 'Client B', 'essential', 'active', now() - interval '10 days', public.melbourne_today() - 10,
     jsonb_build_object('weighInDay', ${todayDay}, 'timezone', 'Melbourne'), null),
  ('${U.G.id}', 'g@example.com', 'Client G', 'essential', 'awaiting_activation', null, public.melbourne_today(),
     jsonb_build_object('weighInDay', ${todayDay}, 'timezone', 'Melbourne'), null),
  ('${U.P.id}', 'p@example.com', 'Client P', 'core', 'paused', now() - interval '10 days', public.melbourne_today() - 10,
     jsonb_build_object('weighInDay', ${todayDay}, 'timezone', 'Melbourne'), '{"calories": 2100}'),
  ('${U.BA.id}', 'ba@example.com', 'Basic BA', 'basic', 'active', now() - interval '10 days', public.melbourne_today() - 10,
     jsonb_build_object('weighInDay', ${todayDay}, 'timezone', 'Melbourne'), '{"calories": 1900}'),
  ('${U.BO.id}', 'bo@example.com', 'Basic BO', 'basic', 'awaiting_onboarding', null, public.melbourne_today(), '{}', null),
  (null, 'u@example.com', 'Unclaimed U', 'essential', 'awaiting_onboarding', null, public.melbourne_today(), '{}', null),
  (null, 'new.client@example.com', 'Unclaimed N', 'core', 'awaiting_onboarding', null, public.melbourne_today(), '{}', null),
  (null, 'o@example.com', 'Waiting O', 'essential', 'awaiting_onboarding', null, public.melbourne_today(), '{}', null),
  (null, 'f@example.com', 'Finished F', 'essential', 'finished', now() - interval '200 days', public.melbourne_today() - 200, '{}', null),
  (null, 'x@example.com', 'Cancelled X', 'beast', 'cancelled', null, public.melbourne_today(), '{}', null);

-- Plans, logs and check-ins for A and B, so there is something to hide.
insert into public.coaching_plans (client_id, version, is_current, plan)
  select id, 1, true, '{"meals": []}' from public.coaching_clients where email in ('a@example.com', 'b@example.com');
insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
  select id, public.melbourne_today(), 'Toast', 300, 'typed' from public.coaching_clients where email in ('a@example.com', 'b@example.com');
insert into public.coaching_workout_logs (client_id, log_date, kind, what, minutes)
  select id, public.melbourne_today(), 'other', 'Football', 45 from public.coaching_clients where email = 'b@example.com';
insert into public.coaching_checkins (client_id, type, scheduled_at)
  select id, 'Check-in', now() + interval '2 days' from public.coaching_clients where email = 'a@example.com';
insert into public.coaching_customers (email, name, tier, amount_cents, marketing_consent)
  values ('a@example.com', 'Client A', 'core', 29900, true), ('b@example.com', 'Client B', 'essential', 11000, false);
`;
}

async function newDb({ portalTimes = 1 } = {}) {
  const db = new PGlite();
  await db.exec(SHIM);
  await db.exec(read('supabase/coaching.sql'));
  for (let i = 0; i < portalTimes; i++) await db.exec(read('supabase/coaching-portal.sql'));
  await db.exec(fixtureSql());
  return db;
}

// Runs fn as a role with the given claims. The claims are what Supabase sends for a signed-in request.
async function as(db, role, claims, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims || {})]);
  try { return await fn(); }
  finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const signedIn = (user, aal) => ({ sub: user.id, email: user.email, role: 'authenticated', aal: aal || 'aal1' });
const coachMfa = () => signedIn(U.C, 'aal2');
const coachNoMfa = () => signedIn(U.C, 'aal1');

async function expectError(promise, pattern) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, 'expected an error');
  assert.match(String(err.message), pattern);
}
const scalar = async (db, sql, params) => (await db.query(sql, params || [])).rows[0];
const count = async (db, table, where, params) =>
  Number((await db.query(`select count(*) as n from public.${table}${where ? ' where ' + where : ''}`, params || [])).rows[0].n);
const clientId = async (db, email) => (await scalar(db, 'select id from public.coaching_clients where email = $1', [email])).id;

// ---------------------------------------------------------------------------
// The SQL itself
// ---------------------------------------------------------------------------

test('the portal SQL runs twice without error (safe to re-run)', async () => {
  const db = await newDb({ portalTimes: 2 });
  assert.equal(await count(db, 'coaching_clients'), 11, 'the fixture rows are all there');
  await db.close();
});

test('it does not change existing non-coaching tables', async () => {
  // A table outside the coaching work, created before the portal SQL runs, must be untouched.
  const db = new PGlite();
  await db.exec(SHIM);
  await db.exec('create table public.recipe_ratings (recipe_id text, email text, rating int, primary key (recipe_id, email)); insert into public.recipe_ratings values (\'r1\', \'x@x.com\', 4);');
  const before = await scalar(db, `select count(*)::int as n from information_schema.columns where table_name = 'recipe_ratings'`);
  await db.exec(read('supabase/coaching.sql'));
  await db.exec(read('supabase/coaching-portal.sql'));
  const after = await scalar(db, `select count(*)::int as n from information_schema.columns where table_name = 'recipe_ratings'`);
  assert.equal(after.n, before.n);
  assert.equal((await scalar(db, `select count(*)::int as n from public.recipe_ratings`)).n, 1);
  await db.close();
});

// ---------------------------------------------------------------------------
// Anon
// ---------------------------------------------------------------------------

test('anon reads nothing except the spot counts, and cannot run the client functions', async () => {
  const db = await newDb();
  for (const fn of ['claim_coaching()', 'submit_onboarding(\'{}\'::jsonb)', 'set_marketing_consent(true)', 'delete_my_coaching_data()', 'is_coach()', 'my_client_id()']) {
    await expectError(as(db, 'anon', {}, () => db.query(`select public.${fn}`)), /permission denied/);
  }
  for (const t of ['coaching_clients', 'coaching_customers', 'coaching_plans', 'coaching_meal_logs', 'coaching_workout_logs',
    'coaching_step_logs', 'coaching_weigh_ins', 'coaching_checkins', 'coaching_notes', 'coaching_admins']) {
    await expectError(as(db, 'anon', {}, () => db.query(`select * from public.${t}`)), /permission denied/);
  }
  const places = await as(db, 'anon', {}, () => db.query('select * from public.coaching_places()'));
  assert.ok(places.rows.length >= 3, 'anon can read the spot counts');
  await db.close();
});

// ---------------------------------------------------------------------------
// Client A (and B)
// ---------------------------------------------------------------------------

test('client A reads only A: their own row, plan, meals, weigh-ins and check-ins', async () => {
  const db = await newDb();
  const aId = await clientId(db, 'a@example.com');
  const who = signedIn(U.A);
  const rows = await as(db, 'authenticated', who, () => db.query('select id from public.coaching_clients'));
  assert.deepEqual(rows.rows.map(r => r.id), [aId]);
  for (const t of ['coaching_plans', 'coaching_meal_logs', 'coaching_checkins']) {
    const r = await as(db, 'authenticated', who, () => db.query(`select client_id from public.${t}`));
    assert.ok(r.rows.length >= 1 && r.rows.every(x => x.client_id === aId), `${t}: only A's rows`);
  }
  await db.close();
});

test('client A cannot read or change B\'s meals, workouts, steps, weigh-ins, plans or check-ins', async () => {
  const db = await newDb();
  const bId = await clientId(db, 'b@example.com');
  const who = signedIn(U.A);
  for (const t of ['coaching_plans', 'coaching_meal_logs', 'coaching_workout_logs', 'coaching_step_logs', 'coaching_weigh_ins', 'coaching_checkins']) {
    const r = await as(db, 'authenticated', who, () => db.query(`select client_id from public.${t} where client_id = $1`, [bId]));
    assert.equal(r.rows.length, 0, `${t}: none of B's rows`);
  }
  const upd = await as(db, 'authenticated', who, () => db.query(`update public.coaching_meal_logs set calories = 1 where client_id = $1 returning id`, [bId]));
  assert.equal(upd.rows.length, 0, 'update of B\'s meal touches nothing');
  const del = await as(db, 'authenticated', who, () => db.query(`delete from public.coaching_workout_logs where client_id = $1 returning id`, [bId]));
  assert.equal(del.rows.length, 0, 'delete of B\'s workout removes nothing');
  await expectError(as(db, 'authenticated', who, () => db.query(
    `insert into public.coaching_meal_logs (client_id, log_date, name, calories, source) values ($1, public.melbourne_today(), 'Sneaky', 100, 'typed')`, [bId])),
    /row-level security/);
  assert.equal(await count(db, 'coaching_meal_logs', 'client_id = $1 and name = $2', [bId, 'Toast']), 1, 'B\'s meal is unchanged');
  await db.close();
});

test('client A cannot read coaching_customers, coaching_admins or the coach notes', async () => {
  const db = await newDb();
  const who = signedIn(U.A);
  assert.equal((await as(db, 'authenticated', who, () => db.query('select * from public.coaching_customers'))).rows.length, 0);
  assert.equal((await as(db, 'authenticated', who, () => db.query('select * from public.coaching_admins'))).rows.length, 0);
  assert.equal((await as(db, 'authenticated', who, () => db.query('select * from public.coaching_notes'))).rows.length, 0);
  await expectError(as(db, 'authenticated', who, () => db.query('select notes from public.coaching_clients')), /permission denied/);
  await db.close();
});

test('client A cannot change their own tier, status, dates or targets', async () => {
  const db = await newDb();
  const aId = await clientId(db, 'a@example.com');
  const who = signedIn(U.A);
  const r1 = await as(db, 'authenticated', who, () => db.query(`update public.coaching_clients set tier = 'beast', status = 'finished' where id = $1 returning id`, [aId]));
  assert.equal(r1.rows.length, 0, 'no update policy for clients: nothing changes');
  const r2 = await as(db, 'authenticated', who, () => db.query(`update public.coaching_clients set targets = '{"calories": 9999}', activated_at = now() where id = $1 returning id`, [aId]));
  assert.equal(r2.rows.length, 0);
  const row = await scalar(db, 'select tier, status, targets from public.coaching_clients where id = $1', [aId]);
  assert.equal(row.tier, 'core');
  assert.equal(row.status, 'active');
  assert.equal(row.targets.calories, 2000);
  await db.close();
});

test('client A can log today and up to 3 days back, but not 4 days back', async () => {
  const db = await newDb();
  const who = signedIn(U.A);
  const log = (offset) => as(db, 'authenticated', who, () => db.query(
    `insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
     values ((select id from public.coaching_clients where email = 'a@example.com'), public.melbourne_today() - $1::int, 'Logged', 200, 'typed') returning id`, [offset]));
  assert.equal((await log(0)).rows.length, 1, 'today is allowed');
  assert.equal((await log(3)).rows.length, 1, '3 days back is allowed');
  await expectError(log(4), /row-level security/);
  await db.close();
});

test('client A cannot log before their activation date', async () => {
  const db = await newDb();
  const who = signedIn(U.A);
  // Activated 10 days ago, so 11 days back is before activation (and also outside the 3-day window).
  await expectError(as(db, 'authenticated', who, () => db.query(
    `insert into public.coaching_step_logs (client_id, log_date, steps)
     values ((select id from public.coaching_clients where email = 'a@example.com'), public.melbourne_today() - 11, 5000)`)), /row-level security/);
  // A client who is awaiting activation cannot log at all.
  await expectError(as(db, 'authenticated', signedIn(U.G), () => db.query(
    `insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
     values ((select id from public.coaching_clients where email = 'g@example.com'), public.melbourne_today(), 'Early', 300, 'typed')`)), /row-level security/);
  await db.close();
});

test('client A cannot log while paused (client P is paused)', async () => {
  const db = await newDb();
  await expectError(as(db, 'authenticated', signedIn(U.P), () => db.query(
    `insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
     values ((select id from public.coaching_clients where email = 'p@example.com'), public.melbourne_today(), 'Paused meal', 300, 'typed')`)), /row-level security/);
  await db.close();
});

test('a client cannot add a second weigh-in in the same week, or weigh in on the wrong day', async () => {
  const db = await newDb();
  const who = signedIn(U.A);
  const weigh = (offset, kg) => as(db, 'authenticated', who, () => db.query(
    `insert into public.coaching_weigh_ins (client_id, weigh_date, kg)
     values ((select id from public.coaching_clients where email = 'a@example.com'), public.melbourne_today() - $1::int, $2) returning week_start`, [offset, kg]));
  const first = await weigh(0, 84.2);
  assert.equal(first.rows.length, 1, 'the first weigh-in this week is allowed');
  await expectError(weigh(0, 84.0), /duplicate key value violates unique constraint/);
  await expectError(weigh(1, 84.0), /row-level security/);   // not the weigh-in day: the day is today's weekday
  await db.close();
});

test('the database sets the week of each weigh-in to its Monday (ISO week)', async () => {
  const db = await newDb();
  // Sunday 22 Nov 2026 belongs to the week that starts Monday 16 Nov 2026. Set by the trigger, not the caller.
  await db.query(`insert into public.coaching_weigh_ins (client_id, weigh_date, week_start, kg)
                  values ((select id from public.coaching_clients where email = 'b@example.com'), date '2026-11-22', date '1900-01-01', 80)`);
  const r = await scalar(db, `select week_start::text as w from public.coaching_weigh_ins where weigh_date = date '2026-11-22'`);
  assert.equal(r.w, '2026-11-16');
  await db.close();
});

test('client B is not blocked by A\'s rules: B reads only B', async () => {
  const db = await newDb();
  const bId = await clientId(db, 'b@example.com');
  const rows = await as(db, 'authenticated', signedIn(U.B), () => db.query('select id from public.coaching_clients'));
  assert.deepEqual(rows.rows.map(r => r.id), [bId]);
  await db.close();
});

// ---------------------------------------------------------------------------
// The coach
// ---------------------------------------------------------------------------

test('a coach without MFA (aal1) sees nothing; a coach with MFA (aal2) sees everything', async () => {
  const db = await newDb();
  // The coach names columns (no notes column on coaching_clients); select * would include the legacy notes column.
  for (const t of ['coaching_clients', 'coaching_meal_logs', 'coaching_plans', 'coaching_checkins', 'coaching_customers', 'coaching_admins']) {
    const cols = t === 'coaching_clients' ? 'id' : '*';
    const r = await as(db, 'authenticated', coachNoMfa(), () => db.query(`select ${cols} from public.${t}`));
    assert.equal(r.rows.length, 0, `aal1 coach sees no ${t}`);
  }
  const total = await count(db, 'coaching_clients');
  const seen = await as(db, 'authenticated', coachMfa(), () => db.query('select id from public.coaching_clients'));
  assert.equal(seen.rows.length, total, 'aal2 coach sees every client');
  assert.equal((await as(db, 'authenticated', coachMfa(), () => db.query('select * from public.coaching_customers'))).rows.length, 2);
  assert.equal((await as(db, 'authenticated', coachMfa(), () => db.query('select * from public.coaching_meal_logs'))).rows.length, 2);
  await db.close();
});

test('a coach with MFA can write (a note, a check-in) and a coach without MFA cannot', async () => {
  const db = await newDb();
  const aId = await clientId(db, 'a@example.com');
  await expectError(as(db, 'authenticated', coachNoMfa(), () => db.query(
    `insert into public.coaching_notes (client_id, body) values ($1, 'nope')`, [aId])), /row-level security/);
  await as(db, 'authenticated', coachMfa(), () => db.query(
    `insert into public.coaching_notes (client_id, body) values ($1, 'Knee is sore')`, [aId]));
  assert.equal((await as(db, 'authenticated', signedIn(U.A), () => db.query('select * from public.coaching_notes'))).rows.length, 0, 'the client never sees the note');
  await db.close();
});

// ---------------------------------------------------------------------------
// Functions the website calls
// ---------------------------------------------------------------------------

test('delete_my_coaching_data removes A\'s data and keeps A\'s customer record', async () => {
  const db = await newDb();
  const aId = await clientId(db, 'a@example.com');
  const result = await as(db, 'authenticated', signedIn(U.A), () => db.query('select public.delete_my_coaching_data() as r'));
  assert.equal(result.rows[0].r.deleted, true);
  assert.equal(result.rows[0].r.customer_record_kept, true);
  assert.equal(await count(db, 'coaching_clients', 'id = $1', [aId]), 0, 'client row gone');
  assert.equal(await count(db, 'coaching_meal_logs', 'client_id = $1', [aId]), 0, 'meals gone');
  assert.equal(await count(db, 'coaching_plans', 'client_id = $1', [aId]), 0, 'plans gone');
  assert.equal(await count(db, 'coaching_checkins', 'client_id = $1', [aId]), 0, 'check-ins gone');
  assert.equal(await count(db, 'coaching_customers', "lower(email) = 'a@example.com'"), 1, 'the customer record stays');
  assert.equal(await count(db, 'coaching_clients', "email = 'b@example.com'"), 1, 'B is untouched');
  await db.close();
});

test('claim_coaching links only a confirmed email, case-insensitively, and only an unclaimed row', async () => {
  const db = await newDb();
  // Unconfirmed: refused, and the row stays unlinked.
  const u = await as(db, 'authenticated', signedIn(U.U), () => db.query('select public.claim_coaching() as r'));
  assert.equal(u.rows[0].r.linked, false);
  assert.equal(u.rows[0].r.reason, 'email_not_confirmed');
  assert.equal((await scalar(db, `select user_id from public.coaching_clients where email = 'u@example.com'`)).user_id, null);
  // Confirmed, with the email in another case: linked.
  const n = await as(db, 'authenticated', signedIn(U.N), () => db.query('select public.claim_coaching() as r'));
  assert.equal(n.rows[0].r.linked, true);
  assert.equal(n.rows[0].r.status, 'awaiting_onboarding');
  assert.equal((await scalar(db, `select user_id from public.coaching_clients where email = 'new.client@example.com'`)).user_id, U.N.id);
  // Calling again is harmless.
  const again = await as(db, 'authenticated', signedIn(U.N), () => db.query('select public.claim_coaching() as r'));
  assert.equal(again.rows[0].r.linked, true);
  // No plan for this email: nothing to link.
  const x = await as(db, 'authenticated', signedIn(U.X), () => db.query('select public.claim_coaching() as r'));
  assert.equal(x.rows[0].r.linked, false);
  assert.equal(x.rows[0].r.reason, 'no_plan_for_this_email');
  // A row that someone already claimed cannot be taken over.
  const b = await as(db, 'authenticated', signedIn(U.X), () => db.query('select public.claim_coaching() as r'));
  assert.equal(b.rows[0].r.linked, false);
  await db.close();
});

test('submit_onboarding: a basic client gets targets worked out on the server and is active at once', async () => {
  const db = await newDb();
  const answers = { timezone: 'Melbourne', age: 34, sex: 'Male', heightCm: 182, weightKg: 84, whatsapp: '',
    goalKind: 'fatloss', jobMult: '1.15', stepsEveryday: 5000, stepsRealistic: 9000, trainingSessions: 3, trainingIntensity: '350',
    agreeNotCoach: true, agreeTerms: true, weighInDay: 'Sat' };
  const claim = await as(db, 'authenticated', signedIn(U.BO), () => db.query('select public.claim_coaching() as r'));
  assert.equal(claim.rows[0].r.linked, true);
  const res = await as(db, 'authenticated', signedIn(U.BO), () => db.query('select public.submit_onboarding($1::jsonb) as r', [JSON.stringify(answers)]));
  assert.equal(res.rows[0].r.ok, true);
  assert.equal(res.rows[0].r.status, 'active');
  const row = await scalar(db, `select status, activated_at is not null as has_activation, targets from public.coaching_clients where email = 'bo@example.com'`);
  assert.equal(row.status, 'active');
  assert.equal(row.has_activation, true);
  const want = BasicTargets.calcTargets({ sex: 'male', age: 34, heightCm: 182, weightKg: 84, activity: 1.15, steps: 5000, trainingSessions: 3, trainingIntensity: 350, goal: 'fatloss' });
  assert.equal(row.targets.calories, want.calories);
  assert.equal(row.targets.steps, BasicTargets.stepsTarget(9000));
  await db.close();
});

test('the server\'s Basic targets equal basic-targets.js for every combination tried', async () => {
  const db = await newDb();
  let checked = 0;
  for (const sex of ['Male', 'Female']) for (const goal of ['fatloss', 'maintain', 'muscle']) for (const age of [18, 33, 70]) for (const jobMult of ['1.15', '1.25', '1.35'])
    for (const intensity of ['200', '350', '500']) for (const steps of [0, 6400, 12000]) for (const sessions of [0, 3, 7]) for (const heightCm of [150, 178, 199]) for (const weightKg of [49.5, 84.3, 120]) {
      const answers = { sex, age, heightCm, weightKg, goalKind: goal, jobMult, stepsEveryday: steps, stepsRealistic: 8000, trainingSessions: sessions, trainingIntensity: intensity };
      const sql = (await scalar(db, 'select public.basic_targets($1::jsonb) as t', [JSON.stringify(answers)])).t;
      const js = BasicTargets.calcTargets({ sex: sex.toLowerCase(), age, heightCm, weightKg, activity: Number(jobMult), steps, trainingSessions: sessions, trainingIntensity: Number(intensity), goal });
      assert.deepEqual([sql.maintenance, sql.calories, sql.protein, sql.carbs, sql.fat, sql.fibre],
        [js.maintenance, js.calories, js.protein, js.carbs, js.fat, js.fibre], JSON.stringify(answers));
      checked++;
    }
  assert.equal(checked, 2 * 3 * 3 * 3 * 3 * 3 * 3 * 3 * 3);
  await db.close();
});

test('submit_onboarding: bad answers are refused with a message, and a plan not awaiting onboarding is refused', async () => {
  const db = await newDb();
  await as(db, 'authenticated', signedIn(U.BO), () => db.query('select public.claim_coaching()'));
  const bad = { timezone: 'Melbourne', age: 16, sex: 'Male', heightCm: 182, weightKg: 84, goalKind: 'fatloss', jobMult: '1.15',
    stepsEveryday: 5000, stepsRealistic: 9000, trainingSessions: 3, trainingIntensity: '350', agreeNotCoach: true, agreeTerms: true };
  const r = await as(db, 'authenticated', signedIn(U.BO), () => db.query('select public.submit_onboarding($1::jsonb) as r', [JSON.stringify(bad)]));
  assert.equal(r.rows[0].r.ok, false);
  assert.equal(r.rows[0].r.error, 'Enter your age (18 to 100).');
  assert.equal((await scalar(db, `select status from public.coaching_clients where email = 'bo@example.com'`)).status, 'awaiting_onboarding');
  const active = await as(db, 'authenticated', signedIn(U.A), () => db.query('select public.submit_onboarding($1::jsonb) as r', [JSON.stringify(bad)]));
  assert.equal(active.rows[0].r.ok, false, 'an active client cannot resubmit onboarding');
  await db.close();
});

test('set_marketing_consent updates the customer record for the confirmed email only', async () => {
  const db = await newDb();
  const off = await as(db, 'authenticated', signedIn(U.A), () => db.query('select public.set_marketing_consent(false) as r'));
  assert.equal(off.rows[0].r.customer_records, 1);
  const row = await scalar(db, `select marketing_consent, unsubscribed_at is not null as unsub from public.coaching_customers where email = 'a@example.com'`);
  assert.equal(row.marketing_consent, false);
  assert.equal(row.unsub, true);
  const u = await as(db, 'authenticated', signedIn(U.U), () => db.query('select public.set_marketing_consent(true) as r'));
  assert.equal(u.rows[0].r.ok, false, 'an unconfirmed email cannot change consent');
  await db.close();
});

// ---------------------------------------------------------------------------
// Spot counts
// ---------------------------------------------------------------------------

test('spot counts: awaiting onboarding, awaiting activation, active and paused take a spot; finished, cancelled and Basic do not', async () => {
  const db = await newDb();
  const rows = (await db.query('select tier, place_limit, taken, places_left from public.coaching_places() order by tier')).rows;
  const by = Object.fromEntries(rows.map(r => [r.tier, r]));
  // Essential: B (active), G (awaiting activation), O and U (awaiting onboarding). F (finished) does not count.
  assert.deepEqual([by.essential.taken, by.essential.places_left], [4, 96]);
  // Core: A (active), P (paused), N (awaiting onboarding). Nothing else.
  assert.deepEqual([by.core.taken, by.core.places_left], [3, 22]);
  // Beast: only a cancelled plan, so no spots taken.
  assert.deepEqual([by.beast.taken, by.beast.places_left], [0, 4]);
  assert.equal(by.basic, undefined, 'Basic is not a capacity tier');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['place_limit', 'places_left', 'taken', 'tier']);
  await db.close();
});

test('the customer list and the coach notes never reach a client, even by guessing a row id', async () => {
  const db = await newDb();
  const first = await scalar(db, 'select id::text as id from public.coaching_customers limit 1');
  const r = await as(db, 'authenticated', signedIn(U.B), () => db.query('select * from public.coaching_customers where id = $1::uuid', [first.id]));
  assert.equal(r.rows.length, 0);
  await db.close();
});

// The verification script you run in the Supabase SQL Editor (supabase/coaching-portal-verify.sql).
// It must pass here too, and it must leave nothing behind.
test('supabase/coaching-portal-verify.sql: every check passes, and nothing is left behind (after 4a to 4d2)', async () => {
  const db = await newDb();
  await db.exec(read('supabase/coaching-portal-4b.sql'));
  await db.exec(read('supabase/coaching-portal-4b2.sql'));
  await db.exec(read('supabase/coaching-portal-4c.sql'));
  await db.exec(read('supabase/coaching-portal-4c2.sql'));
  await db.exec(read('supabase/coaching-portal-4d.sql'));
  await db.exec(read('supabase/coaching-portal-4d2.sql'));
  const results = await db.exec(read('supabase/coaching-portal-verify.sql'));
  const table = results.find(r => r.rows && r.rows.length && r.rows[0].check_name);
  assert.ok(table, 'the script ends with a results table');
  const failed = table.rows.filter(r => r.result !== 'PASS');
  assert.deepEqual(failed.map(r => r.check_name + ': ' + r.detail), [], 'no FAIL rows');
  assert.ok(table.rows.length >= 76, 'the checks ran: ' + table.rows.length);
  const left = await scalar(db, `select count(*)::int as n from auth.users where email like 'verify-%'`);
  assert.equal(left.n, 0, 'the stub users are gone after the rollback');
  await db.close();
});

// 4b: a returning client is linked to their NEW plan, and still sees their old one.
// 4b: a returning client is linked to a NEW plan, and still reads the old one.
test('4b: a returning client is linked to a new plan, and keeps reading the old one', async () => {
  const db = await newDb();
  await db.exec(read('supabase/coaching-portal-4b.sql'));
  // Only one open plan per email, so the old plan is finished first (the coach does this in step 4c).
  await db.query(`update public.coaching_clients set status = 'finished' where email = 'a@example.com'`);
  await db.query(`insert into public.coaching_clients (email, name, tier, status, start_date)
                  values ('a@example.com', 'Client A again', 'core', 'awaiting_onboarding', public.melbourne_today())`);
  const r = await as(db, 'authenticated', signedIn(U.A), () => db.query('select public.claim_coaching() as r'));
  assert.equal(r.rows[0].r.linked, true);
  assert.equal(r.rows[0].r.status, 'awaiting_onboarding', 'the new plan is the one linked');
  const linked = await scalar(db, `select count(*)::int as n from public.coaching_clients where user_id = $1`, [U.A.id]);
  assert.equal(linked.n, 2, 'A now has the new plan and the older finished one');
  const seen = await as(db, 'authenticated', signedIn(U.A), () => db.query('select id from public.coaching_clients'));
  assert.equal(seen.rows.length, 2, 'history reads cover both plans');
  await db.close();
});

test('4b: the Beast AI counter is per client and shared, and anon cannot reach it', async () => {
  const db = await newDb();
  await db.exec(read('supabase/coaching-portal-4b.sql'));
  const aId = await clientId(db, 'a@example.com');
  const bId = await clientId(db, 'b@example.com');
  const use = (id, lim, shared) => scalar(db, 'select allowed, reason from public.coach_ai_use($1, $2, $3)', [id, lim, shared]);
  assert.equal((await use(aId, 1, 2)).allowed, true);
  assert.equal((await use(bId, 1, 2)).allowed, true, 'the shared cap is 2, so the second client is still in');
  const third = await use(aId, 1, 2);
  assert.deepEqual([third.allowed, third.reason], [false, 'shared'], 'the shared cap stops the third call of the day');
  await expectError(as(db, 'anon', {}, () => db.query('select * from public.coach_ai_use(1, 40, 300)')), /permission denied/);
  await db.close();
});

// A fixed clock for the tests only: 10pm in London on 25 November 2026 (GMT), which is already 26 November in Melbourne.
// The SQL files are read here and every now() is swapped for that moment, in the test's copy only. Nothing in the
// production SQL changes, and no client can change the clock. This makes the London boundary tested every time.
const FIXED_NOW = "'2026-11-25 22:00:00+00'::timestamptz";
const atFixedClock = sql => sql.replace(/\bnow\(\)/g, FIXED_NOW);
test('London at a fixed clock (10pm London, Melbourne already the next day): the verify script passes, and the zones really differ', async () => {
  const db = new PGlite();
  await db.exec(SHIM);
  for (const f of ['supabase/coaching.sql', 'supabase/coaching-portal.sql', 'supabase/coaching-portal-4b.sql', 'supabase/coaching-portal-4b2.sql', 'supabase/coaching-portal-4c.sql', 'supabase/coaching-portal-4c2.sql', 'supabase/coaching-portal-4d.sql', 'supabase/coaching-portal-4d2.sql']) {
    await db.exec(atFixedClock(read(f)));
  }
  await db.exec(fixtureSql());
  const mel = await scalar(db, `select public.melbourne_today()::text as d`);
  assert.equal(mel.d, '2026-11-26', 'at this clock Melbourne is on 26 November, so the test is not depending on the real time of day');
  const results = await db.exec(atFixedClock(read('supabase/coaching-portal-verify.sql')));
  const table = results.find(r => r.rows && r.rows.length && r.rows[0].check_name);
  assert.ok(table, 'the script ends with a results table');
  const failed = table.rows.filter(r => r.result !== 'PASS');
  assert.deepEqual(failed.map(r => r.check_name + ': ' + r.detail), [], 'no FAIL rows at the fixed clock');
  const london = table.rows.filter(r => /London/.test(r.check_name));
  assert.ok(london.length >= 4, 'the London checks ran: ' + london.length);
  await db.close();
});

test('supabase/coaching-portal-4c.sql: applies on top of 4b2, and running it a second time is harmless', async () => {
  const db = await newDb();
  await db.exec(read('supabase/coaching-portal-4b.sql'));
  await db.exec(read('supabase/coaching-portal-4b2.sql'));
  await db.exec(read('supabase/coaching-portal-4c.sql'));
  await db.exec(read('supabase/coaching-portal-4c.sql'));
  await db.exec(read('supabase/coaching-portal-4c2.sql'));
  await db.exec(read('supabase/coaching-portal-4d.sql'));
  await db.exec(read('supabase/coaching-portal-4d2.sql'));
  await db.exec(read('supabase/coaching-portal-4c2.sql'));
  await db.exec(read('supabase/coaching-portal-4d.sql'));
  await db.exec(read('supabase/coaching-portal-4d2.sql'));
  const cols = await scalar(db, `select count(*)::int as n from information_schema.columns
    where table_name = 'coaching_clients' and column_name in ('health_flag', 'health_cleared_at', 'health_cleared_by', 'paused_at', 'pause_days_used')`);
  assert.equal(cols.n, 5);
  const anonFns = await scalar(db, `select count(*)::int as n from information_schema.routine_privileges
    where grantee in ('anon', 'PUBLIC') and routine_name in ('get_coach_whatsapp', 'coach_status', 'coach_add_client', 'coach_publish_plan', 'coach_marketing_export', 'coach_ai_use_coach')`);
  assert.equal(anonFns.n, 0, 'anon cannot run any of the new functions');
  await db.close();
});
