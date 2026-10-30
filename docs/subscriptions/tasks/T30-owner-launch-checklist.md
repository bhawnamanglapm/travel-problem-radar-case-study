# T30 · Owner launch checklist

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Owner (developer for the refund step's wording) |
| Size | L, mostly waiting on Razorpay, an adviser and a CA |
| Depends on | — (start now; the terms page and Razorpay's review take the longest) |
| Unblocks | T22 (needs Vercel Pro), T27 |

> Added 2026-10-24 with the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24). It gathers the owner's steps
> from the [launch plan](../../../pm/05-business-case-and-launch/launch-plan.md), the
> [roadmap](../../../pm/04-planning-and-governance/roadmap.md) and pricing.md's
> [checklist](../pricing.md#before-charging-anyone-checklist) in one order. The details stay in those files.

## Why

Everything left before the first live payment, apart from T22 and T32, is a step only the owner can take: an
account, a payment, a review or a legal answer. Several wait on someone else, so they should start before the code
is finished.

## Steps, in order

| # | Step | Links | Status |
|---|---|---|---|
| 1 | Add Anthropic credit in the same organization as the key; re-run the sweep; all 4 categories saved | RM-01, LR-01, I-01 | **Done** 2026-10-25: new key in Vercel, deployed 17:00 UTC; a manual sweep at 17:18 UTC (run 40215787749) on `claude-haiku-5-5` saved all four categories saved (5, 4, 4 and 5 items, 18 in all); 101,309 input and 9,306 output tokens, 10 searches, 90 pages; about 20 seconds |
| 2 | An Anthropic monthly spend limit and alert | LR-17 | todo |
| 3 | Ask an adviser for the liability clause, then ship the terms page. **Start early**: Razorpay's website review comes after it | RM-04, LR-11 | **Shipped** 2026-10-29 (#94) with the owner's plain liability draft. The adviser's check of the clause is still open |
| 4 | Submit Razorpay live activation with the site's URLs, once terms is live (**verify** Razorpay's required pages) | RM-03, LR-08 | **Done**: live mode since 2026-10-28; the admin page shows "live mode, production" and Razorpay settles to the bank (T+2) |
| 5 | Move to Vercel Pro (Hobby is non-commercial, **verify** the current terms). Unblocks T22 | RM-05, LR-05 | todo |
| 6 | Resend Pro. Costing's P0 list has it before the first payment; at 2 a day the free plan's 100 a day lasts longer, so the owner may choose to wait, and records that choice in decisions.md | LR-15, RM-08 | todo |
| 7 | Read the values of `MAX_SUBSCRIBERS` and `MAX_CONFIRMS_PER_DAY` in Vercel | LR-19 | **Done** 2026-10-29: `MAX_SUBSCRIBERS` 5000; `MAX_CONFIRMS_PER_DAY` was 500, lowered to 50 so sign-ups can't use up Resend's free 100 a day; Production redeployed |
| 8 | A written manual step for refunds and chargebacks | LR-20 | **Done** 2026-10-29: [refunds-and-chargebacks.md](../refunds-and-chargebacks.md); `revoke-pro --paid` ends a refunded Pro at once. Razorpay's menu names are still to verify |
| 9 | The GST case confirmed by a CA; advice on India's DPDP Act for stored addresses | LR-13; pricing.md checklist | todo. A checklist for the adviser: [dpdp-check.md](../dpdp-check.md) (2026-10-31) |
| 10 | Score 20 or more live items with the README rubric, **if** the owner keeps the rule not to charge first | LR-03, RM-13 | **Script ready** 2026-10-30: `node --env-file=.env.local scripts/score-items.mjs` picks 20 items from the saved sweeps (read-only), checks the links and the 30 days itself, and writes `review.csv` for the four judged lines; `--score DIR` reports the shares. Not scored yet |
| 11 | Production checks: emailed sign-in, a Pro email after choosing categories, Gmail's one-click unsubscribe | LR-04 | todo |
| 12 | Answer T23 input 5: international cards. Input 8 (yearly plan) is settled as monthly only by the final Pro plan | [T23](T23-pro-display-standards.md), RM-09 | todo |

Steps 1, 2, 7 and 12 take minutes. Steps 3, 4 and 9 depend on others, so begin them first: the chain
liability clause → terms → activation → go-live is the longest in the launch. Buy Vercel Pro (step 5) when T22 is
about to start, not earlier, so it isn't paid for while the review runs.

## Acceptance criteria

- [ ] Every row is done, or the owner has recorded in [decisions.md](../../decisions.md) why it waits
- [ ] The go/no-go list in the launch plan is met for every item that blocks the first live payment

## Tests

None; these are account and legal steps.

## Docs

The launch plan's status column and the roadmap, as each step closes. [progress.md](progress.md).
