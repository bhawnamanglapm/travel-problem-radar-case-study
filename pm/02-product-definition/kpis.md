# KPI catalogue

> **Stage 2 of 8.** How success would be measured. Updated 2026-10-30 with the values the repository now gives, and KPI-20 (India, T42). **Targets are OWNER INPUT NEEDED**, except KPI-20's, set by the owner on 2026-10-31. The current value is
> **Not measured** unless a source in this repository gives one. Stage 7 will describe how each KPI is computed
> from the stored data.

## Product quality (goals G1 to G4)

Scored by hand on a sample of 20 or more live items, using the draft rubric in the
[README](../../README.md#how-i-measured-quality).

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-01 | Source links load | items whose link loads ÷ items scored | Manual check of saved sweeps | **OWNER INPUT NEEDED** | Not measured on live data. July sample: 7 of 8. Related, not the same: 1 of 190 live items (26 to 30 Oct) had a link web search never returned, the `searched` flag (`node scripts/llm-logs.mjs models`, read on 2026-10-30) |
| KPI-02 | Source supports the summary | items whose source supports the summary ÷ items scored | Manual scoring | **OWNER INPUT NEEDED** | Not measured |
| KPI-03 | Findings are current | items dated within 30 days of the sweep ÷ items scored | Item `date` field; `sourceDate` since 2026-10-30 | **OWNER INPUT NEEDED** | Not scored by hand. Of the 18 items with a `sourceDate` (26 to 30 Oct), the median source age was 8.5 days (`node scripts/llm-logs.mjs models`, read on 2026-10-30). Since 2026-10-30, sources over 60 days old are dropped |
| KPI-04 | Opportunities are useful | items a PM would act on ÷ items shown | PM interviews ([plan](../01-discovery/discovery-log.md#interview-plan-proposed-not-done)) | **OWNER INPUT NEEDED** | Not measured |
| KPI-05 | New means new | items flagged New that are new events ÷ items flagged New | Manual scoring | **OWNER INPUT NEEDED** | Not measured; known gap |

## Coverage of India (T42)

Counted from the LLM logs, not scored by hand. It says where the items are, not whether they're good: read it with
the `searched` flag and the dropped items (R-15).

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-20 | India's share of items | items the board places in India ÷ all items shown, over 7 days; also India items a sweep | The LLM logs: `node --env-file=.env.local scripts/llm-logs.mjs areas --days 7` | **20%**, with 4 or more India items a sweep, as long as India items are dropped as too old or have links search never returned no more often than other items (R-15). Below 10% (2 a sweep) fails, and points to the India-only call (RM-38). Stretch: 25% and 6 a sweep, with 7 of 10 India items scored useful by the owner. Set by the owner, 2026-10-31. A sweep can hold at most 8 India places (4 categories × 2), so about 30% is the ceiling | Baseline before T42: 2 of 190 items (1.1%), 0.2 a sweep, over 10 sweeps 26 to 30 Oct (`node --env-file=.env.local scripts/llm-logs.mjs areas --days 7`, read 2026-10-30). A looser count of regions that mention India gave 5 (2.6%): two named India with another area and count as Global, and one was a South Korea rule for Indian passport holders (Asia) |

## Cost and reliability (goals G5 and G6)

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-06 | Cost per sweep | Anthropic spend ÷ sweeps | Run logs (`usage`); the LLM logs; Anthropic Console | **OWNER INPUT NEEDED** | $0.1121 average over 10 sweeps, 26 to 30 Oct, all on Haiku (`node scripts/llm-logs.mjs models`, read on 2026-10-30). Was $0.21 over 5 Sonnet runs ([costing.md](../../docs/subscriptions/costing.md#summary)) |
| KPI-07 | Fixed monthly running cost | Anthropic + Vercel + Resend, a month | Provider invoices | **OWNER INPUT NEEDED** | About ₹6,797 estimated with Vercel Pro and Resend Pro, at Sonnet's $0.21 a sweep; not recomputed for Haiku. Not yet from invoices |
| KPI-08 | Sweeps a day | saved sweeps per UTC day | Sweep history (`radar:sweep:` records) | 1 to 5 a day, as the highest Pro choice needs (T32) | 10 sweeps logged 26 to 30 Oct (`node scripts/llm-logs.mjs models`, read on 2026-10-30). The 2026-10-26 to 29 slots were all swept or skipped as designed, 228 to 418 minutes late (T35) |
| KPI-09 | Complete sweeps | sweeps that saved all 4 categories ÷ sweeps | Sweep history | **OWNER INPUT NEEDED** | Not measured as a ratio. The first production sweep saved 1 of 4; fixed since. 26 to 30 Oct: 19.0 items a sweep on average, of 20 possible (`node scripts/llm-logs.mjs models`, read on 2026-10-30) |

## Growth and engagement (goals G7 and G8)

These counts come from `node scripts/subscribers.mjs stats`, which reads event records holding no addresses (T11),
and since 2026-10-26 from the owner's `/admin/` dashboard.

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-10 | Sign-ups | `subscribed` events per day | `stats` | **OWNER INPUT NEEDED** | Not reported here |
| KPI-11 | Confirm rate | `confirmed` ÷ `confirmsent` | `stats` | **OWNER INPUT NEEDED** | Not reported here |
| KPI-12 | Unsubscribe rate | unsubscribes ÷ active members, a month | `stats` (Free and Pro counted apart) | **OWNER INPUT NEEDED** | Not reported here |
| KPI-13 | Pro requests | `prorequested` events | `stats` | **OWNER INPUT NEEDED** | Not reported here |
| KPI-14 | Active members | Free and Pro members now | `stats` | **OWNER INPUT NEEDED** | Not reported here. No users recorded besides the owner |
| KPI-15 | Inbox placement | emails in the inbox ÷ test emails, per provider | Test sends to each provider | **OWNER INPUT NEEDED** | Gmail: inbox. Outlook.com: Junk (2026-10-22, [progress.md](../../docs/subscriptions/tasks/progress.md)) |

"Not reported here" means the count exists in the store but hasn't been read for this document. Running `stats` is
the owner's step, and this document prints counts only, never addresses.

## Revenue (goal G9)

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-16 | Paying members | active paid Pro subscriptions | Razorpay dashboard; Pro records | Was 24 to 28 to cover running costs at ₹299 ([costing.md](../../docs/subscriptions/costing.md#break-even)). At ₹1 no number covers them; the target is **OWNER INPUT NEEDED** | 3 live ₹1 payments captured by 2026-10-29. `/admin/` showed 5 paid Pro; the 2 extra are test-mode subscriptions that end on Nov 25 and 26 (T27, [progress.md](../../docs/subscriptions/tasks/progress.md)) |
| KPI-17 | Free to paid conversion | new paid Pro ÷ new Free, a month | `checkoutstarted` events; Razorpay | **OWNER INPUT NEEDED** | Not measured |
| KPI-18 | Paid retention | paid members still active after a month ÷ paid members at its start | Razorpay | **OWNER INPUT NEEDED** | Not measured; payments opened 2026-10-28 |
| KPI-19 | Refunds and chargebacks | refunds ÷ payments | Razorpay | **OWNER INPUT NEEDED** | Not measured |
| KPI-21 | Items members find useful | voted items with more Useful than Not useful votes ÷ voted items; also for India items alone | `node --env-file=.env.local scripts/item-votes.mjs` (T43) | **OWNER INPUT NEEDED** | Not measured: the buttons are live for Pro since 2026-10-31 (#136); no votes read yet. Members' votes, not the owner's scoring (KPI-04, KPI-20's stretch), and only Pro members vote |

## What ₹1 means for these KPIs

Since 2026-10-29, ₹1 a month and ₹1 a year is Pro's real price for now ([decisions.md](../../docs/decisions.md)).
KPI-16 to KPI-19 can still show whether people pay, stay and ask for refunds, but not whether Pro covers its running
cost: at ₹1, revenue can't cover about ₹6,797 a month. The break-even target in KPI-16 needs the owner's target price.

## The first 30 days after payments open

Payments opened on 2026-10-28 (T27).

The [pricing recommendation](../../docs/cost%20audit/pro_pricing_recommendation.md#what-to-measure-in-the-first-30-days)
lists what to watch once payments open: conversion, activation, weekly active readers, cancellations and their
reasons, the real cost per sweep, provider invoices, support minutes per paying member, and customer interviews. Its
decision rule: choose the price that balances value, conversion, retention and contribution, not the lowest
break-even.
