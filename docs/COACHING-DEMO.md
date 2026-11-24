# Coaching demo: handover

Branch: `coaching-demo` (not merged to `main`). Last verified 2026-11-25: all tests passing, `/coaching` checked at 390px and 1280px.

## What is on the branch

| File | What it is |
|---|---|
| `coaching.html` | Sales page at `/coaching` ("Work With Me"). Plan cards, comparison table, FAQ. |
| `coach-img/` | Images for the sales page (`stefan.jpg`, `ai-meal-builder.jpg`, `ai-meal-log.jpg`). |
| `coaching-demo.html` | No-login demo at `/coaching-demo`. Coach view plus a client view for each seeded client. Everything is stored in the browser (`localStorage`). |
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

### Basic and its targets (`basic-targets.js`)

- Setup questions: sex, age (18 to 100; under 18 shows "Coaching is for adults 18 and over."), height in cm or ft/in, weight, goal, job activity multiplier, average steps, training sessions a week (0 to 14), training intensity, and two agreements.
- Maths, copied from `calculator.html` and kept in step by a test:
  - BMR is Mifflin-St Jeor.
  - TDEE is BMR × activity, plus steps kcal (`steps × weight × 0.00057`), plus training kcal per day (`sessions × intensity / 7`).
  - Goal adjustment: fat loss −500 kcal, maintain 0, muscle +300 kcal.
  - Protein per kg: 2.2 (fat loss), 2.0 (maintain), 1.8 (muscle).
  - Fat is a share of calories: 25%, 27%, 25%.
  - Carbs fill the rest. Fibre is 14 g per 1,000 kcal.
- Steps target is the average plus 2,000, clamped to 7,000 to 10,000.
- **Open:** the file header says "Maintain" uses the calculator's maintenance branch and needs confirming before launch.

### Six-step onboarding

Steps (`OB_STEPS` in `coaching-demo.html`):

1. About you
2. Your goal and your day
3. Food you like
4. Food to avoid and how you eat
5. Training
6. Weigh-ins, what you have tried, health check and agreements

- Answers save as the client types. Required answers start blank, and Next shows errors without moving on.
- Step 6 ends with "Send my answers to Stefan".

### Step logging

- Clients enter one step count per day (`saveSteps`, max 60,000).
- Coach sees steps on the day log and on Progress, with a weekly average.

### Weigh-ins

- Weigh-ins are only accepted on the client's weigh-in day (`saveWeigh`). One per week; a second one replaces the first.

### Set and rep logging

- A workout is either a plan session or "Other activity".
- Plan session: one row per exercise, with sets of weight (kg or lb) and reps. Add and remove sets, or mark an exercise skipped. At least one set or one skip is required.
- Other activity: what you did, minutes, and notes.
- Coach sees sets and reps per session. A lift is highlighted "Up" when it beats the previous best.

### How to do it

- Exercises from the built-in library open with no AI call.
- An exercise not in the library goes to Beast AI (`mode: exercise`), and the result is saved in the browser.
- A non-exercise shows the "no guide" message.

### Demo sample clients (`seedDb`)

- Sam Taylor: Core, active.
- Mia Chen: Essential, awaiting activation.
- Jordan Reid: The Beast, active.
- Alex Lee: Basic, active.
- A "New client: buy a plan" option runs the purchase flow. Payment is simulated.
- Reset clears the browser data and reseeds these clients.

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

Unit tests (no dependencies, 35 tests across two files):

```
node --test tests/basic-targets.test.js tests/demo-ai.test.js
```

Browser tests (19 tests) need `playwright-core` and Chrome. Install it outside the repo so no `package.json` or lock file is created:

```
mkdir -p /tmp/cb-tests && cd /tmp/cb-tests && npm init -y && npm install --no-save playwright-core
cd ~/beastcoach-website
PLAYWRIGHT_CORE_PATH=/tmp/cb-tests/node_modules/playwright-core \
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node --test tests/coaching-demo.flows.test.js tests/coaching-demo.integration.test.js
```

- `coaching-demo.flows.test.js` runs the flows at 390px with the clock set to a Monday.
- `coaching-demo.integration.test.js` runs the real `api/demo-ai.js` handler in the browser, mocking only the Anthropic and Supabase calls.
- If `playwright-core` cannot be loaded, the browser tests skip with a message.

Run all of them with the commands above. All pass as of 2026-11-25.

There is no automated test for `/coaching`. It was checked by hand: it loads at 390px and 1280px, with no broken images and no horizontal overflow. The one console error is the `coaching_places` 404, which goes away once `supabase/coaching.sql` is run.

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
   - The demo tells clients to "ask Stefan on WhatsApp" or "bring it to your weekly check-in".
   - Where to change: `coaching.html` (plan cards and the comparison table, roughly lines 170 to 300) and `coaching-demo.html` (around lines 1285, 1682 to 1683 and 1693).
2. **Does Essential keep the week 6 plan refresh?**
   - Current copy: "Plan refresh at week 6" on the Essential card, and "Plan updates: Week 6" in the table.
   - Where to change: the same two places in `coaching.html`.

## Other open items found in the code

- Confirm the Maintain targets (see `basic-targets.js` header).
- The `coaching_places` 404 stays until `supabase/coaching.sql` is run.
- The demo model ID is hard-coded in `api/demo-ai.js`.
