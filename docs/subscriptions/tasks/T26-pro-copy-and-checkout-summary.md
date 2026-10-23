# T26 · Pro wording on existing pages and a summary before checkout

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer |
| Size | M |
| Depends on | T23, T24 |
| Unblocks | T27 |

## Why

Five places still describe Pro as free and switched on by hand. Once payments are live they must show the price and
the T23 rules instead. The `/manage/` page also needs a short summary **before** Razorpay Checkout opens, so nobody
reaches a payment window without having read the price, the renewal and how to cancel.

## What changes

Everything below is switched by **one flag**, so the site can ship this work while still in the free test:

- `plan.json` gets `"paid": false`. `fill-plan.mjs` keeps the elements marked `data-when="paid"` or
  `data-when="free-test"` and drops the others at build time. Static pages, no runtime switch.
- `paid` goes to `true` only at go-live (T27). `npm run check` refuses `paid: true` while `monthly` is `null`.

| Page | Today | When `paid` is true |
|---|---|---|
| `index.html` plans section | "Free while it's being tested", "Ask for Pro" | `{{PRO_PRICE}}`, `{{PRO_GST}}`, the renewal line, "Get Pro" → `/pricing/` |
| `index.html` FAQ "What does it cost?" | "Pro is also free while it's being tested" | Free is free; Pro is `{{PRO_PRICE}}`, renews monthly, cancel any time on `/manage/`; link to `/pricing/` |
| `subscribe/index.html` Pro row | "Free while it's being tested… switched on by hand" | Price, renewal, link to `/pricing/`. Or the page redirects to `/pricing/` (decide here; keep old links working) |
| `signup/index.html` Pro box | "I'd also like Pro", unticked | "I'd like Pro (`{{PRO_PRICE}}`). You'll pay on your account page after confirming your email." Still unticked unless `?pro=1` (T23 B6) |
| Live board locked panel (`travel-problem-radar.jsx`) | "…ask for Pro on your account page" | "…get Pro (`{{PRO_PRICE}}`) on your account page", link to `/pricing/`. The price reaches the bundle through a `data-` attribute on `live/index.html`, filled at build; the bundle shows no price if it's missing |
| `manage/index.html` "Request Pro" block | Shown when Razorpay isn't set up | Dropped from the build |

## `/manage/` before and after paying

**Before Checkout opens** (the `buy` block). Shown on the page, not in a pop-up:

> **Pro: {{PRO_PRICE}}** {{PRO_GST}}
> Renews automatically every month until you cancel. Cancel here any time; Pro stays on until the end of the period
> you've paid for. {{PRO_REFUND}} Payments are handled by Razorpay.
> [Pay with Razorpay] · [Pricing details]

- "Upgrade to Pro" becomes "Pay {{PRO_PRICE}} with Razorpay", so the button says what it does.
- Checkout's own screen shows the amount Razorpay charges. T27 checks it equals the page.

**After paying** (states that exist today, reworded to T23):

| State | Text |
|---|---|
| Webhook not in yet | "Payment received. Pro starts in a minute or two; this page updates itself." Poll as today |
| Active | "Pro, {{PRO_PRICE}}. Renews on DATE. [Cancel renewal]" |
| Cancelled, still in period | "Pro until DATE; it won't renew. [Start Pro again]" (**verify** a new subscription can start while the old period runs, else hide until DATE) |
| Renewal failed, retrying (`pending`) | "Your last payment didn't go through. Razorpay will try again; Pro stays on meanwhile." |
| Stopped (`halted`) | "Payments stopped, so you're back on Free. Nothing more will be charged." |
| Checkout closed without paying | "No payment was made." No retry nag (T23 B4) |

**Cancel** stays two steps (already built): "Cancel renewal" → "Yes, cancel it" / "Keep Pro". Plain words, no
reason asked, no offer screen (T23 A3, B5).

## Acceptance criteria

- [ ] With `paid: false`, the built site is word-for-word what it is today (diff of `public/` before and after shows
  only the footer from T25)
- [ ] With `paid: true` on a Preview with test keys, every row above shows as written
- [ ] T23 rules ticked for each changed page, with the hand checks written down
- [ ] Docs: README.md (plans), [paid-website.md](../paid-website.md), CHANGELOG.md

## Tests

- `fill-plan`: `data-when` blocks kept and dropped for each value of `paid`; `paid: true` with `monthly: null` fails
- `npm run check`: no "being tested" or "switched on by hand" in shipped pages when `paid` is true; the Pro box has
  no `checked`; the manage page's pay button text includes the price
- `npm test`: manage-page state texts for `pending` and `halted` (the session reply already carries `rzp.status`;
  **verify** in `api/_lib/` and add it if not)
