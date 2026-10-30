# Business case

> **Stage 5 of 8.** Whether charging for Pro can cover what the product costs to run, first written before anyone
> had paid. Every figure comes from [costing.md](../../docs/subscriptions/costing.md), which stays the detailed source;
> this page summarises it for a decision. **No revenue is forecast:** there is no demand data, so revenue appears only
> as "at N members". Written 2026-10-24; status note added 2026-10-30.

## Where it stands on 2026-10-30

- **The price is ₹1 a month or ₹1 a year**, the owner's real price for now
  ([decisions.md](../../docs/decisions.md) 2026-10-29). Payments have been live since 2026-10-28; Razorpay had
  captured 3 live ₹1 payments by 2026-10-29 (T27, [progress.md](../../docs/subscriptions/tasks/progress.md)).
- **At ₹1, revenue can't cover the running cost** of about ₹6,797 a month at any number of members. The ₹299
  analysis below stays because it is still the break-even maths for whatever price the owner sets. **The target
  price is OWNER INPUT NEEDED** (R-12 in the [RAID log](../04-planning-and-governance/raid-log.md)).
- **The model changed:** sweeps run on `claude-haiku-5-5` since 2026-10-25. 10 Haiku sweeps (26 to 30 Oct)
  averaged $0.1121 (`node scripts/llm-logs.mjs models`, read 2026-10-30), against the $0.21 Sonnet figure the tables below use. costing.md hasn't been
  recomputed for Haiku, so the tables are left as they were; the Haiku row under sensitivity is the closest estimate.
- **Sweeps a day now follow demand:** 1 to 5, as the most frequent Pro member chooses (T32), not a fixed 5.

## The ask

As written on 2026-10-24: spend about **₹6,797 a month** on running costs, and the owner's time, to find out whether
people pay ₹299 a month for the live board. This page doesn't decide the price: the owner set ₹299 as **the price to test, not a proven one**
([decisions.md](../../docs/decisions.md) 2026-10-23;
[pro_pricing_recommendation.md](../../docs/cost%20audit/pro_pricing_recommendation.md)).

## Assumptions

| ID | Assumption | Label in costing.md | Source |
|---|---|---|---|
| A-01 | About 5 scheduled sweeps a day, at $0.21 each | Measured over 5 production runs; the daily count is not measured. Since then: 1 to 5 a day (T32), and $0.1121 a sweep on Haiku over 10 sweeps (`node scripts/llm-logs.mjs models`, read 2026-10-30) | [costing.md](../../docs/subscriptions/costing.md#one-sweep) |
| — | $1 = ₹94.50; a month is 30.4 days | Rate on 22 Oct 2026 | [costing.md](../../docs/subscriptions/costing.md) (header) |
| — | Razorpay keeps 3.42% of a card charge (2% + 0.9% subscriptions, plus 18% GST on the fee) | Price; the UPI AutoPay fee is **unknown** | [costing.md](../../docs/subscriptions/costing.md#prices-used) |
| — | Not GST-registered, so no GST is charged (CR-13). A CA hasn't confirmed it | Owner's answer | [decisions.md](../../docs/decisions.md) 2026-10-23 |
| A-02 | 24 to 28 members cover the running costs at ₹299 | Follows from the rows above | [costing.md](../../docs/subscriptions/costing.md#break-even) |

The `A-` IDs are the planning assumptions in the [RAID log](../04-planning-and-governance/raid-log.md#assumptions).

## Investment: the running cost

The cost is almost all **fixed**: it depends on how many sweeps run, not on how many people read them.

| Item | ₹ a month | Fixed or variable |
|---|---|---|
| Anthropic, 152 sweeps (5 a day) | 3,017 | Fixed: sweeps a day and the model |
| Vercel Pro, 1 seat | 1,890 | Fixed |
| Resend Pro, 50,000 emails | 1,890 | Stepped by emails a month |
| **`F`, the monthly budget** | **6,797** | |
| Razorpay | 3.42% of each charge | Variable, per payment |

Source: [costing.md](../../docs/subscriptions/costing.md#fixed-monthly-cost). Without Resend Pro the total is ₹4,907,
but Resend Free's 100 emails a day fits only 5 to 7 Pro members on a busy sign-in day, so the P0 checklist moves to
Resend Pro before the first payment (R-04).

**Not in `F`**: domain, bank forex markup, reverse-charge GST, an accountant, refunds and chargebacks, support time,
marketing, the owner's time, income tax. Each is **Unknown** and no amount is guessed
([costing.md](../../docs/subscriptions/costing.md#business-costs-not-included)). **OWNER INPUT NEEDED** to state
the full cost.

## Break-even

Three break-evens, from [costing.md](../../docs/subscriptions/costing.md#break-even):

| Break-even | At ₹299 a month | What it means |
|---|---|---|
| **Fixed-cost** | **24 members** (not registered, or GST on top); **28** if GST is inside the price | Covers `F` only |
| Contribution | From the first member | A member adds about ₹0 inside the Resend plan; past it, about ₹12.93 a month |
| Full business | **Unknown** | `(F + the costs not in F) ÷ net per member`. Each extra ₹1,000 a month needs about 4 more members at ₹299 (₹1,000 ÷ ₹286.93, rounded up) |

Net per member at ₹299 is ₹286.93 with GST on top, ₹288.77 if not registered, and ₹243.16 with GST inside
([costing.md](../../docs/subscriptions/costing.md#199-299-and-499-compared-provisional)).

## Revenue at N members (not a forecast)

Surplus or shortfall against `F`, GST on top, from
[costing.md](../../docs/subscriptions/costing.md#199-299-and-499-compared-provisional):

| Price a month | Members to cover `F` | At 20 members | At 30 members | At 50 members |
|---|---|---|---|---|
| ₹199 | 36 / 42 | −₹2,978 | −₹1,068 | ₹2,751 |
| **₹299** | **24 / 28** | **−₹1,058** | **₹1,811** | **₹7,549** |
| ₹499 | 15 / 17 | ₹2,780 | ₹7,569 | ₹17,146 |

- **A surplus here is not profit**: the costs not in `F` aren't in it.
- How many members there will be is **not known**. No one has paid, and no one besides the owner is recorded as a
  member ([README](../README.md#at-a-glance)).

## The downside

| Case | Monthly result | Source |
|---|---|---|
| **No paying members** | −₹6,797 against `F`, plus the costs not in `F` | [costing.md](../../docs/subscriptions/costing.md#fixed-monthly-cost) |
| Before payments open, on Hobby and Resend Free | Anthropic only: about ₹3,017 at 5 sweeps a day | [costing.md](../../docs/subscriptions/costing.md#sweeps-a-month) |
| Stop | Turning off the sweep schedule stops the Anthropic cost at once; the Vercel and Resend plans are monthly (**verify** each provider's cancellation terms) | The cost table above |

Because nearly all the cost is fixed and monthly, the loss is bounded by how long the owner keeps paying for it.

## Sensitivity

Members needed at ₹299, GST on top / inside, from
[costing.md](../../docs/subscriptions/costing.md#stress-tests):

| Scenario | `F` a month | Members at ₹299 |
|---|---|---|
| Today, 5 sweeps a day | ₹6,797 | 24 / 28 |
| 4 sweeps a day | ₹6,193 | 22 / 26 |
| 6 sweeps a day | ₹7,400 | 26 / 31 |
| 1 sweep in 10 fails after being billed | ₹7,132 | 25 / 30 |
| AI cost +50% | ₹8,305 | 29 / 35 |
| AI cost +100%, or 10 sweeps a day | ₹9,813 | 35 / 41 |
| Every sweep at the high-cost scenario ($1.07) | ₹19,210 | 67 / 80 |
| Haiku 5.5 instead of Sonnet 5.5 (**estimate**: assumes the same tokens and searches). Haiku is the default since 2026-10-25; its measured $0.1121 a sweep is below the $0.21 used here, and the 2026-10-30 [model test](../../docs/subscriptions/model-test-2026-10-30.md) kept it | ≈ ₹4,559 | Not stated in the source; at ₹199 it is ≈ 24 instead of 36 |

The Haiku row comes from [haiku-test.md](../../docs/subscriptions/haiku-test.md); the comparison script exists but
hasn't run (RM-23).

**Read:** the number of sweeps a day and the model move the break-even far more than the number of readers. Only an
Anthropic spend limit puts a ceiling on the high-cost row, and whether one is set is **not verified** (R-02, RM-08).

## Options

| Option | Cost a month | What it tests | Source |
|---|---|---|---|
| **A. Stay free**: no payments, keep Hobby and Resend Free | About ₹3,017 (Anthropic) | Whether people sign up and read, the gate pricing.md set first | [pricing.md](../../docs/subscriptions/pricing.md#rollout-order-with-gates) |
| **B. Open payments at ₹299** after the launch checklist | ₹6,797 | Whether people pay, at the price the owner set | [launch-plan.md](launch-plan.md) |
| C. ₹199 | ₹6,797 | Whether a lower price converts enough more to need 36 to 42 members instead of 24 to 28 | [pro_pricing_recommendation.md](../../docs/cost%20audit/pro_pricing_recommendation.md) |
| D. ₹499 | ₹6,797 | Only if a group values it that much; the cost doesn't justify it | Same |

The owner went ahead with B on 2026-10-28, at ₹1 instead of ₹299 (CR-17, CR-18 in the
[change log](../04-planning-and-governance/change-log.md)); none of A to D was chosen as written. Before that, CR-03
skipped the Phase 1 gate. pricing.md's rule **not to charge before a
real sweep is scored** was not applied: no live sweep has been scored by a person (R-01, RM-13). The choice between them is in the
[executive review](../06-executive-communication/executive-review.md#decisions-for-the-owner).

## What would change the decision

| Signal | Effect | Where it's measured |
|---|---|---|
| Scored sweeps show the findings are often wrong or stale | Stop and fix quality before charging | KPI-01 to KPI-05 |
| A week's count shows 4 or 6 sweeps a day, not 5 | Break-even moves to 22 or 26 at ₹299 | KPI-08; [measurement checklist](../../docs/subscriptions/costing.md#measurement-checklist) row 1 |
| Real Anthropic spend differs from $0.21 a sweep | `F` and break-even move | KPI-06; checklist row 2 |
| A CA says GST must be charged inside the price | Break-even moves from 24 to 28 | [Tax questions](../../docs/subscriptions/costing.md#tax-and-legal-questions-for-a-ca) |
| The costs not in `F` are filled in | The full business break-even becomes known | [costing.md](../../docs/subscriptions/costing.md#business-costs-not-included) |
| Conversion, retention or refunds after payments open | Whether ₹299 holds; at ₹1 they show willingness to pay, not whether the price covers cost | KPI-16 to KPI-19 |
| The owner sets a target price | Every "at ₹299" figure above is recomputed at that price | R-12; [costing.md](../../docs/subscriptions/costing.md#break-even) |
