# KPI catalogue

> **Stage 2 of 7.** How success would be measured. **Targets are OWNER INPUT NEEDED.** The current value is
> **Not measured** unless a source in this repository gives one. Stage 7 will describe how each KPI is computed
> from the stored data.

## Product quality (goals G1 to G4)

Scored by hand on a sample of 20 or more live items, using the draft rubric in the
[README](../../README.md#how-i-measured-quality).

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-01 | Source links load | items whose link loads ÷ items scored | Manual check of saved sweeps | **OWNER INPUT NEEDED** | Not measured on live data. July sample: 7 of 8 |
| KPI-02 | Source supports the summary | items whose source supports the summary ÷ items scored | Manual scoring | **OWNER INPUT NEEDED** | Not measured |
| KPI-03 | Findings are current | items dated within 30 days of the sweep ÷ items scored | Item `date` field | **OWNER INPUT NEEDED** | Not measured |
| KPI-04 | Opportunities are useful | items a PM would act on ÷ items shown | PM interviews ([plan](../01-discovery/discovery-log.md#interview-plan-proposed-not-done)) | **OWNER INPUT NEEDED** | Not measured |
| KPI-05 | New means new | items flagged New that are new events ÷ items flagged New | Manual scoring | **OWNER INPUT NEEDED** | Not measured; known gap |

## Cost and reliability (goals G5 and G6)

| ID | KPI | Formula | Data source | Target | Current |
|---|---|---|---|---|---|
| KPI-06 | Cost per sweep | Anthropic spend ÷ sweeps | Run logs (`usage`); Anthropic Console | **OWNER INPUT NEEDED** | $0.21 average, measured over 5 production runs ([costing.md](../../docs/subscriptions/costing.md#summary)) |
| KPI-07 | Fixed monthly running cost | Anthropic + Vercel + Resend, a month | Provider invoices | **OWNER INPUT NEEDED** | About ₹6,797 estimated with Vercel Pro and Resend Pro. Not yet from invoices |
| KPI-08 | Sweeps a day | saved sweeps per UTC day | Sweep history (`radar:sweep:` records) | About 5 a day, by design | Not counted over a week ([measurement checklist](../../docs/subscriptions/costing.md#measurement-checklist), row 1) |
| KPI-09 | Complete sweeps | sweeps that saved all 4 categories ÷ sweeps | Sweep history | **OWNER INPUT NEEDED** | Not measured. The first production sweep saved 1 of 4; fixed since |

## Growth and engagement (goals G7 and G8)

These counts come from `node scripts/subscribers.mjs stats`, which reads event records holding no addresses (T11).

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
| KPI-16 | Paying members | active paid Pro subscriptions | Razorpay dashboard; Pro records | 24 to 28 to cover running costs at ₹299 ([costing.md](../../docs/subscriptions/costing.md#break-even)) | 0. Payments not open |
| KPI-17 | Free to paid conversion | new paid Pro ÷ new Free, a month | `checkoutstarted` events; Razorpay | **OWNER INPUT NEEDED** | Not measured |
| KPI-18 | Paid retention | paid members still active after a month ÷ paid members at its start | Razorpay | **OWNER INPUT NEEDED** | Not measured |
| KPI-19 | Refunds and chargebacks | refunds ÷ payments | Razorpay | **OWNER INPUT NEEDED** | Not measured |

## The first 30 days after payments open

The [pricing recommendation](../../docs/cost%20audit/pro_pricing_recommendation.md#what-to-measure-in-the-first-30-days)
lists what to watch once payments open: conversion, activation, weekly active readers, cancellations and their
reasons, the real cost per sweep, provider invoices, support minutes per paying member, and customer interviews. Its
decision rule: choose the price that balances value, conversion, retention and contribution, not the lowest
break-even.
