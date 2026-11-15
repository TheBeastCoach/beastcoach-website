-- Beast AI: daily usage counter, used by api/beast-ai.js.
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again.

create table if not exists public.beast_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);

alter table public.beast_ai_usage enable row level security;
-- No policies on purpose: nobody can read or write this from the browser.
-- Only the server (service role key) touches it.

-- Adds one use for today and says whether the person is still under the limit.
-- If they are over the limit, the count is not increased.
create or replace function public.beast_ai_use(p_user uuid, p_limit int)
returns table (allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Australia/Melbourne')::date;
  cur int;
begin
  insert into public.beast_ai_usage (user_id, day, count) values (p_user, today, 0)
  on conflict (user_id, day) do nothing;

  update public.beast_ai_usage
     set count = count + 1
   where user_id = p_user and day = today and count < p_limit
  returning count into cur;

  if cur is null then
    select count into cur from public.beast_ai_usage where user_id = p_user and day = today;
    return query select false, cur;
  else
    return query select true, cur;
  end if;
end;
$$;

revoke all on function public.beast_ai_use(uuid, int) from public, anon, authenticated;
grant execute on function public.beast_ai_use(uuid, int) to service_role;
