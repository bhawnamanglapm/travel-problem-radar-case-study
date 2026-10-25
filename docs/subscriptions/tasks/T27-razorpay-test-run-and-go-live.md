# T27 · Razorpay test-mode run and go-live

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Owner (accounts, keys, the real payment) and developer (the run, docs) |
| Size | M |
| Depends on | T22, T24, T25, T26, T30, T32, T33, T34, T35 |
| Unblocks | — |

> Moved here from T22 on 2026-10-23, so the go-live waits for the pricing and policy pages as well as the code.
>
> **Changed 2026-10-25:** Pro becomes one plan the member builds ([T33](T33-pro-plan-builder.md)), with renewal
> ([T34](T34-renew-pro.md)). The run below then covers every period and a plan change, `check-plan.mjs` checks every
> plan, and go-live creates the live plans with T33's script instead of one plan at one price. Update `staging` from
> `main` first: on 2026-10-25 it was 121 commits behind.

## Why

Checkout and the webhook already pass in test mode on `staging` (T20, T21). Going live is mostly the owner's steps
in Razorpay and Vercel, in an order where nothing charges a real card before the pages tell the truth about it.

## Before starting (owner)

| Step | Why | Status |
|---|---|---|
| Vercel Pro | Commercial use isn't allowed on Hobby (**verify** Vercel's current fair-use terms) and T22 needs it | todo |
| Owner inputs 1 to 9 answered (T23) | Price, GST, refund rule, etc. | Price, GST, trial, refund rule, methods and contact answered (2026-10-23); international cards, the liability clause and a yearly plan still open |
| Razorpay live activation submitted with the site's URLs | Razorpay reviews the website, including the policy pages (**verify** the current list) | todo |
| Domain decision | Optional. A custom domain may help with the Chrome warning ([progress.md](progress.md)) and looks more trustworthy at checkout | todo |

## Test-mode run (Preview, test keys)

Set `paid: true` in `plan.json` on a branch, deploy a Preview with the test keys and the test Plan at the real price.

| Step | Check |
|---|---|
| `check-plan.mjs` against the test Plan | Matches `plan.json` |
| Home, `/pricing/`, `/signup/`, locked board | Same price, renewal line, no "being tested" |
| Sign up, confirm, go to `/manage/` | Summary before Checkout shows price, renewal, refund rule |
| Pay with a test card (**verify** current test cards) | Razorpay's screen shows the same amount; page says received; Pro in a minute or two |
| Pre-debit notice and receipt | Note what test mode sends, if anything (**verify**) |
| Simulate or wait for a renewal (**verify** test-mode options) | Renewal date moves |
| Failed renewal | `pending` text, Pro kept; `halted` text, back to Free |
| Cancel renewal | "Pro until DATE"; Free after the date and grace (T22) |
| Pay again, then unsubscribe (T22) | Subscription cancelled in Razorpay, record gone |
| Replay a webhook | No change |
| Keyboard only, phone width, screen reader on the pricing page and Checkout's start | Usable (T23 C3 to C8) |

Write the results and date in the pull request.

## Go-live (owner)

1. Live activation approved.
2. Set the real prices in `plan.json`'s `monthly` and `yearly` (₹1 each while testing, T33). Make the live ₹1 plans with
   `check-plan.mjs --create` and the live keys. Set live `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `RAZORPAY_PLANS` (the value it prints), `RAZORPAY_TOTAL_COUNT` and `RAZORPAY_WEBHOOK_SECRET` for **Production
   only**; live webhook to the production URL with a new secret. Never paste keys into chat, issues or commits.
3. Run `check-plan.mjs` with the live keys and `RAZORPAY_PLANS`: must match.
4. Merge `paid: true`; redeploy Production (variables apply only to new deployments).
5. One real payment with the owner's own card; check the page, Razorpay dashboard, `/manage/`, the webhook log and
   the receipt. Refund it in the dashboard if wanted.
6. Update [pricing.md](../pricing.md) tiers, README.md "What's next", [progress.md](progress.md).
7. Announce.

## Roll back

- **Stop new payments:** set `paid: false` and redeploy (pages go back to the free-test text), and unset
  `RAZORPAY_KEY_ID` (Upgrade disappears).
- Paying members keep Pro until `proUntil`. Cancel their subscriptions in the Razorpay dashboard if billing must
  stop. Leave `RAZORPAY_WEBHOOK_SECRET` set until the last period ends.

## Acceptance criteria

- [ ] Every row of the test-mode run passes, with the date
- [ ] `check-plan.mjs` matches with live keys before `paid: true` is merged
- [ ] One real payment checked end to end
- [ ] Docs: DEPLOYMENT.md (go-live and roll back), pricing.md, decisions.md, CHANGELOG.md

## Tests

None new; this task runs what T22 to T26 built.
