# T24 · `/pricing/` page and one source for the plan's facts

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer |
| Size | M |
| Depends on | T23 (rules; owner inputs 1, 2, 4) |
| Unblocks | T26, T27 |

## Why

The price, period, GST line and refund rule will appear on several pages and must match the live Razorpay Plan. If
each page types them by hand they will drift. This task keeps them in one file and builds the pricing page from it.
Design: [pricing-and-about-pages.md](../pricing-and-about-pages.md#pricing).

## What to build

### 1. `plan.json` (repo root, not secret)

```json
{
  "currency": "INR",
  "monthly": null,
  "yearly": null,
  "gst": null,
  "trialDays": 0,
  "refund": null,
  "methods": null
}
```

- `monthly` / `yearly`: whole rupees, or `null` when not offered. `gst`: the exact line to show, for example
  "GST included" or "plus 18% GST" (owner input 2). `refund`: the one or two sentences of the rule (input 4).
  `methods`: the list switched on in Razorpay (T23 A6).
- Committed with `null`s. While `monthly` is `null` the pricing page **isn't shipped** (see 3).

### 2. `scripts/fill-plan.mjs`

- Same pattern as `scripts/fill-legal.mjs`: runs in the build on `public/`, replaces `{{PRO_PRICE}}`,
  `{{PRO_PERIOD}}`, `{{PRO_GST}}`, `{{PRO_REFUND}}`, `{{PRO_METHODS}}` in shipped HTML, escapes the values, and
  **fails the build** if a slot is used while its value is `null`.
- `{{PRO_PRICE}}` renders as "₹199 a month" (T23 C5). Numbers are formatted with `en-IN` grouping.
- Exports `fill(text, plan)` for the tests. Kept by `.vercelignore` like `fill-legal.mjs`.

### 3. `pricing/index.html`

Static page, the same look as `/subscribe/`. Sections, in order:

1. **Two plans** (T23 C1): Free and Pro, same feature rows in the same order, Pro's price from `{{PRO_PRICE}}` with
   `{{PRO_GST}}` under it, and A2's renewal line next to the button.
2. **Get Pro button.** Signed out: `/signup/?pro=1`. Signed in: `/manage/`. Decided in the page with
   `GET /api/session?action=me` (an existing endpoint); if that call fails, the link stays on `/signup/?pro=1`.
3. **How billing works:** renews each month; cancel on `/manage/` any time and keep Pro to the end of the period;
   the RBI note on later charges (T23 A5, wording **verified**); failed renewals (A8).
4. **Refunds:** `{{PRO_REFUND}}` and a link to `legal/refunds/` (shipped by T25).
5. **Payment:** "Payments are handled by Razorpay. We never see your card or UPI details." and `{{PRO_METHODS}}`.
6. **What Pro doesn't promise** (T23 B2).
7. **Questions:** contact address (input 9).

- The build command copies `pricing` only after `plan.json` has a `monthly` value. `npm run check` refuses a build
  command that ships `pricing` while `monthly` is `null`.
- The "Plans" footer link points to `/pricing/` once it ships; `/subscribe/` then redirects there or links to it
  (decide in T26).

### 4. `scripts/check-plan.mjs` (owner-run, needs keys, not in `npm test`)

- Reads `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_PLAN_ID` from the shell, calls
  `GET /v1/plans/{id}` (**verify** the endpoint and that `item.amount` is in paise), and compares amount, currency
  and period with `plan.json`. Prints match or the difference. Prints no key.
- Run before go-live and after any price change (T27). The fetch is passed in, so its logic is tested offline.

## Acceptance criteria

- [ ] `plan.json` filled from the owner's inputs; the page shows them with no `{{` left in `public/`
- [ ] T23 rules A1 to A8, B1 to B7 and C1 to C9 ticked in the pull request, with the hand checks written down
  (keyboard, 360 px, contrast in both themes)
- [ ] Get Pro goes to `/signup/?pro=1` signed out and `/manage/` signed in
- [ ] `check-plan.mjs` run against the **test** plan and matches
- [ ] Docs: DEPLOYMENT.md (build step, `plan.json`, `check-plan.mjs`), CHANGELOG.md

## Tests

- `fill`: every slot filled; HTML in a value is escaped; a `null` value used by a page fails with its name
- `check-plan` with a stubbed fetch: match; amount differs; period differs; plan not found; no keys set refuses
  before any call
- `npm run check`: `pricing` in the build with `monthly: null` fails; T23's checks pass on the new page
