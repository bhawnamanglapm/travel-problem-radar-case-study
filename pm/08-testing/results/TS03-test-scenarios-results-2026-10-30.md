# TS03 results · Test scenarios

| | |
|---|---|
| Task | [TS03](../TS03-test-scenarios.md) |
| Run | 2026-10-30, about 09:10 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (the repo), plus production read-only where noted |
| Run by | Claude Code, read-only |

## How it was marked

Each of the 55 scenarios was matched against the 1,458 `check()` labels in `scripts/test-*.mjs` with a keyword search
(a scratchpad script, not in the repo), then the matches were read to confirm they test the scenario. "Covered
(auto)" names the suite and an example check label. "Manual" names the TS04 case. "Gap" means no test and no case.
A keyword match is a lead, not proof: the owner's review (TS03 "Done when") still applies.

## Results

| ID | Covered (auto), Manual or Gap | Evidence |
|---|---|---|
| SC-V-1 | Manual | Needs a browser; TS13 SM-1 and SM-2 cover it by status code only |
| SC-V-2 | Gap | Code reading: the demo replays the sample (`demo ? replayCategory(...) : scanCategory(...)`, `travel-problem-radar.jsx`), but the bundle still contains the Anthropic call path and no check asserts the demo never takes it |
| SC-V-3 | Covered (auto) | test-subscriptions: board switch 401 signed out, 402 Free |
| SC-V-4 | Covered (auto) | test-subscriptions, 18 checks, e.g. "item page: signed out shows the headline…". Also live: API-5 in [TS11](TS11-api-testing-results-2026-10-30.md) |
| SC-V-5 | Manual | Needs a phone or device mode ([TS18](TS18-cross-browser-and-device-testing-results-2026-10-30.md)) |
| SC-F-1 | Covered (auto) and Manual | test-subscriptions "confirm GET: a page with a form that POSTs the id and token"; TC-F-1 for the inbox |
| SC-F-2 | Covered (auto) | test-subscriptions "delivery: 2 Pro + 3 Free, first sweep of the day: 5 emails" |
| SC-F-3 | Covered (auto) | test-subscriptions, e.g. "normaliseEmail trims and lowercases" |
| SC-F-4 | Covered (auto) | test-subscriptions "MAX_SUBSCRIBERS unset is not set up: 503" |
| SC-F-5 | Covered (auto) | test-subscriptions, pending TTL and repeat-confirm checks |
| SC-F-6 | Covered (auto) | test-subscriptions per-IP checks |
| SC-F-7 | Covered (auto) and Manual | test-subscriptions "confirm GET: a page with a form" (GET doesn't confirm); TC-F-2 for a real scanner |
| SC-F-8 | Manual | TC-F-3 (bug note 4) |
| SC-U-1 | Covered (auto) | test-subscriptions, 10 checks on the footer link and the unsubscribe page |
| SC-U-2 | Covered (auto) and Manual | test-subscriptions "List-Unsubscribe headers per RFC 8058"; TC-U-1 in Gmail |
| SC-U-3 | Covered (auto) and Manual | test-subscriptions "unsubscribe POST: a Pro is kept with emailOff"; TC-U-2 |
| SC-U-4 | Covered (auto) | test-subscriptions "unsubscribe: wrong token, missing token, unknown id: 200 'no longer active'" |
| SC-U-5 | Covered (auto) | test-subscriptions, 13 bounce and complaint checks |
| SC-S-1 | Covered (auto) | test-subscriptions, sign-in link checks |
| SC-S-2 | Covered (auto) and Manual | test-subscriptions, Google checks; TC-S-1 for the real Google screen |
| SC-S-3 | Covered (auto) | test-password, 56 checks |
| SC-S-4 | Covered (auto) | test-password and test-subscriptions, wrong and expired codes, 429 |
| SC-S-5 | Covered (auto) and Manual | test-subscriptions "cookie: refused after SESSION_HOURS hours"; TC-S-2 for closing the browser |
| SC-S-6 | Manual | TC-S-3 (bug note 5) |
| SC-S-7 | Covered (auto) | test-subscriptions and test-admin sign-out checks |
| SC-S-8 | Covered (auto) | test-subscriptions "a deleted account is 401 at once" |
| SC-P-1 | Covered (auto) and Manual | test-subscriptions checkout and webhook checks; TC-P-1 with a test card |
| SC-P-2 | Covered (auto) and Manual | test-subscriptions and test-sweep category, area and slot checks; TC-P-5 |
| SC-P-3 | Gap | Search, save and share run in the React board, which has no tests (TS06 gap); the share page itself is covered (SC-V-4) |
| SC-P-4 | Covered (auto) and Manual | test-subscriptions cancel checks; TC-P-4 |
| SC-P-5 | Covered (auto) | test-subscriptions renew checks (T34) |
| SC-P-6 | Covered (auto) | test-subscriptions grace checks (T22) |
| SC-P-7 | Covered (auto) and Manual | test-subscriptions "checkout: the failure is logged as a status code only"; TC-P-3 |
| SC-P-8 | Gap | No check found for the return arriving before the webhook; the `/manage/` wait is in the page script |
| SC-P-9 | Covered (auto) | test-subscriptions signature and duplicate checks; live: unsigned POST gives 401 ([TS11](TS11-api-testing-results-2026-10-30.md)) |
| SC-P-10 | Manual | TC-P-2 (bug note 1) |
| SC-P-11 | Manual | Bug note 2; needs `subscribers.mjs show --check` on the accounts the owner names |
| SC-P-12 | Covered (auto) | test-subscriptions and test-admin "a test key on Production is named and turns payments off" |
| SC-A-1 | Covered (auto) and Manual | test-admin, 10 checks; TC-A-1 |
| SC-A-2 | Covered (auto) | test-subscriptions grant, revoke and delete checks |
| SC-A-3 | Covered (auto) | test-admin "after ADMIN_MAX_FAILS_PER_HOUR wrong tries the IP is refused" |
| SC-A-4 | Covered (auto) | test-admin "503 without ADMIN_USER and ADMIN_PASSWORD" |
| SC-A-5 | Manual | Bug note 3; counts only from `subscribers.mjs stats` ([TS05](TS05-test-data-results-2026-10-30.md)) |
| SC-W-1 | Covered (auto) | test-sweep and test-subscriptions, e.g. "a saved scheduled sweep still answers 200 saved"; live: 5 saved runs in Actions |
| SC-W-2 | Covered (auto) | test-sweep "partial and total failure" section, "failures are reported per category" |
| SC-W-3 | Covered (auto) | test-sweep "all four failed: nothing saved but the start time and the LLM log" |
| SC-W-4 | Covered (auto) | test-sweep; live: API-2 gives 401 |
| SC-W-5 | Covered (auto) | test-sweep "manual: the 4th that day gets 429" |
| SC-W-6 | Covered (auto) | test-sweep slot checks; live: 15 "not needed" skips in 22 Actions runs |
| SC-W-7 | Covered (auto) | test-subscriptions "deadline reached after the Pro chunk: Free all deferred" |
| SC-W-8 | Covered (auto) | test-sweep "keeps only the last 60 sweeps" (line 469) |
| SC-L-1 | Covered (auto) | `check.mjs` footer rule ("aria-label=Site" on every page); live: 13 pages 200 |
| SC-L-2 | Covered (auto) | test-plan, 15 checks; live `/pricing/` matches `plan.json` |
| SC-L-3 | Manual | Live: `/subscribe/` 307 to `/pricing/` (BUG-007 retest). The "one job each" half is the owner's judgment |
| SC-L-4 | Manual | Mechanical check found nothing ([TS10](TS10-ui-ux-testing-results-2026-10-30.md)); a person still reads it |

**Totals:** Covered (auto) only 32, Covered (auto) and Manual 11, Manual only 9, Gap 3 (55 in all). The 3 gaps: SC-V-2, SC-P-3,
SC-P-8.

## Bugs found

None. The three gaps are missing tests, listed for TS06.

## Left to do

| What | Who |
|---|---|
| Review this marking (TS03 "Done when") | Owner |
| Order the 3 gaps by risk and add tests: a `check.mjs` rule that the demo entry passes `sample` (SC-V-2); board tests (SC-P-3, TS06); a return-before-webhook test (SC-P-8) | Claude Code |
