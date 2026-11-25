-- Limits for /api/analyse-meal (the "Try It Live" meal analyser on demo.html).
-- Two checks, both enforced here so they cannot be bypassed by changing a request header:
--   * a shared daily cap for the whole site, per Melbourne day
--   * a per-IP cap, counted over the last hour
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again.

-- One row per Melbourne day, with the number of analyses so far.
create table if not exists public.analyse_meal_day (
  day    date primary key,
  count  int  not null default 0
);

-- One row per analysis, with the caller's IP and the time. Used for the rolling hour.
create table if not exists public.analyse_meal_hits (
  id     bigint generated always as identity primary key,
  ip     text        not null,
  at     timestamptz not null default now()
);
create index if not exists analyse_meal_hits_ip_at on public.analyse_meal_hits (ip, at);

-- Nobody can touch these from the browser: no policies, and only the service role may call the function.
alter table public.analyse_meal_day  enable row level security;
alter table public.analyse_meal_hits enable row level security;

create or replace function public.analyse_meal_use(p_ip text, p_day_limit int, p_ip_limit int)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Australia/Melbourne')::date;
  v_count int;
begin
  -- Keep the table small: drop hits older than two days and day rows older than a week.
  delete from public.analyse_meal_hits where at < now() - interval '2 days';
  delete from public.analyse_meal_day  where day < v_day - 7;

  insert into public.analyse_meal_day as d (day, count) values (v_day, 0) on conflict (day) do nothing;
  select d.count into v_count from public.analyse_meal_day d where d.day = v_day for update;
  if v_count >= p_day_limit then
    return query select false, 'daily'::text;
    return;
  end if;

  if (select count(*) from public.analyse_meal_hits h
       where h.ip = p_ip and h.at > now() - interval '1 hour') >= p_ip_limit then
    return query select false, 'ip'::text;
    return;
  end if;

  update public.analyse_meal_day d set count = d.count + 1 where d.day = v_day;
  insert into public.analyse_meal_hits (ip) values (p_ip);
  return query select true, 'ok'::text;
end;
$$;

revoke all on function public.analyse_meal_use(text, int, int) from public;
revoke all on function public.analyse_meal_use(text, int, int) from anon;
revoke all on function public.analyse_meal_use(text, int, int) from authenticated;
grant execute on function public.analyse_meal_use(text, int, int) to service_role;
