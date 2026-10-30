# Travel Problem Radar PRD, v2

> **Stage 2 of 8.** The product as it stands on 2026-10-30 (first written 2026-10-23): the radar, plus email
> digests, accounts, a locked live board with its board features, and live payments. It replaces nothing: the
> [v1 PRD](../../docs/PRD.md) (19 Oct 2026) still describes the radar alone, and its requirements R1 to R11 keep
> their meaning here as `REQ-01` to `REQ-11`. Built and tested items link their task. The 2026-10-30 update closes
> the drift D1 to D8 that the first test run found
> ([TS01 results](../08-testing/results/TS01-requirements-validation-results-2026-10-30.md)); the owner hasn't yet
> confirmed each change. REQ-47 (India, T42) was added later on 2026-10-30 and is live. **Targets are OWNER INPUT NEEDED; no goal has been measured against a target.**

## Summary

A feed of travel-industry problems found on the web 1 to 5 times a day, sorted into four categories, each with a
source and a one-line product opportunity. Free members get a daily teaser email. Pro members, at ₹1 a month or ₹1 a
year for now, get the live board (details and history for each problem, areas, search across every saved sweep,
saved problems, a share link) and 1 to 5 digests a day for the categories and areas they choose.

## What changed since v1

| v1 (19 Oct) | v2 (23 Oct) | Now (30 Oct) | Source |
|---|---|---|---|
| One sweep a day from Vercel's cron | Every 5 hours from GitHub Actions, with Vercel's daily cron as a backstop | Up to 5 fixed UTC slots (00, 05, 10, 15, 20), as many as the Pro member with the highest choice needs; 1 with no Pro. Vercel's backstop at 00:05 UTC | T32, T35; [`sweep.yml`](../../.github/workflows/sweep.yml), [`vercel.json`](../../vercel.json) |
| Live page open to everyone | Live board for Pro only (`BOARD_PAYWALL` on since 2026-10-23) | Same, plus a details panel, areas, search across all sweeps, saved problems and a share page | T36 to T40 |
| Email delivery was a non-goal | Free and Pro email digests, with double opt-in | Pro chooses 1 to 5 emails a day, and areas as well as categories | T32, T41 |
| No accounts | Accounts with no passwords: an emailed sign-in link or Continue with Google | Passwords are optional beside the link and Google (2026-10-27) | T16; [CHANGELOG](../../CHANGELOG.md) 2026-10-27 |
| No price | Pro at ₹299 a month, no GST charged; refund rule set | One Pro price, monthly or yearly: ₹1 each, the owner's real price for now (2026-10-29). Razorpay live since 2026-10-28 | [decisions.md](../../docs/decisions.md) 2026-10-23, 2026-10-26, 2026-10-29; T27 |
| — | Site at travel-problem-radar.vercel.app | radar.pehchanthetraveller.com; the old address redirects (2026-10-28) | [CHANGELOG](../../CHANGELOG.md) 2026-10-28 |
| — | Model `claude-sonnet-5-5` | `claude-haiku-5-5` by default since 2026-10-25 (`api/_lib/handlers.js`, commit `533ab15`); the 2026-10-30 model test kept it | [haiku-test.md](../../docs/subscriptions/haiku-test.md), [model test](../../docs/subscriptions/model-test-2026-10-30.md) |

## Users

Only users with evidence behind them are listed. Others are hypotheses.

| User | Evidence | Need |
|---|---|---|
| **The owner**, a PM scouting for travel problems | Uses it; reported a Slack digest on 1 Aug 2026 ([README](../../README.md#users-and-iteration)) | A daily view of problems with a product angle |
| **Prospective Free or Pro member**, a travel PM *(hypothesis)* | None. No users recorded besides the owner | To be found in the [interview plan](../01-discovery/discovery-log.md#interview-plan-proposed-not-done) |
| **A PM at an Indian travel company** *(hypothesis, T42)* | None. The owner chose them as the first segment to test on 2026-10-30 | India items beside worldwide ones (DSC-09) |
| **Visitors to the portfolio** (recruiters, hiring managers) | Named in the v1 PRD | The public demo and this case study |

## Goals

G1 to G5 come from v1. G6 to G9 are new with subscriptions and payments. Each has a measure in [kpis.md](kpis.md).

| # | Goal | KPIs | Status |
|---|---|---|---|
| G1 | Findings are real and sourced | KPI-01, KPI-02 | Not measured |
| G2 | Findings are current | KPI-03 | Not measured |
| G3 | Opportunities are useful | KPI-04 | Not measured |
| G4 | "New" means a new event | KPI-05 | Not measured; known gap |
| G5 | Cost stays flat whatever the traffic | KPI-06, KPI-07 | Built in. Was $0.21 a sweep on Sonnet (5 production runs); now $0.1121 on average over 10 Haiku sweeps, 26 to 30 Oct (`node scripts/llm-logs.mjs models`) |
| G6 | Sweeps run reliably | KPI-08, KPI-09 | Sweeps resumed 2026-10-25 (I-01 closed). 2026-10-26 to 29: every slot swept or skipped as designed, but GitHub started runs 228 to 418 minutes late (T35). No target set |
| G7 | People who find it sign up and keep reading | KPI-10 to KPI-14 | Counts are recorded (T11, `/admin/`); no target set |
| G8 | Email reaches the inbox | KPI-15 | Gmail inbox; Outlook.com Junk (2026-10-22) |
| G9 | Pro covers its running costs | KPI-16 to KPI-19 | Was: no one had paid, break-even 24 to 28 members at ₹299. Now: 3 live ₹1 payments by 2026-10-29 (T27). At ₹1 no number of members covers the running cost |

## Plans

| | Visitor | Free account | Pro |
|---|---|---|---|
| Demo with the July 2026 sample | Yes | Yes | Yes |
| Live board, history, Copy report | Sign-in panel | Upgrade panel | Yes |
| Details panel, areas, search all sweeps, saved problems on the live board | On the demo's sample only | On the demo's sample only | Yes |
| Share page for one problem (`/p/`) | Opens from a link | Opens from a link | Opens, and Share on the board makes the link |
| Email | No | A daily teaser: counts and headlines for all four categories | 1 to 5 digests a day, as chosen (2 by default) |
| Choose categories and areas | No | No | Yes |
| Price | Free | Free | ₹1 a month or ₹1 a year, no GST charged (was ₹299 a month until 2026-10-25) |

Source: [paid-website.md](../../docs/subscriptions/paid-website.md#who-sees-what), [decisions.md](../../docs/decisions.md),
[`plan.json`](../../plan.json), T32, T36 to T41.

## Requirements

Status: **Live** (on production), **Built** (merged, switched off or not yet used), **Planned**.

### The radar (v1)

| ID | Requirement | Task or source | Status |
|---|---|---|---|
| REQ-01 | Sweep four categories with one model call with web search each, up to 5 items each, plus up to 2 about India where real ones exist (T42) | v1 R1, changed; T42 | Live; the India part since 2026-10-30 |
| REQ-02 | Each item has title, summary, source, link, region, date, severity (Low, Medium, High) and a one-line opportunity | v1 R2 | Live |
| REQ-03 | Flag items not seen in any earlier sweep as New | v1 R3 | Live |
| REQ-04 | Keep the last 60 sweeps; any past sweep can be opened | v1 R4 | Live |
| REQ-05 | Plain-text digest, new items first, with a Copy button | v1 R5 | Live |
| REQ-06 | One failed category doesn't stop the others; if all fail, save nothing and say so | v1 R6 | Live |
| REQ-07 | The public demo replays a saved sample with no AI or API calls | v1 R7 | Live |
| REQ-08 | A server job sweeps on a schedule; visitors only read; the trigger needs a secret. Was every 5 hours; now up to 5 fixed UTC slots a day (00, 05, 10, 15, 20), as many as the highest Pro choice needs, 1 with no Pro; Vercel's backstop at 00:05 UTC (2026-10-30, D1) | v1 R8, changed; T32, T35, BUG-008 | Live |
| REQ-09 | The API key lives only on the server | v1 R9 | Live |
| REQ-10 | Every page that shows AI findings tells the reader to check the source | v1 R10 | Live |
| REQ-11 | Daily Slack digest | v1 R11; the server can also post to Slack | Owner-reported |

### Email, accounts and payments (new)

| ID | Requirement | Task or source | Status |
|---|---|---|---|
| REQ-12 | Sign up by email with double opt-in. The confirm link opens a page with a Confirm button | T05, T06, T08; D9 | Live |
| REQ-13 | Unsubscribe from any email, including one-click | T07 | Live; Gmail's one-click not yet checked |
| REQ-14 | Free gets one email a day, after the first saved sweep of the UTC day: a roll-up of the last 24 hours, shown as a teaser while the board is locked | T09, T18; D2, D3 | Live |
| REQ-15 | Pro gets an email after every saved scheduled sweep, not after manual runs. Changed by REQ-33: each email rolls up the sweeps since that member's previous slot | T09, T10; D4, D5; T32 | Live |
| REQ-16 | Subscriber work never fails or slows the sweep's save, and stops before the 300-second limit | T10 | Live |
| REQ-17 | No addresses, tokens or keys in any reply or log line; the data feed refuses subscriber keys | Rules 1 and 6 of the [tasks](../../docs/subscriptions/tasks/README.md#rules-every-task-follows) | Live |
| REQ-18 | One switch, `SUBSCRIPTIONS_ENABLED`, starts and stops sign-up and delivery; `MAX_SUBSCRIBERS` unset means sign-up isn't open (it answers "not open yet") | T05 | Live (cap 5,000) |
| REQ-19 | The owner can see counts, grant or revoke Pro, and delete a member from an admin script, with addresses shown only on request | T11 | Live |
| REQ-20 | Bounces and spam complaints stop mail; sign-ups are rate-limited per IP | T13 | Live |
| REQ-21 | Pro members choose their categories | T14 | Live; the email side not yet checked |
| REQ-22 | One subscription per inbox, whatever the spelling of the address | PR #19 | Live |
| REQ-23 | Sign in with an emailed link or Continue with Google. A sign-in lasts until the browser closes, 12 hours at most. Was "no passwords"; since 2026-10-27 a password is optional, set from the sign-up confirmation link or the manage page, scrypt-hashed and rate-limited (D2) | T16; [CHANGELOG](../../CHANGELOG.md) 2026-10-27 | Live |
| REQ-24 | The live board is locked for everyone but Pro, enforced by the data feed | T17 | Live |
| REQ-25 | A Pro account outlives its emails: unsubscribing doesn't remove Pro | T17 | Live |
| REQ-26 | Pro can be bought and cancelled on `/manage/` through a Razorpay subscription | T19, T20 | Live: Razorpay live mode since 2026-10-28, first live payments that day (was: test mode passed on staging; D3) |
| REQ-27 | A signed Razorpay webhook turns Pro on and off; duplicate events change nothing | T21 | Live since 2026-10-28 (was: staging check passed) |
| REQ-28 | Pro expires when payment stops; paid members can unsubscribe safely; keys are checked | T22 | Built 2026-10-30: a 48-hour grace for a renewal (`PRO_GRACE_HOURS`), the sweep's tidy step, a test or live key on the wrong deployment turns payments off (was Planned; D4) |
| REQ-29 | Price, GST and refund rule live in one file, `plan.json`, and every page is filled from it | T24 | Live: `paid: true` since 2026-10-26, ₹1 a month and ₹1 a year (was `paid: false`; D5) |
| REQ-30 | Every shipped page has the same footer; a policy page ships only when its gaps are filled | T25 | Live: all four policy pages, terms since 2026-10-29 with the owner's plain liability clause; an adviser's check of the clause is open |
| REQ-31 | Before checkout, a summary shows the price, GST, renewal, cancelling and the refund rule | T26 | Live since 2026-10-28 (was built behind `paid: false`) |
| REQ-32 | Manual sweeps are capped at 3 a UTC day | PR #60 | Live |

### Added since 2026-10-23

These were built after v2 was first written (D7 of the TS01 results). Each is live unless it says otherwise.

| ID | Requirement | Task or source | Status |
|---|---|---|---|
| REQ-33 | Each Pro member chooses 1 to 5 emails a day (2 by default); the site sweeps only as often as the highest choice needs, and an unneeded slot is skipped before any AI call | T32 (replaces T28) | Live; the owner's email check at 3 a day is open |
| REQ-34 | One Pro plan, monthly or yearly, with categories and emails a day chosen freely, priced and paid together | T33 | Live |
| REQ-35 | A member can keep renewing or renew Pro with the last plan, and is warned 7 days before a plan that won't renew ends | T34 | Live; the `start_at` path still to verify in test mode |
| REQ-36 | A late scheduled run is counted in the slot it was meant for, not the slot it started in | T35 | Live; checked on the 2026-10-26 to 29 runs |
| REQ-37 | A details panel shows each problem's history across sweeps, with a link to it | T36 | Live |
| REQ-38 | Problems are filtered by area as well as category | T37 | Live |
| REQ-39 | Search runs across every saved sweep, not only the one open | T38 | Live |
| REQ-40 | Pro members save problems; the saved copy is taken from the sweep file, never from the request | T39 | Live |
| REQ-41 | One problem can be shared as a public page, `/p/<sweep>/<item>`, with a preview image | T40 | Live; the WhatsApp and LinkedIn previews are an owner check |
| REQ-42 | Pro emails can be limited to chosen areas; "all areas" sends exactly the earlier email | T41 | Live; no member has chosen areas yet |
| REQ-43 | The owner's dashboard, `/admin/`, behind its own user and password, shows members, plans and payment mode | [CHANGELOG](../../CHANGELOG.md) 2026-10-26 | Live |
| REQ-44 | Delete my account deletes at once, and cancels the account's Razorpay subscriptions first | [CHANGELOG](../../CHANGELOG.md) 2026-10-27 | Live |
| REQ-45 | An item whose source is over 60 days old is dropped; each item keeps `sourceDate`, the date search gave its page | [CHANGELOG](../../CHANGELOG.md) 2026-10-30 | Live |
| REQ-46 | Each sweep's model use and cost are logged privately, per category, and can be summarised by model | T29; `scripts/llm-logs.mjs`, `scripts/cost-per-run.mjs` | Live |
| REQ-47 | Each category call also asks for up to 2 items about India, only where real, recent ones exist, with region "India", and may run 4 searches. India is its own area on the board, in `/manage/` and in Pro email; an Asia choice saved before then includes India. India's share of items can be read from the logs (KPI-20) | [T42](../../docs/subscriptions/tasks/T42-india-focus.md) | Live 2026-10-30 (#132, `525ea4b`) |
| REQ-48 | Pro members can ask the board a question. The answer is built by AI only from items the radar saved, each claim citing one; a citation to an item not sent is never shown, and links come from the store. Off unless `ASK_ENABLED=1`; `ASK_PER_DAY` questions a day (default 20); the question is not stored. Pro members can mark items Useful or Not useful, and `scripts/item-votes.mjs` gives the share useful (KPI-21) | [T43](../../docs/subscriptions/tasks/T43-ask-the-board.md) | Merged 2026-10-31 (#136, `41f1e09`): votes live; Ask off until `ASK_ENABLED=1` |

## Non-functional requirements

| Area | Requirement | Source |
|---|---|---|
| Cost | No user action can trigger an AI call | [costing.md](../../docs/subscriptions/costing.md#summary) |
| Privacy | Subscriber data never appears in public logs; the privacy policy is published | REQ-17; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| Security | Sign-in codes are random, stored hashed, expire in 15 minutes and work once | [paid-website.md](../../docs/subscriptions/paid-website.md#guardrails) |
| Security | Every page is sent with security headers (`nosniff`, no framing, `Referrer-Policy`) and a Content-Security-Policy in report-only mode, to enforce once the owner's console check is clean | BUG-010; [CHANGELOG](../../CHANGELOG.md) 2026-10-30 |
| Reliability | Every change passes the offline tests and checks, also run on every push | [README](../../README.md#how-i-measured-quality) |
| Accessibility | Skip link on every page (since 2026-10-30; was the home page only), visible focus, small text at WCAG AA contrast, labelled dialog | [homepage-review.md](../../docs/site/homepage-review.md); BUG-011 |
| Dependencies | No new npm packages without the owner's agreement | [tasks README](../../docs/subscriptions/tasks/README.md#rules-every-task-follows) |

## Non-goals

- Checking that findings are true. The radar points to sources, and the reader checks them.
- Letting visitors trigger a sweep.
- Credits or pay-per-run pricing. Users don't cause the AI cost ([costing.md](../../docs/subscriptions/costing.md#pricing-options-compared)).

Two non-goals of 2026-10-23 were later reversed by the owner: **passwords** (optional since 2026-10-27, REQ-23) and
**a yearly plan** (one price, monthly or yearly, since 2026-10-26, REQ-34).

## Open questions

1. Is the radar for one PM or a team? This decides the channel and the price. (From v1; still open.)
2. What makes an opportunity useful: a named user, a buildable feature, a market size? (From v1; still open.)
3. Should New track events rather than headlines? (From v1; still open.)
4. What numbers would show demand? The Phase 2 gate was skipped without thresholds ([decisions.md](../../docs/decisions.md), 2026-10-22).
5. **OWNER INPUT NEEDED:** targets for each KPI in [kpis.md](kpis.md).
6. **OWNER INPUT NEEDED:** the target price. ₹1 is the real price for now (2026-10-29); the break-even analysis
   still uses ₹299 ([business case](../05-business-case-and-launch/business-case.md)).
7. **OWNER INPUT NEEDED:** confirm the D1 to D8 updates above, as TS01 asks (change the PRD, change the product,
   or drop the requirement).
