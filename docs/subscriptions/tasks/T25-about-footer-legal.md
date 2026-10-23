# T25 · `/about/` page, footer on every page, ship the policy pages

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Owner (text, legal details) and developer |
| Size | M |
| Depends on | T23 (owner inputs 4, 6, 9) |
| Unblocks | T27 |

## Why

People paying need to see who runs the site, how to reach them, and the terms and refund rule before they pay.
Razorpay's live activation also asks for these pages (**verify** the current list in the Razorpay dashboard). Today
only `legal/privacy` ships; `contact`, `terms` and `refunds` are drafts with `[OWNER INPUT NEEDED]` gaps (1, 5 and 4
of them). Design: [pricing-and-about-pages.md](../pricing-and-about-pages.md#about).

## What to build

### 1. `about/index.html`

Static. What the radar is and how it works (an AI model with web search, about 5 sweeps a day, nothing checked by a
person), who runs it (owner input 6: brand name and a line or two), and how to get in touch. **No legal name,
postal address or phone here**; those stay on `legal/contact/`, filled at build time.

### 2. Policy pages

- Fill every `[OWNER INPUT NEEDED]` in `legal/terms`, `legal/refunds` and `legal/contact` from the owner's answers.
  The refund page uses the same rule as `plan.json`'s `refund` (T23 A4); `npm run check` compares them.
- Name, address and phone stay `{{LEGAL_NAME}}`, `{{LEGAL_ADDRESS}}`, `{{LEGAL_PHONE}}`, filled by
  `scripts/fill-legal.mjs` from Vercel variables. The owner sets those for Production and Preview first.
- Add each page to the build command once its gaps are filled. `check.mjs` already treats each page on its own and
  refuses links to pages that don't ship.
- Terms say: what Pro includes and doesn't (T23 B2), renewal, cancel on `/manage/`, the refund rule, the governing
  law and place (owner input). **Not legal advice**; the owner may want a lawyer to read terms and refunds.

### 3. Footer

The same footer on every shipped page: home, live board, plans/pricing, sign-in, sign-up, manage, about and each
policy page.

`About · Pricing · Contact · Terms · Privacy · Refunds`

- Links appear only for pages that ship (check.mjs enforces it).
- ~~The live board's footer is in `travel-problem-radar.jsx`~~ Built instead in `live/index.html` and
  `demo/index.html`, outside the app's root, as [pricing-and-about-pages.md](../pricing-and-about-pages.md) has it:
  no bundle rebuild, and the demo ships too, so it gets the same footer.
- Plain links, readable contrast, 24 px targets (T23 C2, C4).

## Built (2026-10-23), waiting on the owner

- `about/index.html`: what it is, how it works, what it isn't, from facts already on the home page. "Who runs it" is
  still `[OWNER INPUT NEEDED]` (input 6), so it isn't in the build.
- Footer: `<nav class="site-foot">` on every shipped page and every draft. Shipped pages list the pages that ship,
  in the fixed order; until `/pricing/` and `legal/contact/` ship, **Plans** (`/subscribe/`) and the email address
  stand in for them. Today that's Plans · Contact · Privacy. Drafts list all six, as they will once everything ships.
- Policy pages, filled where the code already answers: terms (price, GST, trial, how payment works, renewal, failed
  payments) and refunds (cancel on `/manage/`, Pro to the end of the paid month, the rule and its days) now use
  `plan.json`'s slots, with the free-test wording while `paid` is false. The governing law was already filled (India,
  courts at Patiala). Still open: the "last updated" dates, notice when the service stops, liability, and who sends
  the notice before each renewal charge (RBI e-mandate, **verify**).
- `npm run check`: the footer of each page, in order; no shipped page links `about/`, `pricing/` or a draft policy
  page; terms and refunds use the slots; `about/` refuses to ship with a gap.

## Acceptance criteria

- [ ] No `[OWNER INPUT NEEDED]` left in any shipped page
- [ ] `LEGAL_*` variables set in Production and Preview; a preview build passes `fill-legal`
- [ ] Footer on every shipped page, no link to a page that doesn't ship
- [ ] Refund wording on `legal/refunds/` matches `plan.json`
- [ ] Docs: DEPLOYMENT.md (variables, build command), CHANGELOG.md

## Tests

- `npm run check`: a shipped policy page with `[OWNER INPUT NEEDED]` fails; a footer link to an unshipped page
  fails; refund text that differs from `plan.json` fails
- `npm test`: the existing `fill-legal` tests still pass
