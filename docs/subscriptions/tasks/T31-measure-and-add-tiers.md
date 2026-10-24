# T31 · After launch: measure, then decide on Plus and Starter

| | |
|---|---|
| Phase | 4, after go-live |
| Who | Owner (thresholds and the decision), developer (the numbers) |
| Size | S |
| Depends on | T27, and 20 to 30 paying members |
| Unblocks | Plus and Starter tiers, a yearly plan, "Pro Max" (each its own task if chosen) |

> Added 2026-10-24 with the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24). This is phase 2 of the
> [tier plan's rollout](../pricing.md#tiers-by-categories-and-sweeps-draft-2026-10-24).

## Why

Pro launches alone at ₹299. Plus and Starter are only worth building if paying members show they want fewer
categories or a lower price. Each extra tier needs its own Razorpay Plan and changes to `plan.json`, `/pricing/`,
checkout, the webhook and delivery.

## Before looking at any numbers (owner)

Write in [decisions.md](../../decisions.md) the thresholds that would justify each change, for example a share of
Pro members who narrow `cats` to 1 or 2 categories, or a cancellation rate. **OWNER INPUT NEEDED**: no number is
suggested here, because the repo has no data to base one on.

## What to measure

| Measure | Where |
|---|---|
| Paying members, cancellations, failed renewals | Razorpay dashboard; `node scripts/subscribers.mjs stats` |
| Razorpay's active subscriptions against Pro records, weekly | LR-21 |
| How many categories each Pro member keeps in `cats` | The subscriber records (the admin script) |
| Free accounts that never upgrade | `subscribers.mjs stats` |
| Cost per category, if T29 is built | `usageByCat` on saved sweeps |
| Real monthly spend against costing.md | Anthropic, Vercel, Resend and Razorpay bills (RM-14) |

## Decide

Compare the numbers with the thresholds written beforehand, then record the decision in decisions.md: stay Pro-only,
add Plus, add Starter, add a yearly plan (RM-20), or change the price.

## Acceptance criteria

- [ ] Thresholds written before the first look
- [ ] The table above filled in with dates
- [ ] A decision recorded, with a new task for each tier chosen

## Tests

None; this task reads numbers.

## Docs

[pricing.md](../pricing.md), decisions.md, [progress.md](progress.md).
