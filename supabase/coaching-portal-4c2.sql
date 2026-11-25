-- Coaching portal: step 4c2 (plan drafts, and the protein powder question).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Run AFTER supabase/coaching-portal-4c.sql. Additive and safe to run twice.
--
-- 1. coaching_plan_drafts: the coach's work-in-progress meal and training plan, saved as they type.
--    Coach only (is_coach(): listed in coaching_admins AND signed in with MFA). The client can never read it.
--    Only "Publish plan" (coach_publish_plan, 4c) makes a plan visible to the client.
-- 2. Protein powder is a required onboarding answer for NEW submissions: "yes", "no" or "open".
--    The brand and flavour are optional text. Clients who answered before are not asked again (shown as "Not asked").

-- =====================================================================
-- 1. Plan drafts
-- =====================================================================
create table if not exists public.coaching_plan_drafts (
  client_id   bigint primary key references public.coaching_clients (id) on delete cascade,
  draft       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
alter table public.coaching_plan_drafts enable row level security;

drop policy if exists "plan drafts: coach full access" on public.coaching_plan_drafts;
create policy "plan drafts: coach full access" on public.coaching_plan_drafts
  for all to authenticated
  using (public.is_coach()) with check (public.is_coach());

-- No policy for clients, and no grant to anon: a client cannot read or write a draft.
revoke all on public.coaching_plan_drafts from anon, authenticated;
grant select, insert, update, delete on public.coaching_plan_drafts to authenticated;

-- Who last saved it, from the database (the page cannot set it).
create or replace function public.coaching_plan_drafts_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.coaching_plan_drafts_stamp() from public, anon, authenticated;

drop trigger if exists coaching_plan_drafts_stamp on public.coaching_plan_drafts;
create trigger coaching_plan_drafts_stamp
  before insert or update on public.coaching_plan_drafts
  for each row execute function public.coaching_plan_drafts_stamp();

-- =====================================================================
-- 2. Protein powder: required for new onboarding submissions
-- =====================================================================
-- Same checks as 4a, plus the protein powder answer. Redefined here so submit_onboarding (4a and 4b2) uses it.
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
  if (p_answers ->> 'proteinPowder') not in ('yes', 'no', 'open') then
    return 'Tell us whether you use protein powder, or are open to it.';
  end if;
  if length(coalesce(p_answers ->> 'proteinBrand', '')) > 80 then
    return 'Keep the protein powder brand and flavour under 80 characters.';
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

revoke all on function public.onboarding_problem(jsonb, text) from public, anon;
