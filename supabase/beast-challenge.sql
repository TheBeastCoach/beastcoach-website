-- Beast Challenge: tables, row-level security and the community total.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again: it only creates what doesn't exist yet and replaces the policies/function.

-- ---------- Profile: one row per person, created at the end of onboarding ----------
create table if not exists public.beast_challenge_profiles (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  first_name            text not null,
  region                text,
  units                 text,
  sex                   text,
  age                   int,
  height_cm             numeric,
  weight_kg             numeric,
  activity              numeric,        -- 1.15 / 1.25 / 1.35, same as the calculator
  goal                  text,           -- fatloss / recomp / muscle
  why                   text,
  found_via             text,
  tracked               text[] not null default '{}',
  calorie_target        int,
  protein_target        int,
  water_target          int,
  sleep_target          numeric,
  workout_days          int[] not null default '{}',   -- 0 = Sunday ... 6 = Saturday
  route                 text,
  maintenance           int,
  steps_baseline        int not null default 0,        -- 10000 if they track steps, else 0
  start_date            date not null,
  agreed_disclaimer_at  timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------- One row per person per day ----------
create table if not exists public.beast_challenge_days (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  steps         int check (steps is null or steps between 0 and 60000),
  water         int not null default 0 check (water between 0 and 40),
  sleep         numeric check (sleep is null or sleep between 0 and 14),
  protein_hit   boolean not null default false,
  alcohol_free  boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (user_id, day)
);

-- ---------- Calorie entries: one row each, so a typo can be deleted ----------
create table if not exists public.beast_challenge_calories (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day         date not null,
  kcal        int not null check (kcal between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index if not exists beast_challenge_calories_user_day on public.beast_challenge_calories (user_id, day);

-- ---------- Workouts ----------
create table if not exists public.beast_challenge_workouts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day         date not null,
  location    text,
  type        text,
  minutes     int check (minutes is null or minutes between 1 and 600),
  created_at  timestamptz not null default now()
);
create index if not exists beast_challenge_workouts_user_day on public.beast_challenge_workouts (user_id, day);

-- ---------- Row-level security: everyone sees and edits only their own rows ----------
alter table public.beast_challenge_profiles  enable row level security;
alter table public.beast_challenge_days      enable row level security;
alter table public.beast_challenge_calories  enable row level security;
alter table public.beast_challenge_workouts  enable row level security;

drop policy if exists "own profile" on public.beast_challenge_profiles;
create policy "own profile" on public.beast_challenge_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Logs: read any of your own days; write only around today (the page allows today
-- and the 2 days before; the extra day each side covers time-zone differences).
do $$
declare t text;
begin
  foreach t in array array['beast_challenge_days','beast_challenge_calories','beast_challenge_workouts'] loop
    execute format('drop policy if exists "own rows read" on public.%I', t);
    execute format('drop policy if exists "own rows write" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows read" on public.%I for select to authenticated using (auth.uid() = user_id)', t);
    execute format('create policy "own rows write" on public.%I for insert to authenticated with check (auth.uid() = user_id and day between current_date - 3 and current_date + 1)', t);
    execute format('create policy "own rows update" on public.%I for update to authenticated using (auth.uid() = user_id and day between current_date - 3 and current_date + 1) with check (auth.uid() = user_id and day between current_date - 3 and current_date + 1)', t);
    execute format('create policy "own rows delete" on public.%I for delete to authenticated using (auth.uid() = user_id and day between current_date - 3 and current_date + 1)', t);
  end loop;
end $$;

-- ---------- Community total: returns only the overall km, never anyone's rows ----------
create or replace function public.beast_challenge_community_km()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(coalesce(sum(steps), 0) * 0.8 / 1000)::numeric from public.beast_challenge_days;
$$;
revoke all on function public.beast_challenge_community_km() from public;
grant execute on function public.beast_challenge_community_km() to anon, authenticated;
