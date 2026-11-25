-- Coaching portal: step 4d (payments and emails: checkout, webhook, refunds, rate limits, GST setting).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Run AFTER supabase/coaching-portal-4c2.sql. Additive and safe to run twice.
--
-- 1. The GST setting (not registered yet: receipts say "No GST has been charged"). When you register, switch
--    gst_registered on and add your ABN. Receipts then become tax invoices with GST included (1/11 of the price).
-- 2. Processed Stripe events (idempotency): a resent event never creates a second client or purchase.
-- 3. Rate limits for checkout, by IP. Written only by the server (service role).
-- 4. Stripe ids on clients and customers, so a webhook can find the right rows (refunds, Basic renewals).
-- 5. Two server-only functions: create a coaching client from a paid checkout (capacity checked under a lock, and
--    refused if the plan is full), and apply a refund (marks the customer and cancels the plan).
-- Clients cannot read any of the new tables, the settings or the Stripe ids.

-- =====================================================================
-- 1. Settings: GST and ABN (coach-only, as before)
-- =====================================================================
alter table public.coaching_settings add column if not exists gst_registered boolean not null default false;
alter table public.coaching_settings add column if not exists abn text;
alter table public.coaching_settings drop constraint if exists coaching_settings_abn_check;
alter table public.coaching_settings add constraint coaching_settings_abn_check
  check (abn is null or abn ~ '^[0-9 ]{11,14}$');

-- =====================================================================
-- 2. Processed Stripe events (server only)
-- =====================================================================
create table if not exists public.coaching_processed_events (
  event_id      text primary key,
  event_type    text not null,
  received_at   timestamptz not null default now(),
  done_at       timestamptz
);
alter table public.coaching_processed_events enable row level security;
revoke all on public.coaching_processed_events from anon, authenticated;

-- 'done' if this event was already fully handled; otherwise 'run' (new, or a failed earlier attempt to retry).
create or replace function public.coaching_begin_event(p_event_id text, p_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_done timestamptz;
begin
  insert into public.coaching_processed_events (event_id, event_type) values (p_event_id, p_type)
    on conflict (event_id) do nothing;
  select e.done_at into v_done from public.coaching_processed_events e where e.event_id = p_event_id;
  return case when v_done is not null then 'done' else 'run' end;
end;
$$;

create or replace function public.coaching_finish_event(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.coaching_processed_events set done_at = now() where event_id = p_event_id;
$$;

-- =====================================================================
-- 3. Rate limits (server only)
-- =====================================================================
create table if not exists public.coaching_rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          integer not null default 0
);
alter table public.coaching_rate_limits enable row level security;
revoke all on public.coaching_rate_limits from anon, authenticated;

-- True if this key is under the limit for the current window. Counts the hit.
create or replace function public.coaching_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_start timestamptz; v_hits integer;
begin
  insert into public.coaching_rate_limits (key, window_start, hits) values (p_key, now(), 0) on conflict (key) do nothing;
  select r.window_start, r.hits into v_start, v_hits from public.coaching_rate_limits r where r.key = p_key for update;
  if now() - v_start > make_interval(secs => p_window_seconds) then
    v_start := now(); v_hits := 0;
  end if;
  if v_hits >= p_limit then
    update public.coaching_rate_limits set window_start = v_start, hits = v_hits where key = p_key;
    return false;
  end if;
  update public.coaching_rate_limits set window_start = v_start, hits = v_hits + 1 where key = p_key;
  return true;
end;
$$;

-- =====================================================================
-- 4. Stripe ids
-- =====================================================================
alter table public.coaching_clients add column if not exists stripe_customer_id text;
alter table public.coaching_clients add column if not exists stripe_subscription_id text;
alter table public.coaching_clients add column if not exists stripe_session_id text;
create unique index if not exists coaching_clients_stripe_session on public.coaching_clients (stripe_session_id)
  where stripe_session_id is not null;

alter table public.coaching_customers add column if not exists stripe_session_id text;
alter table public.coaching_customers add column if not exists stripe_payment_intent text;
alter table public.coaching_customers add column if not exists stripe_customer_id text;
alter table public.coaching_customers add column if not exists stripe_subscription_id text;
alter table public.coaching_customers add column if not exists refunded_at timestamptz;
alter table public.coaching_customers add column if not exists refund_note text;
create unique index if not exists coaching_customers_stripe_session on public.coaching_customers (stripe_session_id)
  where stripe_session_id is not null;

-- Clients may not read any of the Stripe ids (the column grants from 4a do not include them, and this stays so).
revoke select (stripe_customer_id, stripe_subscription_id, stripe_session_id) on public.coaching_clients from authenticated;

-- =====================================================================
-- 5. Create the coaching rows from a paid checkout (server only)
-- =====================================================================
-- Idempotent by Stripe session: a second call for the same session returns the same client.
-- Refuses (ok false, reason 'full') when the plan has no free place at this moment. The capacity row is locked.
create or replace function public.coaching_create_from_purchase(
  p_session_id text, p_email text, p_name text, p_tier text, p_amount_cents integer, p_currency text,
  p_marketing_consent boolean, p_consent_wording text, p_payment_intent text, p_stripe_customer_id text,
  p_subscription_id text, p_paid_on date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_existing uuid;
  v_limit integer;
  v_taken integer;
  v_id bigint;
begin
  select cu.id into v_existing from public.coaching_customers cu where cu.stripe_session_id = p_session_id;
  if v_existing is not null then
    select c.id into v_id from public.coaching_clients c where c.stripe_session_id = p_session_id;
    return jsonb_build_object('ok', true, 'client_id', v_id, 'repeat', true);
  end if;

  if p_tier <> 'basic' then
    select cap.place_limit into v_limit from public.coaching_capacity cap where cap.tier = p_tier for update;
    select count(*) into v_taken from public.coaching_clients c
     where c.tier = p_tier and c.status in ('awaiting_onboarding', 'awaiting_activation', 'active', 'paused');
    if v_taken >= coalesce(v_limit, 0) then
      return jsonb_build_object('ok', false, 'reason', 'full');
    end if;
  end if;

  if exists (select 1 from public.coaching_clients c where lower(c.email) = v_email and c.status not in ('finished', 'cancelled')) then
    return jsonb_build_object('ok', false, 'reason', 'already_open');
  end if;

  insert into public.coaching_clients (email, name, tier, status, start_date, stripe_customer_id, stripe_subscription_id, stripe_session_id)
  values (v_email, nullif(trim(p_name), ''), p_tier, 'awaiting_onboarding', public.melbourne_today(),
          p_stripe_customer_id, p_subscription_id, p_session_id)
  returning id into v_id;

  insert into public.coaching_customers (email, name, tier, amount_cents, currency, purchased_at, marketing_consent, consent_at,
                                         consent_wording, stripe_session_id, stripe_payment_intent, stripe_customer_id, stripe_subscription_id)
  values (v_email, nullif(trim(p_name), ''), p_tier, p_amount_cents, coalesce(p_currency, 'AUD'),
          coalesce(p_paid_on::timestamptz, now()), p_marketing_consent, now(), p_consent_wording,
          p_session_id, p_payment_intent, p_stripe_customer_id, p_subscription_id);

  return jsonb_build_object('ok', true, 'client_id', v_id, 'repeat', false);
end;
$$;

-- =====================================================================
-- 6. A refund (server only): the customer is noted, and a full refund cancels the plan (the place frees up).
-- =====================================================================
create or replace function public.coaching_apply_refund(p_payment_intent text, p_full boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cu public.coaching_customers%rowtype;
  v_cancelled boolean := false;
begin
  select * into v_cu from public.coaching_customers cu where cu.stripe_payment_intent = p_payment_intent limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  update public.coaching_customers set refunded_at = coalesce(refunded_at, now()), refund_note = p_note where id = v_cu.id;
  if p_full then
    update public.coaching_clients set status = 'cancelled'
     where stripe_session_id = v_cu.stripe_session_id and status not in ('finished', 'cancelled');
    v_cancelled := found;
  end if;
  return jsonb_build_object('found', true, 'email', v_cu.email, 'name', v_cu.name, 'tier', v_cu.tier, 'cancelled', v_cancelled);
end;
$$;

-- =====================================================================
-- 7. Grants: server functions to the service role only; no client access at all
-- =====================================================================
revoke all on function public.coaching_begin_event(text, text) from public, anon, authenticated;
revoke all on function public.coaching_finish_event(text) from public, anon, authenticated;
revoke all on function public.coaching_rate_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.coaching_create_from_purchase(text, text, text, text, integer, text, boolean, text, text, text, text, date) from public, anon, authenticated;
revoke all on function public.coaching_apply_refund(text, boolean, text) from public, anon, authenticated;
grant execute on function public.coaching_begin_event(text, text) to service_role;
grant execute on function public.coaching_finish_event(text) to service_role;
grant execute on function public.coaching_rate_hit(text, integer, integer) to service_role;
grant execute on function public.coaching_create_from_purchase(text, text, text, text, integer, text, boolean, text, text, text, text, date) to service_role;
grant execute on function public.coaching_apply_refund(text, boolean, text) to service_role;
