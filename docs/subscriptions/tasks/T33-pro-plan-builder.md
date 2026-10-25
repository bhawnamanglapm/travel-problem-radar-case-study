# T33 · One Pro plan: categories, emails a day and billing period, priced and paid together

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Owner (pricing model, prices, periods) and developer |
| Size | L, in 3 PRs (prices and plans; the manage and pricing pages; checkout, plan changes and the test-mode run) |
| Depends on | Owner inputs P1 to P5 below; T14 and T32 (built) |
| Unblocks | T27 (go-live sells this plan), T34 (renewal works on the same plans) |

> Added 2026-10-25 at the owner's request ([decision log](../../decisions.md)): "select how many emails they want to
> receive from 1 to 5 per day … which category they have … monthly, three, six or twelve months", priced and paid
> for each, in Razorpay test mode first. It changes the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24)
> (one price, ₹299 a month, monthly only) and brings forward the tier decision [T31](T31-measure-and-add-tiers.md)
> had left until after launch.

## Why

Checked on 2026-10-25 against the code:

| The owner wants | Today | Gap |
|---|---|---|
| 1 to 5 emails a day, and the sweeps follow | **Built (T32).** `/manage/` saves 1 to 5; the site sweeps as often as the most frequent Pro member needs, between `SWEEPS_PER_DAY_MIN` and `SWEEPS_PER_DAY_MAX` (`api/_lib/schedule.js`) | Free to change for any Pro; not part of a price. Slot timing breaks when GitHub runs late ([T35](T35-sweep-slots-on-time.md)) |
| Categories: one, several or all | **Built for emails (T14).** Four checkboxes on `/manage/`; any 1 to 4; all 4 is stored as "every category" | No "All" or "Just one" shortcut. Free to change for any Pro; not part of a price. The live board always shows all 4 |
| Both as one plan | **Combined in delivery only.** Pro emails are grouped by (categories, emails a day), each member gets their own number with only their categories (`subscriber-delivery.js`; tested) | Two separate cards with two Save buttons; neither goes near payment |
| 1, 3, 6 or 12 months | **Not built.** One Razorpay plan (`RAZORPAY_PLAN_ID`), monthly; `plan.json` has `yearly: null` | Everything |
| A price for each, paid by Razorpay | **Not built.** Every Pro pays the one price | Everything |
| A button to choose and pay on `/manage/` | **Built, but only where payments are on.** "Upgrade to Pro" shows to a Free member when all of `RAZORPAY_KEY_ID`, `_KEY_SECRET`, `_WEBHOOK_SECRET`, `_PLAN_ID` and `RAZORPAY_TOTAL_COUNT` are set. **None are set on Production** (by design until T27), so Production shows "Request Pro". They are set on the `staging` Preview, where a test checkout passed on 2026-10-23. A Pro member never sees a pay button | `staging` is 121 commits behind `main` (checked 2026-10-25), so it runs the 23 Oct pages: no pricing summary, no Emails-a-day card |

## Owner inputs (OWNER INPUT NEEDED)

| # | Question | Default if not answered | Why it matters |
|---|---|---|---|
| P1 | How is the price set? (a) a price per number of categories plus an amount per extra email a day; (b) a few fixed tiers (pricing.md's Starter / Plus / Pro); (c) a price for every combination | (a), because it lets members pick freely and keeps the price list short | Each distinct amount and period needs its own Razorpay Plan: (c) is up to 4 × 5 × 4 = 80 |
| P2 | The prices themselves, and the discount for 3, 6 and 12 months | None: no page shows a price until set | Claude doesn't pick prices. [costing.md](../costing.md) has the costs: one member on 5 a day takes the whole site to 5 sweeps a day (about ₹6,797 a month against ₹4,987 at 2) |
| P3 | Does a 3, 6 or 12 month plan **renew automatically** (charged every 3, 6 or 12 months until cancelled), or is it **paid once** and then renewed by hand? | Renews automatically, like monthly today | Decides whether T34's "Renew" is mostly a reminder or the main path |
| P4 | Is the price set by **how many** categories or by **which** ones? | How many: a member on 2 categories may switch which 2 at any time | Which ones would need a price per category |
| P5 | Refunds for longer periods: is a started 6 or 12 month period refunded in part? | Same rule as monthly: first payment back within 7 days, no refund for a started period after that | `plan.json`'s refund text, the refunds and terms pages, and T22's unsubscribe wording all change |

## What to build

### 0. Before anything (dev, with the owner)

- Bring `staging` up to date with `main` and redeploy, so the test run below tests today's code.

### 1. Prices and Razorpay plans (PR 1)

- `plan.json` gains the price model from P1 and P2 and the periods (`1, 3, 6, 12` months), replacing `monthly` /
  `yearly`; `scripts/fill-plan.mjs` and the `{{PRO_…}}` slots follow. With `paid: false` the built site stays
  word for word what it is today (as T26 required).
- A local script creates (or finds) one Razorpay Plan for each distinct amount and period through Razorpay's Plans
  API, in test or live mode by the key, and prints their ids. Plan ids aren't secret: they go in `plan.json` under
  `razorpayPlans.test` and `razorpayPlans.live`, replacing the single `RAZORPAY_PLAN_ID`. **Verify** at build time:
  that a plan can be `monthly` with interval 3 or 6, or `yearly` with interval 1; and the UPI AutoPay limit per debit
  against the largest 12-month amount.
- `scripts/check-plan.mjs` checks every plan in the mode of the keys: amount, currency and period match `plan.json`.
- One function, `priceOf({ cats, perDay, months })`, used by the pages, checkout and the webhook, so they can't
  disagree. A choice with no plan is refused.

### 2. One plan card on `/manage/` and a price calculator on `/pricing/` (PR 2)

- `/manage/` replaces the Categories and Emails-a-day cards with one **Your plan** card:
  - Categories: **All four** (default), **Just one** (a pick-one list), or **Choose** (checkboxes, at least one);
  - Emails a day: 1 to 5 (up to `SWEEPS_PER_DAY_MAX`), with the IST times as today;
  - Billing: 1, 3, 6 or 12 months;
  - the price for that choice, the renewal line, the refund rule, then **Pay with Razorpay**.
  - A Free member submits the whole choice with one button. A paying Pro sees their current plan and **Change plan**.
    An owner-granted Pro keeps today's free choice and no button.
- `/pricing/` shows the same choices with the price updating, from the same `plan.json`, and Get Pro carries the
  choice into sign-up and `/manage/`.
- Keyboard, phone width and both themes, per [T23](T23-pro-display-standards.md).

### 3. Checkout, what was paid for, and plan changes (PR 3)

- `checkout` takes `{ cats, perDay, months }`, picks the plan, and puts the choice in the subscription's `notes`.
- The webhook records on the subscriber what was paid for (`paidFor: { catCount, perDay, months }`) and applies the
  categories and emails a day chosen at checkout.
- `set-cats` and `set-freq` let a paying Pro change only within what they paid for: any categories up to their count
  (P4), any number up to their emails a day. Asking for more goes through **Change plan**.
- **Change plan**: Razorpay's subscription update, to the new plan now or at the end of the period. **Verify** at
  build time whether an update is allowed for UPI AutoPay subscriptions as well as cards, and how proration works; if
  not allowed, cancel at period end and start the new plan from that date (T34's "start later").
- The site's sweeps a day still come from the Pro members' emails a day (T32), which can no longer exceed what each
  paid for. Owner-granted Pro is unchanged.

### 4. Test-mode run on `staging` (end of PR 3)

With the test keys and the test plans: every period once; one plan from each price step; a Free member choosing and
paying with one button; a plan change up and down; a Pro trying to save more than they paid for (refused); Razorpay's
screen amount equal to the page's for each. Results and date in the pull request. T27 repeats the essentials before
go-live.

## Built (2026-10-25, on `fixes`, not deployed)

The owner chose P1 (a) on 2026-10-25: "a price per number of categories, plus an amount per extra email a day", and
**₹1 for every choice while testing** (P2). P3 to P5 use the defaults above until the owner says otherwise.

- **Prices.** `plan.json`'s `monthly`/`yearly` are replaced by `pricing`: `byCategories` (1 to 4), `perExtraEmail`
  and `periods` (`{"1":1,"3":1,"6":1,"12":1}`, months on sale → months charged). Every value is 1 today. Nothing
  else holds a price: `api/_lib/plan.js` has the one `priceOf`, used by `/api/account`, the webhook, `fill-plan`
  and `check-plan`; `/manage/` works prices out from the same table, which `/api/account` sends.
- **Razorpay plans: one ₹1 plan per period, not one per price.** A subscription's `quantity` is the price in rupees,
  so up to 80 prices need only 4 plans, and a price change needs none. `RAZORPAY_PLANS` (JSON, months → plan id)
  replaces `RAZORPAY_PLAN_ID`; it is a Vercel variable rather than `plan.json` so test and live plans can't mix.
  `check-plan.mjs --create` makes the missing plans (monthly every 1, 3 or 6; yearly for 12) and prints the value;
  without `--create` it checks each is ₹1, INR, and the right period. `RAZORPAY_TOTAL_COUNT` now counts months.
- **`/manage/`.** One plan card replaces the Categories and Emails-a-day cards: categories as **All four**, **Just one**
  (a list) or **Choose which** (checkboxes); emails a day 1 to the cap; and, for Free, the billing period with each
  period's price for that choice, and a summary line. Free presses **Upgrade to Pro** (payments on) or **Request Pro**
  (payments off) to open it, then **Pay with Razorpay** or **Send my request**. A Pro sees the same card with
  **Save changes** (`set-plan`).
- **Checkout** takes `cats`, `sweepsPerDay` and `months`, uses that period's plan with `quantity` = price and
  `total_count` = `RAZORPAY_TOTAL_COUNT` ÷ months (rounded up), puts the choice in `notes`, and stores it as
  `rzp.choice`. The same choice within an hour reuses the unpaid subscription; a different one gets its own.
- **The first grant** for a subscription applies the choice and stores `paidFor`. A paid Pro may then save anything
  that costs no more than what they paid for over the same period (`set-plan`, `set-cats`, `set-freq`; more is
  `403 change_plan`). Owner-granted Pro, and paid Pro from before T33, choose freely.
- **Request Pro** stores the choice as `proRequest`; `grant-pro` applies it. Asking again with another choice updates
  it and doesn't email the owner again.
- **Pages.** "Renews automatically every month" is now "at the end of each billing period" on the home, plans,
  sign-up, pricing, manage, live, terms and refunds pages; `/pricing/` says the price depends on categories, emails a
  day and period (`{{PRO_PERIODS}}`).
- Tests: `priceOf`, `pricingErrors`, `razorpayPlans`, `offers`, the price words; `check-plan` against a fake Plans
  API, `--create` in test and live mode; `readChoice`, `withinPaid`, checkout's plan, quantity, cycles, notes and
  reuse; the webhook's first grant and a later charge; `set-plan` within and beyond `paidFor`; request-pro with a
  choice; `grant-pro` applying it. The manage page was clicked through in headless Chrome against a stub API: request,
  pay (Checkout opened with "Pro, 6 months"), a Pro over what they paid for.

**Not built yet:** **Change plan** to a bigger plan mid-period (the page says to choose it when this one ends; T34's
"start later" path is the likely way); the `/pricing/` calculator (the owner asked for it last); the test-mode run.

## Acceptance criteria

- [ ] P1 (a) and P2 (₹1 while testing) answered 2026-10-25; P3 to P5 on defaults until confirmed; record in in [decisions.md](../../decisions.md)
- [ ] With `paid: false`, `public/` is unchanged apart from what this task deliberately adds behind the switch
- [ ] `check-plan.mjs` matches every test plan; the same script is ready for the live ones (T27)
- [x] `/manage/` takes categories, emails a day and period as one choice and one Pay button
- [ ] `/pricing/` shows the same prices (the calculator, last)
- [ ] A paying Pro can't save more categories or emails a day than paid for; Change plan works up and down on
  `staging`
- [ ] The test-mode run passes on an up-to-date `staging`, with the date
- [ ] Docs: [pricing.md](../pricing.md), [payments-razorpay.md](../payments-razorpay.md), DEPLOYMENT.md (the plans
  script, the variables that change), README.md, the refunds and terms pages, CHANGELOG.md

## Tests

`priceOf` for every choice and period; a choice with no plan refused; `check-plan.mjs` against a fake Plans API (a
mismatched amount or period fails); checkout picks the right plan and writes the notes; the webhook records
`paidFor`; `set-cats` / `set-freq` within and beyond `paidFor`; owner Pro unlimited; the manage page's one-button
flow against a stub API; `fill-plan` both ways.
