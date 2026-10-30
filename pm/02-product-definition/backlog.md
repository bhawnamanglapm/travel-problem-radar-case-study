# Backlog by epic

> **Stage 2 of 8.** The build tasks `T00` to `T42` grouped into epics, with each one's status on 2026-10-30 (first
> written 2026-10-23 for `T00` to `T27`). Each task file has its acceptance criteria. The statuses come from [progress.md](../../docs/subscriptions/tasks/progress.md)
> and the git history; where a later pull request changed one, that pull request is named. Sizes (S, M, L) were
> guesses made when the tasks were written, not measurements.

## Epics

| Epic | Goal | Tasks | Requirements | Status |
|---|---|---|---|---|
| EP-01 Radar core | Find, sort and keep travel problems; a demo and a live page | Before the task list: July 2026 to 19 Oct 2026 | REQ-01 to REQ-11 | Done |
| EP-02 Subscriber foundations | Storage, records, HTTP helpers, emails | T00 to T04 | REQ-17 | Done |
| EP-03 Sign-up flow | Double opt-in sign-up and unsubscribe | T05 to T08 | REQ-12, REQ-13, REQ-18 | Done |
| EP-04 Delivery | Free daily and Pro every sweep, inside the sweep | T09, T10 | REQ-14 to REQ-16 | Done |
| EP-05 Operate and launch | Admin script, metrics, staged launch, and the fixes it found | T11, T12, fixes | REQ-19, REQ-22 | One launch check open |
| EP-06 Hardening and options | Bounces, complaints, rate limit; Pro picks categories | T13, T14 | REQ-20, REQ-21 | Done |
| EP-07 Paid website | Accounts, a locked board, a teaser email | T16 to T18 | REQ-23 to REQ-25 | Done; live |
| EP-08 Payments | Razorpay checkout, webhook, Pro lifecycle | T15, T19 to T22 | REQ-26 to REQ-28 | Live since 2026-10-28; T22 built 2026-10-30 (was: built and tested on staging, T22 to do) |
| EP-09 Showing Pro and going live | Honest pricing pages and a go-live run | T23 to T27, T30 | REQ-29 to REQ-31 | Live with `paid: true` at ₹1 since 2026-10-28 (was: pages live with `paid: false`). Open: T23's owner inputs, Vercel Pro, T27's test-run record, T30's owner steps |
| EP-10 The Pro plan | Pro chooses emails a day, one plan monthly or yearly, renewing, slots on time | T28, T32 to T35 | REQ-33 to REQ-36 | Live; T28 replaced by T32; T32's owner email check open |
| EP-11 Board features | Details and history, areas, search all sweeps, saved problems, sharing, areas in email, India | T36 to T42 | REQ-37 to REQ-42, REQ-47 | Live (29 and 30 Oct; T42 on 30 Oct) |
| EP-12 Measure | Cost per category, then decide on tiers | T29, T31 | REQ-46 | T29 done; T31 to do |

EP-10 to EP-12 were added on 2026-10-30 for the tasks written after 2026-10-23. Changes outside a task file (the
admin dashboard, passwords, deleting an account, source freshness) are in the [CHANGELOG](../../CHANGELOG.md) and
are REQ-23, REQ-43 to REQ-45 in the [PRD](prd.md).

```mermaid
flowchart LR
  EP01["EP-01 Radar core"] --> EP02["EP-02 Foundations"] --> EP03["EP-03 Sign-up"] --> EP04["EP-04 Delivery"] --> EP05["EP-05 Operate"]
  EP05 --> EP06["EP-06 Hardening"]
  EP05 --> EP07["EP-07 Paid website"] --> EP08["EP-08 Payments"] --> EP09["EP-09 Go live"]
  EP09 --> EP10["EP-10 Pro plan"]
  EP09 --> EP11["EP-11 Board features"]
  EP09 --> EP12["EP-12 Measure"]
```

## Tasks

| Task | Epic | What | Size | Status | Evidence |
|---|---|---|---|---|---|
| [T00](../../docs/subscriptions/tasks/T00-owner-prerequisites.md) | EP-02 | Domain, sender and decisions D1 to D9 | S | Done (owner-reported, 2026-10-21) | Domain verified in Resend, DMARC set |
| [T01](../../docs/subscriptions/tasks/T01-storage-list.md) | EP-02 | Storage `list()` and test helpers | S | Done | `9175e84` |
| [T02](../../docs/subscriptions/tasks/T02-subscriber-records.md) | EP-02 | Subscriber records module | M | Done | `f0de053` |
| [T03](../../docs/subscriptions/tasks/T03-http-helpers.md) | EP-02 | HTTP helpers | S | Done | `536cc33` |
| [T04](../../docs/subscriptions/tasks/T04-email-builders.md) | EP-02 | Email builders and batch sending | M | Done | `87bbdcb` |
| [T05](../../docs/subscriptions/tasks/T05-api-subscribe.md) | EP-03 | `POST /api/subscribe` | M | Done | `0f718c3` |
| [T06](../../docs/subscriptions/tasks/T06-api-confirm.md) | EP-03 | `/api/confirm` | S | Done | `15c4478` |
| [T07](../../docs/subscriptions/tasks/T07-api-unsubscribe.md) | EP-03 | `/api/unsubscribe`, one-click | S | Done | `5dfa7be` |
| [T08](../../docs/subscriptions/tasks/T08-subscribe-page.md) | EP-03 | `/subscribe/` page, build and checks | M | Done | `147fd24` |
| [T09](../../docs/subscriptions/tasks/T09-delivery-engine.md) | EP-04 | Delivery engine | L | Done | `ef7831b` |
| [T10](../../docs/subscriptions/tasks/T10-sweep-integration.md) | EP-04 | Delivery wired into the sweep | M | Done | `0d3b008` |
| [T11](../../docs/subscriptions/tasks/T11-admin-script-and-metrics.md) | EP-05 | Admin script and metrics | M | Done | `d344d34` |
| Request Pro | EP-05 | Ask for Pro at sign-up or on `/manage/`; the owner grants it by hand | — | Done | PR #8 |
| Fresh reads | EP-05 | Storage reads skip the CDN cache, except the data feed's | — | Done | PR #9 |
| [T12](../../docs/subscriptions/tasks/T12-docs-and-launch.md) | EP-05 | Docs and staged launch | M | Docs done; launch has one check open: a Pro email with one category | progress.md |
| One inbox | EP-05 | One subscription per inbox | — | Done; checked on production | PR #19 |
| Old links | EP-05 | Old unsubscribe links say "no longer active" | — | Done | PR #23 |
| [T13](../../docs/subscriptions/tasks/T13-optional-hardening.md) | EP-06 | Bounces, complaints, per-IP limit | M | Done; live with the webhook and firewall rule | PR #12 |
| [T14](../../docs/subscriptions/tasks/T14-optional-pro-categories.md) | EP-06 | Pro chooses categories | M | Done; live. The email side not yet checked | PR #18 |
| [T15](../../docs/subscriptions/tasks/T15-phase2-gate-and-accounts.md) | EP-08 | Phase 2 gate and accounts | S | In progress. The owner skipped the gate; prerequisites started | progress.md |
| [T16](../../docs/subscriptions/tasks/T16-accounts-and-sign-in.md) | EP-07 | Accounts and sign-in | L | Done. Sign-up checked in production, the sign-in link not yet | progress.md |
| [T17](../../docs/subscriptions/tasks/T17-locked-board.md) | EP-07 | Locked board | M | Done; switched on in production 2026-10-23 | progress.md |
| [T18](../../docs/subscriptions/tasks/T18-teaser-email.md) | EP-07 | Free email becomes a teaser | S | Done; live with the switch | progress.md |
| [T19](../../docs/subscriptions/tasks/T19-razorpay-library.md) | EP-08 | Razorpay library | M | Done | progress.md |
| [T20](../../docs/subscriptions/tasks/T20-manage-page-and-checkout.md) | EP-08 | `/manage/` checkout and cancel | L | Done; test checkout passed on staging 2026-10-23 | progress.md |
| [T21](../../docs/subscriptions/tasks/T21-razorpay-webhook.md) | EP-08 | Razorpay webhook | M | Done; staging check passed 2026-10-23 | progress.md |
| [T22](../../docs/subscriptions/tasks/T22-pro-lifecycle-and-go-live.md) | EP-08 | Pro expiry, paid unsubscribe, key safety | M | Built 2026-10-30: 48-hour renewal grace, the sweep's tidy step, key-mismatch guard (was: to do, needs Vercel Pro) | progress.md |
| [T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md) | EP-09 | Display rules and owner inputs | S | Price, GST, trial, refund rule, about text and contact answered. International cards and domain renewal open. The yearly plan exists since 2026-10-26 (T33). progress.md still lists T23 as to do | T23; PR #74 |
| [T24](../../docs/subscriptions/tasks/T24-pricing-page.md) | EP-09 | `/pricing/` and `plan.json` | M | Live; `paid: true` since 2026-10-26, charging since 2026-10-28, ₹1 a month and ₹1 a year (was `paid: false`, ₹299) | progress.md, `f7c4270` |
| [T25](../../docs/subscriptions/tasks/T25-about-footer-legal.md) | EP-09 | `/about/`, footer, policy pages | M | All four policy pages live; terms since 2026-10-29 with the owner's plain liability clause. The adviser's check of the clause is open | PR #67, PR #74; progress.md |
| [T26](../../docs/subscriptions/tasks/T26-pro-copy-and-checkout-summary.md) | EP-09 | Pro wording, summary before checkout | M | Live since 2026-10-28 (was built behind `paid: false`) | progress.md |
| [T27](../../docs/subscriptions/tasks/T27-razorpay-test-run-and-go-live.md) | EP-09 | Test-mode run and go-live | M | Go-live done 2026-10-28; first live ₹1 payments that day. Open: Vercel Pro, the test-run rows not recorded, T30's steps | progress.md |
| [T28](../../docs/subscriptions/tasks/T28-two-sweeps-a-day.md) | EP-10 | 2 sweeps a day | M | Replaced by T32 (2026-10-24); not built | progress.md |
| [T29](../../docs/subscriptions/tasks/T29-usage-by-category.md) | EP-12 | Usage and cost per category | S | Done 2026-10-30 | `89625f7`, `9810a86` |
| [T30](../../docs/subscriptions/tasks/T30-owner-launch-checklist.md) | EP-09 | Owner launch checklist | L | In progress: steps 1, 3, 4, 7, 8 done; 2, 5, 6, 9 to 12 open | progress.md |
| [T31](../../docs/subscriptions/tasks/T31-measure-and-add-tiers.md) | EP-12 | Measure, then decide on tiers | S | To do; after go-live | progress.md |
| [T32](../../docs/subscriptions/tasks/T32-sweeps-per-day.md) | EP-10 | Pro chooses 1 to 5 emails a day | L | Live; slots checked 2026-10-30. The owner's email check at 3 a day is open | #88, #89 |
| [T33](../../docs/subscriptions/tasks/T33-pro-plan-builder.md) | EP-10 | One Pro plan, monthly or yearly | L | Live; simplified 2026-10-26 to one price | #91, #92 |
| [T34](../../docs/subscriptions/tasks/T34-renew-pro.md) | EP-10 | Renewing Pro | M | Live; the `start_at` path still to verify in test mode | #91, #92 |
| [T35](../../docs/subscriptions/tasks/T35-sweep-slots-on-time.md) | EP-10 | Sweep slots on time | S | Done; the 2026-10-26 to 29 runs all in the right slot | #91, #92; progress.md |
| [T36](../../docs/subscriptions/tasks/T36-problem-detail-panel.md) | EP-11 | Problem details panel | M | Live 2026-10-29 | #100 |
| [T37](../../docs/subscriptions/tasks/T37-areas.md) | EP-11 | Areas | M | Live 2026-10-29 | #101 |
| [T38](../../docs/subscriptions/tasks/T38-search-all-sweeps.md) | EP-11 | Search all sweeps | M | Live 2026-10-29 | #102 |
| [T39](../../docs/subscriptions/tasks/T39-saved-problems.md) | EP-11 | Saved problems | M | Live 2026-10-29 | #103 |
| [T40](../../docs/subscriptions/tasks/T40-share-a-problem.md) | EP-11 | Share one problem | M | Live 2026-10-30; the WhatsApp and LinkedIn previews are an owner check | #104 |
| [T41](../../docs/subscriptions/tasks/T41-email-areas.md) | EP-11 | Areas in Pro email | M | Live 2026-10-30 | #105 |
| [T42](../../docs/subscriptions/tasks/T42-india-focus.md) | EP-11 | India focus: India items in each call, India as an area | M | Live 2026-10-30 (#132, `525ea4b`) | `7ae46aa`, `52ef57f` |

## Done in EP-01, before the task list

| What | Evidence |
|---|---|
| The radar built in Claude's app, with a daily Slack digest | July 2026; owner-reported ([README](../../README.md#users-and-iteration)) |
| Public demo replaying the saved sample; claims checked against the repo; offline checks and CI | 2026-10-18 ([decisions.md](../../docs/decisions.md)) |
| Live page on Vercel with a server sweep and guardrails | 2026-10-18, `66f2bf1` |
| Sweep every 5 hours from GitHub Actions; the token-limit fix | `b691d54`, `f200a79` |
| Manual sweeps capped at 3 a UTC day | PR #60 |
| Home page rebuilt as a customer page | 2026-10-22 ([homepage-review.md](../../docs/site/homepage-review.md)) |
