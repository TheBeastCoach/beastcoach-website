-- Coaching portal: step 4b2 (client time zones, and the marketing email setting).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Run AFTER supabase/coaching-portal-4b.sql. Additive and safe to run twice.
--
-- 1. "Today" for logging is the client's own day, in their own time zone (coaching_clients.time_zone), not
--    Melbourne's. The 3-days-back window and the activation day use that zone too. A missing or unknown zone
--    falls back to Australia/Melbourne.
-- 2. Onboarding saves a valid IANA zone. A city the client types ("London") is mapped ("Europe/London").
-- 3. get_my_marketing_consent(): the signed-in client's own marketing setting, true or false. Nothing else.

-- =====================================================================
-- 1. Time zones
-- =====================================================================

-- The canonical IANA name if the text is a valid zone (any letter case), else null.
create or replace function public.valid_time_zone(p_tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select z.name::text
    from pg_catalog.pg_timezone_names z
   where lower(z.name) = lower(trim(coalesce(p_tz, '')))
   limit 1;
$$;

-- What the client typed, as a valid IANA zone. A full zone name is used as it is. A common city is mapped.
-- Anything else is Australia/Melbourne.
create or replace function public.resolve_time_zone(p_text text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  k text := lower(trim(coalesce(p_text, '')));
  v text;
begin
  if k = '' then
    return 'Australia/Melbourne';
  end if;
  v := public.valid_time_zone(p_text);
  if v is not null then
    return v;
  end if;
  k := trim(split_part(k, ',', 1));          -- "Melbourne, Australia" -> "melbourne"
  v := case k
    when 'melbourne' then 'Australia/Melbourne'
    when 'sydney' then 'Australia/Sydney'
    when 'brisbane' then 'Australia/Brisbane'
    when 'adelaide' then 'Australia/Adelaide'
    when 'perth' then 'Australia/Perth'
    when 'hobart' then 'Australia/Hobart'
    when 'darwin' then 'Australia/Darwin'
    when 'auckland' then 'Pacific/Auckland'
    when 'london' then 'Europe/London'
    when 'dublin' then 'Europe/Dublin'
    when 'paris' then 'Europe/Paris'
    when 'berlin' then 'Europe/Berlin'
    when 'johannesburg' then 'Africa/Johannesburg'
    when 'dubai' then 'Asia/Dubai'
    when 'singapore' then 'Asia/Singapore'
    when 'hong kong' then 'Asia/Hong_Kong'
    when 'tokyo' then 'Asia/Tokyo'
    when 'mumbai' then 'Asia/Kolkata'
    when 'new york' then 'America/New_York'
    when 'chicago' then 'America/Chicago'
    when 'denver' then 'America/Denver'
    when 'los angeles' then 'America/Los_Angeles'
    when 'toronto' then 'America/Toronto'
    when 'vancouver' then 'America/Vancouver'
    else null
  end;
  if v is null then
    v := public.valid_time_zone(replace(k, ' ', '_'));
  end if;
  return coalesce(v, 'Australia/Melbourne');
end;
$$;

-- The zone a client's days are counted in: their own, if valid, else Melbourne.
create or replace function public.client_zone(p_client_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.valid_time_zone(c.time_zone), 'Australia/Melbourne')
    from public.coaching_clients c
   where c.id = p_client_id;
$$;

-- Today, for this client, in their own zone.
create or replace function public.client_today(p_client_id bigint)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
            (select coalesce(public.valid_time_zone(c.time_zone), 'Australia/Melbourne')
               from public.coaching_clients c where c.id = p_client_id),
            'Australia/Melbourne'))::date;
$$;

-- A client may log for a date from their activation day (in their zone), up to 3 days back, only while active.
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
       and p_date >= (c.activated_at at time zone public.client_zone(p_client_id))::date
       and p_date <= public.client_today(p_client_id)
       and p_date >= public.client_today(p_client_id) - 3
  );
$$;

-- Onboarding: the zone is saved as a valid IANA name (the page sends one, or the typed city is mapped here).
-- Otherwise everything is as in 4a. Basic's start date is today in the client's own zone.
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
  v_zone text;
  v_today date;
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

  v_zone := coalesce(public.valid_time_zone(p_answers ->> 'timeZoneIana'), public.resolve_time_zone(p_answers ->> 'timezone'));
  v_today := (now() at time zone v_zone)::date;

  if r.tier = 'basic' then
    v_targets := public.basic_targets(p_answers);
    update public.coaching_clients
       set onboarding = p_answers,
           time_zone = v_zone,
           whatsapp = nullif(trim(p_answers ->> 'whatsapp'), ''),
           targets = v_targets,
           status = 'active',
           activated_at = now(),
           start_date = v_today,
           end_date = v_today + 84
     where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'active', 'targets', v_targets);
  end if;

  update public.coaching_clients
     set onboarding = p_answers,
         time_zone = v_zone,
         whatsapp = nullif(trim(p_answers ->> 'whatsapp'), ''),
         status = 'awaiting_activation'
   where id = r.id;
  return jsonb_build_object('ok', true, 'status', 'awaiting_activation');
end;
$$;

-- =====================================================================
-- 2. The client's own marketing setting (true or false), for the signed-in client only
-- =====================================================================
create or replace function public.get_my_marketing_consent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select cu.marketing_consent
      from public.coaching_customers cu
      join auth.users u on lower(u.email) = lower(cu.email)
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
     order by cu.consent_at desc nulls last, cu.created_at desc
     limit 1
  ), false);
$$;

-- =====================================================================
-- 3. Grants
-- =====================================================================
revoke all on function public.valid_time_zone(text) from public, anon, authenticated;
revoke all on function public.resolve_time_zone(text) from public, anon, authenticated;
revoke all on function public.client_zone(bigint) from public, anon, authenticated;
revoke all on function public.client_today(bigint) from public, anon, authenticated;
revoke all on function public.can_log_on(bigint, date) from public, anon;
grant execute on function public.can_log_on(bigint, date) to authenticated;
revoke all on function public.submit_onboarding(jsonb) from public, anon;
grant execute on function public.submit_onboarding(jsonb) to authenticated;
revoke all on function public.get_my_marketing_consent() from public, anon;
grant execute on function public.get_my_marketing_consent() to authenticated;
