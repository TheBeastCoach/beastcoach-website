-- Coaching: client list, editable capacity, and the live "spots left" counter
-- used by the Work With Me page (badges on the plan cards and the Places row
-- in the comparison table).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to run again: it never overwrites limits you have already changed.
--
-- How spots work:
--   Each coaching client is one row in coaching_clients.
--   A spot is taken while status = 'active'. Set status to 'finished' when their
--   12 weeks end (or they leave) and the spot opens up again automatically.
--   The limit for each plan lives in coaching_capacity. Change it there (Table
--   Editor, or later from the admin area) and the sales page updates on the next
--   page load. No code change needed.

create table if not exists public.coaching_clients (
  id          bigint generated always as identity primary key,
  email       text not null,
  name        text,
  tier        text not null check (tier in ('essential', 'core', 'beast')),
  status      text not null default 'active' check (status in ('active', 'finished')),
  start_date  date not null default (now() at time zone 'Australia/Melbourne')::date,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists coaching_clients_active on public.coaching_clients (tier) where status = 'active';

alter table public.coaching_clients enable row level security;
-- No policies on purpose: client details can never be read from the browser.

create table if not exists public.coaching_capacity (
  tier        text primary key check (tier in ('essential', 'core', 'beast')),
  place_limit int  not null check (place_limit >= 0),
  updated_at  timestamptz not null default now()
);

-- Starting limits. Only inserted if missing, so running this file again keeps your changes.
insert into public.coaching_capacity (tier, place_limit) values
  ('essential', 100), ('core', 25), ('beast', 4)
on conflict (tier) do nothing;

alter table public.coaching_capacity enable row level security;
-- No policies: only you (Table Editor / admin with the service role) can change limits.

-- Older versions of this file defined coaching_places() with hard-coded limits.
drop function if exists public.coaching_places();

create function public.coaching_places()
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
      on c.tier = cap.tier and c.status = 'active'
   group by cap.tier, cap.place_limit;
$$;

revoke all on function public.coaching_places() from public;
grant execute on function public.coaching_places() to anon, authenticated, service_role;
