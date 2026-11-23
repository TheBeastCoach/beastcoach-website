-- Coaching demo: shared daily cap for Beast AI demo calls.
-- Safe to run more than once.

create table if not exists public.demo_ai_usage (
  day   date primary key,
  count int  not null default 0
);

alter table public.demo_ai_usage enable row level security;
-- No policies on purpose: anon and authenticated roles cannot read or write this table.

create or replace function public.demo_ai_use(p_limit int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   date := (now() at time zone 'Australia/Melbourne')::date;
  v_count int;
begin
  insert into public.demo_ai_usage as u (day, count)
  values (v_day, 0)
  on conflict (day) do nothing;

  select u.count into v_count
  from public.demo_ai_usage as u
  where u.day = v_day
  for update;

  if v_count >= p_limit then
    return query select false, v_count;
    return;
  end if;

  update public.demo_ai_usage as u
  set count = u.count + 1
  where u.day = v_day
  returning u.count into v_count;

  return query select true, v_count;
end;
$$;

revoke all on function public.demo_ai_use(int) from public;
revoke all on function public.demo_ai_use(int) from anon;
revoke all on function public.demo_ai_use(int) from authenticated;
grant execute on function public.demo_ai_use(int) to service_role;
