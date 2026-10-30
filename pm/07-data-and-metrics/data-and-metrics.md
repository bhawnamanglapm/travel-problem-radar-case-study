# Data and metrics

> **Stage 7 of 8.** What the product stores, how each KPI in the [KPI catalogue](../02-product-definition/kpis.md)
> would be computed from it, and what isn't measured at all. Built from the code and from
> [DEPLOYMENT.md](../../DEPLOYMENT.md#what-is-stored). **No counts are printed here**: running `stats` is the
> owner's step, and this page never shows an address. Updated 2026-10-30 (first written 2026-10-24): the stores,
> fields and scripts added by T29 and T32 to T42, and passwords.

## Where the data lives

Everything is in one private Vercel Blob store, under `radar/`. There is no database and no analytics service.
Full table, with Blob paths: [DEPLOYMENT.md](../../DEPLOYMENT.md#what-is-stored).

| Record | Holds | Kept | Personal data | Public through `/api/data` |
|---|---|---|---|---|
| `radar:history` | One entry per saved sweep: `id`, `at`, `total`, `newCount`, `highCount`, and `manual` for a manual sweep | Last 60 sweeps | No | Yes |
| `radar:sweep:<id>` | One sweep's items: `id`, `cat`, `title`, `summary`, `source`, `link`, `region`, `date`, `severity`, `opportunity`, `isNew`. Since 2026-10-30 `sourceDate`, when search gave the page's age; sources over 60 days old are dropped. Since T36 each item's history: `firstAt`, `seen`, `prev`, `firstEarlier` | While in the last 60 | No | Yes |
| `radar:search` | The "All saved sweeps" search (T38): the latest copy of each item in the kept sweeps, with `sweep` and `sweepAt` | Rebuilt each sweep | No | Yes (Pro only) |
| `radar:items` | Each item's history (T36): first sweep, number of sweeps, up to 6 latest sweep ids | Trimmed to `radar:seenIds` | No | No |
| `radar:llmlog:<id>` | One sweep's LLM log: each Claude call's request and response (never the key), usage per category (`usageByCat`, T29), and every page search found, with its link, title and age | 30 days | No | No |
| `radar:seenIds` | Item IDs already seen, for the New flag | Up to 800 | No | No |
| `radar:lastScheduled` | When the last scheduled sweep started, and its slot (`slotAt`, T35) | Overwritten | No | No |
| `radar:sub:<id>` | One subscriber: address, status, plan, dates, categories, sign-in state, `emailOff`, Razorpay state. Since 2026-10-27 an optional password hash (`pw`, scrypt). Since T39 `saved`: up to 100 saved problems. Since T41 `areas`; since T42 `areasV`, which marks a list saved after India became its own area. `<id>` is a SHA-256 of the address | Until unsubscribed (Free) or deleted (Pro) | **Yes**: the address | No |
| `radar:event:…` | One event: type, time and plan. **No address or id** | Until `prune-events` deletes it | No | No |
| `radar:deliveries:<day>` | Record ids sent that day's Free digest | 7 days | Record ids, not addresses | No |
| `radar:subscriberCount` | Pending plus active records at the last sweep | Overwritten | No | No |
| `radar:iphit:…` | One sign-up attempt's or wrong password's time. The key holds part of a SHA-256 of the IP; **the IP isn't stored** | 2 hours | No | No |
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

## Owner scripts that read the data

All run on the owner's machine, read only, and print no address. Since 2026-10-26 the owner's `/admin/` dashboard
also shows members, plans, areas and payment mode, behind its own user and password.

| Script | Reads | Gives | KPIs |
|---|---|---|---|
| `node scripts/llm-logs.mjs models` (also `list`, `summary`, `show`, `areas`) | `radar:llmlog:` | Per model, averages per sweep: items, pages, searches, tokens, cost and cost per item; failed calls; the items' source ages and links search never returned (`searched`). With `areas`, the items shown by area and India's share (T42) | KPI-20, KPI-01 (a proxy), KPI-03, KPI-06, KPI-08, KPI-09 |
| [`scripts/cost-per-run.mjs`](../../scripts/cost-per-run.mjs) | `radar:llmlog:` | Each sweep's cost and each category's, at list prices (T29) | KPI-06 |
| [`scripts/score-items.mjs`](../../scripts/score-items.mjs) | Saved sweeps | Picks 20 items, checks links and dates, writes a review sheet outside the repo for a person to score; then totals it | KPI-01 to KPI-05. Built; **no scoring recorded yet** |

Readings so far, from `node scripts/llm-logs.mjs models` on 2026-10-30: 10 sweeps 26 to 30 Oct, all on `claude-haiku-5-5`, $0.1121 and 19.0
items a sweep on average; 1 of 190 items had a link search never returned; the 18 items with a `sourceDate` had a
median source age of 8.5 days. From `llm-logs.mjs areas --days 7` the same day: 2 of 190 items (1.1%) in India.

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
| KPI-01 Source links load | `radar:sweep:` items, `link` | `score-items.mjs` checks a 20-item sample's links; a person confirms | The LLM log's `searched` flag is a warning sign, not this KPI |
| KPI-02 Source supports the summary | Items, `summary` against the source | Read and score by hand | Manual; one scorer |
| KPI-03 Findings are current | Items, `sourceDate` (since 2026-10-30), else `date` | Count items whose source is within 30 days of the sweep's `at` | `date` is free text the model writes; `sourceDate` exists only when search gave the page's age |
| KPI-04 Opportunities are useful | Interviews | Ask PMs which they would act on | No interviews run |
| KPI-05 New means new | Items, `isNew` | Check by hand whether New items are new events | The New flag compares IDs built from the title, so a retitled story shows as New |
| KPI-06 Cost per sweep | The LLM logs (every sweep, cron included); Anthropic Console | `node scripts/llm-logs.mjs models` or `cost-per-run.mjs` | Logs are kept 30 days. A month's Console spend is still the full check ([measurement checklist](../../docs/subscriptions/costing.md#measurement-checklist) row 2) |
| KPI-07 Monthly running cost | Provider invoices | Sum the month | Not stored in the product |
| KPI-08 Sweeps a day | `radar:history` | Count entries per UTC day, leaving out `manual` | Only the last 60 are kept, about 12 days at 5 a day |
| KPI-09 Complete sweeps | The LLM log's outcome per category (`llm-logs.mjs summary`) | Count sweeps where all four categories returned items | The saved sweep and history still keep only totals; the logs last 30 days |
| KPI-10 Sign-ups | `subscribed` events | `stats` | — |
| KPI-11 Confirm rate | `confirmed`, `subscribed` events | `stats` | See the mismatch above |
| KPI-12 Unsubscribe rate | `unsubscribed`, `emailoff` events; `stats` "now" counts | Unsubscribes in a month ÷ members at its start | The member count at a past date isn't stored; read `stats` at the start of each month |
| KPI-13 Pro requests | `prorequested` events | `stats` | — |
| KPI-14 Active members | Subscriber records | `stats` "now" | — |
| KPI-15 Inbox placement | Test sends | Send to a Gmail and an Outlook.com address; note where each lands | Manual |
| KPI-16 Paying members | Razorpay; `progranted` and `prorevoked` events; `/admin/` | Razorpay's active subscriptions; check against Pro records weekly (LR-21) | `stats` counts Pro given by hand and paid Pro together; `/admin/` counts 2 test-mode subscriptions as paid until Nov 25 and 26 (R-13) |
| KPI-17 Free to paid conversion | `checkoutstarted`, `progranted` events; Razorpay | New paid Pro in a month ÷ new Free in the month | `stats` doesn't print these events; count them by listing event keys |
| KPI-18 Paid retention | Razorpay | Subscriptions still active after a month ÷ active at its start | — |
| KPI-19 Refunds and chargebacks | Razorpay | Refunds ÷ payments | Refunds are revoked by hand, with `revoke-pro --paid` since 2026-10-29 (R-07) |
| KPI-20 India's share of items | The LLM logs, `radar:llmlog:` | `llm-logs.mjs areas --days 7`: the items each sweep showed (a failed call's items and a dropped item left out), placed by `areaOf(region)` as on the board; India ÷ all, and India ÷ sweeps | Logs are kept 30 days. Text naming India and another area counts as Global, and India with elsewhere in Asia as Asia, so items that touch India are undercounted |

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
| **Which items Pro members read on the board** | Not logged. Saved problems (T39) are stored per member, but no count of them is reported | New events; not planned |
| **Product quality** | No live sweep scored by a person (R-01). The 2026-10-30 model test's blind review was marked by ChatGPT | RM-13: score 20 or more items with `score-items.mjs` |
| **Complete sweeps beyond 30 days** | Per-category results are only in the LLM logs, kept 30 days | Store `perCat` in the history entry, or copy the logs' readings monthly |
| **Support time** | No log | A simple log kept by the owner |
| **Reasons for cancelling** | No exit question | The interview plan |

## Measurement plan

The thresholds that turn these readings into decisions are **OWNER INPUT NEEDED**
([executive review](../06-executive-communication/executive-review.md#decisions-for-the-owner), decision 6).

**Once sweeps run again (before payments):** sweeps ran again on 2026-10-25 and payments opened on 2026-10-28, so
this table is now history; none of it is recorded as done except what `node scripts/llm-logs.mjs models` gives.

| When | Read | KPIs |
|---|---|---|
| Daily, 7 days | The history on `/live/`: sweeps a day; the run logs: `perCat` and `usage` | KPI-06, KPI-08, KPI-09 |
| Once | Score 20 or more live items with the draft rubric | KPI-01 to KPI-05 |
| Once | Test sends to Gmail and Outlook.com | KPI-15 |
| End of the week | `stats --days 7` | KPI-10 to KPI-14 |

**First month after payments open (from 2026-10-28):** the hypercare checks in the
[post-launch plan](../05-business-case-and-launch/post-launch-plan.md#hypercare-the-first-30-days), plus:

| When | Read | KPIs |
|---|---|---|
| Start and end of the month | `stats --days 30`; Razorpay active subscriptions | KPI-12, KPI-14, KPI-16 |
| End of the month | Razorpay: new, cancelled, refunded; `checkoutstarted` and `progranted` counts | KPI-17 to KPI-19 |
| End of the month | Anthropic Console spend; provider invoices | KPI-06, KPI-07 |
| A week after T42 is live | `llm-logs.mjs areas --days 7` and `llm-logs.mjs models` (RM-38) | KPI-20, KPI-06 |
| End of the month | Fill the [benefits tracker](../05-business-case-and-launch/post-launch-plan.md#benefits-tracker) | G9 |
