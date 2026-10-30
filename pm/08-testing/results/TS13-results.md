# TS13 results · Smoke testing

| | |
|---|---|
| Task | [TS13](../TS13-smoke-testing.md) |
| Run | 2026-10-30, 09:10 to 09:50 UTC |
| Deploy | Production, built from `d2b9639` (main) |
| Environment | Production, read-only, by curl and the GitHub Actions logs. No browser was connected |
| Run by | Claude Code |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| SM-1 | Open `/` | Pass (loads); console: Needs owner | 200 in 0.28 s. Console errors need a browser |
| SM-2 | Open `/demo/` | Pass (loads); board: Needs owner | 200; the page loads `radar.js` (205,427 bytes raw). The board drawing the sample needs a browser |
| SM-3 | Open `/live/` signed out | Pass (by the API) | 200; the board's data call gives 401 `not_signed_in`, which shows the locked board. Seeing it needs a browser |
| SM-4 | Open `/live/` as the owner's Pro | Needs owner | Needs the owner's sign-in |
| SM-5 | Open `/pricing/` | Pass | 200; shows "₹1 a month or ₹1 a year", the same as `plan.json` |
| SM-6 | `/signup/`, `/signin/`, `/manage/`; `/subscribe/` | Pass | 200, 200, 200; `/subscribe/` gives 307 to `/pricing/` |
| SM-7 | One legal page | Pass | All 4 give 200 with the footer (`npm run check` checks the footer on every page) |
| SM-8 | API-1 and API-2 | Pass | 401 and 401 ([TS11](TS11-results.md)) |
| SM-9 | The last sweep is within the last chosen slot | Pass, late (BUG-008) | From the logs, not the board: the newest sweep saved 30 Oct 02:27 UTC (slot 0); GitHub's slot 0 run at about 05:58 UTC then skipped it as "already swept". Slot 10 hadn't come yet. The sweep is in the right slot but hours after it: see [TS14](TS14-results.md) and BUG-008. The time shown on the board needs SM-4 |
| SM-10 | `travel-problem-radar.vercel.app` | Pass | The root gives 307 to radar.pehchanthetraveller.com; API paths there are not redirected (API-6) |

**Totals:** 9 Pass (SM-9 with BUG-008; SM-1 to SM-3 with a browser part left), 1 Needs owner (SM-4).

## Run log

| Date | Deploy | Result |
|---|---|---|
| 2026-10-30 | Production from `d2b9639` | SM-1 to SM-3 and SM-5 to SM-10 pass by curl and logs; SM-4 and the browser halves left to the owner |

## Bugs found

BUG-008 (sweeps run hours after their slot). See [TS19 results](TS19-results.md).

## Left to do

| What | Who |
|---|---|
| SM-4, and the console and board halves of SM-1 to SM-3, in a browser | Owner |
| `scripts/smoke.mjs` (TS13 step 4, optional, no new packages) | Claude Code, its own PR |
