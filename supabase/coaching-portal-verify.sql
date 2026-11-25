-- Coaching portal: verification (run AFTER supabase/coaching-portal.sql).
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--
-- What it does:
--   * Creates stub users, coaching rows, logs and a customer row inside ONE transaction.
--   * Acts as anon, client A, client B, a coach without MFA (aal1) and a coach with MFA (aal2),
--     using set local role and request claims, and re-runs the key rules from tests/coaching-portal-rls.test.js.
--   * Records every check as PASS or FAIL in a temporary table and shows them in the results panel.
--   * Ends with ROLLBACK, so NOTHING is left behind: no stub users, rows, logs or customers.
--   * Each check is isolated. If one errors, it is recorded as FAIL and the rest still run.
--
-- The checks compare against counts taken in the same transaction, not fixed numbers, so they are
-- correct on the live project, which already holds real coaching rows. Nothing real is changed.
--
-- Read the result: the last table shows one row per check, with PASS or FAIL and a short detail.

begin;

-- Results, and the stub identities. Both live only inside this transaction.
create temp table verify_results (
  seq     int,
  check_name text,
  result  text,
  detail  text
) on commit drop;

create temp table verify_ids (
  name   text primary key,        -- 'A', 'B', 'C' (coach), 'U' (unconfirmed), 'N' (confirmed, mixed-case email), 'X' (no plan)
  id     uuid not null,
  email  text not null
) on commit drop;

-- Records one check.
create function pg_temp.verify_record(p_name text, p_ok boolean, p_detail text)
returns void language plpgsql as $$
begin
  insert into verify_results (seq, check_name, result, detail)
  values ((select count(*) + 1 from verify_results), p_name, case when p_ok then 'PASS' else 'FAIL' end, coalesce(p_detail, ''));
end;
$$;

-- Acts as a role with the claims of a stub user (p_who) or, for 'anon', with no claims.
create function pg_temp.verify_as(p_role text, p_who text, p_aal text default 'aal1')
returns void language plpgsql as $$
declare
  v_id uuid;
  v_email text;
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{}', true);
  else
    select i.id, i.email into v_id, v_email from verify_ids i where i.name = p_who;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated', 'aal', p_aal)::text, true);
  end if;
  execute format('set local role %I', p_role);
end;
$$;

-- Goes back to the database owner and clears the claims.
create function pg_temp.verify_reset()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- 1. Stub identities and data ----------------------------------------------------------
-- The identities are written first, outside the block below, so they survive if the block fails.
insert into verify_ids (name, id, email) values
  ('A', gen_random_uuid(), 'verify-a@verify.invalid'),
  ('B', gen_random_uuid(), 'verify-b@verify.invalid'),
  ('C', gen_random_uuid(), 'verify-coach@verify.invalid'),
  ('U', gen_random_uuid(), 'verify-unconfirmed@verify.invalid'),
  ('N', gen_random_uuid(), 'VERIFY-New.Client@Verify.invalid'),
  ('X', gen_random_uuid(), 'verify-stranger@verify.invalid'),
  ('L', gen_random_uuid(), 'verify-london@verify.invalid');   -- a confirmed client in London (time zone checks)

do $$
declare
  v_today_day text := (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from public.melbourne_today())::int];
  v_a bigint; v_b bigint; v_n bigint;
begin
  -- Only the columns every auth.users table has. Other columns take their defaults.
  insert into auth.users (id, email, email_confirmed_at)
  select i.id, i.email,
         case when i.name = 'U' then null else now() - interval '2 days' end
    from verify_ids i;

  insert into public.coaching_admins (user_id) select id from verify_ids where name = 'C';

  insert into public.coaching_clients (user_id, email, name, tier, status, activated_at, start_date, onboarding)
  select i.id, i.email, 'Verify ' || i.name, 'core', 'active', now() - interval '10 days', public.melbourne_today() - 10,
         jsonb_build_object('weighInDay', v_today_day)
    from verify_ids i where i.name = 'A';
  select id into v_a from public.coaching_clients where email = 'verify-a@verify.invalid';

  insert into public.coaching_clients (user_id, email, name, tier, status, activated_at, start_date, onboarding)
  select i.id, i.email, 'Verify B', 'essential', 'active', now() - interval '10 days', public.melbourne_today() - 10,
         jsonb_build_object('weighInDay', v_today_day)
    from verify_ids i where i.name = 'B';
  select id into v_b from public.coaching_clients where email = 'verify-b@verify.invalid';

  -- Unclaimed rows for the claim checks: one for the unconfirmed user, one for the mixed-case confirmed user.
  insert into public.coaching_clients (email, name, tier, status, start_date) values
    ('verify-unconfirmed@verify.invalid', 'Verify unconfirmed', 'essential', 'awaiting_onboarding', public.melbourne_today()),
    ('verify-new.client@verify.invalid', 'Verify new client', 'core', 'awaiting_onboarding', public.melbourne_today());
  select id into v_n from public.coaching_clients where email = 'verify-new.client@verify.invalid';

  insert into public.coaching_plans (client_id, version, is_current, plan) values (v_a, 1, true, '{"meals": []}');
  insert into public.coaching_meal_logs (client_id, log_date, name, calories, source) values
    (v_a, public.melbourne_today(), 'Verify toast A', 300, 'typed'),
    (v_b, public.melbourne_today(), 'Verify toast B', 310, 'typed');
  insert into public.coaching_workout_logs (client_id, log_date, kind, what, minutes) values
    (v_b, public.melbourne_today(), 'other', 'Verify football', 45);
  insert into public.coaching_checkins (client_id, type, scheduled_at) values (v_a, 'Check-in', now() + interval '2 days');
  insert into public.coaching_customers (email, name, tier, amount_cents, marketing_consent) values
    ('verify-a@verify.invalid', 'Verify A', 'core', 29900, true),
    ('verify-b@verify.invalid', 'Verify B', 'essential', 11000, false);

  -- Client L: London. Active for 10 days, so today in London and the 3 days before it are open to log.
  insert into public.coaching_clients (user_id, email, name, tier, status, activated_at, start_date, time_zone, onboarding)
  select i.id, i.email, 'Verify London', 'core', 'active', now() - interval '10 days', public.melbourne_today() - 10, 'Europe/London', '{}'::jsonb
    from verify_ids i where i.name = 'L';
exception when others then
  perform pg_temp.verify_record('setup: stub data', false, sqlerrm);
end $$;

-- 2. Anon ------------------------------------------------------------------------------
do $$
declare n int; blocked int := 0;
begin
  perform pg_temp.verify_as('anon', 'anon');
  begin select count(*) into n from public.coaching_clients;
  exception when others then n := 0; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('anon: reads no coaching rows', n = 0, 'rows visible to anon: ' || n);

  perform pg_temp.verify_as('anon', 'anon');
  begin
    begin perform 1 from public.coaching_customers; exception when others then blocked := blocked + 1; end;
    begin perform 1 from public.coaching_admins; exception when others then blocked := blocked + 1; end;
    begin perform 1 from public.coaching_notes; exception when others then blocked := blocked + 1; end;
    begin perform 1 from public.coaching_meal_logs; exception when others then blocked := blocked + 1; end;
  end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('anon: customers, admins, notes and logs are refused', blocked = 4, 'refused: ' || blocked || ' of 4');

  perform pg_temp.verify_as('anon', 'anon');
  begin perform public.claim_coaching(); blocked := -1; exception when others then null; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('anon: cannot run claim_coaching', blocked <> -1, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('anon: checks', false, 'error: ' || sqlerrm);
end $$;

do $$
declare n int;
begin
  perform pg_temp.verify_as('anon', 'anon');
  select count(*) into n from public.coaching_places();
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('anon: spot counts are readable', n >= 1, 'rows: ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('anon: spot counts are readable', false, 'error: ' || sqlerrm);
end $$;

-- 3. Client A -------------------------------------------------------------------------
do $$
declare n int; total int; a_id bigint; b_id bigint;
begin
  select id into a_id from public.coaching_clients where email = 'verify-a@verify.invalid';
  select id into b_id from public.coaching_clients where email = 'verify-b@verify.invalid';

  perform pg_temp.verify_as('authenticated', 'A');
  select count(*) into n from public.coaching_clients;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: sees only their own client row', n = 1, 'rows: ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: sees only their own client row', false, 'error: ' || sqlerrm);
end $$;

do $$
declare n int; b_meals int;
begin
  select count(*) into b_meals from public.coaching_meal_logs
   where client_id = (select id from public.coaching_clients where email = 'verify-b@verify.invalid');
  perform pg_temp.verify_as('authenticated', 'A');
  select count(*) into n from public.coaching_meal_logs
   where client_id = (select id from public.coaching_clients where email = 'verify-b@verify.invalid');
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read client B''s meals', n = 0 and b_meals >= 1, 'B has ' || b_meals || ' meal(s) in the database; A sees ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read client B''s meals', false, 'error: ' || sqlerrm);
end $$;

do $$
declare n int; upd int;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  update public.coaching_meal_logs set calories = 1
   where client_id = (select id from public.coaching_clients where email = 'verify-b@verify.invalid');
  get diagnostics upd = row_count;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot change client B''s meal', upd = 0, 'rows changed: ' || upd);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot change client B''s meal', false, 'error: ' || sqlerrm);
end $$;

do $$
declare n int;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  select count(*) into n from public.coaching_customers;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read the customer list', n = 0, 'rows: ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read the customer list', false, 'error: ' || sqlerrm);
end $$;

do $$
declare n int;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  select count(*) into n from public.coaching_admins;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read the coach list', n = 0, 'rows: ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read the coach list', false, 'error: ' || sqlerrm);
end $$;

do $$
declare refused boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  begin perform notes from public.coaching_clients limit 1;
  exception when others then refused := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read the coach notes column', refused, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot read the coach notes column', false, 'error: ' || sqlerrm);
end $$;

do $$
declare upd int; tier_now text;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  update public.coaching_clients set tier = 'beast', status = 'finished'
   where email = 'verify-a@verify.invalid';
  get diagnostics upd = row_count;
  perform pg_temp.verify_reset();
  select tier into tier_now from public.coaching_clients where email = 'verify-a@verify.invalid';
  perform pg_temp.verify_record('client A: cannot change their own tier or status', upd = 0 and tier_now = 'core',
    'rows changed: ' || upd || ', tier now: ' || tier_now);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: cannot change their own tier or status', false, 'error: ' || sqlerrm);
end $$;

-- Logging window: today and 3 days back are allowed; 4 days back and before activation are refused.
do $$
declare ok_today boolean := false; ok_three boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  insert into public.coaching_step_logs (client_id, log_date, steps)
    values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today(), 5000);
  ok_today := true;
  insert into public.coaching_step_logs (client_id, log_date, steps)
    values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today() - 3, 5000);
  ok_three := true;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: can log today and 3 days back', ok_today and ok_three, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: can log today and 3 days back', false, 'error: ' || sqlerrm);
end $$;

do $$
declare refused_four boolean := false; refused_before boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  begin
    insert into public.coaching_step_logs (client_id, log_date, steps)
      values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today() - 4, 5000);
  exception when others then refused_four := true; end;
  begin
    insert into public.coaching_step_logs (client_id, log_date, steps)
      values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today() - 11, 5000);
  exception when others then refused_before := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: refused 4 days back', refused_four, '');
  perform pg_temp.verify_record('client A: refused before activation (11 days back)', refused_before, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: refused outside the logging window', false, 'error: ' || sqlerrm);
end $$;

-- One weigh-in a week: the first is allowed on the weigh-in day; a second the same week, or on another day, is refused.
do $$
declare first_ok boolean := false; second_refused boolean := false; wrong_day_refused boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  insert into public.coaching_weigh_ins (client_id, weigh_date, kg)
    values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today(), 84.2);
  first_ok := true;
  begin
    insert into public.coaching_weigh_ins (client_id, weigh_date, kg)
      values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today(), 84.0);
  exception when others then second_refused := true; end;
  begin
    insert into public.coaching_weigh_ins (client_id, weigh_date, kg)
      values ((select id from public.coaching_clients where email = 'verify-a@verify.invalid'), public.melbourne_today() - 1, 84.0);
  exception when others then wrong_day_refused := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: one weigh-in in a week, the first allowed', first_ok, '');
  perform pg_temp.verify_record('client A: a second weigh-in the same week is refused', second_refused, '');
  perform pg_temp.verify_record('client A: a weigh-in on a day other than the chosen one is refused', wrong_day_refused, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A: weigh-in rules', false, 'error: ' || sqlerrm);
end $$;

-- 4. Client B -------------------------------------------------------------------------
do $$
declare n int; a_meals int;
begin
  select count(*) into a_meals from public.coaching_meal_logs
   where client_id = (select id from public.coaching_clients where email = 'verify-a@verify.invalid');
  perform pg_temp.verify_as('authenticated', 'B');
  select count(*) into n from public.coaching_meal_logs
   where client_id = (select id from public.coaching_clients where email = 'verify-a@verify.invalid');
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client B: cannot read client A''s meals', n = 0 and a_meals >= 1, 'A has ' || a_meals || '; B sees ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client B: cannot read client A''s meals', false, 'error: ' || sqlerrm);
end $$;

-- 5. Coach: without MFA (aal1) and with MFA (aal2) ---------------------------------------
do $$
declare n_clients int; n_customers int; n_meals int;
begin
  perform pg_temp.verify_as('authenticated', 'C', 'aal1');
  select count(*) into n_clients from public.coaching_clients;
  select count(*) into n_customers from public.coaching_customers;
  select count(*) into n_meals from public.coaching_meal_logs;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('coach without MFA (aal1) sees no clients, customers or logs',
    n_clients = 0 and n_customers = 0 and n_meals = 0, 'clients ' || n_clients || ', customers ' || n_customers || ', meals ' || n_meals);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('coach without MFA (aal1) sees no clients, customers or logs', false, 'error: ' || sqlerrm);
end $$;

do $$
declare seen int; total int; seen_c int; total_c int; seen_m int; total_m int;
begin
  select count(*) into total from public.coaching_clients;
  select count(*) into total_c from public.coaching_customers;
  select count(*) into total_m from public.coaching_meal_logs;
  perform pg_temp.verify_as('authenticated', 'C', 'aal2');
  select count(*) into seen from public.coaching_clients;
  select count(*) into seen_c from public.coaching_customers;
  select count(*) into seen_m from public.coaching_meal_logs;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('coach with MFA (aal2) sees every client, customer and log',
    seen = total and seen_c = total_c and seen_m = total_m and total >= 2,
    'clients ' || seen || '/' || total || ', customers ' || seen_c || '/' || total_c || ', meals ' || seen_m || '/' || total_m);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('coach with MFA (aal2) sees every client, customer and log', false, 'error: ' || sqlerrm);
end $$;

-- 6. Claiming a plan -----------------------------------------------------------------
do $$
declare r jsonb; linked_u boolean;
begin
  perform pg_temp.verify_as('authenticated', 'U');
  r := public.claim_coaching();
  perform pg_temp.verify_reset();
  select (user_id is not null) into linked_u from public.coaching_clients where email = 'verify-unconfirmed@verify.invalid';
  perform pg_temp.verify_record('claim: an unconfirmed email is not linked',
    (r ->> 'linked') = 'false' and linked_u = false, 'result: ' || r::text);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('claim: an unconfirmed email is not linked', false, 'error: ' || sqlerrm);
end $$;

do $$
declare r jsonb; linked_n boolean;
begin
  perform pg_temp.verify_as('authenticated', 'N');
  r := public.claim_coaching();
  perform pg_temp.verify_reset();
  select (user_id is not null) into linked_n from public.coaching_clients where email = 'verify-new.client@verify.invalid';
  perform pg_temp.verify_record('claim: a confirmed email links the plan, whatever the case of the email',
    (r ->> 'linked') = 'true' and linked_n = true, 'result: ' || r::text);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('claim: a confirmed email links the plan, whatever the case of the email', false, 'error: ' || sqlerrm);
end $$;

do $$
declare r jsonb;
begin
  perform pg_temp.verify_as('authenticated', 'X');
  r := public.claim_coaching();
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('claim: a confirmed user with no plan is told so, and linked to nothing',
    (r ->> 'linked') = 'false' and (r ->> 'reason') = 'no_plan_for_this_email', 'result: ' || r::text);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('claim: a confirmed user with no plan is told so, and linked to nothing', false, 'error: ' || sqlerrm);
end $$;

-- 6b. Older plans (4b): A reads A's older plan, B cannot read it, and A cannot write to it -------
do $$
declare old_id bigint; old_meal_id uuid; n int; upd int; refused boolean := false;
begin
  -- An older, finished 12-week plan for client A, with one meal from that plan.
  insert into public.coaching_clients (user_id, email, name, tier, status, activated_at, start_date, onboarding)
  select i.id, i.email, 'Verify A older plan', 'core', 'finished', now() - interval '150 days',
         public.melbourne_today() - 150, '{}'
    from verify_ids i where i.name = 'A';
  select id into old_id from public.coaching_clients where name = 'Verify A older plan';
  insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
    values (old_id, public.melbourne_today() - 120, 'Verify older meal', 400, 'typed')
    returning id into old_meal_id;
exception when others then
  perform pg_temp.verify_record('setup: older plan for client A', false, sqlerrm);
end $$;

do $$
declare n int;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  select count(*) into n from public.coaching_meal_logs
   where client_id = (select id from public.coaching_clients where name = 'Verify A older plan');
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A (4b): reads A''s older plan', n = 1, 'rows: ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A (4b): reads A''s older plan', false, 'error: ' || sqlerrm);
end $$;

do $$
declare n int;
begin
  perform pg_temp.verify_as('authenticated', 'B');
  select count(*) into n from public.coaching_meal_logs
   where client_id = (select id from public.coaching_clients where name = 'Verify A older plan');
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client B (4b): cannot read A''s older plan', n = 0, 'rows: ' || n);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client B (4b): cannot read A''s older plan', false, 'error: ' || sqlerrm);
end $$;

do $$
declare upd int; refused boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  update public.coaching_meal_logs set calories = 1
   where client_id = (select id from public.coaching_clients where name = 'Verify A older plan');
  get diagnostics upd = row_count;
  begin
    insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
      values ((select id from public.coaching_clients where name = 'Verify A older plan'), public.melbourne_today(), 'Sneaky', 100, 'typed');
  exception when others then refused := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A (4b): cannot change or add to an older plan', upd = 0 and refused,
    'rows changed: ' || upd || ', insert refused: ' || refused);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('client A (4b): cannot change or add to an older plan', false, 'error: ' || sqlerrm);
end $$;

-- Beast AI usage counter (4b): stops at the client limit, and clients cannot use it at all.
do $$
declare r1 boolean; r2 boolean; r3 boolean; r3_reason text; a_id bigint;
begin
  select id into a_id from public.coaching_clients where email = 'verify-a@verify.invalid' and status = 'active';
  select u.allowed into r1 from public.coach_ai_use(a_id, 2, 300000) u;
  select u.allowed into r2 from public.coach_ai_use(a_id, 2, 300000) u;
  select u.allowed, u.reason into r3, r3_reason from public.coach_ai_use(a_id, 2, 300000) u;
  perform pg_temp.verify_record('Beast AI: the client limit stops the third call of the day',
    r1 = true and r2 = true and r3 = false and r3_reason = 'client',
    'calls: ' || r1 || ', ' || r2 || ', then ' || r3 || ' (' || r3_reason || ')');
exception when others then
  perform pg_temp.verify_record('Beast AI: the client limit stops the third call of the day', false, 'error: ' || sqlerrm);
end $$;

do $$
declare call_refused boolean := false; read_refused boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  begin perform 1 from public.coach_ai_use(1, 40, 300); exception when others then call_refused := true; end;
  begin perform 1 from public.coach_ai_usage; exception when others then read_refused := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('Beast AI: a client cannot call the counter or read it', call_refused and read_refused,
    'call refused: ' || call_refused || ', read refused: ' || read_refused);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('Beast AI: a client cannot call the counter or read it', false, 'error: ' || sqlerrm);
end $$;

-- 7. Spot counts: the function must agree with a direct count, for each capacity tier -----
do $$
declare f_taken int; direct_taken int; t text;
begin
  foreach t in array array['essential', 'core', 'beast'] loop
    select count(*) into direct_taken from public.coaching_clients
     where tier = t and status in ('awaiting_onboarding', 'awaiting_activation', 'active', 'paused');
    perform pg_temp.verify_as('anon', 'anon');
    select taken into f_taken from public.coaching_places() where tier = t;
    perform pg_temp.verify_reset();
    perform pg_temp.verify_record('spot counts: ' || t || ' agrees with a direct count',
      f_taken = direct_taken, 'function: ' || coalesce(f_taken::text, 'none') || ', direct: ' || direct_taken);
  end loop;
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('spot counts: agree with a direct count', false, 'error: ' || sqlerrm);
end $$;

do $$
declare basic_listed boolean;
begin
  perform pg_temp.verify_as('anon', 'anon');
  select exists (select 1 from public.coaching_places() where tier = 'basic') into basic_listed;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('spot counts: Basic is never a capacity tier', basic_listed = false, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('spot counts: Basic is never a capacity tier', false, 'error: ' || sqlerrm);
end $$;

-- 7b. Time zones: a London client logs on their own date; the window is in their zone. ------------
do $$
declare l_id bigint; l_zone text; ok_today boolean := false; ok_three boolean := false;
  refused_four boolean := false; l_today date; mel_today date;
begin
  select id into l_id from public.coaching_clients where email = 'verify-london@verify.invalid';
  l_zone := public.client_zone(l_id);
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('London: the client zone is Europe/London', l_zone = 'Europe/London', 'zone: ' || coalesce(l_zone, 'null'));

  -- The London date is worked out here, as the database owner, from the zone itself.
  l_today := (now() at time zone 'Europe/London')::date;
  mel_today := (now() at time zone 'Australia/Melbourne')::date;
  perform pg_temp.verify_as('authenticated', 'L');
  begin
    insert into public.coaching_meal_logs (client_id, log_date, name, calories, source, meal_time)
      values (l_id, l_today, 'Verify London dinner', 650, 'typed', 'Dinner');
    ok_today := true;
  exception when others then ok_today := false; end;
  begin
    insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
      values (l_id, l_today - 3, 'Verify London lunch', 500, 'typed');
    ok_three := true;
  exception when others then ok_three := false; end;
  begin
    insert into public.coaching_meal_logs (client_id, log_date, name, calories, source)
      values (l_id, l_today - 4, 'Verify London too early', 500, 'typed');
  exception when others then refused_four := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('London: logs the evening meal on their own date', ok_today,
    'London date ' || l_today || ' (Melbourne date ' || mel_today || ')');
  perform pg_temp.verify_record('London: can log 3 days back in their own time', ok_three, '');
  perform pg_temp.verify_record('London: refused 4 days back in their own time', refused_four, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('London: time zone logging checks', false, 'error: ' || sqlerrm);
end $$;

-- 7c. Time zone fallback: a missing or unknown zone is Australia/Melbourne; city names map to IANA. ----
do $$
declare l_id bigint; fb text; city_ok boolean; bad_ok boolean; typed_ok boolean;
begin
  select id into l_id from public.coaching_clients where email = 'verify-london@verify.invalid';
  update public.coaching_clients set time_zone = 'Mars/Olympus' where id = l_id;
  fb := public.client_zone(l_id);
  update public.coaching_clients set time_zone = 'Europe/London' where id = l_id;
  city_ok := public.resolve_time_zone('London') = 'Europe/London' and public.resolve_time_zone('london, uk') = 'Europe/London';
  bad_ok := public.resolve_time_zone('Mars/Olympus') = 'Australia/Melbourne' and public.resolve_time_zone('') = 'Australia/Melbourne';
  typed_ok := public.resolve_time_zone('america/new_york') = 'America/New_York';
  perform pg_temp.verify_record('time zone: an unknown stored zone falls back to Australia/Melbourne', fb = 'Australia/Melbourne', 'zone: ' || fb);
  perform pg_temp.verify_record('time zone: a city maps to its IANA zone (London to Europe/London)', city_ok, '');
  perform pg_temp.verify_record('time zone: unknown or empty input falls back to Australia/Melbourne', bad_ok and typed_ok, '');
exception when others then
  perform pg_temp.verify_record('time zone: fallback checks', false, 'error: ' || sqlerrm);
end $$;

-- 7d. Marketing setting: each client sees only their own; anon cannot call it. -----------------------
do $$
declare a_val boolean; b_val boolean; l_val boolean; anon_blocked boolean := false;
begin
  perform pg_temp.verify_as('authenticated', 'A');
  a_val := public.get_my_marketing_consent();
  perform pg_temp.verify_reset();
  perform pg_temp.verify_as('authenticated', 'B');
  b_val := public.get_my_marketing_consent();
  perform pg_temp.verify_reset();
  perform pg_temp.verify_as('authenticated', 'L');
  l_val := public.get_my_marketing_consent();
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('marketing: returns only the signed-in client''s own setting',
    a_val = true and b_val = false and l_val = false,
    'A: ' || coalesce(a_val::text, 'null') || ', B: ' || coalesce(b_val::text, 'null') || ', London (no customer record): ' || coalesce(l_val::text, 'null'));
  perform pg_temp.verify_as('anon', 'anon');
  begin
    perform public.get_my_marketing_consent();
  exception when others then anon_blocked := true; end;
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('marketing: anon cannot call get_my_marketing_consent', anon_blocked, '');
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('marketing: consent checks', false, 'error: ' || sqlerrm);
end $$;

-- 8. Delete: B removes their own data; B's customer row stays; A's data is untouched. Runs last. ---
do $$
declare r jsonb; b_left int; a_left int; cust_left int;
begin
  perform pg_temp.verify_as('authenticated', 'B');
  r := public.delete_my_coaching_data();
  perform pg_temp.verify_reset();
  select count(*) into b_left from public.coaching_clients where email = 'verify-b@verify.invalid';
  select count(*) into a_left from public.coaching_clients where email = 'verify-a@verify.invalid';
  select count(*) into cust_left from public.coaching_customers where email = 'verify-b@verify.invalid';
  perform pg_temp.verify_record('delete_my_coaching_data: removes B''s client row, keeps B''s customer record and A''s data',
    (r ->> 'deleted') = 'true' and b_left = 0 and cust_left = 1 and a_left = 2,
    'B row left: ' || b_left || ', B customer left: ' || cust_left || ', A row left: ' || a_left);
exception when others then
  perform pg_temp.verify_reset();
  perform pg_temp.verify_record('delete_my_coaching_data: removes B''s client row, keeps B''s customer record and A''s data', false, 'error: ' || sqlerrm);
end $$;

-- Results ----------------------------------------------------------------------------------
select seq, check_name, result, detail
  from verify_results
 order by seq;

-- Nothing is kept: every stub user, row, log and customer goes now.
rollback;
