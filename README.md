# Beast Coach Website

**beastcoach.fit** — We all have a beast in us.

## Pages
- `index.html` — Homepage with early access signup
- `features.html` — Full feature list
- `about.html` — Founder story and mission
- `privacy.html` — Privacy policy
- `styles.css` — All styles

## Images to add
Replace these placeholder image files with your actual photos:
- `hero.jpg` — Full bleed hero image (gym or nature shot, landscape)
- `screen-workout.jpg` — App screenshot of workout screen
- `screen-meals.jpg` — App screenshot of meal planning screen
- `screen-ai.jpg` — App screenshot of AI logging screen
- `founder.jpg` — Founder photo for about page

## Deploying to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → New Project → Import from GitHub
3. Select this repo → Deploy (no build settings needed)
4. Go to Settings → Domains → Add `beastcoach.fit`
5. Point your GoDaddy DNS to Vercel:
   - Add CNAME record: `www` → `cname.vercel-dns.com`
   - Add A record: `@` → `76.76.21.21`

## Early access leads
View signups in Supabase → Table Editor → early_access table.
Columns: id, email, created_at
