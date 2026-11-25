# Email setup (Resend): step by step

This sets up the emails the coaching portal sends: the welcome, the receipt, the "spot just filled" refund note, and
the three Basic emails (renewed, payment failed, cancelled). It also sets up the sign-up and password-reset emails
that Supabase sends for your accounts. You can do this in about 30 minutes.

These emails are transactional only. Nothing in this setup sends marketing email.

---

## Part 1: Create a Resend account

1. Open https://resend.com in your browser.
2. Click **Sign up**. Use your own email address.
3. Confirm your email when Resend sends you the link.
4. Sign in. You land on the Resend dashboard.

## Part 2: Add and verify the beastcoach.fit domain

Resend will only send from a domain you prove you own. You prove it by adding a few DNS records where your domain is
managed (the place you bought beastcoach.fit, such as Cloudflare, GoDaddy, Crazy Domains or Vercel's domain settings).

1. In Resend, click **Domains** in the left menu, then **Add domain**.
2. Type `beastcoach.fit` and choose the region closest to you (Sydney, if offered). Click **Add**.
3. Resend now shows a table of DNS records. It has a TXT record for DKIM, an MX record and a TXT record for SPF, and
   sometimes a DMARC record. **Copy the values from the Resend screen, exactly as they are shown.** Do not type your own.
4. Open the DNS settings for beastcoach.fit in your domain provider. Add each record from Resend's table:
   - Type: the type shown (TXT or MX).
   - Name / host: the name shown. Some providers want only the part before `.beastcoach.fit`. If you are not sure,
     copy what Resend shows and check your provider's help page for "host" or "name".
   - Value / content: the value shown.
   - Priority (MX records only): the number shown.
   - TTL: leave the default.
5. Save each record.
6. Back in Resend, click **Verify DNS records**. It can take a few minutes to a few hours for DNS to update. If it
   fails, wait 30 minutes and try again. Do not change the values to make it pass.
7. When every record shows a green tick, the domain status is **Verified**.

Do not delete any existing records for beastcoach.fit (your website and any email you already use). Only add the new ones.

## Part 3: Create the API key

1. In Resend, click **API Keys** in the left menu, then **Create API Key**.
2. Name it `beastcoach-portal`.
3. Permission: **Sending access**. Domain: **beastcoach.fit**.
4. Click **Add**. Resend shows the key once, starting with `re_`. **Copy it now** and keep it somewhere safe
   (a password manager). You cannot see it again.

## Part 4: Add the key to Vercel

Use two environments, so a test never sends real email to clients by accident:

1. Open your project on https://vercel.com, then **Settings**, then **Environment Variables**.
2. Add `RESEND_API_KEY`, value = the key from Part 3.
   - Environment: **Preview** (for the coaching-portal preview).
   - Add it again for **Production** when you are ready to go live. The value is the same key.
3. Save. A new deployment is needed before the preview picks up the change: push a commit, or redeploy.

## Part 5: Set Supabase Auth to send its emails through Resend

Supabase sends the "confirm your signup" and "reset your password" emails. Its default sender is shared and often lands
in spam. Send them through Resend instead.

1. Open the Supabase dashboard, choose your project, then **Project Settings** (the gear), then **Authentication**.
2. Scroll to **SMTP Settings**. Turn on **Enable Custom SMTP**.
3. Fill in:
   - **Sender email:** `stefan@beastcoach.fit`
   - **Sender name:** `Stefan at Beast Coach`
   - **Host:** `smtp.resend.com`
   - **Port number:** `465`
   - **Minimum interval between emails:** leave the default
   - **Username:** `resend`
   - **Password:** the Resend API key from Part 3
4. Click **Save**.
5. Test it: sign out of the site, use **Forgot password** on beastcoach.fit/dashboard with an email you can read.
   The reset email should arrive from Stefan at Beast Coach.

Note: these settings are in the Supabase dashboard, not in the code. They apply to the whole project, so they also
change the emails for the Discipline Path accounts. That is what you want.

## Part 6: Check the portal emails

1. On the preview, complete a test checkout (see docs/STRIPE-TEST-SETUP.md). The welcome and receipt should arrive.
2. Check the email shows **From: Stefan at Beast Coach <stefan@beastcoach.fit>** and that a reply goes to
   stefan@stefanbotha.com.
3. If an email does not arrive, look in Vercel, **Logs**, and search for `Resend refused`. The log names the kind of
   email. A `403` usually means the domain is not verified yet, or the key does not have sending access to beastcoach.fit.

## If something goes wrong

- **No emails at all:** check `RESEND_API_KEY` is set for the environment you are testing (Preview or Production).
- **Emails land in spam:** check all DNS records are green in Resend. Re-check the SPF and DKIM values were copied exactly.
- **"Domain not verified":** wait, then press Verify again. Do not invent values.
