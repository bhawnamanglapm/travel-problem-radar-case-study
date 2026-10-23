# Executive review

> **Stage 6 of 7.** One page for the owner, the person who decides. It summarises where the product stands and ends in
> the decisions that are open. Every figure links its source; nothing here is new evidence. State on 2026-10-24.

## In one paragraph

Travel Problem Radar is a live MVP. About 5 times a day it finds recent travel-industry problems on the web, each
with a source and a product idea. Free members get a daily teaser and Pro members the live board; Pro is given by hand
because payments aren't open. **The product is not ready to charge**:
- sweeps have failed since 2026-10-23 (I-01);
- no finding has been scored (R-01);
- no one besides the owner is recorded as a user.

Opening payments costs about **₹6,797 a month** and needs **24 to 28 members at ₹299** to cover it. The next step is
to get sweeps running and score them, and only then decide whether to spend on charging.

## Where it stands

| | Status | Source |
|---|---|---|
| Product | Live: demo, sign-up, Free and Pro emails, a Pro-only live board, accounts, checkout built | [PRD v2](../02-product-definition/prd.md) |
| Sweeps | **Failing** since 2026-10-23 15:09 UTC: Anthropic answers HTTP 400 for every category; the board shows the last good sweep | I-01 in the [RAID log](../04-planning-and-governance/raid-log.md#issues) |
| Quality | Not measured. No real sweep scored against the draft rubric | R-01; KPI-01 to KPI-05 |
| Users | None recorded besides the owner. No interviews run | [discovery log](../01-discovery/discovery-log.md) |
| Payments | Not open. A test checkout and webhook passed on staging on 2026-10-23 | [launch plan](../05-business-case-and-launch/launch-plan.md#test-mode-run) |
| Engineering | 952 offline tests and 199 offline checks pass, counted at `662bded` on 2026-10-23 | [pm README](../README.md#at-a-glance) |

## The numbers that exist

| Figure | Value | Kind | Source |
|---|---|---|---|
| Cost of one sweep | $0.21 | Measured over 5 production runs | [costing.md](../../docs/subscriptions/costing.md#one-sweep) |
| Monthly running cost with Vercel Pro and Resend Pro (`F`) | ₹6,797 | Estimate from list prices | [business case](../05-business-case-and-launch/business-case.md#investment-the-running-cost) |
| Monthly cost today, before payments | About ₹3,017 (Anthropic) | Estimate at 5 sweeps a day | Same |
| Break-even at ₹299 | 24 members, or 28 if GST is inside the price | Follows from `F` | [business case](../05-business-case-and-launch/business-case.md#break-even) |
| Paying members | 0 | Payments not open | KPI-16 |
| Sign-ups, confirm rate, retention, conversion | — | **Not measured** | [data and metrics](../07-data-and-metrics/data-and-metrics.md#what-isnt-measured) |

## Top risks

| ID | Risk | Why it matters now |
|---|---|---|
| R-01 | The findings are wrong or stale | It is the product's whole claim, and no sweep has been scored |
| R-03 | One AI vendor does all the finding | It is happening: I-01 |
| R-02 | Spend runs away | Whether an Anthropic spend limit is set is **not verified** (LR-17) |
| R-08 | Charging on Vercel Hobby | Hobby is non-commercial (**verify** the terms); Pro is needed before go-live |
| R-10 | Policy pages not reviewed by a lawyer | The terms page waits for an adviser (I-05) |

Full list: [RAID log](../04-planning-and-governance/raid-log.md).

## Launch status

**No-go today.** None of the items on the [launch plan's go list](../05-business-case-and-launch/launch-plan.md#go--no-go)
is done yet; two supporting items are (LR-12, the policy pages; LR-18, the cap on manual sweeps). The first to do,
LR-01 (sweeps running), is the owner's step: a key with credit in Vercel Production.

## Decisions for the owner

Each has options and the recommendation the repository's own documents support. "The repo supports" means a
written rule or reason exists in the source named; it does not mean the choice is made. Record each answer in
[decisions.md](../../docs/decisions.md).

### 1. Keep the rule not to charge before a scored sweep?

| Option | Effect |
|---|---|
| **A. Keep it**: score 20 or more live items (RM-13, LR-03) before go-live | Go-live waits for sweeps to run and be scored. The main claim has evidence before anyone pays |
| B. Drop it, as the Phase 1 gate was dropped (CR-03) | Go-live can follow the payment checklist alone; members pay for unscored findings |

**The repo supports A.** pricing.md's rule still stands ([business case](../05-business-case-and-launch/business-case.md#options)),
and R-01 has no other mitigation that measures quality.

### 2. When to spend on Vercel Pro and Resend Pro (₹1,890 a month each)?

| Option | Effect |
|---|---|
| A. Now | About ₹3,780 a month more (2 × ₹1,890) while sweeps are failing and nothing is charged |
| **B. When go-live is next**: after LR-01 and LR-03 pass, before the test-mode run (LR-07) | Spend starts when it can lead to revenue. T22 (LR-06) needs Vercel Pro first ([progress.md](../../docs/subscriptions/tasks/progress.md)) |
| C. Not at all: stay free (business case option A) | About ₹3,017 a month; tests whether people sign up and read, not whether they pay |

**The repo supports B.** Both are P0 items before the first live payment
([costing.md](../../docs/subscriptions/costing.md#pre-launch-checklist)), and pricing.md orders demand before charging.
C is pricing.md's original first phase, and stays open if the owner prefers to learn more before spending.

### 3. Engage an adviser for the terms page?

| Option | Effect |
|---|---|
| **A. Yes, before live activation** (LR-11, RM-04) | Terms ships with a liability clause; Razorpay's website review can see it |
| B. Apply for activation without terms | Only if Razorpay doesn't require terms (**verify**); the liability gap stays |

**The repo supports A.** The decision on 2026-10-23 kept terms as a draft until an adviser writes the clause
([decisions.md](../../docs/decisions.md)). The adviser's cost is **OWNER INPUT NEEDED**.

### 4. Confirm GST with a CA, and decide on international cards

| Question | Options | What the repo says |
|---|---|---|
| GST | Ask a CA before the first live payment, or rely on the owner's answer ("not registered") | A CA's answer is a P0 item (LR-13). The questions are written: [costing.md](../../docs/subscriptions/costing.md#tax-and-legal-questions-for-a-ca) |
| International cards | Accept them (Razorpay enables them separately, at up to 3% fee) or keep cards and UPI AutoPay only | **No recommendation in the repo.** Open in [payments-razorpay.md](../../docs/subscriptions/payments-razorpay.md#prerequisites) (LR-14); question 5 for the CA asks whether they change anything |

### 5. How much effort and money to put into go-to-market?

| Option | Effect |
|---|---|
| **A. Owned channels and an invited pilot**, no paid spend | Learns whether travel PMs value it before counting on them to pay |
| B. Paid promotion | No budget is recorded; conversion is unknown, so cost per paying member can't be estimated |

**The repo supports A**, as proposed in the [go-to-market plan](../05-business-case-and-launch/go-to-market.md#rollout-with-gates).
Hours a week, pilot size and any budget are **OWNER INPUT NEEDED**.

### 6. Set the KPI targets and gate thresholds

| Option | Effect |
|---|---|
| **A. Set them now**, before sweeps restart and before looking at results | Gates can pass or fail honestly |
| B. Set them after the first results | Easy to set a bar the results already clear |

**The repo supports A.** pricing.md asks for thresholds set before looking. What's open: the targets in
[kpis.md](../02-product-definition/kpis.md), Gates 1 to 3 in the go-to-market plan, and the hypercare exit in the
[post-launch plan](../05-business-case-and-launch/post-launch-plan.md#hypercare-the-first-30-days).

## Asks this week

1. Restore sweeps: a key with credit in Vercel Production, then redeploy (RM-01, LR-01).
2. Check the Anthropic spend limit and alert (LR-17).
3. Answer decisions 1 and 6, which cost nothing and set the order of everything else.
