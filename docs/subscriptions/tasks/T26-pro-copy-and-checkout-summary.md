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

## Built (2026-10-23)

Branch `feat/t26-pro-copy`. `plan.json` stays `paid: false`, so the live site doesn't change: a build diffed
against `main` differs only in blank lines where the paid blocks were dropped, and in the scripts below.

- **Switch.** Each page keeps today's text in `<!-- when:free-test -->…<!-- /when -->` with the paid text beside it in
  `<template data-when="paid">`, the markers `fill-plan.mjs` already has (T24).
- **Home.** Pro card: `{{PRO_PRICE}}`, a line with the GST and renewal, and "Get Pro" → `/pricing/`. FAQ: price, GST,
  renewal, cancel on the account page, a link to `/pricing/`. The sign-up dialog's Pro box: price, GST, "renews
  automatically every month until you cancel", "you'll pay on your account page after confirming your email".
- **`/subscribe/`.** The Pro row gets the price, GST, renewal and a `/pricing/` link. No redirect: the page stays.
- **`/signup/`.** The Pro box as on the home page, still unticked unless `?pro=1`.
- **Live board.** The price line reaches the bundle through `<meta name="tpr-pro-price">` in `live/index.html`, inside a
  paid block, so it exists only in a paid build. With it, the locked panels show the price and renewal, "Get Pro" →
  `/pricing/` and "Go to your account". Without it they read as today. (A meta tag, not a `data-` attribute: a
  `<template>` block holds whole elements.)
- **`/manage/`.**
  - The `buy` block shows the summary above the button: price, GST, renewal, cancel any time with Pro until the
    period's end, the refund rule (`{{PRO_REFUND}}`), "Payments are handled by Razorpay" and "Pricing details".
  - The button is **"Pay with Razorpay"**, without the amount: while GST is open, "Pay ₹299" could be wrong if GST is
    added on top. Checkout's own screen shows the amount; T27 checks it.
  - The `ask` block stays in the paid build (it shows when Razorpay isn't set up) but says "Payments aren't open right
    now" and has no Request Pro button. The script skips the button when it's missing.
  - Closing Checkout says "The payment window was closed." The planned "No payment was made" could be wrong: a payment
    may finish after the window closes (for example in a UPI app; **verify**), and Pro then starts from the webhook.
- **Failed renewals (a correction).** The plan's `pending` text said "Pro stays on meanwhile". It doesn't: Razorpay
  retries after the period has ended, so `effectivePlan()` is already Free, and the page offered **Upgrade**. A
  second subscription could then charge twice. Now:
  - `/api/account` returns `billing`: `"pending"` while Razorpay retries, `"halted"` once it has given up, else
    `null`;
  - a checkout while `pending` gets `409 payment_retrying`;
  - the page says "Your renewal payment didn't go through, and Razorpay is trying again. Pro comes back as soon as a
    payment succeeds" with no pay button (a `charged` event restores Pro, as `applyRzpEvent` does today);
  - `halted`: "Razorpay stopped trying to take your renewal payment, so you're on Free … You can start Pro again
    below." The plan's "Nothing more will be charged" is left out: no source says a halted subscription can't be
    charged again (**verify** in Razorpay's docs at T27).
- **Not built.** "Start Pro again" while a cancelled period runs: checkout already refuses while Pro is on
  (`already_pro`). The active line keeps "Renews on DATE." without the price, which the page script doesn't have.

**Checks and tests.**
- `npm run check`, 188:
  - with `paid: true`, no page says "being tested" or "switched on by hand";
  - the manage page's paid summary has the price, GST, renewal and refund rule above "Pay with Razorpay", and no
    Request Pro;
  - the page handles `pending`, `halted`, `payment_retrying` and a closed window;
  - the live page carries the price meta and the bundle reads it.
  - Each check was tried failing once.
- `npm test`:
  - `billing` for each state, and `null` for an owner-granted Pro;
  - `payment_retrying` with no call to Razorpay;
  - the five real pages filled both ways: unchanged with `paid: false`, and with the sample plan no `{{`, no
    free-test text, the price and the renewal.

**Still open.**
- **Go-live order.** Once paid, these pages link `/pricing/`, so `/pricing/` must ship first. `npm run check` already
  refuses `paid: true` while `/pricing/` is a draft (tried with a temporary `plan.json`).
- **Acceptance.** The "`paid: true` on a Preview with test keys" item is T27's run.
