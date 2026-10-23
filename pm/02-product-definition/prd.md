# Travel Problem Radar PRD, v2

> **Stage 2 of 7.** The product as it stands on 2026-10-23: the radar, plus email digests, accounts, a locked live
> board and payments. It replaces nothing: the [v1 PRD](../../docs/PRD.md) (19 Oct 2026) still describes the
> radar alone, and its requirements R1 to R11 keep their meaning here as `REQ-01` to `REQ-11`. Built and tested items
> link their task. **Targets are OWNER INPUT NEEDED; no goal has been measured.**

## Summary

A feed of travel-industry problems found on the web about 5 times a day, sorted into four categories, each with a
source and a one-line product opportunity. Free members get a daily teaser email. Pro members, at ₹299 a month, get
the live board, its history and the full digest after every sweep.

## What changed since v1

| v1 (19 Oct) | v2 (23 Oct) | Source |
|---|---|---|
| One sweep a day from Vercel's cron | Every 5 hours from GitHub Actions, with Vercel's daily cron as a backstop | [CHANGELOG](../../CHANGELOG.md) |
| Live page open to everyone | Live board for Pro only (`BOARD_PAYWALL` on since 2026-10-23) | [decisions.md](../../docs/decisions.md) |
| Email delivery was a non-goal | Free and Pro email digests, with double opt-in | [tasks](../../docs/subscriptions/tasks/README.md) T01 to T14 |
| No accounts | Accounts with no passwords: an emailed sign-in link or Continue with Google | T16 |
| No price | Pro at ₹299 a month, no GST charged; refund rule set | [decisions.md](../../docs/decisions.md) 2026-10-23 |

## Users

Only users with evidence behind them are listed. Others are hypotheses.

| User | Evidence | Need |
|---|---|---|
| **The owner**, a PM scouting for travel problems | Uses it; reported a Slack digest on 1 Aug 2026 ([README](../../README.md#users-and-iteration)) | A daily view of problems with a product angle |
| **Prospective Free or Pro member**, a travel PM *(hypothesis)* | None. No users recorded besides the owner | To be found in the [interview plan](../01-discovery/discovery-log.md#interview-plan-proposed-not-done) |
| **Visitors to the portfolio** (recruiters, hiring managers) | Named in the v1 PRD | The public demo and this case study |

## Goals

G1 to G5 come from v1. G6 to G9 are new with subscriptions and payments. Each has a measure in [kpis.md](kpis.md).

| # | Goal | KPIs | Status |
|---|---|---|---|
| G1 | Findings are real and sourced | KPI-01, KPI-02 | Not measured |
| G2 | Findings are current | KPI-03 | Not measured |
| G3 | Opportunities are useful | KPI-04 | Not measured |
| G4 | "New" means a new event | KPI-05 | Not measured; known gap |
| G5 | Cost stays flat whatever the traffic | KPI-06, KPI-07 | Built in. $0.21 a sweep, measured over 5 production runs |
| G6 | Sweeps run reliably | KPI-08, KPI-09 | Not measured over a week |
| G7 | People who find it sign up and keep reading | KPI-10 to KPI-14 | Counts are recorded (T11); no target set |
| G8 | Email reaches the inbox | KPI-15 | Gmail inbox; Outlook.com Junk (2026-10-22) |
| G9 | Pro covers its running costs | KPI-16 to KPI-19 | No one has paid. Break-even is 24 to 28 members at ₹299 |

## Plans

| | Visitor | Free account | Pro |
|---|---|---|---|
| Demo with the July 2026 sample | Yes | Yes | Yes |
| Live board, history, Copy report | Sign-in panel | Upgrade panel | Yes |
| Email | No | A daily teaser: counts and headlines for all four categories | The full digest after every saved scheduled sweep |
| Choose categories | No | No | Yes |
| Price | Free | Free | ₹299 a month, no GST charged |

Source: [paid-website.md](../../docs/subscriptions/paid-website.md#who-sees-what), [decisions.md](../../docs/decisions.md).

## Requirements

Status: **Live** (on production), **Built** (merged, switched off or not yet used), **Planned**.

### The radar (v1)

| ID | Requirement | Task or source | Status |
|---|---|---|---|
| REQ-01 | Sweep four categories with one model call with web search each, up to 5 items each | v1 R1 | Live |
| REQ-02 | Each item has title, summary, source, link, region, date, severity (Low, Medium, High) and a one-line opportunity | v1 R2 | Live |
| REQ-03 | Flag items not seen in any earlier sweep as New | v1 R3 | Live |
| REQ-04 | Keep the last 60 sweeps; any past sweep can be opened | v1 R4 | Live |
| REQ-05 | Plain-text digest, new items first, with a Copy button | v1 R5 | Live |
| REQ-06 | One failed category doesn't stop the others; if all fail, save nothing and say so | v1 R6 | Live |
| REQ-07 | The public demo replays a saved sample with no AI or API calls | v1 R7 | Live |
| REQ-08 | A server job sweeps on a schedule (now every 5 hours); visitors only read; the trigger needs a secret | v1 R8, changed | Live |
| REQ-09 | The API key lives only on the server | v1 R9 | Live |
| REQ-10 | Every page that shows AI findings tells the reader to check the source | v1 R10 | Live |
| REQ-11 | Daily Slack digest | v1 R11; the server can also post to Slack | Owner-reported |

### Email, accounts and payments (new)

| ID | Requirement | Task or source | Status |
|---|---|---|---|
| REQ-12 | Sign up by email with double opt-in. The confirm link opens a page with a Confirm button | T05, T06, T08; D9 | Live |
| REQ-13 | Unsubscribe from any email, including one-click | T07 | Live; Gmail's one-click not yet checked |
| REQ-14 | Free gets one email a day, after the first saved sweep of the UTC day: a roll-up of the last 24 hours, shown as a teaser while the board is locked | T09, T18; D2, D3 | Live |
| REQ-15 | Pro gets an email after every saved scheduled sweep, not after manual runs | T09, T10; D4, D5 | Live |
| REQ-16 | Subscriber work never fails or slows the sweep's save, and stops before the 300-second limit | T10 | Live |
| REQ-17 | No addresses, tokens or keys in any reply or log line; the data feed refuses subscriber keys | Rules 1 and 6 of the [tasks](../../docs/subscriptions/tasks/README.md#rules-every-task-follows) | Live |
| REQ-18 | One switch, `SUBSCRIPTIONS_ENABLED`, starts and stops sign-up and delivery; `MAX_SUBSCRIBERS` unset means closed | T05 | Live (cap 5,000) |
| REQ-19 | The owner can see counts, grant or revoke Pro, and delete a member from an admin script, with addresses shown only on request | T11 | Live |
| REQ-20 | Bounces and spam complaints stop mail; sign-ups are rate-limited per IP | T13 | Live |
| REQ-21 | Pro members choose their categories | T14 | Live; the email side not yet checked |
| REQ-22 | One subscription per inbox, whatever the spelling of the address | PR #19 | Live |
| REQ-23 | Accounts with no passwords: an emailed sign-in link or Continue with Google. A sign-in lasts until the browser closes, 12 hours at most | T16 | Live: sign-up checked in production, the sign-in link not yet. Continue with Google shows only once its keys are set |
| REQ-24 | The live board is locked for everyone but Pro, enforced by the data feed | T17 | Live |
| REQ-25 | A Pro account outlives its emails: unsubscribing doesn't remove Pro | T17 | Live |
| REQ-26 | Pro can be bought and cancelled on `/manage/` through a Razorpay subscription | T19, T20 | Built; test mode passed on staging |
| REQ-27 | A signed Razorpay webhook turns Pro on and off; duplicate events change nothing | T21 | Built; staging check passed |
| REQ-28 | Pro expires when payment stops; paid members can unsubscribe safely; keys are checked | T22 | Planned |
| REQ-29 | Price, GST and refund rule live in one file, `plan.json`, and every page is filled from it | T24 | Live (`paid: false`) |
| REQ-30 | Every shipped page has the same footer; a policy page ships only when its gaps are filled | T25 | Live; terms still a draft |
| REQ-31 | Before checkout, a summary shows the price, GST, renewal, cancelling and the refund rule | T26 | Built behind `paid: false` |
| REQ-32 | Manual sweeps are capped at 3 a UTC day | PR #60 | Live |

## Non-functional requirements

| Area | Requirement | Source |
|---|---|---|
| Cost | No user action can trigger an AI call | [costing.md](../../docs/subscriptions/costing.md#summary) |
| Privacy | Subscriber data never appears in public logs; the privacy policy is published | REQ-17; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| Security | Sign-in codes are random, stored hashed, expire in 15 minutes and work once | [paid-website.md](../../docs/subscriptions/paid-website.md#guardrails) |
| Reliability | Every change passes the offline tests and checks, also run on every push | [README](../../README.md#how-i-measured-quality) |
| Accessibility | Skip link, visible focus, small text at WCAG AA contrast, labelled dialog | [homepage-review.md](../../docs/site/homepage-review.md) |
| Dependencies | No new npm packages without the owner's agreement | [tasks README](../../docs/subscriptions/tasks/README.md#rules-every-task-follows) |

## Non-goals

- Checking that findings are true. The radar points to sources, and the reader checks them.
- Letting visitors trigger a sweep.
- Passwords.
- Credits or pay-per-run pricing. Users don't cause the AI cost ([costing.md](../../docs/subscriptions/costing.md#pricing-options-compared)).
- A yearly plan, for now. It comes later, only if paying up front matters.

## Open questions

1. Is the radar for one PM or a team? This decides the channel and the price. (From v1; still open.)
2. What makes an opportunity useful: a named user, a buildable feature, a market size? (From v1; still open.)
3. Should New track events rather than headlines? (From v1; still open.)
4. What numbers would show demand? The Phase 2 gate was skipped without thresholds ([decisions.md](../../docs/decisions.md), 2026-10-22).
5. **OWNER INPUT NEEDED:** targets for each KPI in [kpis.md](kpis.md).
