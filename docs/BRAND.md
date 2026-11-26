# Beast Coach brand

Every page restyle follows these rules. The tokens live in `brand.css` at the site root. Use the variables, not raw colours.

## Colour (dark is the default)

| Token | Value | Use |
|---|---|---|
| `--ground` | #0B0C0A | page background (warm near-black) |
| `--ground-alt` | #0F100D | alternate section band |
| `--surface` | #141511 | cards |
| `--surface-raised` | #17180F | inside the highlighted card, table headers |
| `--line` | #26281F | 1px card borders |
| `--line-strong` | #3A3D30 | outline buttons, inputs |
| `--ink` | #F4F5EE | headlines and main text |
| `--ink-soft` | #C7C9BE | body text |
| `--muted` | #A3A69A | secondary text (the lightest text allowed) |
| `--lime` | #C6F432 | primary action: primary buttons, "Most popular", ticks |
| `--amber` | #FFC21F | spots-left counts |
| `--orange` | #FF8A2A | The Beast tier, and real urgency only (4 or fewer spots) |
| `--on-accent` | #0B0C0A | text on lime, amber or orange fills. Never white text on those. |

Focus ring: 2px solid `--lime`, 2px offset, on every interactive element.

## Gradient

`--brand-gradient: linear-gradient(90deg, #C6F432 0%, #FFC21F 55%, #FF8A2A 100%)`

Use it ONLY for:
- the logo,
- two or three key words in a headline (or one short sentence in the hero),
- the Core price,
- the 2px border of the highlighted Core card,
- big step numbers (01, 02, 03).

Never on backgrounds, buttons, body text, or in more than about three places on one screen.

## Type

- Headlines, plan names, prices and big numbers: **Big Shoulders Display**, weight 800 to 900, uppercase, line-height 0.88 to 1, never under 24px.
- Everything else: **Hanken Grotesk**, 400 to 700.
- Eyebrows: Hanken Grotesk 12px, 700, uppercase, letter-spacing 2px.
- Load: `family=Big+Shoulders+Display:wght@700;800;900&family=Hanken+Grotesk:wght@400;500;600;700`
- Bebas Neue and Manrope are retired. Do not load them on new or restyled pages.

## Shape and depth

- Buttons and badges: pills (999px radius).
- Cards: 20px radius. Large panels: 28px.
- No drop shadows. Depth comes from `--surface` on `--ground` plus 1px `--line` borders.
- Content max width 1200px, side padding 24px, sections padded about 88px top and bottom.

## Buttons

All buttons are pills, at least 52px tall, 16px 700 text, same padding and width rules.
- Primary: solid lime fill, `--on-accent` text. Main actions.
- Outline: transparent, 2px `--line-strong` border, ink text. Secondary actions.
- The Beast: solid orange (`--orange`) fill, `--on-accent` text, 2px orange border. The top tier only.

## Table and body text sizes

- Body text is 16px on desktop and at least 15px on mobile. Only eyebrows (12px) and small footnotes go smaller.
- Comparison table: feature names and cell values at least 15px mobile, 16px desktop. Rows have about 14px padding top and bottom.
- Plan names in table headers: Big Shoulders Display, about 24px. Prices under them: at least 15px.
- Section labels inside the table (The basics, Your plan, Coaching): eyebrows.

## Logo

An open ring (a "C") with a dot in the gap, inline SVG, viewBox `0 0 100 100`:
- path `M83.83 37.69 A36 36 0 1 1 56.25 14.55`, fill none, stroke-width 14, round caps,
- stroke is a `linearGradient` (userSpaceOnUse, x1 12 y1 88 x2 88 y2 12): #C6F432 at 0, #FFC21F at 0.55, #FF8A2A at 1,
- a circle at cx 73.14 cy 22.42 r 7, fill #FF8A2A.

Give every SVG instance its own gradient id (for example `logo-hdr`, `logo-ftr`, `logo-hero`).
Wordmark beside it: "BEAST COACH" in Big Shoulders Display 900, with "COACH" in the gradient.

## Shared classes (brand.css)

`.btn-primary`, `.btn-outline`, `.btn-beast`, `.plan-card`, `.plan-card--highlight`, `.tick-list`, `.eyebrow`, `.text-gradient`, `.site-nav` (the site header).

## Contrast

Body text at least 4.5:1 on its background. Display text 24px and up at least 3:1. The lightest text is `--muted`.
Check with `tests/brand.test.js` before shipping a page.
