# Data and metrics

> **Stage 7 of 7.** What the product stores, how each KPI in the [KPI catalogue](../02-product-definition/kpis.md)
> would be computed from it, and what isn't measured at all. Built from the code and from
> [DEPLOYMENT.md](../../DEPLOYMENT.md#what-is-stored). **No counts are printed here**: running `stats` is the
> owner's step, and this page never shows an address. State on 2026-10-24.

## Where the data lives

Everything is in one private Vercel Blob store, under `radar/`. There is no database and no analytics service.
Full table, with Blob paths: [DEPLOYMENT.md](../../DEPLOYMENT.md#what-is-stored).

| Record | Holds | Kept | Personal data | Public through `/api/data` |
|---|---|---|---|---|
| `radar:history` | One entry per saved sweep: `id`, `at`, `total`, `newCount`, `highCount`, and `manual` for a manual sweep | Last 60 sweeps | No | Yes |
| `radar:sweep:<id>` | One sweep's items: `id`, `cat`, `title`, `summary`, `source`, `link`, `region`, `date`, `severity`, `opportunity`, `isNew` | While in the last 60 | No | Yes |
| `radar:seenIds` | Item IDs already seen, for the New flag | Up to 800 | No | No |
| `radar:lastScheduled` | When the last scheduled sweep started | Overwritten | No | No |
| `radar:sub:<id>` | One subscriber: address, status, plan, dates, categories, sign-in state, `emailOff`, Razorpay state. `<id>` is a SHA-256 of the address | Until unsubscribed (Free) or deleted (Pro) | **Yes**: the address | No |
| `radar:event:…` | One event: type, time and plan. **No address or id** | Until `prune-events` deletes it | No | No |
| `radar:deliveries:<day>` | Record ids sent that day's Free digest | 7 days | Record ids, not addresses | No |
| `radar:subscriberCount` | Pending plus active records at the last sweep | Overwritten | No | No |
| `radar:iphit:…` | One sign-up attempt's time. The key holds part of a SHA-256 of the IP; **the IP isn't stored** | 2 hours | No | No |
| `radar:rzpsub:<id>` | Which subscriber a Razorpay subscription belongs to | Not stated | Indirectly | No |
| `radar:rzp-event:…` | A Razorpay event already applied | 30 days | No | No |

Sources: [api/_lib/radar.js](../../api/_lib/radar.js) (`normalize`, the history entry),
[DEPLOYMENT.md](../../DEPLOYMENT.md#what-is-stored).

### Events

Written by `recordEvent` in [api/_lib/subscribers.js](../../api/_lib/subscribers.js). Each holds a type, a time and
sometimes a plan.

| Type | Written when | Printed by `stats` |
|---|---|---|
| `subscribed` | A new address signs up | Yes |
| `confirmsent` | A confirmation email is sent | Yes |
| `noticesent` | An already-confirmed address is emailed its manage link instead (CR-07) | Yes |
| `confirmed` | An address confirms, by link or by Google sign-up | Yes |
| `expired` | A pending sign-up isn't confirmed within 7 days and is deleted | Yes |
| `unsubscribed`, `emailoff` | A member stops emails; `emailoff` is a Pro who keeps the account | Yes, Free and Pro apart |
| `bounced`, `complained` | Resend reports a hard bounce or a spam complaint | Yes |
| `prorequested` | A Free member asks for Pro | Yes |
| `signinsent` | A sign-in email is sent | Yes |
| `deleted` | A member deletes the account | No |
| `checkoutstarted` | A Razorpay subscription is created at checkout | No |
| `progranted`, `prorevoked` | A Razorpay webhook changes an account's plan | No |
| `manualsweep` | A manual sweep runs (capped at 3 a day) | No |

## The `stats` command

`node --env-file=.env.local scripts/subscribers.mjs stats [--days 30]` reads the subscriber records and the events,
and prints counts with no addresses ([scripts/subscribers.mjs](../../scripts/subscribers.mjs), `computeStats`):
- **now**: pending, Free, Pro, Pro ending within 7 days, Free members waiting for Pro;
- **per UTC day**: the event types marked "Yes" above, plus Free digests delivered;
- **confirm rate**: `confirmed ÷ subscribed` over the period.

**A mismatch to settle:** the KPI catalogue defines KPI-11 as `confirmed ÷ confirmsent`, but `stats` prints
`confirmed ÷ subscribed`. They differ whenever a confirmation is resent. This page follows the code; which one KPI-11
should be is **OWNER INPUT NEEDED**.

## How each KPI is computed

| KPI | From | How | Caveat |
|---|---|---|---|
| KPI-01 Source links load | `radar:sweep:` items, `link` | Open each link of a 20-item sample by hand; count those that load | Manual |
| KPI-02 Source supports the summary | Items, `summary` against the source | Read and score by hand | Manual; one scorer |
| KPI-03 Findings are current | Items, `date` | Count items dated within 30 days of the sweep's `at` | `date` is free text the model writes, not checked |
| KPI-04 Opportunities are useful | Interviews | Ask PMs which they would act on | No interviews run |
| KPI-05 New means new | Items, `isNew` | Check by hand whether New items are new events | The New flag compares IDs built from the title, so a retitled story shows as New |
| KPI-06 Cost per sweep | The `usage` line in each sweep's reply; Anthropic Console | Tokens and searches × Anthropic prices ([costing.md](../../docs/subscriptions/costing.md#how-to-re-measure)) | GitHub Actions logs show it; sweeps from Vercel's cron don't appear there, so a month's Console spend is the full check ([measurement checklist](../../docs/subscriptions/costing.md#measurement-checklist) row 2) |
| KPI-07 Monthly running cost | Provider invoices | Sum the month | Not stored in the product |
| KPI-08 Sweeps a day | `radar:history` | Count entries per UTC day, leaving out `manual` | Only the last 60 are kept, about 12 days at 5 a day |
| KPI-09 Complete sweeps | `perCat` in each sweep's reply | Count sweeps where all four categories returned items | **Not stored**: history keeps totals, not counts per category. A failed category and an empty one look alike in a saved sweep |
| KPI-10 Sign-ups | `subscribed` events | `stats` | — |
| KPI-11 Confirm rate | `confirmed`, `subscribed` events | `stats` | See the mismatch above |
| KPI-12 Unsubscribe rate | `unsubscribed`, `emailoff` events; `stats` "now" counts | Unsubscribes in a month ÷ members at its start | The member count at a past date isn't stored; read `stats` at the start of each month |
| KPI-13 Pro requests | `prorequested` events | `stats` | — |
| KPI-14 Active members | Subscriber records | `stats` "now" | — |
| KPI-15 Inbox placement | Test sends | Send to a Gmail and an Outlook.com address; note where each lands | Manual |
| KPI-16 Paying members | Razorpay; `progranted` and `prorevoked` events | Razorpay's active subscriptions; check against Pro records weekly (LR-21) | `stats` counts Pro given by hand and paid Pro together |
| KPI-17 Free to paid conversion | `checkoutstarted`, `progranted` events; Razorpay | New paid Pro in a month ÷ new Free in the month | `stats` doesn't print these events; count them by listing event keys |
| KPI-18 Paid retention | Razorpay | Subscriptions still active after a month ÷ active at its start | — |
| KPI-19 Refunds and chargebacks | Razorpay | Refunds ÷ payments | Refunds are revoked by hand today (R-07) |

## Rules for the data

| Rule | Where it's enforced |
|---|---|
| Events never hold an address or a record id | `recordEvent`; [DEPLOYMENT.md](../../DEPLOYMENT.md#what-is-stored) |
| Only `stats` and other count commands are used for reporting; `list` and `show` print addresses and are for support only | [scripts/subscribers.mjs](../../scripts/subscribers.mjs) header |
| The IP address is never stored; a hash prefix lives 2 hours for rate limiting | `radar:iphit:` |
| `/api/data` serves only the history and sweeps; every subscriber key is refused | `ALLOWED_KEY` in [api/_lib/handlers.js](../../api/_lib/handlers.js); tests |
| With the paywall on, `/api/data` replies are `private, no-store` | [DEPLOYMENT.md](../../DEPLOYMENT.md#caching) |
| Counts in documents, never addresses | [kpis.md](../02-product-definition/kpis.md) |

How long events are kept is set by when the owner runs `prune-events --older-than <days>`; the script's example uses
400. A retention period isn't decided: **OWNER INPUT NEEDED**, and the [privacy page](../../legal/privacy/index.html)
should match it.

## What isn't measured

| Gap | Why | What it would take |
|---|---|---|
| **Page visits** | No page-analytics script is in the site's code | An analytics tool, and a privacy-page update. Not planned |
| **Whether readers open or click the emails** | No open or click tracking | Resend's tracking, if turned on (**verify** the setting), and a privacy-page update |
| **Which items Pro members read on the board** | Not logged | New events; not planned |
| **Product quality** | No sweep scored (R-01) | RM-13: score 20 or more items |
| **Complete sweeps over time** | Per-category results aren't stored | Read run logs, or store `perCat` in the history entry |
| **Support time** | No log | A simple log kept by the owner |
| **Reasons for cancelling** | No exit question | The interview plan |

## Measurement plan

The thresholds that turn these readings into decisions are **OWNER INPUT NEEDED**
([executive review](../06-executive-communication/executive-review.md#decisions-for-the-owner), decision 6).

**Once sweeps run again (before payments):**

| When | Read | KPIs |
|---|---|---|
| Daily, 7 days | The history on `/live/`: sweeps a day; the run logs: `perCat` and `usage` | KPI-06, KPI-08, KPI-09 |
| Once | Score 20 or more live items with the draft rubric | KPI-01 to KPI-05 |
| Once | Test sends to Gmail and Outlook.com | KPI-15 |
| End of the week | `stats --days 7` | KPI-10 to KPI-14 |

**First month after payments open:** the hypercare checks in the
[post-launch plan](../05-business-case-and-launch/post-launch-plan.md#hypercare-the-first-30-days), plus:

| When | Read | KPIs |
|---|---|---|
| Start and end of the month | `stats --days 30`; Razorpay active subscriptions | KPI-12, KPI-14, KPI-16 |
| End of the month | Razorpay: new, cancelled, refunded; `checkoutstarted` and `progranted` counts | KPI-17 to KPI-19 |
| End of the month | Anthropic Console spend; provider invoices | KPI-06, KPI-07 |
| End of the month | Fill the [benefits tracker](../05-business-case-and-launch/post-launch-plan.md#benefits-tracker) | G9 |
