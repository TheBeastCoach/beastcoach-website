-- Coaching portal: step 4d2 (duplicate open plans, Basic refunds, owner alerts).
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Run AFTER supabase/coaching-portal-4d.sql. Additive and safe to run twice.
--
-- 1. coaching_create_from_purchase also tells the webhook which open plan the email already has ("existing_tier"),
--    so the client email and the owner alert can name both plans.
-- 2. coaching_apply_refund can match a Basic subscription's customer record (by subscription id) as well as a
--    payment, and a full refund of a subscription finishes the plan (not "cancelled"). The webhook also cancels the
--    Stripe subscription itself, so the client is never charged again.

-- =====================================================================
-- 1. Duplicate open plan: report the existing plan's tier
-- =====================================================================
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
  v_open_tier text;
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

  select c.tier into v_open_tier from public.coaching_clients c
   where lower(c.email) = v_email and c.status not in ('finished', 'cancelled')
   order by c.created_at desc limit 1;
  if v_open_tier is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_open', 'existing_tier', v_open_tier);
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
-- 2. A refund, by payment or by Basic subscription (server only)
-- =====================================================================
drop function if exists public.coaching_apply_refund(text, boolean, text);

create or replace function public.coaching_apply_refund(p_payment_intent text, p_full boolean, p_note text, p_subscription_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cu public.coaching_customers%rowtype;
  v_status text := null;
begin
  select * into v_cu from public.coaching_customers cu
   where (p_payment_intent is not null and cu.stripe_payment_intent = p_payment_intent)
      or (p_subscription_id is not null and cu.stripe_subscription_id = p_subscription_id)
   order by cu.purchased_at desc limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  update public.coaching_customers set refunded_at = coalesce(refunded_at, now()), refund_note = p_note where id = v_cu.id;
  if p_full then
    -- A full refund ends the plan: "finished" for a Basic subscription (the subscription is cancelled too), else "cancelled".
    v_status := case when p_subscription_id is not null then 'finished' else 'cancelled' end;
    update public.coaching_clients set status = v_status
     where stripe_session_id = v_cu.stripe_session_id and status not in ('finished', 'cancelled');
    if not found then v_status := null; end if;
  end if;
  return jsonb_build_object('found', true, 'email', v_cu.email, 'name', v_cu.name, 'tier', v_cu.tier,
                            'cancelled', v_status is not null, 'status', v_status);
end;
$$;

revoke all on function public.coaching_create_from_purchase(text, text, text, text, integer, text, boolean, text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.coaching_create_from_purchase(text, text, text, text, integer, text, boolean, text, text, text, text, date) to service_role;
revoke all on function public.coaching_apply_refund(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.coaching_apply_refund(text, boolean, text, text) to service_role;
