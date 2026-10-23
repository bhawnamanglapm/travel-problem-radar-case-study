# Post-launch plan

> **Stage 5 of 7. A plan for after payments open; none of it has run.** It covers the first 30 days (hypercare),
> support and incidents, the triggers that call for action, tracking the benefit against break-even, what to build
> next, and the reviews. Thresholds marked **Proposed** are suggestions for the owner to confirm or replace; the rest
> are **OWNER INPUT NEEDED**. State on 2026-10-24.

## Hypercare: the first 30 days

From the day `paid: true` goes live ([launch plan](launch-plan.md#go-live-steps)).

| How often | Check | Where | Source |
|---|---|---|---|
| Daily | The last sweep is under about 5 hours old and saved all four categories | `/api/data?key=radar:history`; the failure email and Slack | [DEPLOYMENT.md](../../DEPLOYMENT.md#watching-runs) |
| Daily | Every payment turned an account Pro; no webhook failures | Razorpay's webhook log; `/manage/` | R-06 |
| Daily | Bounces, complaints, quota stops | Resend's logs; `stats` | [DEPLOYMENT.md](../../DEPLOYMENT.md#managing-subscribers) |
| Daily | Anthropic spend against about $0.21 a sweep | Anthropic Console | KPI-06; [costing.md](../../docs/subscriptions/costing.md#measurement-checklist) row 2 |
| Weekly | Razorpay's active subscriptions match the Pro records | Razorpay dashboard; `list --plan pro` | LR-21 |
| Weekly | Sweeps a day, emails a day | Live board history; Resend dashboard | KPI-08; costing measurement rows 1 and 4 |

**Exit hypercare** when all of these hold, **Proposed**, for the owner to confirm:
- 7 days in a row in which every scheduled sweep saved all four categories (KPI-09);
- no open severity 1 or 2 incident;
- two weekly checks in a row in which Razorpay and the Pro records match;
- a month of real Anthropic spend read and compared with the model in [costing.md](../../docs/subscriptions/costing.md).

If they don't hold by day 30, hypercare continues and the [30-day review](#reviews) says why.

## Support

| | |
|---|---|
| Channel | The address on the [contact page](../../legal/contact/index.html) and in `plan.json` (CR-14) |
| Promise | "We reply within the same day", live on the contact page since 2026-10-23 ([decisions.md](../../docs/decisions.md)) |
| Who answers | The owner. No one else is recorded |
| Tools | `scripts/subscribers.mjs` (`show`, `grant-pro`, `revoke-pro`, `delete`); Razorpay dashboard for refunds |
| Refund rule | The first payment back in full if asked within 7 days; a mistaken charge always; otherwise a started month isn't refunded. Approved refunds arrive within 14 days ([decisions.md](../../docs/decisions.md) 2026-10-23) |
| Not tracked | Support time per paying member, which the [pricing recommendation](../../docs/cost%20audit/pro_pricing_recommendation.md#what-to-measure-in-the-first-30-days) asks for. **OWNER INPUT NEEDED**: how to log it |

## Incident severity

| Level | Meaning | Example | Response, **Proposed** |
|---|---|---|---|
| 1 | Money or access is wrong for a paying member | Charged but still Free; Pro lost while paid; charged twice | Same day; consider rollback |
| 2 | The product delivers nothing new | Every category failing (as since 2026-10-23, I-01) | Same day |
| 3 | Part of it is degraded | One category failing; emails in Junk; a late sweep | Within the week |
| 4 | A question or a request | How to cancel; asking for a refund within the rule | Same day, per the contact promise |

## Incident playbooks

| Incident | How it shows | First steps | Source |
|---|---|---|---|
| **Every category fails** | The failure email and Slack; `502` with every `perCat` `failed: http 400` | Check the key has credit, web search is allowed for the organisation, and `RADAR_MODEL` is valid; read Anthropic's console logs. The board keeps the last good sweep | [DEPLOYMENT.md](../../DEPLOYMENT.md#10-troubleshooting); I-01, I-02 |
| **A payment didn't make the account Pro** | A member writes in; the webhook log shows failures | Check the webhook is Enabled and its secret matches; replay the event from Razorpay (**verify** the option) | R-06; [DEPLOYMENT.md](../../DEPLOYMENT.md#razorpay--vercel) |
| **Refund or chargeback** | Razorpay notice; a member writes in | Refund in Razorpay, then revoke Pro by hand: the written step from LR-20. Each refund loses Razorpay's fee | R-07; RM-21 automates it later |
| **Bounces or complaints rise** | `stats` shows `bounced` or `complained`; Resend's logs | The Resend webhook already turns those addresses' email off; find the cause before the next send | [DEPLOYMENT.md](../../DEPLOYMENT.md#managing-subscribers) |
| **Spend alert, or spend above the model** | Anthropic Console alert | Pause the sweep (GitHub and Vercel schedules), check `RADAR_MODEL` and the run count, rotate `CRON_SECRET` if a leak is possible | R-02; [DEPLOYMENT.md](../../DEPLOYMENT.md#pausing-the-sweep) |
| **Email quota stops** | `subscribers.stopped: "quota"` in the sweep reply | The rest send at the next sweep; recheck the Resend plan | [DEPLOYMENT.md](../../DEPLOYMENT.md#10-troubleshooting) |

**When to roll back payments**, **Proposed**: a severity 1 incident that affects more than one paying member, or one
that can't be fixed the same day. Steps: [launch plan](launch-plan.md#rollback). Whether to tell members, and how, is
**OWNER INPUT NEEDED**.

## KPI triggers

Each KPI is defined in the [KPI catalogue](../02-product-definition/kpis.md) and computed as in
[data-and-metrics.md](../07-data-and-metrics/data-and-metrics.md#how-each-kpi-is-computed).

| KPI | Trigger | Action |
|---|---|---|
| KPI-09 Complete sweeps | Any scheduled sweep that saves nothing | Severity 2 playbook above |
| KPI-01, KPI-02 Links load, source supports | Below a pass mark in the monthly scoring: **OWNER INPUT NEEDED** | Look at which category fails; change the prompt; rescore |
| KPI-06 Cost per sweep | Above $0.21 by more than a margin: **OWNER INPUT NEEDED** | Find the cause in the run logs; update [costing.md](../../docs/subscriptions/costing.md) and the break-even |
| KPI-08 Sweeps a day | Not 5 over a week | Update `F` and the break-even ([business case](business-case.md#sensitivity)) |
| KPI-11 Confirm rate | A drop: **OWNER INPUT NEEDED** | Check inbox placement (KPI-15) and the Chrome warning (I-04) |
| KPI-12 Unsubscribe rate | A rise: **OWNER INPUT NEEDED** | Ask why, in the interview plan |
| KPI-16 Paying members | Under 24 after a period the owner sets | The [executive review](../06-executive-communication/executive-review.md#decisions-for-the-owner) options: keep, change price, or stop charging |
| KPI-18 Paid retention | Below a mark: **OWNER INPUT NEEDED** | Interview the members who cancel |
| KPI-19 Refunds and chargebacks | Any chargeback; refunds above a mark: **OWNER INPUT NEEDED** | Check the pricing page and checkout summary say what members get |

## Benefits tracker

The benefit to track is whether Pro covers its running costs (goal G9). Actuals are empty until payments open.

| Month after go-live | Paying members (KPI-16) | Break-even at ₹299 | Real running cost | Net revenue | Surplus against the real cost |
|---|---|---|---|---|---|
| 1 | — | 24 to 28 | — (model: ₹6,797) | — | — |
| 2 | — | 24 to 28 | — | — | — |
| 3 | — | 24 to 28 | — | — | — |

Source for the break-even and the model cost: [business case](business-case.md#break-even). The real cost comes from
provider invoices (KPI-07); net revenue from Razorpay's settlement reports.

## What to build next

The order is in the [roadmap](../04-planning-and-governance/roadmap.md), not copied here:
- **Next** (RM-10 to RM-16): the open production checks, scoring, measuring sweeps and spend, interviews, and the
  owner's own domain.
- **Later, only if users ask** (RM-17 to RM-24): including automatic refund handling (RM-21) and a cheaper model
  after a quality comparison (RM-23).

After launch, what moves an item up is evidence: support requests, interview answers, and the KPI triggers above.
Each change is recorded in [decisions.md](../../docs/decisions.md) and, if it revises an earlier decision, in the
[change log](../04-planning-and-governance/change-log.md).

## Handover to business as usual

Not applicable: one person builds and runs the product, so there is no team to hand over to. The runbook a new
operator would need already exists: [DEPLOYMENT.md](../../DEPLOYMENT.md) sections 8 to 10.

## Reviews

| Review | When | Inputs | Output |
|---|---|---|---|
| Weekly check | Every week of hypercare | The weekly rows above | Notes; any incident opened |
| 30-day review | Day 30 | The benefits tracker; KPI-06 to KPI-19; support log; incidents | Exit hypercare or not; a decision on price and gates in [decisions.md](../../docs/decisions.md) |
| Quality scoring | Monthly | 20 or more live items | KPI-01 to KPI-05 |

## Lessons so far

From the record before launch, so the post-launch reviews start from them:

| Lesson | Evidence |
|---|---|
| **Claims ran ahead of evidence**, and were removed once checked | CR-01: email delivery, working buttons and "raised quality" removed on 2026-10-18 |
| **One vendor and a bare error message made an outage slow to diagnose** | Every sweep failed from 2026-10-23 15:09 UTC with only `http 400` (I-01, I-02, R-03) |
| **The free hosting plan shaped the design** | A daily cron (CR-02), the 12-function limit (CR-12), the Blob lock (R-09) |
| **Decisions sometimes moved faster than the evidence** | The Phase 1 gate skipped (CR-03); the paywall on before checkout (CR-11) |
| **Sign-in paths failed in the real world**, not in tests | The emailed link failed twice before Google sign-in was added (CR-08) |
| **Deliverability is outside the code** | Outlook.com files the emails in Junk (I-03) |

The same pattern is drawn out in the [change log](../04-planning-and-governance/change-log.md#what-the-pattern-shows).
