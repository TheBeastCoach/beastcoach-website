-- Coaching portal: step 4c (the coach side).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Run AFTER supabase/coaching-portal-4b2.sql. Additive and safe to run twice.
--
-- What it adds:
--   1. Health flag on each client (worked out from the onboarding answers), and "Cleared to start" (who and when).
--      Activation is refused by the database while a flag is not cleared.
--   2. Pauses: Core and The Beast only, 14 pause days per plan, counted by the database. The end date moves
--      by the days paused. Pause days can never go over 14.
--   3. Activation: activated_at is set to now, and the end date to the start date plus 12 weeks.
--   4. Check-in rules: Basic gets none, Essential gets one kick-off call, Core and The Beast any number.
--   5. The coach can edit capacity (place_limit).
--   6. coaching_settings: the coach's WhatsApp number. Only the coach can read or change it.
--      get_coach_whatsapp() gives it only to a signed-in client on an active or paused The Beast plan.
--   7. coach_add_client(): add a client by hand, refused when the plan is full.
--   8. coach_publish_plan(): publish a new plan version (old versions are kept).
--   9. coach_marketing_export(): customers who said yes to news and have not unsubscribed.
--  10. coach_status(): tells a signed-in user whether they are the coach (for the coach sign-in page).
--  11. coach_ai_use_coach(): the coach's own Beast AI counter (200 a day), separate from clients.
--  12. Basic privacy: the coach cannot read a Basic client's meals, workouts, steps or weigh-ins,
--      as the privacy page promises.
-- Every coach action still needs is_coach(): listed in coaching_admins AND signed in with MFA (aal2).

-- =====================================================================
-- 1. New columns on coaching_clients
-- =====================================================================

-- A health flag: any "yes" to the three health questions, or an injury written in onboarding.
create or replace function public.coaching_health_flag(p_onboarding jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_onboarding -> 'health' ->> 'heart', '') = 'yes'
      or coalesce(p_onboarding -> 'health' ->> 'chest', '') = 'yes'
      or coalesce(p_onboarding -> 'health' ->> 'other', '') = 'yes'
      or lower(trim(coalesce(p_onboarding ->> 'injuries', ''))) not in ('', 'none', 'no', 'nil', 'n/a', 'na', '-', 'nothing', 'no injuries');
$$;

alter table public.coaching_clients add column if not exists health_flag boolean
  generated always as (public.coaching_health_flag(onboarding)) stored;
alter table public.coaching_clients add column if not exists health_cleared_at timestamptz;
alter table public.coaching_clients add column if not exists health_cleared_by uuid references auth.users (id) on delete set null;
alter table public.coaching_clients add column if not exists paused_at timestamptz;
alter table public.coaching_clients add column if not exists pause_days_used integer not null default 0;

alter table public.coaching_clients drop constraint if exists coaching_clients_pause_days_check;
alter table public.coaching_clients add constraint coaching_clients_pause_days_check
  check (pause_days_used between 0 and 14);

-- =====================================================================
-- 2. Status rules on coaching_clients (run for every insert and update, whoever makes it)
-- =====================================================================
create or replace function public.coaching_clients_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old text := case when tg_op = 'UPDATE' then old.status else null end;
  v_days integer;
begin
  -- Cleared to start: the database records who and when. It cannot be set to another person or time.
  if tg_op = 'UPDATE' then
    if new.health_cleared_at is distinct from old.health_cleared_at then
      if new.health_cleared_at is null then
        new.health_cleared_by := null;
      else
        new.health_cleared_at := now();
        new.health_cleared_by := auth.uid();
      end if;
    else
      new.health_cleared_by := old.health_cleared_by;
    end if;
  elsif new.health_cleared_at is not null then
    new.health_cleared_at := now();
    new.health_cleared_by := auth.uid();
  end if;

  -- Activation (not a resume) is refused while a coached client's health flag is not cleared.
  if new.status = 'active' and v_old is distinct from 'active' and v_old is distinct from 'paused'
     and new.tier <> 'basic' and public.coaching_health_flag(new.onboarding) and new.health_cleared_at is null then
    raise exception 'This client has a health flag. Tick "Cleared to start" before you activate.' using errcode = 'P0001';
  end if;

  -- Activation by the coach: activated now, ends 12 weeks after the start date.
  if new.status = 'active' and v_old = 'awaiting_activation' then
    new.activated_at := now();
    new.end_date := new.start_date + 84;
  end if;

  -- A row written straight in as paused (data entry, not a pause) just gets its pause start.
  if tg_op = 'INSERT' and new.status = 'paused' then
    new.paused_at := coalesce(new.paused_at, now());
  end if;

  -- Pausing: Core and The Beast only, from active only, while pause days are left.
  if tg_op = 'UPDATE' and new.status = 'paused' and v_old is distinct from 'paused' then
    if v_old is distinct from 'active' then
      raise exception 'Only an active plan can be paused.' using errcode = 'P0001';
    end if;
    if new.tier not in ('core', 'beast') then
      raise exception 'Only Core and The Beast can be paused.' using errcode = 'P0001';
    end if;
    if old.pause_days_used >= 14 then
      raise exception 'All 14 pause days are used.' using errcode = 'P0001';
    end if;
    new.paused_at := now();
  end if;

  -- Leaving a pause: count the days (Melbourne dates), never past 14, and move the end date by them.
  if v_old = 'paused' and new.status <> 'paused' then
    v_days := greatest(0, (now() at time zone 'Australia/Melbourne')::date
                          - (coalesce(old.paused_at, now()) at time zone 'Australia/Melbourne')::date);
    v_days := least(v_days, 14 - old.pause_days_used);
    new.pause_days_used := old.pause_days_used + v_days;
    if new.status = 'active' and new.end_date is not null then
      new.end_date := new.end_date + v_days;
    end if;
    new.paused_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists coaching_clients_rules on public.coaching_clients;
create trigger coaching_clients_rules
  before insert or update on public.coaching_clients
  for each row execute function public.coaching_clients_rules();

-- =====================================================================
-- 3. Check-in rules: Basic none, Essential one kick-off call, Core and The Beast any number
-- =====================================================================
create or replace function public.coaching_checkin_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
begin
  select c.tier into v_tier from public.coaching_clients c where c.id = new.client_id;
  if v_tier = 'basic' then
    raise exception 'Basic does not include check-ins.' using errcode = 'P0001';
  end if;
  if v_tier = 'essential' then
    if new.type <> 'Kick-off call' then
      raise exception 'Essential includes one kick-off call only.' using errcode = 'P0001';
    end if;
    if new.status = 'scheduled' and exists (
      select 1 from public.coaching_checkins x
       where x.client_id = new.client_id and x.status = 'scheduled' and x.id <> new.id) then
      raise exception 'Essential includes one kick-off call. Edit or cancel the one already booked.' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists coaching_checkin_rules on public.coaching_checkins;
create trigger coaching_checkin_rules
  before insert or update on public.coaching_checkins
  for each row execute function public.coaching_checkin_rules();

-- =====================================================================
-- 4. Capacity: the coach can read and change place_limit
-- =====================================================================
drop policy if exists "capacity: coach full access" on public.coaching_capacity;
create policy "capacity: coach full access" on public.coaching_capacity
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
revoke all on public.coaching_capacity from anon, authenticated;
grant select, update (place_limit, updated_at) on public.coaching_capacity to authenticated;

-- =====================================================================
-- 5. Coach settings: the WhatsApp number (one row). Coach only.
-- =====================================================================
create table if not exists public.coaching_settings (
  id              boolean primary key default true check (id),
  coach_whatsapp  text check (coach_whatsapp is null or coach_whatsapp ~ '^\+?[0-9 ]{6,20}$'),
  updated_at      timestamptz not null default now()
);
alter table public.coaching_settings enable row level security;
drop policy if exists "settings: coach full access" on public.coaching_settings;
create policy "settings: coach full access" on public.coaching_settings
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());
revoke all on public.coaching_settings from anon, authenticated;
grant select, insert, update on public.coaching_settings to authenticated;

-- The number, only for a signed-in client on an active or paused The Beast plan. Nobody else gets anything.
create or replace function public.get_coach_whatsapp()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.coach_whatsapp
    from public.coaching_settings s
   where s.id
     and exists (select 1 from public.coaching_clients c
                  where c.user_id = auth.uid() and c.tier = 'beast' and c.status in ('active', 'paused'));
$$;

-- =====================================================================
-- 6. Coach functions
-- =====================================================================

-- For the coach sign-in page: is this user the coach, and is the session MFA-verified? Only about the caller.
create or replace function public.coach_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', exists (select 1 from public.coaching_admins a where a.user_id = auth.uid()),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'));
$$;

-- Add a client by hand: the client row (awaiting onboarding) and the customer record (marketing consent off).
-- Refused when the plan is full. The capacity row is locked so two adds cannot both take the last place.
create or replace function public.coach_add_client(p_email text, p_name text, p_tier text, p_amount_cents integer, p_paid_on date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := trim(coalesce(p_email, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_limit integer;
  v_taken integer;
  v_id bigint;
begin
  if not public.is_coach() then
    raise exception 'Only the coach can add clients.' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'error', 'Enter a valid email.');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter the client''s name.');
  end if;
  if p_tier is null or p_tier not in ('basic', 'essential', 'core', 'beast') then
    return jsonb_build_object('ok', false, 'error', 'Choose a plan.');
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter the amount paid.');
  end if;
  if p_paid_on is null then
    return jsonb_build_object('ok', false, 'error', 'Enter the date they paid.');
  end if;

  if p_tier <> 'basic' then
    select cap.place_limit into v_limit from public.coaching_capacity cap where cap.tier = p_tier for update;
    select count(*) into v_taken from public.coaching_clients c
     where c.tier = p_tier and c.status in ('awaiting_onboarding', 'awaiting_activation', 'active', 'paused');
    if v_taken >= coalesce(v_limit, 0) then
      return jsonb_build_object('ok', false, 'error', 'That plan is full. Raise the capacity first, or choose another plan.');
    end if;
  end if;

  if exists (select 1 from public.coaching_clients c
              where lower(c.email) = lower(v_email) and c.status not in ('finished', 'cancelled')) then
    return jsonb_build_object('ok', false, 'error', 'This email already has an open plan.');
  end if;

  insert into public.coaching_clients (email, name, tier, status, start_date)
  values (v_email, v_name, p_tier, 'awaiting_onboarding', public.melbourne_today())
  returning id into v_id;

  insert into public.coaching_customers (email, name, tier, amount_cents, purchased_at, marketing_consent)
  values (v_email, v_name, p_tier, p_amount_cents, p_paid_on::timestamp at time zone 'Australia/Melbourne', false);

  return jsonb_build_object('ok', true, 'client_id', v_id);
end;
$$;

-- Publish a plan: a new version becomes current, older versions are kept. One statement, so the client
-- never sees a moment with no current plan. Not for Basic (Basic has no coach plan).
create or replace function public.coach_publish_plan(p_client_id bigint, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not public.is_coach() then
    raise exception 'Only the coach can publish plans.' using errcode = '42501';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(coalesce(p_plan -> 'meals', '{}'::jsonb)) <> 'object'
     or coalesce(jsonb_typeof(p_plan -> 'training'), 'string') <> 'string' then
    return jsonb_build_object('ok', false, 'error', 'The plan is not in the right shape.');
  end if;
  perform 1 from public.coaching_clients c where c.id = p_client_id and c.tier <> 'basic' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'There is no coaching plan for that client.');
  end if;
  select coalesce(max(p.version), 0) + 1 into v_version from public.coaching_plans p where p.client_id = p_client_id;
  update public.coaching_plans p set is_current = false, updated_at = now() where p.client_id = p_client_id and p.is_current;
  insert into public.coaching_plans (client_id, version, is_current, plan) values (p_client_id, v_version, true, p_plan);
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

-- The marketing list for the CSV: one row per email, only if they said yes and have not unsubscribed.
create or replace function public.coach_marketing_export()
returns table (email text, name text, plan text, purchased_on date)
language sql
stable
security definer
set search_path = ''
as $$
  with per_email as (
    select lower(cu.email) as k,
           bool_or(cu.marketing_consent) as said_yes,
           bool_or(cu.unsubscribed_at is not null) as unsubscribed,
           (array_agg(cu.email order by cu.purchased_at desc))[1] as email,
           (array_agg(cu.name order by cu.purchased_at desc))[1] as name,
           (array_agg(cu.tier order by cu.purchased_at desc))[1] as plan,
           max(cu.purchased_at) as last_at
      from public.coaching_customers cu
     group by lower(cu.email)
  )
  select p.email, p.name, p.plan, (p.last_at at time zone 'Australia/Melbourne')::date
    from per_email p
   where public.is_coach() and p.said_yes and not p.unsubscribed
   order by p.email;
$$;

-- The coach's own Beast AI counter for the meal plan builder: 200 a day, kept apart from every client
-- and from the shared client total. Server only (service role).
create or replace function public.coach_ai_use_coach(p_limit integer)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Australia/Melbourne')::date;
  v_used integer;
begin
  insert into public.coach_ai_usage (day, client_id, n_used) values (v_day, -1, 0) on conflict do nothing;
  select u.n_used into v_used from public.coach_ai_usage u where u.day = v_day and u.client_id = -1 for update;
  if v_used >= p_limit then
    return query select false, 'coach'::text;
    return;
  end if;
  update public.coach_ai_usage u set n_used = u.n_used + 1 where u.day = v_day and u.client_id = -1;
  return query select true, 'ok'::text;
end;
$$;

-- =====================================================================
-- 7. Basic privacy: the coach reads logs only for coached plans (Essential, Core, The Beast)
-- =====================================================================
create or replace function public.client_is_coached(p_client_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.coaching_clients c where c.id = p_client_id and c.tier <> 'basic');
$$;

drop policy if exists "meals: coach full access" on public.coaching_meal_logs;
create policy "meals: coach full access" on public.coaching_meal_logs
  for all to authenticated
  using (public.is_coach() and public.client_is_coached(client_id))
  with check (public.is_coach() and public.client_is_coached(client_id));

drop policy if exists "workouts: coach full access" on public.coaching_workout_logs;
create policy "workouts: coach full access" on public.coaching_workout_logs
  for all to authenticated
  using (public.is_coach() and public.client_is_coached(client_id))
  with check (public.is_coach() and public.client_is_coached(client_id));

drop policy if exists "steps: coach full access" on public.coaching_step_logs;
create policy "steps: coach full access" on public.coaching_step_logs
  for all to authenticated
  using (public.is_coach() and public.client_is_coached(client_id))
  with check (public.is_coach() and public.client_is_coached(client_id));

drop policy if exists "weighins: coach full access" on public.coaching_weigh_ins;
create policy "weighins: coach full access" on public.coaching_weigh_ins
  for all to authenticated
  using (public.is_coach() and public.client_is_coached(client_id))
  with check (public.is_coach() and public.client_is_coached(client_id));

-- =====================================================================
-- 8. Grants
-- =====================================================================

-- The new client columns can be read (a client sees only their own row; the coach sees all).
grant select (health_flag, health_cleared_at, health_cleared_by, paused_at, pause_days_used)
  on public.coaching_clients to authenticated;

revoke all on function public.coaching_health_flag(jsonb) from public, anon;
grant execute on function public.coaching_health_flag(jsonb) to authenticated;
revoke all on function public.coaching_clients_rules() from public, anon, authenticated;
revoke all on function public.coaching_checkin_rules() from public, anon, authenticated;
revoke all on function public.client_is_coached(bigint) from public, anon;
grant execute on function public.client_is_coached(bigint) to authenticated;

revoke all on function public.get_coach_whatsapp() from public, anon;
grant execute on function public.get_coach_whatsapp() to authenticated;
revoke all on function public.coach_status() from public, anon;
grant execute on function public.coach_status() to authenticated;
revoke all on function public.coach_add_client(text, text, text, integer, date) from public, anon;
grant execute on function public.coach_add_client(text, text, text, integer, date) to authenticated;
revoke all on function public.coach_publish_plan(bigint, jsonb) from public, anon;
grant execute on function public.coach_publish_plan(bigint, jsonb) to authenticated;
revoke all on function public.coach_marketing_export() from public, anon;
grant execute on function public.coach_marketing_export() to authenticated;
revoke all on function public.coach_ai_use_coach(integer) from public, anon, authenticated;
grant execute on function public.coach_ai_use_coach(integer) to service_role;
