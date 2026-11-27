# Recipes: how to add or change one

The full recipes are gated. Only a signed-in member can read the ingredients and method. The public site
shows a teaser: name, photo, tags, badges, labelled numbers and one line.

## Where things live

| File | What it is | Public? |
|---|---|---|
| `private/recipes-full.json` | The source of truth: every field, including ingredients and method | No. Not deployed (`.vercelignore`). |
| `supabase/recipes-full-upsert.sql` | Generated SQL that writes every recipe into `public.recipes_full` | No. Not deployed. |
| `recipe-img/<slug>.jpg` | Photo | Yes |
| `recipes-public.js` | Generated: public fields only | Yes |
| `recipes/<slug>.html` | Generated: teaser pages | Yes |
| `recipes.html` | Generated list block (between the recipe-list markers) | Yes |
| `sitemap.xml` | Generated | Yes |

## Required fields (in `private/recipes-full.json`)

Every recipe is one object with these fields:

- `id`: the slug. Lower-case letters, digits and hyphens only, for example `chia-oats-bowl`. Must be unique.
- `title`: the name shown on the page.
- `image`: the photo path, for example `recipe-img/chia-oats-bowl.jpg`. Use `null` only while there is no photo.
- `meal`: the tags, for example `["breakfast"]`. Allowed: breakfast, lunch, dinner, snack, smoothie.
- `difficulty`: `Easy`, `Medium` or `Hard`.
- `healthScore`: a number from 1 to 10, based on how whole the ingredients are (not a macro score).
- `kcal`, `protein`, `fibre`: numbers, the values for the basis below.
- `basis`: what those numbers are for. Use exactly one of `"per serve"`, `"per whole batch"`, `"per portion"`,
  `"per container"`, `"per brownie"`, `"per 40g"`, `"per 45g scoop"`. Use `null` only when the basis is genuinely
  unknown. A `null` basis hides the numbers on the public site until you confirm the basis.
- `teaser`: one line, shown publicly. Describe the recipe, and do not list ingredients or method.
- `ingredients`: array of strings, with quantities. Private.
- `instructions`: array of strings. Private.
- `desc`, `blurb`: longer text. Private.
- `dateAdded`: `YYYY-MM-DD`.
- Optional: `carbs`, `fat`, `chip` (the short name used in the Beast Challenge list).

## Steps to add or change a recipe

Run these from the repo root, in this order.

1. Edit `private/recipes-full.json`. Add the new object, or change an existing one. Keep the JSON valid.
2. Add the photo to `recipe-img/` (a `.jpg`, named after the slug). Set `image` to match.
3. Build the teaser pages, the public file and the recipe list: `node scripts/build-recipe-teasers.js`
4. Rebuild the search metadata (JSON-LD, footer bio, sitemap): `node scripts/build-seo.js`
5. Build the SQL: `npm run build:recipe-sql`
6. Run the tests: `npm test`. All must pass before anything else.
7. Commit on the branch and push. Do not merge.
8. Stefan runs `supabase/recipes-full-upsert.sql` in the Supabase SQL editor. This writes the full recipe for
   signed-in members. It is safe to run again. Until it has been run, a new or changed recipe does not show
   its full version to members.

The first time only: run `supabase/recipes-full.sql` once in Supabase, to create the table and its row-level
security. Then use the upsert file for every change after that.

## Rules

- No ingredients, quantities or method in any public file: not in `recipes-public.js`, the teaser pages, the
  list, the sitemap, JSON-LD or any page script. Only `private/recipes-full.json` and the Supabase table hold them.
- No em dashes or en dashes (the long dash characters) in any copy. Use a comma, colon or full stop.
- Australian spelling: flavour, colour, favourite, yoghurt, fibre, organise, litre.
- New work goes on a new branch, not on main.
- Never merge to main without Stefan's approval.
- Calories, protein and fibre need a basis. If you are not sure what a figure is for, set `basis` to `null`
  and ask.

## Checks before you push

- `npm test` passes.
- The teaser for the recipe reads well on a phone and has no ingredients in it.
- The recipe opens with its full content when signed in, and shows the sign-up message when signed out.
