# TS07 · Integration testing

| | |
|---|---|
| Component | Integration testing |
| Who | Claude Code writes and runs the offline part; the owner runs the staging part |
| Status | Partial |
| Depends on | TS05 |
| Size | M |
| Unblocks | TS08, TS11 |

## What it means here

Checking that the parts work together: our handlers with storage, email, payments, Google and the model. There are
two levels:
- **Offline:** our modules together, with fakes only at the edge. This is in place.
- **With the real services** on the `staging` Preview: real Blob, Resend, Razorpay test mode and Google. This is done
  by hand and not written down.

## In place today

**Offline.** The suites run whole handlers, not single functions:
- The sweep: `runDailySweep()` with a fake Anthropic (`fakeFetch`), `memStorage()` and fake Slack and email.
- Subscriber delivery after a sweep, with `fakeResend`.
- `/api/account` checkout, return and cancel with a fake Razorpay, then the webhook handler on the same store.
- `/api/session` sign-in by code, Google and password, and `/api/data` locked or open by plan (T16, T17).

**With real services**, recorded in [progress.md](../../docs/subscriptions/tasks/progress.md) and the T-files:
- Test checkout on `staging`, 2026-10-23, against its own Blob store (`radar-preview`) with Razorpay test mode (T20).
- The signed Razorpay webhook, staging check (T21).
- Go-live in production, 2026-10-28; first live payments the same day (T27).
- The sweep's real calls are logged in Blob and read with [llm-logs.mjs](../../scripts/llm-logs.mjs).
- [check-plan.mjs](../../scripts/check-plan.mjs) checks that Razorpay's plans match `plan.json`.

## Gaps

| Integration | Gap |
|---|---|
| Resend → our webhook | Bounce and complaint events tested offline only; never with a real event |
| Razorpay webhook | Staging check once (T21); not repeated since T22, T33 and T34 changed the handling |
| Google sign-in | No written check that the Preview's redirect URL works |
| Blob | Concurrent writes (two sweeps, or a sweep and a sign-up at once) aren't tested |
| Anthropic | Covered by real sweeps and the model test; no fault cases (timeouts, 529) run for real |
| GitHub Actions → `/api/sweep` | The workflow is checked by its runs, not by a test |

## The work

Run on `staging` with test keys, using TS05's named test inboxes. Record each run in the table at the end of this
file.

| ID | Integration | Steps | Expected |
|---|---|---|---|
| IT-1 | Razorpay checkout → webhook → record | Buy Pro with a test card; watch the webhook in Razorpay's test dashboard | The events delivered with 200, signature valid, Pro on |
| IT-2 | Duplicate webhook | Resend the same event from Razorpay's dashboard | 200, nothing changes |
| IT-3 | Cancel → Razorpay | Cancel on `/manage/` | Razorpay shows the subscription cancelled; Pro runs to its end |
| IT-4 | Renew (T34) | Keep renewing on a test Pro | A new subscription starting at `proUntil`, held as `rzp.next` |
| IT-5 | Resend bounce | Sign up a known bouncing test address (Resend's test addresses) | The record stops getting mail |
| IT-6 | Google on Preview | Continue with Google on the Preview URL | Returns to the Preview, signed in |
| IT-7 | Key safety | Before IT-1, open checkout on staging | Checkout opens, so payments are on and the keys match the environment. The mismatch itself is tested offline (`keyMismatch`, 10 checks in test-subscriptions) |
| IT-8 | Plans | `check-plan.mjs` with the test keys in the shell | Exit 0 |

Offline, add:
1. A test where a sweep and a sign-up write to `memStorage` in the same tick.
2. A sweep where Anthropic answers 529 (overloaded) for one category: that category fails cleanly and the others
   save. Check first whether `test-sweep.mjs` already covers an HTTP error, as against a bad reply.

## Done when

- IT-1 to IT-8 have each run once on `staging`, with a date and result.
- The two offline tests are in `npm test`.
- Any failure has a TS19 bug.

## Tools and cost

- Razorpay test mode, Resend's test addresses, the Preview: free.
- None of IT-1 to IT-8 needs a sweep. A sweep on staging costs about $0.12 (Haiku); **ask before running one.**

## Risks and notes

- Keys go in the shell for one command, never in a file (the rule in `check-plan.mjs`).
- Resend's test addresses are documented by Resend; use those, not invented ones, so no real inbox gets mail.
- Webhooks from Razorpay's test mode only reach a Preview if its URL is set in the test dashboard. Check before IT-1.

## Runs

| Date | ID | Result | Notes |
|---|---|---|---|
| | | | |
