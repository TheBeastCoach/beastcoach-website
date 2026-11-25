# Coaching portal: database, security and login (step 4a)

Branch: `coaching-portal`. Not merged, not deployed. The database step is in `supabase/coaching-portal.sql`. Nothing here has been run against the live Supabase project: you run the SQL yourself after review.

The demo (`coaching-demo.html`) is the approved spec. This step is the real database behind it, the rules that keep one person's data from another's, and the login side (the My Coach tile and `/my-coach`). The client screens move onto this data in the next step.

## What runs where

| Step | File | What it does |
|---|---|---|
| 1 | `supabase/coaching.sql` | Already part of the coaching setup. Creates `coaching_clients`, `coaching_capacity` and `coaching_places()`. Run it first if it has not been run. |
| 2 | `supabase/coaching-portal.sql` | This step. Extends `coaching_clients`, adds the new tables, the rules (RLS), the helper and client functions, and the grants. Safe to run twice. |
| 3 | by hand | Add yourself as the coach (`coaching_admins`). Add a test client if you want one. |

## Who can see what, in plain English

- **Nobody signed out** can read anything, except the spot counts (`coaching_places()`).
- **A client** (signed in, and linked to their coaching row by their confirmed email) can:
  - read their own client row (but not the coach notes column, and not their tier or status changes);
  - read their own plan, meals, workouts, steps, weigh-ins and check-ins;
  - add, change and delete their own meals, workouts, steps and weigh-ins, but only:
    - for dates from their activation date onwards;
    - no more than 3 days back (Melbourne time);
    - only while their status is `active` (not while awaiting, paused, finished or cancelled).
  - Weigh-ins also need to be on the weigh-in day they chose in onboarding, and only one is allowed per ISO week.
- **Nobody else's data.** A client cannot read or change another client's rows, cannot read the customer list, the coach notes or the coach list.
- **The coach** (listed in `coaching_admins`, and signed in with two-factor authentication): full read and write on every coaching table. A coach who signs in with a password only (no second factor) sees nothing.
- **The customer list** (`coaching_customers`) is readable by the coach only, and it survives a client deleting their data.

## Every table

| Table | What it holds | Who reads | Who writes |
|---|---|---|---|
| `coaching_clients` (extended) | One row per plan: name, email, tier (`basic`, `essential`, `core`, `beast`), status, activation and end dates, time zone, WhatsApp, onboarding answers (`onboarding`), Basic targets (`targets`), and the signed-in user (`user_id`). The old `notes` column is kept but no one signed in through the API can read it. | Client: their own row (no `notes`). Coach: all. | Coach. Clients use `submit_onboarding()` and `claim_coaching()`. |
| `coaching_customers` | The permanent customer list, one row per purchase: email, name, country, tier, purchase date, amount in cents, currency, news consent and when it was given, the wording shown, and when they unsubscribed. No link to `auth.users` or `coaching_clients`, so it survives a client deleting their data. | Coach only | Coach. Clients change their own consent with `set_marketing_consent()`. |
| `coaching_plans` | One current meal and workout plan per client, as JSON, with a version number. Old versions are kept. Only one row per client is marked current. | Client: their own. Coach: all. | Coach. |
| `coaching_meal_logs` | Meals the client logs: name, time, calories and macros, source (`plan`, `ai`, `builder`, `typed`), the text they typed, the Beast AI estimate, whether they edited it, and whether it was added after the day. | Client: their own. Coach: all. | Client (inside the window). Coach: all. |
| `coaching_workout_logs` | Workouts: kind `plan` (with the session and sets of kg and reps) or `other` (what, minutes, notes). | Client: their own. Coach: all. | Client (inside the window). Coach: all. |
| `coaching_step_logs` | One step count per client per day. Saving again replaces the day's count. | Client: their own. Coach: all. | Client (inside the window). Coach: all. |
| `coaching_weigh_ins` | Weigh-ins: date, kilograms, and the Monday of that week (set by the database). One per client per week, enforced by a unique key. | Client: their own. Coach: all. | Client (inside the window, on their weigh-in day). Coach: all. |
| `coaching_checkins` | Kick-off calls, check-ins and video calls, with the time and status (`scheduled` or `cancelled`). Scheduled on WhatsApp; the portal only shows them. | Client: their own. Coach: all. | Coach. |
| `coaching_notes` | Coach-only notes about a client. | Coach only | Coach only |
| `coaching_admins` | The coach's user id. Just the coach. | Coach only | Added by hand in the SQL Editor. |

Every new table has row level security turned on, and every one has keys that are UUIDs (so no sequence permissions are needed).

## Every policy, in plain English

Policies are the rules the database applies to every request. Each one is named after its table.

**`coaching_clients`**
- *clients: read own row*: a signed-in client reads the row linked to their login.
- *clients: coach full access*: the coach, with two-factor sign-in, reads and writes every row.
- There is no client update, insert or delete policy, so a client cannot change their tier, status, dates or targets.

**`coaching_meal_logs`, `coaching_workout_logs`, `coaching_step_logs`**
- *reads own*: a client reads their own logs.
- *adds own in window*, *changes own in window*, *deletes own in window*: a client writes their own logs only from their activation date, up to 3 days back, and only while active.
- *coach full access*: the coach reads and writes everything.

**`coaching_weigh_ins`**
- *reads own*: a client reads their own weigh-ins.
- *adds / changes / deletes own on weigh day*: the same window as the logs, and only on the weigh-in day the client chose.
- The database allows one weigh-in per client per ISO week, whatever the page does.
- *coach full access*.

**`coaching_plans`, `coaching_checkins`**
- *client reads own*: a client reads their own plan versions and check-ins.
- *coach full access*: only the coach writes.

**`coaching_customers`, `coaching_notes`, `coaching_admins`**
- *coach full access* (and for `coaching_admins`, *coach reads*): only the coach, with two-factor sign-in.

## Functions the website calls

Every function checks who is signed in (`auth.uid()`) itself. None of them can be run by someone signed out.

| Function | What it does |
|---|---|
| `claim_coaching()` | Links the coaching row whose email matches the signed-in user's **confirmed** email, if nobody has claimed it yet. Returns `linked`, the `status` and the `tier`. An unconfirmed email is refused. |
| `submit_onboarding(answers)` | Saves the onboarding answers, but only while the plan is `awaiting_onboarding`. Checks the answers. Coached plans move to `awaiting_activation`. **Basic** plans get their targets worked out on the server and become `active` at once. |
| `set_marketing_consent(on)` | Records the news answer on every customer row for the signed-in user's confirmed email, with the date and the wording shown. Turning it off also records an unsubscribe. |
| `delete_my_coaching_data()` | Deletes the client's row. Their plans, logs, weigh-ins, check-ins and notes go with it (they are linked with delete-cascade). The customer record in `coaching_customers` is kept. |
| `coaching_places()` | The spot counts for the sales page. Public, as before. A spot is taken while a plan is awaiting onboarding, awaiting activation, active or paused. Basic and cancelled or finished plans do not take a spot. |

Helper functions (used inside the rules, not called by the website): `is_coach()`, `my_client_id()`, `can_log_on()`, `is_weigh_day()`, `melbourne_today()`, `basic_targets()`, `onboarding_problem()`.

**Why Basic targets are worked out in SQL:** the server must set the targets, so a client cannot type their own. `basic_targets()` is a port of `basic-targets.js`, and the tests check the two give the same numbers across 13,122 combinations (`tests/coaching-portal-rls.test.js`). Changing the formula means changing it in both places.

## Grants

Supabase gives new public tables full access to `anon` and `authenticated` by default. The SQL takes that back:
- `anon`: nothing on the new tables, and no execute on any new function. The one exception is `coaching_places()`, which stays public.
- `authenticated`: only the table actions the policies need, and column-level read on `coaching_clients` that leaves out the old `notes` column.

## Running it in Supabase (you do this)

Do these in order. Use the SQL Editor (Dashboard, SQL Editor, New query).

1. **Check the existing coaching table first.** Paste and run:
   ```sql
   select column_name from information_schema.columns where table_name = 'coaching_clients';
   ```
   It should include `id`, `email`, `name`, `tier`, `status`, `start_date`, `notes`, `created_at`. If `coaching_clients` is missing, run `supabase/coaching.sql` first.
2. **Run `supabase/coaching-portal.sql`.** Paste the whole file and run it. It is safe to run again if something goes wrong; fix the cause and run it again.
3. **Check the policies are on.** Run:
   ```sql
   select tablename, rowsecurity from pg_tables
    where schemaname = 'public' and tablename like 'coaching%' order by tablename;
   ```
   Every row should say `true`.
4. **Add yourself as the coach.** Sign up or sign in to the site with your own account first, so you have a user. Then run this, with your email in place of the one shown:
   ```sql
   insert into public.coaching_admins (user_id)
   select id from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```
   You then need two-factor sign-in (MFA) turned on for that account, and to sign in with it, or the coach rules will show you nothing. This is on purpose.
5. **Add a test client by hand** (optional, for testing the portal):
   1. Ask the test person to sign up on the site with the email you use here, and confirm the email.
   2. Add their plan:
      ```sql
      insert into public.coaching_clients (email, name, tier, status)
      values ('client@example.com', 'Test Client', 'core', 'awaiting_onboarding');
      ```
   3. When they sign in, the dashboard calls `claim_coaching()` and their My Coach tile appears. They are linked to the row.
   4. A test client's plan stays `awaiting_onboarding` until they submit onboarding (Basic submits it straight to active). To move a coached plan on by hand for testing, for example to `active`, set `status`, `activated_at` and `start_date` in the Table Editor. Do not do this for a real client.

## Run order (Supabase SQL Editor, in this order)

1. `supabase/coaching.sql`, only if it has not been run before.
2. `supabase/coaching-portal.sql`. Safe to run twice.
3. `supabase/coaching-portal-verify.sql`. Read the results panel: one row per check, each marked PASS or FAIL.
   - It works inside one transaction and ends with a rollback. It creates stub users, rows, logs and a customer record only while it runs, and leaves nothing behind.
   - It acts as anon, two clients, a coach without MFA and a coach with MFA, and re-checks the rules from `tests/coaching-portal-rls.test.js`.
   - Every check is recorded even if it errors (recorded as FAIL), so one failure does not stop the rest.
   - It checks against counts taken during the run, not fixed numbers, so it is correct on the live project.
   - Expect 33 rows, all PASS (28 from 4a, plus the 4b checks). If any row is FAIL, do not go on to step 4: send me the row's text.
   - The stub users need the standard `auth.users` columns (`id`, `email`, `email_confirmed_at`). If the first row says FAIL on the setup check, paste me its detail.
4. Add yourself as the coach, and add a test client, as described below.

## Login: the My Coach tile and `/my-coach`

- After sign-in, the dashboard calls `claim_coaching()`. If it finds a plan, the **My Coach** tile appears. Nobody else sees it. If the call fails (for example before step 2 has been run), the tile stays hidden and the dashboard works normally.
- `/my-coach` needs a signed-in user. If nobody is signed in, the page sends them to the dashboard sign-in and brings them back afterwards.
- The page shows the plan name and a message for each status: `awaiting_onboarding` (the setup button is a placeholder for the next step), `awaiting_activation`, `active`, `paused`, `finished` and `cancelled`.
- The page holds only the public publishable key. No service key or other secret is in the browser.

## Tests

- `tests/coaching-portal-rls.test.js` runs the real SQL in Postgres (PGlite, which is Postgres compiled to run in Node; no Docker is needed here) and acts as anon, two clients, a client who is awaiting or paused, a basic client, an unconfirmed user, a confirmed user with no plan, a coach without MFA and a coach with MFA. It checks each rule in the step 4a list, that the SQL runs twice, and that it leaves other tables alone.
- `tests/coaching-portal-pages.test.js` checks the My Coach tile and `/my-coach` in a browser, with the Supabase library stubbed.
- `npm test` runs everything.

**What the tests cannot prove:** they use PGlite, not the Supabase image. Supabase's own `auth` schema, its MFA flags in the sign-in token, and its default grants are imitated in the test set-up. Before launch, run the same checks on a Supabase preview project, the way you would sign in to it: with a password, and with a password plus MFA.

## Things to know

- **`start_date` is still required** on `coaching_clients`, because it was in the first version of the table. Pending plans get today's date. Activation uses `activated_at`, which is what the logging window checks.
- **Coach notes moved** to `coaching_notes`. The old `notes` column stays, but no one can read it through the API.
- **`coaching_customers` is one row per purchase**, not one row per person. Consent is recorded on each row, and `set_marketing_consent()` updates all of a person's rows.
- **A client's offline logs** (the demo lets a client record meals while waiting for activation) are not allowed here: the database accepts logs only from activation onwards, while active. The demo's "baseline" group has no place in the database.
- **Check-in rules** (one kick-off call for Essential) are not yet in the database. They are part of the next step, when the coach screens move onto this data.
- **The coach's client list** must name its columns, not use `select *`, because of the notes column.
- **Branch and main:** `coaching-portal` starts from `coaching-demo`, which does not yet have the security fixes that are on `main` (the dashboard ratings change). When this branch is merged into `main`, `dashboard.html` will need the two changes combined.

## Step 4b: the client side on real data

What 4b adds, on top of 4a:

| Part | What it is | Where |
|---|---|---|
| Full history | A client reads every coaching row linked to their login: the current plan and older 12-week plans. Writes still go only to the current active plan. | `supabase/coaching-portal-4b.sql` (`my_client_ids()`, read policies) |
| Returning clients | `claim_coaching()` links a new plan for the same email, not only the first one. | `supabase/coaching-portal-4b.sql` |
| Beast AI counter | 40 calls per client per Melbourne day, and 300 shared across all clients per day. Only the server can use it. | `supabase/coaching-portal-4b.sql` (`coach_ai_usage`, `coach_ai_use()`) |
| Beast AI endpoint | `/api/coach-ai`: checks the user's token with Supabase, checks an active plan, counts the call, then calls Anthropic. Modes: Describe it, Meal Builder (fridge and create), How to do it. | `api/coach-ai.js`, and the runners exported from `api/demo-ai.js` |
| Client portal | The onboarding (six steps and the Basic screen), the status screens, Today (Add a meal in three modes, workouts, Other activity, steps, weigh-in), My plan, Progress, and Settings (news, delete my data). | `my-coach.html` |
| Checks | The 4b checks are in the verify script, which now also runs 4b first in the test suite. | `supabase/coaching-portal-verify.sql` |

### Run order (Supabase SQL Editor, in this order)

1. `supabase/coaching.sql`, only if it has never been run.
2. `supabase/coaching-portal.sql` (4a). Already run on the live project.
3. `supabase/coaching-portal-4b.sql` (4b). Safe to run twice.
4. `supabase/coaching-portal-4b2.sql` (4b2). Safe to run twice. Client time zones, and the marketing email setting. Run after 4b.
5. `supabase/coaching-portal-verify.sql`. Read the results panel: every row should say PASS. It still rolls back, so it leaves nothing behind.

### Step 4b2: client time zones and marketing emails

- **Time zones.** "Today", the 3-day logging window, the activation day and the weigh-in day use the client's own zone (`coaching_clients.time_zone`). A missing or unknown zone falls back to Australia/Melbourne. Onboarding saves a valid IANA zone: a city such as London is mapped to Europe/London (`resolve_time_zone()`), and a full zone name is kept as it is. Database: `supabase/coaching-portal-4b2.sql` (`valid_time_zone()`, `resolve_time_zone()`, `client_zone()`, `client_today()`, `can_log_on()`, `submit_onboarding()`). Page: `my-coach.html` (`zoneFor()`, `clientToday()`, `canLog()`).
- **Marketing emails.** `get_my_marketing_consent()` (security definer) returns only the signed-in client's own setting, true or false. Settings shows "Marketing emails: On" or "Off" with one toggle button. Anon cannot call it.
- **Checks.** The verify script adds a London client: the client zone is Europe/London, a London client logs on their own date, can log 3 days back and is refused 4 days back. It also checks the fallback zone, city mapping, that a client sees only their own marketing setting, and that anon is refused.
- **Limit of the London check.** Right now London and Melbourne may be on the same calendar date, so the London boundary is only proven in full when the two dates differ (roughly from midnight to 11am Melbourne time). The zone-to-date mapping itself is covered by the fallback and city checks.

### Environment for `/api/coach-ai` (Vercel)

- `ANTHROPIC_API_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (the counter only). Both must be set for the environments you use. Without them the endpoint returns 500 `not_configured` and no AI call is made.
- The browser only ever receives the signed-in user's access token. No secret key is in the page.

### Decisions, and where the portal differs from the demo

- **Storage.** The demo kept everything in the browser. The portal reads and writes Supabase directly, and relies on the database rules. The only thing kept in the browser is the onboarding draft, so answers survive a reload.
- **Logging dates.** The window uses Melbourne's date, the same day the database uses. A client in another zone may see a different "today" in their own time, but logging follows Melbourne's day.
- **Weigh-in edits.** Saving a second weigh-in in the same week updates the one you already have, rather than failing. The database still allows only one per week.
- **Refused days.** The page checks the logging window before it writes, so a refused day shows a clear message. The database checks again on every write, and that check is the one that counts.
- **Consent.** A client cannot read their news choice (the customer list is coach-only), so Settings shows two explicit buttons and reports what was just saved, rather than showing the current state.
- **Delete my data.** Two steps: an explanation and a confirm button. The purchase record is kept, as the page says.
- **Plans.** The coach's plan is read as JSON: `{ "meals": { "1".."7": [meal, ...] }, "training": "Mon: Full body A\n- Squat 3x8" }`. Step 4c writes plans in this shape.
- **Basic targets.** Worked out on the server by `submit_onboarding()`, so a client cannot type their own. The Basic targets screen appears straight after submitting.
- **Beast AI limits.** Each call counts before Anthropic is called, including a call that then fails. That keeps the limit honest, and it is the simplest rule to explain. A failed call therefore uses up one of the 40.
- **Exercise library.** Copied unchanged from the demo, so the wording matches.
- **WhatsApp.** The Beast's button still links to `https://wa.me/`, as in the demo. The real Stefan number is not yet in the page. Add it before launch.
- **Check-ins.** The client sees the next check-in from `coaching_checkins`. Scheduling it, and the one-kick-off rule for Essential, are step 4c (coach side).

### Tests added in 4b

- `tests/coaching-portal-client.test.js`: the client portal on a stubbed Supabase, which applies the same window and weigh-in rules as the database. It covers both onboarding flows (the six steps and the Basic screen), the status screens, the check-in card, The Beast only WhatsApp, From my plan, Describe it, Meal Builder, workouts (plan and Other activity), steps, the weigh-in day, past-day logging, refused days with a friendly message, read-only plans, earlier plans in Progress, the consent buttons, delete my data, How to do it, and no coach-only notes.
- `tests/coach-ai.test.js`: no token, a bad token, no active plan, the client limit, the shared cap, the order of the checks, the day mode refused for clients, an unreachable counter, missing keys.
- `tests/coaching-portal-rls.test.js`: the 4b database rules (older plans, the returning-client claim, the counter per client and shared, anon refused), and the extended verify script (after 4b and 4b2), all PASS, nothing left behind.

What the tests cannot prove: the page is tested on a stub of Supabase and of Beast AI, and the database on PGlite. Before launch, sign in on a Supabase preview project with a real client account and check one day of logging end to end, and one call to Describe it.

## Agreement pages

Agreement pages: reviewed by Stefan's attorney. Australian Consumer Law refund wording and Australian Privacy Principles to be confirmed before launch.

## Step 4c: the coach side (`/coach`)

### What 4c adds

- **`coach.html` at `/coach`.** Not linked from anywhere, `noindex`. Sign in with your email and password, then a code from an authenticator app (Supabase MFA, TOTP). The first time, you set the authenticator up with a QR code or a typed key. Every later sign-in asks for a code, so the session is `aal2`. If your account is not in `coaching_admins`, the page shows only "This page is for the coach only".
- **No "remember me".** The session is kept in this browser tab only (`sessionStorage`), closing the tab signs you out, and you are signed out after 30 minutes without activity. There is a Sign out button on every screen.
- **The coach screens from the demo, on real data:** Clients (capacity you can edit, add a client by hand, filters by status and plan, search, badges for awaiting activation and health flags, "needs you"), and each client's Overview, Check-ins, Onboarding, Targets and plan (plan inputs, targets, meal plan with Calculate with Beast AI, training plan, Approve and publish), Logs (from activation, sets and reps, lifts that went up, a baseline group), Progress and Notes. Also Customers (filters, Copy emails, Export CSV) and Settings (your WhatsApp number, your authenticators).
- **Database rules (`supabase/coaching-portal-4c.sql`).** Each one holds even if someone writes to the table directly:
  - **Health flag:** any "yes" to the three health questions, or an injury written in onboarding. Activation is refused until "Cleared to start" is ticked. The database records who ticked it and when.
  - **Activation:** `activated_at` is now, and the end date is the start date plus 12 weeks.
  - **Pauses:** Core and The Beast only, from active only, 14 pause days per plan at most. The end date moves by the days paused. A pause longer than the days left is counted only up to 14 in total.
  - **Check-ins:** Basic gets none. Essential gets one kick-off call (a cancelled one does not count, so you can rebook it). Core and The Beast get any number.
  - **Capacity:** the coach can change `place_limit`. Add client by hand is refused when the plan is full.
  - **Publishing** makes a new version in `coaching_plans`. Old versions are kept.
  - **CSV export:** `coach_marketing_export()` returns one row per email (email, name, plan, date of last purchase), only for customers who said yes and have not unsubscribed.
  - **WhatsApp number:** stored in `coaching_settings` (coach only). `get_coach_whatsapp()` gives it only to a signed-in client on an active or paused The Beast plan. The client's button uses it. It is not in the code.
  - **Basic privacy:** the coach cannot read a Basic client's meals, workouts, steps or weigh-ins, as the privacy page says.
- **Beast AI for the coach.** `/api/coach-ai` with `mode: 'day'` is the meal plan builder. It works only for a token whose user is in `coaching_admins` AND that is `aal2`. Coach calls have their own limit of 200 a day (`coach_ai_use_coach`), and never count against any client or the shared client total.
- **My Coach (client):** the WhatsApp button shows only when the database returns your number. A paused client sees "Paused since ... Pause days used: N of 14".

### Run order (Supabase SQL Editor, in this order)

1. `supabase/coaching.sql`, `supabase/coaching-portal.sql`, `supabase/coaching-portal-4b.sql`, `supabase/coaching-portal-4b2.sql` (all already run on the live project).
2. `supabase/coaching-portal-4c.sql` (4c). Safe to run twice. **Run it before this branch's pages go live:** My Coach now reads `paused_at` and `pause_days_used`, which 4c adds.
3. `supabase/coaching-portal-verify.sql`. Every row should say PASS (64 checks). It rolls back, so it leaves nothing behind.

No new environment variables. `/api/coach-ai` uses the same `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as before.

### Add yourself as the coach, and set up your authenticator

1. Have a normal account on the site: sign up at beastcoach.fit/dashboard with your email, and confirm the email.
2. In the Supabase dashboard, check MFA is on: Authentication, then Multi-Factor (or Sign In / Providers), and make sure **TOTP (App Authenticator)** is enabled.
3. In the SQL Editor, run this with your email:
   ```sql
   insert into public.coaching_admins (user_id)
   select id from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```
   Check it: `select a.user_id, u.email from public.coaching_admins a join auth.users u on u.id = a.user_id;` should show only you.
4. Open `/coach` and sign in with your email and password.
5. The page shows a QR code and a key. Scan the code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or Bitwarden), or type the key in. Enter the 6-digit code and press Verify. You are in.
6. **Straight away, add a backup.** Go to Settings, Add a backup authenticator, and set up a second one: another phone, or a password manager that stores codes. Supabase authenticator codes come with no recovery codes, so a backup is the only way to sign in if your phone is lost.
7. From then on, every sign-in asks for a code from either authenticator.

**If you are locked out** (no working authenticator): in the Supabase dashboard go to Authentication, Users, open your user, and remove the MFA factor. Then sign in at `/coach` and set up the authenticator again (and a backup).

### Decisions in 4c, and where it differs from the demo

- **Basic clients:** the coach sees plan, status and billing only, as in the demo and the privacy page, and the database now enforces it. 4a had let the coach read Basic logs; 4c closes that.
- **Waitlist card:** not built. There is no waitlist table yet.
- **Customers "Data deleted" column:** shown as Status, worked out from the client rows ("No client data" when there are none). The database does not record a deletion date.
- **Customer CSV:** your columns (email, name, plan, date), not the demo's longer list. The date is the date of their last purchase.
- **Unsubscribe** on the Customers page has a confirm step, which the demo does not.
- **Every status change** (activate, pause, resume, finish, cancel, change plan, delete) has a confirm step.
- **Check-in times** are entered in Melbourne time. The client's own time is shown beside it, as you schedule and in the list.
- **Plan meals:** the client portal shows "Label: foods", and no longer repeats the foods underneath when they are the same.

### Tests added in 4c

- `tests/coach-portal.test.js` (19 tests): sign-in, wrong password, not-a-coach screen, MFA enrol (QR, key, backup advice) and challenge-then-verify, sign out, the clients list filters and badges, capacity, add client (and full), health flag and activation with confirm, pause and resume with "N of 14", check-ins (Essential limit, Melbourne time with the client's own time beside), the plan editor and publish (plan JSON shape), targets, logs, notes, the Basic view, the CSV, settings and a backup authenticator, and that `/coach` has no secret keys and no links to it.
- `tests/coach-ai.test.js`: the coach path (aal2 and admin), aal1 refused, not admin refused, the coach limit, and that coach calls touch no client counter.
- `tests/coaching-portal-rls.test.js`: 4c runs twice cleanly, anon cannot run the new functions, and the verify script passes (also at the fixed 10pm London clock).
- `supabase/coaching-portal-verify.sql`: now 64 checks.

What the tests cannot prove: Supabase's real MFA (the page is tested against a fake of supabase-js). Before launch, sign in at `/coach` on the preview with your real account and authenticator, add a backup, activate a test client, publish a plan and schedule a check-in.

## Open after 4c

- **Payments into the portal:** Stripe purchases still need to create the client and customer rows automatically (today: Add a client by hand).
- **Waitlist** table and card.
- **Renew and drop-to-Basic buttons** for finished clients.
