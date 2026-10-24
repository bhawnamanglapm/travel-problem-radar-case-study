# T30 · Owner launch checklist

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Owner (developer for the refund step's wording) |
| Size | L, mostly waiting on Razorpay, an adviser and a CA |
| Depends on | — (start now; Razorpay's review takes the longest) |
| Unblocks | T22 (needs Vercel Pro), T27 |

> Added 2026-10-24 with the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24). It gathers the owner's steps
> from the [launch plan](../../../pm/05-business-case-and-launch/launch-plan.md), the
> [roadmap](../../../pm/04-planning-and-governance/roadmap.md) and pricing.md's
> [checklist](../pricing.md#before-charging-anyone-checklist) in one order. The details stay in those files.

## Why

Everything left before the first live payment, apart from T22 and T28, is a step only the owner can take: an
account, a payment, a review or a legal answer. Several wait on someone else, so they should start before the code
is finished.

## Steps, in order

| # | Step | Links | Status |
|---|---|---|---|
| 1 | Add Anthropic credit in the same organization as the key; re-run the sweep; all 4 categories saved | RM-01, LR-01, I-01 | todo |
| 2 | An Anthropic monthly spend limit and alert | LR-17 | todo |
| 3 | Submit Razorpay live activation with the site's URLs. **Start early**: it includes a website review | RM-03, LR-08 | todo |
| 4 | Ship the terms page, with an adviser's liability clause (Razorpay may require it, **verify**) | RM-04, LR-11 | todo |
| 5 | Move to Vercel Pro (Hobby is non-commercial, **verify** the current terms). Unblocks T22 | RM-05, LR-05 | todo |
| 6 | Resend Pro. Costing's P0 list has it before the first payment; at 2 a day the free plan's 100 a day lasts longer, so the owner may choose to wait, and records that choice in decisions.md | LR-15, RM-08 | todo |
| 7 | Read the values of `MAX_SUBSCRIBERS` and `MAX_CONFIRMS_PER_DAY` in Vercel | LR-19 | todo |
| 8 | A written manual step for refunds and chargebacks | LR-20 | todo |
| 9 | The GST case confirmed by a CA; advice on India's DPDP Act for stored addresses | LR-13; pricing.md checklist | todo |
| 10 | Score 20 or more live items with the README rubric, **if** the owner keeps the rule not to charge first | LR-03, RM-13 | todo |
| 11 | Production checks: emailed sign-in, a Pro email after choosing categories, Gmail's one-click unsubscribe | LR-04 | todo |

Steps 1, 2, 5 and 7 take minutes. Steps 3, 4 and 9 depend on others, so begin them first.

## Acceptance criteria

- [ ] Every row is done, or the owner has recorded in [decisions.md](../../decisions.md) why it waits
- [ ] The go/no-go list in the launch plan is met for every item that blocks the first live payment

## Tests

None; these are account and legal steps.

## Docs

The launch plan's status column and the roadmap, as each step closes. [progress.md](progress.md).
