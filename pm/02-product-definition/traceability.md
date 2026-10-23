# Requirements traceability

> **Stage 2 of 7.** Each requirement in [prd.md](prd.md), the code that meets it, and the automated test or check
> that proves it. Every test named here runs offline with `npm test` or `npm run check`, also on every push. The
> "Verified by" column names the section heading inside each test file. On `main` at `662bded` (2026-10-23):
> 952 tests and 199 checks pass, and none fail.

| Test file | Passing on 2026-10-23 | Covers |
|---|---|---|
| [`scripts/test-sweep.mjs`](../../scripts/test-sweep.mjs) | 86 | The sweep, the data feed, Slack and email to the owner |
| [`scripts/test-subscriptions.mjs`](../../scripts/test-subscriptions.mjs) | 771 | Subscribers, accounts, delivery, Razorpay |
| [`scripts/test-plan.mjs`](../../scripts/test-plan.mjs) | 56 | `plan.json` and the pages filled from it |
| [`scripts/test-compare.mjs`](../../scripts/test-compare.mjs) | 39 | The model-comparison script (not a product requirement) |
| [`scripts/check.mjs`](../../scripts/check.mjs) | 199 checks | Pages, bundles, links, the prompt copy, no secrets |

## The radar

| Req | Code | Verified by | Status |
|---|---|---|---|
| REQ-01 Four categories, one call each, up to 5 items | `api/_lib/radar.js` | test-sweep: "the sweep itself", "request sent to Anthropic". check §5: the server prompt matches the component | Live |
| REQ-02 Item fields and severity | `normalize()` in `api/_lib/radar.js` | test-sweep: "parser". check §1: sample data shape | Live |
| REQ-03 New flags | `runDailySweep()` | test-sweep: "the sweep itself" | Live |
| REQ-04 Keep 60 sweeps | `runDailySweep()` | test-sweep: "60-sweep cap" | Live |
| REQ-05 Digest with Copy | The dashboard component (Report tab) | Headless browser run on 18 Oct 2026 ([README](../../README.md#how-i-measured-quality)). **Not in CI** | Live |
| REQ-06 Partial and total failure | `runDailySweep()` | test-sweep: "partial and total failure" | Live |
| REQ-07 Demo with no AI calls | `demo/` | check §3. Headless browser run on 18 Oct 2026 | Live |
| REQ-08 Scheduled server sweep, secret, read-only visitors | `api/sweep.js`, `makeSweepHandler()`, `.github/workflows/sweep.yml`, `vercel.json` | test-sweep: "/api/sweep", the 2-hour gap sections | Live |
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
| REQ-15 Pro after every scheduled sweep | `deliverToSubscribers()` | test-subscriptions: "T09", "T10" | Live |
| REQ-16 Never fails the sweep's save | `makeSweepHandler()` | test-subscriptions: "T10" | Live |
| REQ-17 No addresses in replies or logs; feed refuses subscriber keys | All handlers; `makeDataHandler()` | test-sweep: "/api/data". test-subscriptions: "T05", "T11" and others | Live |
| REQ-18 One switch; closed when the cap is unset | `makeSubscribeHandler()` | test-subscriptions: "T05" | Live |
| REQ-19 Admin script | `scripts/subscribers.mjs` | test-subscriptions: "T11" | Live |
| REQ-20 Bounces, complaints, per-IP limit | `makeResendWebhookHandler()`; a Vercel Firewall rule | test-subscriptions: "T13 part A", "T13 part B". The firewall rule is configuration, not tested | Live |
| REQ-21 Pro chooses categories | `/manage/`, `proCatsKey()` | test-subscriptions: "T14" | Live |
| REQ-22 One subscription per inbox | `canonicalEmail()` in `api/_lib/subscribers.js` | test-subscriptions: "One inbox, one subscriber", "Already subscribed" | Live |
| REQ-23 Sign-in with no passwords | `makeSessionHandler()`, `api/_lib/session.js`, `api/_lib/google.js` | test-subscriptions: "T16". check §4c2 | Live |
| REQ-24 Locked board | `makeDataHandler()` behind `BOARD_PAYWALL` | test-subscriptions: "T17". check §4: the locked-board panels | Live |
| REQ-25 Pro outlives its emails | `api/_lib/subscribers.js` | test-subscriptions: "T17" | Live |
| REQ-26 Checkout and cancel | `api/_lib/razorpay.js`, `makeAccountHandler()` | test-subscriptions: "T19", "T20". check §4c. Test-mode run on staging, 2026-10-23 | Built |
| REQ-27 Signed webhook | `makeRazorpayWebhookHandler()`, `applyRzpEvent()` | test-subscriptions: "T21". Staging check, 2026-10-23 | Built |
| REQ-28 Pro expiry, paid unsubscribe, key safety | — | — | Planned (T22) |
| REQ-29 `plan.json` is the one source | `plan.json`, `scripts/fill-plan.mjs` | test-plan. check §4e | Live (`paid: false`) |
| REQ-30 Footer; policy pages ship only when complete | `legal/`, `scripts/fill-legal.mjs` | check §4d, §4f | Live; terms a draft |
| REQ-31 Summary before checkout | `manage/index.html` | check §4e; test-plan | Built behind `paid: false` |

## Gaps in coverage

- **REQ-05 and REQ-07** depend on headless browser runs from 18 Oct 2026 that aren't in CI.
- **The live board's AI notice** (REQ-10) has no automated check; the other pages' notices do.
- **What the tests can't cover:** whether a real inbox accepts the email (Outlook.com filed it in Junk), and
  whether the findings are true. Those are measured by KPI-15 and KPI-01 to KPI-05 in [kpis.md](kpis.md), and none
  is measured yet.
