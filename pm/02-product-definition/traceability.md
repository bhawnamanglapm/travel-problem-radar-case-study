# Requirements traceability

> **Stage 2 of 8.** Each requirement in [prd.md](prd.md), the code that meets it, and the automated test or check
> that proves it. Every test named here runs offline with `npm test` or `npm run check`, also on every push. The
> "Verified by" column names the section heading or comment inside each test file. Updated 2026-10-30: on `main` at
> `e339d32`, 1,582 tests and 249 checks pass, and none fail (first written at `662bded`, 2026-10-23: 952 tests,
> 199 checks).

| Test file | Passing on 2026-10-30 | On 2026-10-23 | Covers |
|---|---|---|---|
| [`scripts/test-sweep.mjs`](../../scripts/test-sweep.mjs) | 249 | 86 | The sweep, slots, the data feed, item history, areas, search, source freshness, LLM logs, Slack and email to the owner |
| [`scripts/test-subscriptions.mjs`](../../scripts/test-subscriptions.mjs) | 1,048 | 771 | Subscribers, accounts, delivery, Razorpay, the Pro plan, saved problems, share pages |
| [`scripts/test-password.mjs`](../../scripts/test-password.mjs) | 56 | — | Passwords |
| [`scripts/test-plan.mjs`](../../scripts/test-plan.mjs) | 73 | 56 | `plan.json` and the pages filled from it |
| [`scripts/test-admin.mjs`](../../scripts/test-admin.mjs) | 49 | — | The `/admin/` dashboard |
| [`scripts/test-cost.mjs`](../../scripts/test-cost.mjs) | 25 | — | Pricing a sweep from the LLM log (`cost-per-run.mjs`) |
| [`scripts/test-score.mjs`](../../scripts/test-score.mjs) | 42 | — | The scoring script (`score-items.mjs`); not a product requirement |
| [`scripts/test-compare.mjs`](../../scripts/test-compare.mjs) | 40 | 39 | The model-comparison script; not a product requirement |
| [`scripts/check.mjs`](../../scripts/check.mjs) | 249 checks | 199 checks | Pages, bundles, links, the prompt copy, brand contrast, skip links, no secrets |

Per-file counts are the `PASS` lines each file printed on 2026-10-30.

## The radar

| Req | Code | Verified by | Status |
|---|---|---|---|
| REQ-01 Four categories, one call each, up to 5 items, plus up to 2 from India | `api/_lib/radar.js` | test-sweep: "the sweep itself", "request sent to Anthropic". check §5: the server prompt matches the component | Live; the India part since 2026-10-30 (REQ-47) |
| REQ-02 Item fields and severity | `normalize()` in `api/_lib/radar.js` | test-sweep: "parser". check §1: sample data shape | Live |
| REQ-03 New flags | `runDailySweep()` | test-sweep: "the sweep itself" | Live |
| REQ-04 Keep 60 sweeps | `runDailySweep()` | test-sweep: "60-sweep cap" | Live |
| REQ-05 Digest with Copy | The dashboard component (Report tab) | Headless browser run on 18 Oct 2026 ([README](../../README.md#how-i-measured-quality)). **Not in CI** | Live |
| REQ-06 Partial and total failure | `runDailySweep()` | test-sweep: "partial and total failure" | Live |
| REQ-07 Demo with no AI calls | `demo/` | check §3. Headless browser run on 18 Oct 2026 | Live |
| REQ-08 Scheduled server sweep, secret, read-only visitors | `api/sweep.js`, `makeSweepHandler()`, `.github/workflows/sweep.yml`, `vercel.json` | test-sweep: "/api/sweep", the 2-hour gap sections, "T32: sweeps a day", "T35: the slot a scheduled run was due for" | Live |
| REQ-09 API key only on the server | `api/_lib/handlers.js` | test-sweep: "/api/sweep". check §6: no secrets in the repository | Live |
| REQ-10 Check-the-source notice | Every page that shows findings | check §4b, §4c3, §4e, §4f and the home page check. The live board's own notice has **no check** | Live |
| REQ-11 Slack digest | `api/_lib/slack.js` (server); Claude's app (the original) | test-sweep: "Slack delivery after the sweep". The Claude-app digest is owner-reported | Live, owner-reported |
| REQ-32 Manual sweeps capped at 3 a day | `makeSweepHandler()` | test-sweep: "manual runs: at most MAX_MANUAL_SWEEPS_PER_DAY a UTC day" | Live |

## Email, accounts and payments

| Req | Code | Verified by | Status |
|---|---|---|---|
| REQ-12 Double opt-in, Confirm button | `makeSubscribeHandler()`, `makeConfirmHandler()` in `api/_lib/subscription-handlers.js` | test-subscriptions: "T05", "T06". check §4b, §4c3 | Live |
| REQ-13 Unsubscribe, one-click | `makeUnsubscribeHandler()` | test-subscriptions: "T07". Gmail's one-click **not checked** in a real inbox | Live |
| REQ-14 Free daily roll-up, teaser | `buildRollup()`, `deliverToSubscribers()` in `api/_lib/subscriber-delivery.js` | test-subscriptions: "T09", "T18" | Live |
| REQ-15 Pro after every scheduled sweep (now by slot, REQ-33) | `deliverToSubscribers()` | test-subscriptions: "T09", "T10", "T32: each Pro member's emails a day" | Live |
| REQ-16 Never fails the sweep's save | `makeSweepHandler()` | test-subscriptions: "T10" | Live |
| REQ-17 No addresses in replies or logs; feed refuses subscriber keys | All handlers; `makeDataHandler()` | test-sweep: "/api/data". test-subscriptions: "T05", "T11" and others | Live |
| REQ-18 One switch; closed when the cap is unset | `makeSubscribeHandler()` | test-subscriptions: "T05" | Live |
| REQ-19 Admin script | `scripts/subscribers.mjs` | test-subscriptions: "T11" | Live |
| REQ-20 Bounces, complaints, per-IP limit | `makeResendWebhookHandler()`; a Vercel Firewall rule | test-subscriptions: "T13 part A", "T13 part B". The firewall rule is configuration, not tested | Live |
| REQ-21 Pro chooses categories | `/manage/`, `proCatsKey()` | test-subscriptions: "T14" | Live |
| REQ-22 One subscription per inbox | `canonicalEmail()` in `api/_lib/subscribers.js` | test-subscriptions: "One inbox, one subscriber", "Already subscribed" | Live |
| REQ-23 Sign-in by link or Google; passwords optional since 2026-10-27 | `makeSessionHandler()`, `api/_lib/session.js`, `api/_lib/google.js`, `api/_lib/password.js` | test-subscriptions: "T16". test-password (all sections). check §4c2 | Live |
| REQ-24 Locked board | `makeDataHandler()` behind `BOARD_PAYWALL` | test-subscriptions: "T17". check §4: the locked-board panels | Live |
| REQ-25 Pro outlives its emails | `api/_lib/subscribers.js` | test-subscriptions: "T17" | Live |
| REQ-26 Checkout and cancel | `api/_lib/razorpay.js`, `makeAccountHandler()` | test-subscriptions: "T19", "T20". check §4c. Test-mode run on staging, 2026-10-23. Live payments since 2026-10-28 (T27) | Live |
| REQ-27 Signed webhook | `makeRazorpayWebhookHandler()`, `applyRzpEvent()` | test-subscriptions: "T21". Staging check, 2026-10-23 | Live |
| REQ-28 Pro expiry, paid unsubscribe, key safety | `PRO_GRACE_HOURS`, `effectivePlan()` in `api/_lib/subscribers.js`; the sweep's tidy step | test-subscriptions: the "T22" comments (the grace; a key in the wrong environment, at checkout and on the webhook) | Built 2026-10-30 (was Planned) |
| REQ-29 `plan.json` is the one source | `plan.json`, `scripts/fill-plan.mjs` | test-plan. check §4e | Live (`paid: true`, ₹1) |
| REQ-30 Footer; policy pages ship only when complete | `legal/`, `scripts/fill-legal.mjs` | check §4d, §4f | Live; terms live 2026-10-29, adviser's check open |
| REQ-31 Summary before checkout | `manage/index.html` | check §4e; test-plan | Live |

## Added since 2026-10-23

| Req | Code | Verified by | Status |
|---|---|---|---|
| REQ-33 Pro chooses 1 to 5 emails a day | `api/_lib/schedule.js`, `makeSweepHandler()`, `deliverToSubscribers()` | test-sweep: "T32: sweeps a day". test-subscriptions: "T32: each Pro member's emails a day". Production slots read from the 2026-10-26 to 29 runs (T32) | Live |
| REQ-34 One Pro plan, monthly or yearly | `makeAccountHandler()` | test-subscriptions: "T33: one Pro plan" | Live |
| REQ-35 Renewing Pro | `makeAccountHandler()` | test-subscriptions: "T34: renewing Pro" | Live; `start_at` not checked in test mode |
| REQ-36 Slots on time | `makeSweepHandler()` | test-sweep: "a scheduled sweep that saves nothing still uses up its slot", "T35" | Live |
| REQ-37 Details panel and history | `trackItems` in `api/_lib/radar.js` and the component | test-sweep: "T36: each item's history". check §5 compares the two copies. Panel checked by hand in headless Chrome, **not in CI** | Live |
| REQ-38 Areas | `AREAS`, `areaOf` | test-sweep: "T37: areaOf". check §5. Filters checked by hand, **not in CI** | Live |
| REQ-39 Search all sweeps | `mergeSearch`, `radar:search` | test-sweep: the two "T38" sections. Board checked by hand, **not in CI** | Live |
| REQ-40 Saved problems | `makeAccountHandler()` | test-subscriptions: "T39: saved problems" | Live |
| REQ-41 Share one problem | `makeDataHandler()` (`?page=item`), the `vercel.json` rewrite | test-subscriptions: "T40: one problem's share page". The WhatsApp and LinkedIn previews **not checked** | Live |
| REQ-42 Areas in Pro email | `deliverToSubscribers()`, `makeAccountHandler()` | test-subscriptions: "T41: areas in the Pro email", with a fingerprint of the earlier emails | Live |
| REQ-43 Admin dashboard | `api/admin.js`, `api/_lib/admin.js` | test-admin (all sections) | Live |
| REQ-44 Delete account cancels Razorpay first | `deleteSubscriber()` | test-subscriptions: "T17: … Delete my account", "delete and Razorpay (2026-10-27)" | Live |
| REQ-45 Sources over 60 days dropped | `api/_lib/radar.js` | test-sweep: "source freshness" | Live |
| REQ-46 Cost per sweep and category | The LLM log, `scripts/cost-per-run.mjs` | test-sweep: the "LLM log" sections. test-cost (all sections) | Live |
| REQ-47 India items and the India area | `buildPrompt` and `scanCategory` (4 searches), `AREAS` and `areaOf` in `api/_lib/radar.js`; `readAreas` in `api/_lib/subscribers.js`; `scripts/llm-logs.mjs areas` | test-sweep: "T37: areaOf" (the T42 cases), "request uses … 4 searches", "the prompt asks for up to 2 India items", "llm-logs areas". test-subscriptions: "readAreas", "set-areas … (T42)", the T42 "pro areas" cases. test-admin: the areas rows. check §5: both copies of the prompt and the areas block; the admin and manage area lists | Built on `feat/india-focus` at `52ef57f` (1,590 tests, 249 checks pass); live 2026-10-30 (#132) |

## Gaps in coverage

- **REQ-05 and REQ-07** depend on headless browser runs from 18 Oct 2026 that aren't in CI.
- **The live board's AI notice** (REQ-10) has no automated check; the other pages' notices do.
- **The board features** (REQ-37 to REQ-39) were checked by hand in headless Chrome when built; those runs aren't in
  CI ([progress.md](../../docs/subscriptions/tasks/progress.md), T36 to T38 notes).
- **The first test run** (2026-10-30) checked requirements against the product and found the drift D1 to D8, now
  reflected in the [PRD](prd.md) ([TS01 results](../08-testing/results/TS01-requirements-validation-results-2026-10-30.md)).
- **What the tests can't cover:** whether a real inbox accepts the email (Outlook.com filed it in Junk), and
  whether the findings are true. Those are measured by KPI-15 and KPI-01 to KPI-05 in [kpis.md](kpis.md). None is
  measured by a person yet; the 2026-10-30 model test's blind review was marked by ChatGPT
  ([model test](../../docs/subscriptions/model-test-2026-10-30.md)).
