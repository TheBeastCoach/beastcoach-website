# Coaching demo: handover

Branch: `coaching-demo` (not merged to `main`). Last updated 2026-11-25. Tests and the `/coaching` check are listed under "Running the tests".

## What is on the branch

| File | What it is |
|---|---|
| `coaching.html` | Sales page at `/coaching` ("Work With Me"). Plan cards, comparison table, FAQ. |
| `coach-img/` | Images for the sales page (`stefan.jpg`, `ai-meal-builder.jpg`, `ai-meal-log.jpg`). |
| `coaching-demo.html` | No-login demo at `/coaching-demo`. Coach view (Clients and Customers pages) plus a client view for each client. Everything is stored in the browser (`localStorage`). |
| `coaching-terms.html`, `coaching-health.html`, `coaching-privacy.html` | Draft agreement pages at `/coaching-terms`, `/coaching-health` and `/coaching-privacy`. Marked DRAFT, `noindex`. Linked from the onboarding agreements. |
| `basic-targets.js` | Basic daily targets formula, shared by the demo page and the tests. |
| `api/demo-ai.js` | Demo Beast AI endpoint, `POST /api/demo-ai`. |
| `supabase/coaching.sql` | Client list, editable capacity, `coaching_places()` for the live "spots left" counter. |
| `supabase/coaching-demo.sql` | Shared daily cap for demo AI calls (`demo_ai_use`). |
| `tests/` | Unit and browser tests (see below). |

### Sales page (`coaching.html`)

Prices in AUD. Copy and prices are as written in the file; do not change them without checking with Stefan.

| Plan | Price | Places (from `coaching_capacity`) | Plan updates |
|---|---|---|---|
| Basic | $2.50 a week, $30 billed every 12 weeks | Unlimited | None |
| Essential | $110 for 12 weeks | 100 | Week 6 |
| Core | $299 for 12 weeks | 25 | Weeks 4 and 8 |
| The Beast | $699 for 12 weeks | 4 | Whenever needed |

- Renewal is 20% off, and the Discipline Path ($37 normally) is included from Core up.
- The live counter reads `POST /rest/v1/rpc/coaching_places`. If that fails, the page keeps its static "spots left" wording.
- Until `supabase/coaching.sql` has been run, the browser logs a 404 for that RPC. The page still works.

### Agreement pages (DRAFT)

- `/coaching-terms`: what each plan includes, prices and billing, refunds (full before the plan starts, none once delivered), pausing (Core and The Beast, up to 2 weeks), WhatsApp reply hours for The Beast (within 2 hours, Australian business hours, Melbourne time), renewal, and Basic after 12 weeks.
- `/coaching-health`: Stefan is a coach, not a dietitian, nutritionist or doctor. General guidance, not medical advice. See a doctor first for a condition, injury or medication.
- `/coaching-privacy`: what is collected, who sees it (Stefan for coaching plans, nobody for Basic), that meal text and photos go to an AI provider, how to export or delete, and that the customer record is kept after deletion (tax records, and respecting email choices).
- Every page has the banner "DRAFT: not yet reviewed. Do not rely on this yet." Nothing here has been reviewed. Get it reviewed before launch.
- The onboarding links each agreement to its page. The link opens in a new tab, so the form is not lost.

### Basic and its targets (`basic-targets.js`)

- Setup questions: sex, age (18 to 100; under 18 shows "Coaching is for adults 18 and over."), height in cm or ft/in, weight, time zone (required), goal, job activity multiplier, the two steps questions, training sessions a week (0 to 14), training intensity, and two agreements.
- Maths, copied from `calculator.html` and kept in step by a test:
  - BMR is Mifflin-St Jeor.
  - TDEE is BMR × activity, plus steps kcal (`steps × weight × 0.00057`), plus training kcal per day (`sessions × intensity / 7`).
  - Goal adjustment: fat loss −500 kcal, maintain 0, muscle +300 kcal.
  - Protein per kg: 2.2 (fat loss), 2.0 (maintain), 1.8 (muscle).
  - Fat is a share of calories: 25%, 27%, 25%.
  - Carbs fill the rest. Fibre is 14 g per 1,000 kcal.
- **Calories use the everyday steps** (steps on a normal day, not counting planned walks). This is the conservative choice.
- **The steps target is the realistic target the client gave**, kept between 3,000 and 20,000 (`stepsTarget`). The old "average plus 2,000" rule is gone.
- **Open:** the file header says "Maintain" uses the calculator's maintenance branch and needs confirming before launch.

### Six-step onboarding

Steps (`OB_STEPS` in `coaching-demo.html`):

1. About you (includes the time zone)
2. Your goal and your day (includes the two steps questions)
3. Food you like
4. Food to avoid and how you eat
5. Training
6. Weigh-ins, what you have tried, health check and agreements

- Answers save as the client types. Required answers start blank, and Next shows errors without moving on.
- Step 6 ends with "Send my answers to Stefan".
- **Steps questions** (Basic and step 2):
  - "About how many steps do you do on a normal day, NOT counting any walks you do on purpose? (work, errands, around the house)" with "Just an estimate is fine." Accepts 0 to 60,000.
  - "What daily steps target feels realistic for you, including walks you do on purpose?" Accepts 3,000 to 20,000.
  - Both are required.
- **Food lists:** "Other foods you like", "Foods you will not eat" and "Allergies or intolerances" each have the hint "Separate each food with a comma, e.g. halloumi, chickpeas, lentils". The coach sees each food as a chip (split on commas).
- **Meals question:** "How many meals are you currently eating per day?" The coach sees it as "Currently eats".

### Time zone

- A text box, "Your time zone or city (e.g. Melbourne, London, New York)", with suggestions from a list of common cities and zones (HTML `datalist`). No default value. Required, on step 1 and on Basic.
- What they type is stored. If it matches a known city or zone, that zone is used for their "today" and their weigh-in day. Otherwise Australia/Melbourne is used and the coach sees a flag ("Not recognised: Australia/Melbourne is used") on the client overview and the onboarding answers.
- The coach's own pages use Melbourne.

### Step logging and weigh-ins

- Clients enter one step count per day (`saveSteps`, max 60,000). Coach sees steps on the day log and on Progress, with a 7-day average from activation.
- Weigh-ins are only accepted on the client's weigh-in day. On any other day the entry box is not shown, and the save refuses too. One per week; a second one replaces the first.

### Set and rep logging, and Other activity

- A workout is either a plan session or "Other activity".
- Plan session: one row per exercise, with sets of weight (kg or lb) and reps. Add and remove sets, or mark an exercise skipped. At least one set or one skip is required.
- Other activity: what, minutes, and notes. Blank minutes are saved as no minutes (not 0). It shows on Today and in the coach Logs.
- Coach sees sets and reps per session. A lift is highlighted "Up" when it beats the previous best.
- **Other activity fix:** the round 2 code saves what, minutes and notes, and blank minutes no longer become 0. I could not reproduce the "does not work" failure in the browser (saving worked on training days, rest days, past days, and in the coach view). The test in `coaching-demo.round2.test.js` covers the full path. If it still fails for you, send the exact steps and device.

### Add a meal

- A card titled "Add a meal", with the line "Log what you ate: pick it from your plan, or describe it and Beast AI calculates it."
- Options, in order: **From my plan** (default for coaching clients), **Describe it**, **Meal Builder**. Basic has Describe it only and opens on it.
- The Beast AI button is "Calculate now". "Enter the numbers yourself" is inside Describe it.

### Logging for past days

- Clients can log meals, steps and workouts for today and the 3 days before it. The Previous button stops at 3 days back.
- Older days are read-only: no add or save forms, a note says so, and the save handlers refuse.
- Weigh-ins stay strict (see above).
- The coach Logs show back-dated entries on the day they belong to, with a small "added later" tag.

### Logs start at activation

- The coach Logs tab lists days from the activation date to today, newest first. No empty days before activation.
- Meals logged while waiting for activation (or dated before it) sit in one collapsed group at the bottom: "Logged before activation (baseline)".
- Progress and the 7-day averages count only from the activation date.
- Seeded clients: Sam, Jordan and Alex have history from their start date. Mia is not yet activated, so her one seeded meal is in the baseline group and she has no seeded steps.

### Demo sample clients (`seedDb`)

- Sam Taylor: Core, active. Said yes to news.
- Mia Chen: Essential, awaiting activation.
- Jordan Reid: The Beast, active.
- Alex Lee: Basic, active.
- Three past customers: Dana Price (Core, finished, said yes), Ben Ortiz (Essential, finished, data deleted, did not say yes), Kim Walsh (Basic, unsubscribed).
- A "New client: buy a plan" option runs the purchase flow. Payment is simulated.
- Reset clears the browser data and reseeds the sample clients and customers.
- The storage key changed (`bc_demo_v3`, UI `bc_demo_ui2`), so browsers with older demo data start from the new seeds.

## Customers

- The coach's **Customers** page sits next to **Clients**. One row per person who has bought: name, country, email, products (chips), last purchase date, status (Active, Finished, Basic, Cancelled), OK to email, Data deleted, and an Unsubscribe action (demo only).
- **OK to email** means: said yes at checkout, and not unsubscribed.
- Filters: search by name or email, product, status, OK to email. Filters update the list in place.
- **Copy emails** and **Download CSV** only include customers who are OK to email and match the filters. A note on the page says how many are left out and why.
- **Checkout** asks for a country (required) and has an optional, unticked box: "Send me news and offers from Beast Coach. Unsubscribe any time." The answer and its date are stored on the customer record.
- **Deleting a client** removes their onboarding answers, plans, logs and notes. The customer record is kept, marked "Data deleted" with the date. A client who had not finished is recorded as **Cancelled**.
- Renewals and dropping to Basic are recorded as purchases.
- **In production** this becomes a Supabase table (one row per customer, joined with the existing Discipline Path purchases), readable only by the coach role. The code has a comment saying so.

## Demo Beast AI endpoint (`api/demo-ai.js`)

- Method: POST only. Header `x-demo-key` must match `DEMO_KEY` (SHA-256 compare, timing-safe).
- Modes: `log` (one meal), `day` (one line per meal, max 20 lines), `fridge` (photo, max about 2 MB, JPEG/PNG/WebP), `exercise` (how-to), `create` (meal from listed foods, with meal type and effort).
- Model: `claude-haiku-4-5-20251001`, set in the file.
- Shared daily cap: 200 calls per Melbourne day, across the whole demo, enforced by `demo_ai_use` in SQL. Not the same as the public "20 Beast AI requests a day" on the sales page.
- Responses:
  - 200: the result.
  - 400: `empty`, `too_long`, `too_many_lines`, `bad_image`, `image_too_big`, `bad_input`, `bad_mode`.
  - 401 `demo_key`.
  - 405 `method_not_allowed`.
  - 422: `not_food`, `not_exercise`, `ingredients`.
  - 429 `daily_limit`.
  - 500 `not_configured` if any environment variable is missing.
  - 502 `try_again` if the AI reply is not usable JSON.
- Parsing and ingredient checks are shared with `api/beast-ai.js` through its `_test` exports.

## Running the tests

Install the browser tooling once, outside the repo, so no `package.json` or lock file is created:

```
mkdir -p /tmp/cb-tests && cd /tmp/cb-tests && npm init -y && npm install --no-save playwright-core
```

Then, from the repo:

```
export PLAYWRIGHT_CORE_PATH=/tmp/cb-tests/node_modules/playwright-core
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export SHOT_DIR=/tmp/cb-shots          # optional: where screenshots are written
```

Unit and file checks (no browser):

```
node --test tests/basic-targets.test.js tests/demo-ai.test.js tests/coaching-legal.test.js
```

Browser tests (Chrome):

```
node --test tests/coaching-demo.flows.test.js tests/coaching-demo.integration.test.js tests/coaching-demo.round2.test.js
```

- `coaching-demo.flows.test.js`: the flows at 390px, with the clock set to a Monday.
- `coaching-demo.integration.test.js`: the real `api/demo-ai.js` handler in the browser, with only the Anthropic and Supabase calls mocked. Includes the AI error cases and the no-key case.
- `coaching-demo.round2.test.js`: logs from activation (a new client onboards, is activated, and the Logs tab is checked), the steps questions, the Basic steps rule, food lists, time zones, Add a meal, Other activity, past days, weigh-in strictness, customers (checkout, delete keeps the record, copy and CSV only for OK-to-email, unsubscribe, search and filters), reset, the no-key run, and the agreement links. It also writes the screenshots: `add-a-meal-phone.png`, `onboarding-steps-phone.png`, `agreements-links-phone.png`, `coach-logs-new-client-phone.png`, `customers-desktop.png`.
- If `playwright-core` cannot be loaded, the browser tests skip with a message.

Counts as of 2026-11-25: unit and legal checks 42 passing (`basic-targets`, `demo-ai`, `coaching-legal`); browser flows, integration and round 2 39 passing.

There is no automated test for `/coaching` itself. It was checked by hand at 390px and 1280px: no broken images, no horizontal overflow. The one console error is the `coaching_places` 404, which goes away once `supabase/coaching.sql` is run.

## Setup still needed

1. **Vercel environment variables, Preview scope:**
   - `DEMO_KEY`: a random string of your choice. Do not commit it.
   - `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`: also needed by `api/demo-ai.js`. Check they are set for Preview as well.
2. **Supabase SQL Editor** (Dashboard → SQL Editor → New query → paste → Run), in this order:
   1. `supabase/coaching-demo.sql`
   2. `supabase/coaching.sql`

   Both files are safe to run again. `coaching.sql` never overwrites capacity you have changed.

## Preview link

```
https://<preview-deployment>/coaching-demo?key=<DEMO_KEY>
```

- The key is saved in the browser (`bc_demo_key`) and removed from the address bar.
- The page opens without the key. The key only unlocks Beast AI. Without it the AI features show a "key" message, and the numbers can still be typed in.
- Use the Preview deployment, not production.

## Open decisions

1. **Do Core check-ins and calls stay on WhatsApp?**
   - Current copy: Core has a weekly WhatsApp check-in, two WhatsApp video calls at weeks 4 and 8, and form checks on WhatsApp. The Beast has weekly 1:1 WhatsApp video calls and direct WhatsApp access.
   - The demo tells clients to "ask Stefan on WhatsApp" or "bring it to your weekly check-in". The terms page repeats the WhatsApp details.
   - Where to change: `coaching.html` (plan cards and the comparison table), `coaching-terms.html`, and `coaching-demo.html` (the no-guide message, the status card and the WhatsApp links).
2. **Does Essential keep the week 6 plan refresh?**
   - Current copy: "Plan refresh at week 6" on the Essential card, "Plan updates: Week 6" in the table, and the same in `coaching-terms.html`.

## Other open items found in the code

- Confirm the Maintain targets (see `basic-targets.js` header).
- Get the three agreement pages reviewed before launch. They are drafts.
- Decide whether a customer who is Cancelled should ever come back to Active. The demo sets Cancelled only when a client who has not finished is deleted.
- The Discipline Path purchases are not recorded yet. The customer model is ready for them.
- The `coaching_places` 404 stays until `supabase/coaching.sql` is run.
- The demo model ID is hard-coded in `api/demo-ai.js`.
- The Customers page and the customer records are demo-only, in browser storage. Do not treat them as real customer data.
