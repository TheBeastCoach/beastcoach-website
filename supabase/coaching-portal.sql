-- Coaching portal: database, security and login (step 4a).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Additive only: it does not drop or change any non-coaching table, and it is safe to run again.
-- Run supabase/coaching.sql first (it creates coaching_clients, coaching_capacity and coaching_places).
--
-- Who can do what, in plain words:
--   * Anyone signed out: nothing, except the spot counts in coaching_places().
--   * A client (signed in, linked to a coaching_clients row): reads their own row, plan, logs,
--     weigh-ins and check-ins. Adds, changes and deletes their own meal, workout, step and weigh-in
--     rows only for dates from activation onwards and up to 3 days back, and only while active.
--     Cannot change their tier, status, dates or targets. Cannot read anyone else's data.
--   * The coach (listed in coaching_admins, and signed in with MFA, aal2): full access to the coaching
--     tables. Signed in with a password only (aal1), the coach gets nothing.
--   * Customer records (coaching_customers) are readable by the coach only, and they survive a
--     client deleting their own data.

-- =====================================================================
-- 1. coaching_clients: extend the existing table (existing rows keep working)
-- =====================================================================
alter table public.coaching_clients add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.coaching_clients add column if not exists activated_at timestamptz;
alter table public.coaching_clients add column if not exists end_date date;
alter table public.coaching_clients add column if not exists time_zone text;
alter table public.coaching_clients add column if not exists whatsapp text;
alter table public.coaching_clients add column if not exists onboarding jsonb not null default '{}'::jsonb;
alter table public.coaching_clients add column if not exists targets jsonb;

alter table public.coaching_clients drop constraint if exists coaching_clients_tier_check;
alter table public.coaching_clients add constraint coaching_clients_tier_check
  check (tier in ('basic', 'essential', 'core', 'beast'));

alter table public.coaching_clients drop constraint if exists coaching_clients_status_check;
alter table public.coaching_clients add constraint coaching_clients_status_check
  check (status in ('awaiting_onboarding', 'awaiting_activation', 'active', 'paused', 'finished', 'cancelled'));
alter table public.coaching_clients alter column status set default 'awaiting_onboarding';

-- One open plan per email (finished and cancelled plans may share an email).
create unique index if not exists coaching_clients_one_open_per_email
  on public.coaching_clients (lower(email)) where status not in ('finished', 'cancelled');
create index if not exists coaching_clients_user_id on public.coaching_clients (user_id);

-- The coach-only notes column from the first version must never be readable by a client.
-- Coach notes now live in coaching_notes (below). Nobody signed in through the API can read this column.
alter table public.coaching_clients enable row level security;

-- =====================================================================
-- 2. New tables (every one has RLS on). Keys are uuids, so no sequence grants are needed.
-- =====================================================================

-- The permanent customer list. One row per purchase. No foreign key to auth.users or coaching_clients,
-- so it survives a client deleting their data.
create table if not exists public.coaching_customers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  name             text,
  country          text,
  tier             text not null check (tier in ('basic', 'essential', 'core', 'beast', 'discipline_path')),
  purchased_at     timestamptz not null default now(),
  amount_cents     integer not null check (amount_cents >= 0),
  currency         text not null default 'AUD',
  marketing_consent boolean not null default false,
  consent_at       timestamptz,
  consent_wording  text,
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists coaching_customers_email on public.coaching_customers (lower(email));
alter table public.coaching_customers enable row level security;

-- One current meal and workout plan per client. Old versions are kept: only new versions are inserted.
create table if not exists public.coaching_plans (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null references public.coaching_clients (id) on delete cascade,
  version     integer not null check (version >= 1),
  is_current  boolean not null default false,
  plan        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, version)
);
create unique index if not exists coaching_plans_one_current on public.coaching_plans (client_id) where is_current;
create index if not exists coaching_plans_client on public.coaching_plans (client_id);
alter table public.coaching_plans enable row level security;

-- Meals. Matches the demo: name, calories and macros, source, the text typed, the Beast AI estimate.
create table if not exists public.coaching_meal_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null references public.coaching_clients (id) on delete cascade,
  log_date    date not null,
  logged_at   timestamptz not null default now(),
  meal_time   text,
  name        text not null check (char_length(name) between 1 and 80),
  calories    integer not null check (calories between 0 and 5000),
  protein     integer not null default 0 check (protein between 0 and 500),
  carbs       integer not null default 0 check (carbs between 0 and 800),
  fat         integer not null default 0 check (fat between 0 and 400),
  fibre       integer not null default 0 check (fibre between 0 and 200),
  source      text not null check (source in ('plan', 'ai', 'builder', 'typed')),
  entry_text  text check (entry_text is null or char_length(entry_text) <= 600),
  ai          jsonb,
  edited      boolean not null default false,
  added_late  boolean not null default false
);
create index if not exists coaching_meal_logs_client_date on public.coaching_meal_logs (client_id, log_date);
alter table public.coaching_meal_logs enable row level security;

-- Workouts. kind 'plan' has a session (exercises with sets of kg and reps); kind 'other' has what, minutes and notes.
create table if not exists public.coaching_workout_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null references public.coaching_clients (id) on delete cascade,
  log_date    date not null,
  kind        text not null check (kind in ('plan', 'other')),
  what        text not null check (char_length(what) between 1 and 120),
  minutes     integer check (minutes is null or minutes between 0 and 600),
  notes       text check (notes is null or char_length(notes) <= 300),
  session     jsonb,
  added_late  boolean not null default false,
  logged_at   timestamptz not null default now(),
  check ((kind = 'plan' and session is not null) or (kind = 'other' and session is null))
);
create index if not exists coaching_workout_logs_client_date on public.coaching_workout_logs (client_id, log_date);
alter table public.coaching_workout_logs enable row level security;

-- Steps: one count per client per day (saving again replaces the day's count, as in the demo).
create table if not exists public.coaching_step_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null references public.coaching_clients (id) on delete cascade,
  log_date    date not null,
  steps       integer not null check (steps between 0 and 60000),
  added_late  boolean not null default false,
  unique (client_id, log_date)
);
create index if not exists coaching_step_logs_client_date on public.coaching_step_logs (client_id, log_date);
alter table public.coaching_step_logs enable row level security;

-- Weigh-ins: at most one per client per week, enforced here (see the unique key on week_start).
create table if not exists public.coaching_weigh_ins (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null references public.coaching_clients (id) on delete cascade,
  weigh_date  date not null,
  week_start  date not null default date '2000-01-01',   -- set by trigger: the Monday of weigh_date's ISO week
  kg          numeric(5, 2) not null check (kg > 0 and kg < 500),
  created_at  timestamptz not null default now(),
  unique (client_id, week_start)
);
create index if not exists coaching_weigh_ins_client_date on public.coaching_weigh_ins (client_id, weigh_date);
alter table public.coaching_weigh_ins enable row level security;

create or replace function public.coaching_weigh_week()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.week_start := new.weigh_date - (extract(isodow from new.weigh_date)::integer - 1);
  return new;
end;
$$;

drop trigger if exists coaching_weigh_ins_week on public.coaching_weigh_ins;
create trigger coaching_weigh_ins_week
  before insert or update of weigh_date on public.coaching_weigh_ins
  for each row execute function public.coaching_weigh_week();

-- Check-ins and calls (scheduled on WhatsApp, shown in the portal). Times are timestamptz; the coach enters Melbourne time.
create table if not exists public.coaching_checkins (
  id            uuid primary key default gen_random_uuid(),
  client_id     bigint not null references public.coaching_clients (id) on delete cascade,
  type          text not null check (type in ('Kick-off call', 'Check-in', 'Video call')),
  scheduled_at  timestamptz not null,
  status        text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists coaching_checkins_client_time on public.coaching_checkins (client_id, scheduled_at);
alter table public.coaching_checkins enable row level security;

-- Coach-only notes about a client. Never readable by the client.
create table if not exists public.coaching_notes (
  client_id   bigint primary key references public.coaching_clients (id) on delete cascade,
  body        text not null default '',
  updated_at  timestamptz not null default now()
);
alter table public.coaching_notes enable row level security;

-- Coach accounts. Just the coach. Added by hand in the SQL Editor (see docs/COACHING-PORTAL.md).
create table if not exists public.coaching_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.coaching_admins enable row level security;

-- =====================================================================
-- 3. Helper functions (security definer, fixed search_path)
-- =====================================================================

-- True only for a coach who is listed in coaching_admins AND signed in with MFA (aal2).
create or replace function public.is_coach()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.coaching_admins a where a.user_id = auth.uid());
$$;

-- The coaching_clients id linked to the signed-in user (their open plan first, else their newest).
create or replace function public.my_client_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
    from public.coaching_clients c
   where c.user_id = auth.uid()
   order by (c.status not in ('finished', 'cancelled')) desc, c.created_at desc
   limit 1;
$$;

-- Today's date in Melbourne.
create or replace function public.melbourne_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Australia/Melbourne')::date;
$$;

-- A client may log for a date only from their activation date, up to 3 days back, and only while active.
create or replace function public.can_log_on(p_client_id bigint, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.coaching_clients c
     where c.id = p_client_id
       and c.status = 'active'
       and c.activated_at is not null
       and p_date >= (c.activated_at at time zone 'Australia/Melbourne')::date
       and p_date <= public.melbourne_today()
       and p_date >= public.melbourne_today() - 3
  );
$$;

-- The weigh-in day the client chose during onboarding (Mon to Sun).
create or replace function public.is_weigh_day(p_client_id bigint, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.coaching_clients c
     where c.id = p_client_id
       and array_position(array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], c.onboarding ->> 'weighInDay')
           = extract(isodow from p_date)::integer
  );
$$;

-- Basic targets, the same formula as basic-targets.js (ported so the server, not the browser, sets targets).
-- Rounding is half up, as JavaScript's Math.round does for these positive numbers.
create or replace function public.basic_targets(p_answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sex text := p_answers ->> 'sex';
  v_age numeric := (p_answers ->> 'age')::numeric;
  v_height numeric := (p_answers ->> 'heightCm')::numeric;
  v_weight numeric := (p_answers ->> 'weightKg')::numeric;
  v_activity numeric := (p_answers ->> 'jobMult')::numeric;
  v_steps_everyday numeric := (p_answers ->> 'stepsEveryday')::numeric;
  v_steps_realistic numeric := (p_answers ->> 'stepsRealistic')::numeric;
  v_sessions numeric := (p_answers ->> 'trainingSessions')::numeric;
  v_intensity numeric := (p_answers ->> 'trainingIntensity')::numeric;
  v_goal text := p_answers ->> 'goalKind';
  v_bmr numeric;
  v_tdee numeric;
  v_delta numeric;
  v_protein_per_kg numeric;
  v_fat_pct numeric;
  v_target numeric;
  v_protein numeric;
  v_fat_kcal numeric;
  v_carb_kcal numeric;
begin
  if v_sex = 'Male' then
    v_bmr := 10 * v_weight + 6.25 * v_height - 5 * v_age + 5;
  else
    v_bmr := 10 * v_weight + 6.25 * v_height - 5 * v_age - 161;
  end if;
  v_tdee := v_bmr * v_activity + v_steps_everyday * v_weight * 0.00057 + (v_sessions * v_intensity) / 7;
  case v_goal
    when 'fatloss'  then v_delta := -500; v_protein_per_kg := 2.2; v_fat_pct := 0.25;
    when 'maintain' then v_delta := 0;    v_protein_per_kg := 2.0; v_fat_pct := 0.27;
    when 'muscle'   then v_delta := 300;  v_protein_per_kg := 1.8; v_fat_pct := 0.25;
    else raise exception 'unknown goal %', v_goal;
  end case;
  v_target := v_tdee + v_delta;
  v_protein := v_weight * v_protein_per_kg;
  v_fat_kcal := v_target * v_fat_pct;
  v_carb_kcal := greatest(0, v_target - v_protein * 4 - v_fat_kcal);
  return jsonb_build_object(
    'maintenance', floor(v_tdee + 0.5),
    'calories',    floor(v_target + 0.5),
    'protein',     floor(v_protein + 0.5),
    'carbs',       floor(v_carb_kcal / 4 + 0.5),
    'fat',         floor(v_fat_kcal / 9 + 0.5),
    'fibre',       floor((v_target / 1000) * 14 + 0.5),
    'steps',       least(20000, greatest(3000, floor(v_steps_realistic + 0.5)))
  );
end;
$$;

-- Checks the onboarding answers before they are saved. Returns null when they are fine, else a message.
create or replace function public.onboarding_problem(p_answers jsonb, p_tier text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_age numeric;
  v_height numeric;
  v_weight numeric;
  v_steps_every numeric;
  v_steps_real numeric;
  v_sessions numeric;
begin
  if coalesce(trim(p_answers ->> 'timezone'), '') = '' then return 'Enter your time zone or city.'; end if;
  begin
    v_age := (p_answers ->> 'age')::numeric;
    v_height := (p_answers ->> 'heightCm')::numeric;
    v_weight := (p_answers ->> 'weightKg')::numeric;
    v_steps_every := (p_answers ->> 'stepsEveryday')::numeric;
    v_steps_real := (p_answers ->> 'stepsRealistic')::numeric;
    v_sessions := (p_answers ->> 'trainingSessions')::numeric;
  exception when others then
    return 'Please enter numbers where numbers are asked for.';
  end;
  if v_age is null or v_age < 18 or v_age > 100 then return 'Enter your age (18 to 100).'; end if;
  if v_height is null or v_height < 100 or v_height > 250 then return 'Enter your height in cm (100 to 250).'; end if;
  if v_weight is null or v_weight < 30 or v_weight > 400 then return 'Enter your current weight.'; end if;
  if (p_answers ->> 'agreeNotCoach') is distinct from 'true' then
    return 'Please confirm you understand this is general guidance.';
  end if;
  if (p_answers ->> 'agreeTerms') is distinct from 'true' then return 'Please agree to the terms and billing.'; end if;
  if v_steps_every is null or v_steps_every not between 0 and 60000 then
    return 'Enter a number from 0 to 60,000 for everyday steps.';
  end if;
  if v_steps_real is null or v_steps_real not between 3000 and 20000 then
    return 'Enter a target from 3,000 to 20,000.';
  end if;
  if p_tier = 'basic' then
    if (p_answers ->> 'sex') not in ('Male', 'Female') then return 'Choose male or female.'; end if;
    if (p_answers ->> 'goalKind') not in ('fatloss', 'maintain', 'muscle') then return 'Choose a goal.'; end if;
    if (p_answers ->> 'jobMult') not in ('1.15', '1.25', '1.35') then return 'Choose how active your job is.'; end if;
    if v_sessions is null or v_sessions not between 0 and 14 then
      return 'Enter how many sessions a week (0 if none).';
    end if;
    if (p_answers ->> 'trainingIntensity') not in ('200', '350', '500') then return 'Choose how hard your sessions are.'; end if;
  else
    if coalesce(trim(p_answers ->> 'goal'), '') = '' then return 'Tell us what you want to achieve.'; end if;
    if (p_answers ->> 'weighInDay') not in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun') then return 'Choose your weigh-in day.'; end if;
    if (p_answers ->> 'agreeConsent') is distinct from 'true' then return 'Please agree so Stefan can see your logs.'; end if;
  end if;
  return null;
end;
$$;

-- =====================================================================
-- 4. Functions the website calls (each checks auth.uid() itself)
-- =====================================================================

-- Links the signed-in user to the coaching row whose email matches their confirmed email.
-- Only a row nobody has claimed yet is linked. Returns what the dashboard needs to show.
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

  select * into r
    from public.coaching_clients c
   where c.user_id = v_uid
   order by (c.status not in ('finished', 'cancelled')) desc, c.created_at desc
   limit 1;

  if not found then
    select * into r
      from public.coaching_clients c
     where lower(c.email) = lower(v_email) and c.user_id is null
     order by (c.status not in ('finished', 'cancelled')) desc, c.created_at desc
     limit 1
     for update;
    if not found then
      return jsonb_build_object('linked', false, 'reason', 'no_plan_for_this_email');
    end if;
    update public.coaching_clients set user_id = v_uid where id = r.id;
  end if;

  return jsonb_build_object('linked', true, 'status', r.status, 'tier', r.tier);
end;
$$;

-- The client's onboarding answers. Basic: targets are worked out here and the plan is active at once.
-- Coached: the plan moves to awaiting_activation, for Stefan to build and activate.
create or replace function public.submit_onboarding(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.coaching_clients%rowtype;
  v_problem text;
  v_targets jsonb;
begin
  select * into r
    from public.coaching_clients c
   where c.user_id = auth.uid() and c.status = 'awaiting_onboarding'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'There is no plan waiting for onboarding.');
  end if;

  v_problem := public.onboarding_problem(p_answers, r.tier);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'error', v_problem);
  end if;

  if r.tier = 'basic' then
    v_targets := public.basic_targets(p_answers);
    update public.coaching_clients
       set onboarding = p_answers,
           time_zone = p_answers ->> 'timezone',
           whatsapp = nullif(trim(p_answers ->> 'whatsapp'), ''),
           targets = v_targets,
           status = 'active',
           activated_at = now(),
           start_date = public.melbourne_today(),
           end_date = public.melbourne_today() + 84
     where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'active', 'targets', v_targets);
  end if;

  update public.coaching_clients
     set onboarding = p_answers,
         time_zone = p_answers ->> 'timezone',
         whatsapp = nullif(trim(p_answers ->> 'whatsapp'), ''),
         status = 'awaiting_activation'
   where id = r.id;
  return jsonb_build_object('ok', true, 'status', 'awaiting_activation');
end;
$$;

-- The news and offers answer, for every customer record with the signed-in user's confirmed email.
create or replace function public.set_marketing_consent(p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  n integer;
begin
  select u.email into v_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'Confirm your email first.');
  end if;
  if p_on then
    update public.coaching_customers
       set marketing_consent = true, consent_at = now(), unsubscribed_at = null,
           consent_wording = 'Send me news and offers from Beast Coach. Unsubscribe any time.'
     where lower(email) = lower(v_email);
  else
    update public.coaching_customers
       set marketing_consent = false, consent_at = now(), unsubscribed_at = now(),
           consent_wording = 'Send me news and offers from Beast Coach. Unsubscribe any time.'
     where lower(email) = lower(v_email);
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'customer_records', n);
end;
$$;

-- Deletes the signed-in client's coaching data: their row, plans, logs, weigh-ins, check-ins and notes.
-- The customer record in coaching_customers is kept (it has no link to these rows).
create or replace function public.delete_my_coaching_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.coaching_clients where user_id = auth.uid();
  get diagnostics n = row_count;
  return jsonb_build_object(
    'deleted', n > 0,
    'client_rows_removed', n,
    'customer_record_kept', true
  );
end;
$$;

-- Spot counts: a spot is taken while a plan is awaiting onboarding, awaiting activation, active or paused.
-- Basic is never counted. Same output shape as before, so the sales page keeps working.
create or replace function public.coaching_places()
returns table (tier text, place_limit int, taken int, places_left int)
language sql
stable
security definer
set search_path = public
as $$
  select cap.tier,
         cap.place_limit,
         count(c.id)::int as taken,
         greatest(cap.place_limit - count(c.id)::int, 0) as places_left
    from public.coaching_capacity cap
    left join public.coaching_clients c
      on c.tier = cap.tier
     and c.tier <> 'basic'
     and c.status in ('awaiting_onboarding', 'awaiting_activation', 'active', 'paused')
   group by cap.tier, cap.place_limit;
$$;

-- =====================================================================
-- 5. Row level security policies
-- =====================================================================

-- coaching_clients: a client reads only their own row. No client update, insert or delete policy.
drop policy if exists "clients: read own row" on public.coaching_clients;
create policy "clients: read own row" on public.coaching_clients
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "clients: coach full access" on public.coaching_clients;
create policy "clients: coach full access" on public.coaching_clients
  for all to authenticated
  using (public.is_coach())
  with check (public.is_coach());

-- Meals, steps and workouts: a client reads their own and writes their own inside the logging window.
drop policy if exists "meals: client reads own" on public.coaching_meal_logs;
create policy "meals: client reads own" on public.coaching_meal_logs
  for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "meals: client adds own in window" on public.coaching_meal_logs;
create policy "meals: client adds own in window" on public.coaching_meal_logs
  for insert to authenticated
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "meals: client changes own in window" on public.coaching_meal_logs;
create policy "meals: client changes own in window" on public.coaching_meal_logs
  for update to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, log_date))
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "meals: client deletes own in window" on public.coaching_meal_logs;
create policy "meals: client deletes own in window" on public.coaching_meal_logs
  for delete to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "meals: coach full access" on public.coaching_meal_logs;
create policy "meals: coach full access" on public.coaching_meal_logs
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "workouts: client reads own" on public.coaching_workout_logs;
create policy "workouts: client reads own" on public.coaching_workout_logs
  for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "workouts: client adds own in window" on public.coaching_workout_logs;
create policy "workouts: client adds own in window" on public.coaching_workout_logs
  for insert to authenticated
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "workouts: client changes own in window" on public.coaching_workout_logs;
create policy "workouts: client changes own in window" on public.coaching_workout_logs
  for update to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, log_date))
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "workouts: client deletes own in window" on public.coaching_workout_logs;
create policy "workouts: client deletes own in window" on public.coaching_workout_logs
  for delete to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "workouts: coach full access" on public.coaching_workout_logs;
create policy "workouts: coach full access" on public.coaching_workout_logs
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "steps: client reads own" on public.coaching_step_logs;
create policy "steps: client reads own" on public.coaching_step_logs
  for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "steps: client adds own in window" on public.coaching_step_logs;
create policy "steps: client adds own in window" on public.coaching_step_logs
  for insert to authenticated
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "steps: client changes own in window" on public.coaching_step_logs;
create policy "steps: client changes own in window" on public.coaching_step_logs
  for update to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, log_date))
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "steps: client deletes own in window" on public.coaching_step_logs;
create policy "steps: client deletes own in window" on public.coaching_step_logs
  for delete to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, log_date));
drop policy if exists "steps: coach full access" on public.coaching_step_logs;
create policy "steps: coach full access" on public.coaching_step_logs
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- Weigh-ins: in the window, on the client's chosen weigh-in day, and one per week (unique key above).
drop policy if exists "weighins: client reads own" on public.coaching_weigh_ins;
create policy "weighins: client reads own" on public.coaching_weigh_ins
  for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "weighins: client adds own on weigh day" on public.coaching_weigh_ins;
create policy "weighins: client adds own on weigh day" on public.coaching_weigh_ins
  for insert to authenticated
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, weigh_date) and public.is_weigh_day(client_id, weigh_date));
drop policy if exists "weighins: client changes own on weigh day" on public.coaching_weigh_ins;
create policy "weighins: client changes own on weigh day" on public.coaching_weigh_ins
  for update to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, weigh_date) and public.is_weigh_day(client_id, weigh_date))
  with check (client_id = public.my_client_id() and public.can_log_on(client_id, weigh_date) and public.is_weigh_day(client_id, weigh_date));
drop policy if exists "weighins: client deletes own on weigh day" on public.coaching_weigh_ins;
create policy "weighins: client deletes own on weigh day" on public.coaching_weigh_ins
  for delete to authenticated
  using (client_id = public.my_client_id() and public.can_log_on(client_id, weigh_date) and public.is_weigh_day(client_id, weigh_date));
drop policy if exists "weighins: coach full access" on public.coaching_weigh_ins;
create policy "weighins: coach full access" on public.coaching_weigh_ins
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- Plans and check-ins: the client reads their own. Only the coach writes.
drop policy if exists "plans: client reads own" on public.coaching_plans;
create policy "plans: client reads own" on public.coaching_plans
  for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "plans: coach full access" on public.coaching_plans;
create policy "plans: coach full access" on public.coaching_plans
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "checkins: client reads own" on public.coaching_checkins;
create policy "checkins: client reads own" on public.coaching_checkins
  for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "checkins: coach full access" on public.coaching_checkins;
create policy "checkins: coach full access" on public.coaching_checkins
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- Coach only: customers, notes and the admin list.
drop policy if exists "customers: coach full access" on public.coaching_customers;
create policy "customers: coach full access" on public.coaching_customers
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "notes: coach full access" on public.coaching_notes;
create policy "notes: coach full access" on public.coaching_notes
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "admins: coach reads" on public.coaching_admins;
create policy "admins: coach reads" on public.coaching_admins
  for select to authenticated
  using (public.is_coach());

-- =====================================================================
-- 6. Grants: nothing for anon; the authenticated role gets only what the policies above need.
-- =====================================================================

revoke all on public.coaching_clients from anon, authenticated;
-- Column list: everything except the legacy coach-only notes column.
grant select (id, user_id, email, name, tier, status, start_date, activated_at, end_date, time_zone, whatsapp,
              onboarding, targets, created_at) on public.coaching_clients to authenticated;
grant insert, update, delete on public.coaching_clients to authenticated;

revoke all on public.coaching_customers, public.coaching_plans, public.coaching_meal_logs,
             public.coaching_workout_logs, public.coaching_step_logs, public.coaching_weigh_ins,
             public.coaching_checkins, public.coaching_notes, public.coaching_admins from anon, authenticated;
grant select, insert, update, delete on public.coaching_meal_logs, public.coaching_workout_logs,
      public.coaching_step_logs, public.coaching_weigh_ins, public.coaching_plans, public.coaching_checkins to authenticated;
grant select, insert, update, delete on public.coaching_customers, public.coaching_notes to authenticated;
grant select on public.coaching_admins to authenticated;

-- Functions: no public or anon execute (Supabase's default privileges would otherwise grant anon execute).
-- Helpers and client functions are for signed-in users only.
revoke all on function public.is_coach() from public, anon;
revoke all on function public.my_client_id() from public, anon;
revoke all on function public.melbourne_today() from public, anon;
revoke all on function public.can_log_on(bigint, date) from public, anon;
revoke all on function public.is_weigh_day(bigint, date) from public, anon;
revoke all on function public.basic_targets(jsonb) from public, anon;
revoke all on function public.onboarding_problem(jsonb, text) from public, anon;
revoke all on function public.coaching_weigh_week() from public, anon;
grant execute on function public.is_coach() to authenticated;
grant execute on function public.my_client_id() to authenticated;
grant execute on function public.melbourne_today() to authenticated;
grant execute on function public.can_log_on(bigint, date) to authenticated;
grant execute on function public.is_weigh_day(bigint, date) to authenticated;

revoke all on function public.claim_coaching() from public, anon;
revoke all on function public.submit_onboarding(jsonb) from public, anon;
revoke all on function public.set_marketing_consent(boolean) from public, anon;
revoke all on function public.delete_my_coaching_data() from public, anon;
grant execute on function public.claim_coaching() to authenticated;
grant execute on function public.submit_onboarding(jsonb) to authenticated;
grant execute on function public.set_marketing_consent(boolean) to authenticated;
grant execute on function public.delete_my_coaching_data() to authenticated;

-- The spot counts stay public (anon and authenticated), as before.
revoke all on function public.coaching_places() from public, anon;
grant execute on function public.coaching_places() to anon, authenticated, service_role;
