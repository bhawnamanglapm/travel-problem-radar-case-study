# Executive review

> **Stage 6 of 8.** One page for the owner, the person who decides. It summarises where the product stands and ends in
> the decisions that are open. Every figure links its source; nothing here is new evidence. State on 2026-10-31
> (first written 2026-10-24).

## In one paragraph

Travel Problem Radar is live and taking payments. One to five times a day, as Pro members choose, it finds recent
travel-industry problems on the web, each with a source and a product idea. Free members get a daily teaser; Pro
members get the live board, with details, areas (India among them), search, saved problems, share pages and votes,
and 1 to 5 emails a day. Anyone can see counts of new problems by area and category on a public trends page.
**Payments opened on 2026-10-28 at ₹1 a month or ₹1 a year**, the owner's real price for now. Three things stand out:
- at ₹1, revenue can't cover the running cost of about ₹6,797 a month at any number of members (R-12);
- no finding has been scored by a person; the 2026-10-30 model test's blind review was marked by ChatGPT (R-01);
- the first full test run ended **not ready to sign off**, and one S1 bug is open: an account doesn't see the live
  board (BUG-002).

The next steps are a target price, the open launch items (Vercel Pro, Resend Pro, a spend limit), and BUG-002.

## Where it stands

| | Status | Source |
|---|---|---|
| Product | Live at radar.pehchanthetraveller.com (since 2026-10-28): demo, sign-up with an optional password, Google sign-in, Free and Pro emails, the Pro live board with details, areas, search across sweeps, saved problems, share pages and Useful / Not useful votes (Ask the board is built and off until the owner's test), a public `/trends/` page with counts only, `/manage/` with plan and payment, `/admin/` | [PRD v2](../02-product-definition/prd.md); [flows and screens](../03-design/flows-and-screens.md) |
| Sweeps | Running since 2026-10-25, on `claude-haiku-5-5`. 10 sweeps logged 26 to 30 Oct, 19.0 items each on average. The 26 to 29 Oct slots were all right, started 228 to 418 minutes late | `node scripts/llm-logs.mjs models` (2026-10-30); T35 in [progress.md](../../docs/subscriptions/tasks/progress.md) |
| Quality | **Not measured by a person.** The model test's blind review (marked by ChatGPT) kept 28 of 55 Haiku items. Of 190 live items, 1 had a link web search never returned; the 18 dated sources had a median age of 8.5 days | [model test](../../docs/subscriptions/model-test-2026-10-30.md); [kpis.md](../02-product-definition/kpis.md) |
| Users | 3 live ₹1 payments by 2026-10-29. `/admin/` showed 5 paid Pro, 2 of them test-mode subscriptions. No interviews run | T27 in [progress.md](../../docs/subscriptions/tasks/progress.md); [discovery log](../01-discovery/discovery-log.md) |
| Payments | **Live** since 2026-10-28 (Razorpay live mode), ₹1 a month or ₹1 a year | [launch plan](../05-business-case-and-launch/launch-plan.md) |
| Testing | First full run 2026-10-30: **not ready to sign off**. BUG-001 and BUG-008 to BUG-011 fixed; the owner closed 10 bugs without retests. BUG-002 (S1) open; IT-1 to IT-8 blocked by an old `staging`; UAT-3 not done | [test results](../08-testing/results/README.md); [TS19](../08-testing/TS19-bug-reporting-and-retesting.md) |
| Engineering | 1,709 offline tests and 254 offline checks pass, at `293d333` on 2026-10-31 (1,582 and 249 on 2026-10-30; 952 and 199 on 2026-10-23) | `npm test`, `npm run check`; [traceability](../02-product-definition/traceability.md) |

## The numbers that exist

| Figure | Value | Kind | Source |
|---|---|---|---|
| Cost of one sweep, Haiku | $0.1121 | Measured over 10 production sweeps, 26 to 30 Oct | `node scripts/llm-logs.mjs models` (2026-10-30) |
| Cost of one sweep, Sonnet | $0.21 | Measured over 5 production runs; the cost model still uses it | [costing.md](../../docs/subscriptions/costing.md#one-sweep) |
| Monthly running cost with Vercel Pro and Resend Pro (`F`) | ₹6,797 | Estimate from list prices, at $0.21 a sweep; not recomputed for Haiku | [business case](../05-business-case-and-launch/business-case.md#investment-the-running-cost) |
| Price | ₹1 a month or ₹1 a year | The owner's decision, 2026-10-29 | [decisions.md](../../docs/decisions.md) |
| Break-even | None at ₹1. At ₹299 (the analysis): 24 members, or 28 if GST is inside the price | Follows from `F` | [business case](../05-business-case-and-launch/business-case.md#break-even) |
| Live payments | 3, of ₹1 each, by 2026-10-29 | Razorpay, as recorded in T27 | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| Sign-ups, confirm rate, retention, conversion | — | **Not measured** | [data and metrics](../07-data-and-metrics/data-and-metrics.md#what-isnt-measured) |

## Top risks

| ID | Risk | Why it matters now |
|---|---|---|
| R-12 | The price is below the cost | At ₹1 no number of members covers about ₹6,797 a month; the target price is **OWNER INPUT NEEDED** |
| R-08 | Charging on Vercel Hobby | Payments are live and the site is still on Hobby, which is non-commercial (**verify** the terms) |
| R-01 | The findings are wrong or stale | It is the product's whole claim, and no live sweep has been scored by a person |
| R-02 | Spend runs away | Whether an Anthropic spend limit is set is **not verified** (LR-17) |
| R-04 | Sign-ins use up Resend Free's 100 emails a day | Still on the free plan on 2026-10-29 with paying members; confirmations capped at 50 a day |
| I-10 | BUG-002: an account doesn't see the live board | S1, P1; a paying member could be locked out |

Full list: [RAID log](../04-planning-and-governance/raid-log.md).

## Launch status

**Launched on 2026-10-28** without every item on the [launch plan's go list](../05-business-case-and-launch/launch-plan.md#go--no-go).
Done: LR-01, LR-02, LR-06, LR-08, LR-09, LR-11 (the adviser's check open), LR-12, LR-18 to LR-20. Still open from the
go list: LR-05 (Vercel Pro), LR-07 (the test-mode run isn't recorded), LR-10 (partly checked), LR-13 (a CA), LR-15
(Resend Pro), LR-17 (spend limit not verified), and LR-03 (scoring), which the owner did not apply as a gate.

## Decisions for the owner

Each has options and the recommendation the repository's own documents support. "The repo supports" means a
written rule or reason exists in the source named; it does not mean the choice is made. Record each answer in
[decisions.md](../../docs/decisions.md). Since 2026-10-24 the owner has decided some of these; each says so.

### 1. Keep the rule not to charge before a scored sweep?

| Option | Effect |
|---|---|
| A. Keep it: score 20 or more live items (RM-13, LR-03) before go-live | Go-live waits for sweeps to run and be scored. The main claim has evidence before anyone pays |
| B. Drop it, as the Phase 1 gate was dropped (CR-03) | Go-live can follow the payment checklist alone; members pay for unscored findings |

**Taken by events: B.** Payments opened on 2026-10-28 with no live sweep scored by a person. Scoring live items
(RM-13) is still the only way to measure R-01.

### 2. When to spend on Vercel Pro and Resend Pro (₹1,890 a month each)?

| Option | Effect |
|---|---|
| A. Now | About ₹3,780 a month more (2 × ₹1,890) |
| B. When go-live is next: before the test-mode run (LR-07) | Spend starts when it can lead to revenue |
| C. Not at all: stay free (business case option A) | Tests whether people sign up and read, not whether they pay |

**Still open, and now urgent.** Go-live has happened, so B's moment has passed; both are P0 items before the first
live payment ([costing.md](../../docs/subscriptions/costing.md#pre-launch-checklist)), and neither is recorded as
done (LR-05, LR-15). At ₹1 neither is paid for by revenue.

### 3. Engage an adviser for the terms page?

**Partly decided.** The owner shipped terms on 2026-10-29 with a plain liability clause of their own
([decisions.md](../../docs/decisions.md) 2026-10-29). An adviser's check of it is still open (T30 step 3, R-10);
the adviser's cost is **OWNER INPUT NEEDED**.

### 4. Confirm GST with a CA, and decide on international cards

| Question | Options | What the repo says |
|---|---|---|
| GST | Ask a CA, or rely on the owner's answer ("not registered") | A CA's answer is a P0 item (LR-13), still open. The questions are written: [costing.md](../../docs/subscriptions/costing.md#tax-and-legal-questions-for-a-ca) |
| International cards | Accept them (Razorpay enables them separately, at up to 3% fee) or keep cards and UPI AutoPay only | **No recommendation in the repo.** Open in [payments-razorpay.md](../../docs/subscriptions/payments-razorpay.md#prerequisites) (LR-14) |

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
| **A. Set them now**, before reading the first month's results | Gates can pass or fail honestly |
| B. Set them after the first results | Easy to set a bar the results already clear |

**The repo supports A.** pricing.md asks for thresholds set before looking. What's open: the targets in
[kpis.md](../02-product-definition/kpis.md), Gates 1 to 3 in the go-to-market plan, and the hypercare exit in the
[post-launch plan](../05-business-case-and-launch/post-launch-plan.md#hypercare-the-first-30-days). Hypercare runs
from 2026-10-28, so its day-30 review falls on 2026-11-27.

### 7. Set Pro's target price (new, 2026-10-30)

| Option | Effect |
|---|---|
| A. Keep ₹1 while learning | Shows whether people pay at all; running cost stays the owner's |
| B. Set a price that covers the cost | The ₹299 analysis says 24 to 28 members; other prices are in the [business case](../05-business-case-and-launch/business-case.md#break-even) |

**No recommendation in the repo.** The owner chose ₹1 "for now" on 2026-10-29; the target is **OWNER INPUT
NEEDED** (R-12, RM-36).

## Asks this week

1. Give the two account addresses for BUG-002 in chat, so the records can be compared read-only (I-10, RM-34).
2. Decide on Vercel Pro and Resend Pro now that payments are live (decision 2), and check the Anthropic spend limit
   (LR-17).
3. Update `staging` to `main` so IT-1 to IT-8 and UAT-3 can run (RM-35).
4. Answer decisions 6 and 7, which cost nothing and set what the first month is measured against.
5. Run the Preview test of Ask the board before it is switched on in Production (RM-41).
