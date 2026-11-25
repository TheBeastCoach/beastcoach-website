-- Coaching portal: step 4b (client side on real data).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Run AFTER supabase/coaching-portal.sql (4a). Additive and safe to run twice.
-- It does not drop or change any non-coaching table, and it does not change any write rule.
--
-- What it adds:
--   1. A client can READ their history: every coaching row linked to their login (older 12-week plans too).
--      Writes still go only to the current active plan (the 4a write rules are unchanged).
--   2. claim_coaching() links a NEW plan for a returning client (an unclaimed row with their email),
--      not only their first plan.
--   3. A usage counter for Beast AI calls: 40 per client per Melbourne day, and 300 shared per day.
--      Only the server (service role) can use it. Clients cannot read or change it.

-- =====================================================================
-- 1. Every coaching row linked to the signed-in user
-- =====================================================================
create or replace function public.my_client_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.coaching_clients c where c.user_id = auth.uid();
$$;

revoke all on function public.my_client_ids() from public, anon;
grant execute on function public.my_client_ids() to authenticated;

-- Read policies move from "the newest plan" to "any plan linked to me". Write policies are untouched.
drop policy if exists "meals: client reads own" on public.coaching_meal_logs;
create policy "meals: client reads own" on public.coaching_meal_logs
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "workouts: client reads own" on public.coaching_workout_logs;
create policy "workouts: client reads own" on public.coaching_workout_logs
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "steps: client reads own" on public.coaching_step_logs;
create policy "steps: client reads own" on public.coaching_step_logs
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "weighins: client reads own" on public.coaching_weigh_ins;
create policy "weighins: client reads own" on public.coaching_weigh_ins
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "plans: client reads own" on public.coaching_plans;
create policy "plans: client reads own" on public.coaching_plans
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists "checkins: client reads own" on public.coaching_checkins;
create policy "checkins: client reads own" on public.coaching_checkins
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

-- =====================================================================
-- 2. claim_coaching(): links a new plan for a returning client
-- =====================================================================
create or replace function public.claim_coaching()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  r public.coaching_clients%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('linked', false, 'reason', 'not_signed_in');
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if v_email is null or v_confirmed is null then
    return jsonb_build_object('linked', false, 'reason', 'email_not_confirmed');
  end if;

  -- First: a row with this confirmed email that nobody has claimed yet (a new plan, or the first one).
  select * into r
    from public.coaching_clients c
   where lower(c.email) = lower(v_email) and c.user_id is null
   order by (c.status not in ('finished', 'cancelled')) desc, c.created_at desc
   limit 1
   for update;
  if found then
    update public.coaching_clients set user_id = v_uid where id = r.id;
    return jsonb_build_object('linked', true, 'status', r.status, 'tier', r.tier, 'client_id', r.id);
  end if;

  -- Otherwise: the newest plan this user already owns.
  select * into r
    from public.coaching_clients c
   where c.user_id = v_uid
   order by (c.status not in ('finished', 'cancelled')) desc, c.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('linked', false, 'reason', 'no_plan_for_this_email');
  end if;
  return jsonb_build_object('linked', true, 'status', r.status, 'tier', r.tier, 'client_id', r.id);
end;
$$;

revoke all on function public.claim_coaching() from public, anon;
grant execute on function public.claim_coaching() to authenticated;

-- =====================================================================
-- 3. Beast AI usage: 40 per client per Melbourne day, 300 shared per day (server only)
-- =====================================================================
-- client_id 0 is the shared row for the whole site.
create table if not exists public.coach_ai_usage (
  day        date not null,
  client_id  bigint not null,
  n_used     integer not null default 0,
  primary key (day, client_id)
);
alter table public.coach_ai_usage enable row level security;   -- no policies: no client can read or write it
revoke all on public.coach_ai_usage from anon, authenticated;

create or replace function public.coach_ai_use(p_client_id bigint, p_client_limit integer, p_shared_limit integer)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
  v_client integer;
  v_shared integer;
begin
  insert into public.coach_ai_usage (day, client_id, n_used) values (v_day, p_client_id, 0) on conflict do nothing;
  insert into public.coach_ai_usage (day, client_id, n_used) values (v_day, 0, 0) on conflict do nothing;

  select u.n_used into v_client from public.coach_ai_usage u where u.day = v_day and u.client_id = p_client_id for update;
  select u.n_used into v_shared from public.coach_ai_usage u where u.day = v_day and u.client_id = 0 for update;

  if v_shared >= p_shared_limit then
    return query select false, 'shared'::text;
    return;
  end if;
  if v_client >= p_client_limit then
    return query select false, 'client'::text;
    return;
  end if;

  update public.coach_ai_usage u set n_used = u.n_used + 1 where u.day = v_day and u.client_id = p_client_id;
  update public.coach_ai_usage u set n_used = u.n_used + 1 where u.day = v_day and u.client_id = 0;
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.coach_ai_use(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.coach_ai_use(bigint, integer, integer) to service_role;
