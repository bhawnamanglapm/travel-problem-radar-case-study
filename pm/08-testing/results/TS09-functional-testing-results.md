# TS09 results · Functional testing

| | |
|---|---|
| Task | [TS09](../TS09-functional-testing.md) |
| Run | 2026-10-30, 08:50 to 09:30 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (tests, code) and production, read-only |
| Run by | Claude Code, read-only |

"Auto" means the offline suites cover it (all pass, [TS04](TS04-test-cases-results.md)); "Live" names a read-only check on
production this run. "Not tested" means it needs the owner.

## Results

| REQ | Requirement | Result | Evidence |
|---|---|---|---|
| REQ-01 | Four categories, up to 5 items each | Pass | Auto (test-sweep); Live: 29 Oct slot 10 sweep saved 4 categories, 5 items each, total 20 |
| REQ-02 | Item fields and severity | Pass | Auto; Live: `score-items.mjs` read 183 unique items from 10 sweeps, all with the rubric's fields |
| REQ-03 | New flags | Pass | Auto; Live: sweep replies carry `newCount` (19 of 20 on 29 Oct) |
| REQ-04 | Keep 60 sweeps | Pass | Auto: "keeps only the last 60 sweeps" (`test-sweep.mjs:469`) |
| REQ-05 | Digest with Copy | Not tested | Manual only; no written criteria yet (TS02) |
| REQ-06 | Partial and total failure | Pass | Auto; Live: 3 runs on 24 and 25 Oct failed in all 4 categories (Anthropic credit too low), saved nothing and showed as failed |
| REQ-07 | Demo makes no AI calls | Pass (code reading) | `demo/src/main.jsx` passes `sample`; the board replays it (`demo ? replayCategory : scanCategory`). No test asserts it (SC-V-2 gap) |
| REQ-08 | Scheduled sweep, secret | Pass, with BUG-008 | Live: API-2 401 without the secret; 27 of 30 Actions runs succeeded. Sweeps start 155 to 418 minutes after their slot, later than `/manage/` says: BUG-008 |
| REQ-09 | Key only on the server | Pass | History scan: no Anthropic key pattern in any commit ([TS15](TS15-security-testing-results.md)). Both bundles contain the shared component's direct Anthropic call (from the Claude artifact version), but no key, no `x-api-key` header, and neither board reaches it: the demo replays, and the live board hides the sweep button (`{!live && ...}`) |
| REQ-10 | Check-the-source notice | Not tested | Needs the board in a browser |
| REQ-11 | Slack digest | Pass | Live: 29 Oct sweep reply `slack: "sent"` |
| REQ-12 | Double opt-in, Confirm button | Pass | Auto ("confirm GET: a page with a form that POSTs"); Live: 15 subscribed, 15 confirmed in 30 days |
| REQ-13 | Unsubscribe, one-click | Pass (auto); Gmail not tested | Auto: List-Unsubscribe per RFC 8058. Gmail's button needs TC-U-1 |
| REQ-14 | Free daily email | Pass | Auto; Live: "free sent" 2 to 5 a day, 26 to 30 Oct (`stats`) |
| REQ-15 | Pro email after scheduled sweeps | Pass | Live: Pro sent 4 of 5 due, 1 not this slot, failed 0 (29 Oct) |
| REQ-16 | Delivery never slows the save; stops before 300 s | Pass | Auto (deadline checks); Live: the sweep step takes 14 to 16 s |
| REQ-17 | No addresses, tokens or keys in replies or logs | Pass | Auto; Live: 30 Actions logs scanned, 0 email addresses |
| REQ-18 | One switch, a cap | Pass | Auto |
| REQ-19 | Owner admin | Pass (signed out) | Live: `/api/admin` 401 signed out; signed-in view needs the owner |
| REQ-20 | Bounces, complaints, per-IP limit | Pass | Auto; Live: 0 bounced, 0 complained |
| REQ-21 | Pro chooses categories | Pass (auto) | Auto; the email side has no criteria yet (TS02) |
| REQ-22 | One subscription per inbox | Pass | Auto (37 normalising checks) |
| REQ-23 | Sign-in | Pass (auto) | Auto: link, Google, password. Live: `/api/session?action=me` 200 `signedIn:false`, Google on |
| REQ-24 | Locked board | Pass | Live: API-1 401 `not_signed_in` |
| REQ-25 | Pro outlives its emails | Pass (auto) | Auto: "a Pro is kept with emailOff" |
| REQ-26 | Checkout and cancel | Not tested | Needs staging (TC-P-1, TC-P-4) |
| REQ-27 | Signed webhook | Pass | Live: unsigned POST to the Razorpay and Resend webhooks gives 401 |
| REQ-28 | Expiry, paid unsubscribe, key safety | Pass (auto) | Auto: 48-hour grace, key mismatch. No `razorpay: "key mismatch"` in the sweep replies read |
| REQ-29 | `plan.json` is the one source | Pass | Live: `/pricing/` and `/legal/refunds/` show `plan.json`'s price and refund text |
| REQ-30 | Footer; policy pages | Pass | Live: all 4 legal pages 200; footer present |
| REQ-31 | Summary before checkout | Not tested | Needs the checkout in a browser |
| REQ-32 | Manual sweeps capped at 3 a day | Pass (auto) | Auto: "the 4th that day gets 429" |
| NFR | Accessibility: skip link on every page | Fail | 1 of 14 pages: BUG-011 ([TS17](TS17-accessibility-testing-results.md)) |
| NFR | Security headers | Fail | BUG-010 ([TS15](TS15-security-testing-results.md)) |

**Totals:** 32 REQs: 28 Pass (some on offline tests or code reading only), 4 Not tested (REQ-05, 10, 26, 31).
REQ-08 passes with a bug (BUG-008). 2 NFRs fail.

## Bugs found

BUG-008 (REQ-08 timing), BUG-010 (headers), BUG-011 (skip link). See [TS19 results](TS19-bug-reporting-and-retesting-results.md).

## Left to do

| What | Who |
|---|---|
| Run the 4 Not-tested rows in a browser (REQ-26 and 31 on staging) | Owner |
| Update `traceability.md`: REQ-28 built, fresh counts (1,582 checks) | Claude Code |
