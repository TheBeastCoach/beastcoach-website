# Stripe test setup: step by step

Everything in the coaching portal's payments is tested in Stripe **test mode** on the preview first. Live money is
never taken from the preview. Follow these steps in order.

## Part 1: Get the test keys

1. Sign in to https://dashboard.stripe.com.
2. Turn on **Test mode**. The switch is near the top of the page. A **Test mode** banner shows when it is on.
   Everything in this guide happens with test mode on.
3. Click **Developers** (top right), then **API keys**.
4. Copy the **Secret key**. It starts with `sk_test_`. Do not copy the publishable key; the portal does not use it.

## Part 2: Put the test keys in Vercel's Preview environment only

1. Open the project on https://vercel.com, then **Settings**, then **Environment Variables**.
2. Add `STRIPE_SECRET_KEY`:
   - Value: the `sk_test_...` key from Part 1.
   - Environment: **Preview only**. Untick Production and Development.
3. Leave the **live** keys (`sk_live_...`) in **Production** only. Never put a live key in Preview.
4. Add `SITE_URL` with the preview address of the coaching-portal branch (for example
   `https://beastcoach-website-git-coaching-portal-yourname.vercel.app`), Environment **Preview only**. Checkout sends
   people back to this address after payment.
5. Save, then redeploy the preview (push a commit, or redeploy from the Deployments page).

## Part 3: Create a TEST webhook endpoint for the coaching plans

The coaching plans use their own webhook (`/api/coaching-webhook`), separate from the Discipline Path webhook, so the
two cannot affect each other.

1. In the Stripe dashboard (still in **Test mode**), go to **Developers**, then **Webhooks**, then **Add endpoint**.
2. **Endpoint URL:** the preview address followed by `/api/coaching-webhook`, for example
   `https://beastcoach-website-git-coaching-portal-yourname.vercel.app/api/coaching-webhook`.
3. Click **Select events** and tick exactly these five:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `charge.refunded`
4. Click **Add endpoint**.
5. Open the new endpoint and click **Reveal** under **Signing secret**. It starts with `whsec_`. Copy it.
6. In Vercel, add `STRIPE_COACHING_WEBHOOK_SECRET` with that value, Environment **Preview only**. Redeploy the preview.

Do not reuse the Discipline Path's webhook secret here. Each endpoint has its own.

## Part 4: Test cards

Use these in Stripe Checkout while in test mode. Any future expiry date (for example 12/34), any three-digit CVC, and any
postcode work.

| Card number           | What happens                              |
|-----------------------|-------------------------------------------|
| 4242 4242 4242 4242   | Payment succeeds                          |
| 4000 0000 0000 9995   | Declined: insufficient funds              |
| 4000 0000 0000 0002   | Declined: generic decline                 |
| 4000 0025 0000 3155   | Needs 3D Secure: Stripe shows a test authentication page. Click **Complete** |

## Part 5: The checks to run on the preview

1. **Full plan:** on the preview's sales page, pick a plan that has no places left (set its capacity to 0 in the coach
   Clients page, then set it back). The step should say the plan is full, with the waitlist button, and no payment page.
2. **Successful payment (Core):** choose Core, fill in the name and an email, tick both agreements, and pay with
   `4242 4242 4242 4242`. You should land on My Coach. Within a minute, Vercel's logs show the webhook ran, the client
   appears in the coach's Clients page, and the welcome and receipt arrive by email.
3. **Discipline Path:** the same email should now see the Discipline Path unlocked (Core and The Beast include it).
4. **Declined card:** `4000 0000 0000 9995` should stop at Stripe with a message, and no client is created.
5. **Resent webhook:** in the Stripe dashboard, open the event under **Developers, Events**, and click **Resend**. Nothing
   should change: no second client and no second email.
6. **Refund:** in the Stripe dashboard, open the payment and refund it. The client should move to cancelled in the coach
   Clients page, and the customer record should note the refund.
7. **Basic:** choose Basic, pay with the test card. Stripe creates a subscription. In the Stripe dashboard you can
   simulate a renewal and a failed payment on the subscription.
8. **Renewal:** once a test client is finished (set the status to finished in the coach page), sign in to My Coach. The
   **Renew ... with 20% off** button should show the reduced price. Tick the box, then pay.

## Going live (later, not now)

When you are ready for real payments: repeat Parts 2 and 3 in **live mode**, with the live `sk_live_` key and a live
webhook endpoint on https://www.beastcoach.fit/api/coaching-webhook. Put them in **Production** only. Check the
receipts and the GST setting (the coach page's Settings) before you switch.
