# TS14 results · Performance testing

| | |
|---|---|
| Task | [TS14](../TS14-performance-testing.md) |
| Run | 2026-10-30, 09:15 to 09:50 UTC |
| Commit | `d2b9639` (main), deployed to production |
| Environment | Production, read-only: curl, `llm-logs.mjs list --days 7`, GitHub Actions run logs, Google PageSpeed API |
| Run by | Claude Code |

The targets in TS14 step 1 are proposals the owner hasn't approved yet; results are measured against them anyway.

## Results

| ID | Measure | Proposed target | Result | Evidence |
|---|---|---|---|---|
| PF-1 | Scheduled sweep, slowest in 7 days | Under 120 s | Pass | The sweep step in the 5 saved Actions runs took 14 to 16 s; the whole job 20 to 23 s. Skipped runs take 7 to 9 s (the step itself 1 s) |
| PF-2 | Sweep cost, 7 days | No target | Recorded | 10 sweeps, $0.0921 to $0.1254 each, median about $0.114, total about $1.12 (`llm-logs.mjs list --days 7`) |
| PF-3 | Sweep starts on time | No target in TS14; `/manage/` promises "about 05:47 and 15:47 IST" | Fail: BUG-008 | 22 sweeps in the logs record `lateMinutes`: 155 to 418 minutes late, median 337. Slot 0 sweeps saved at about 02:27 UTC (07:57 IST) each day; slot 10 sweeps at 15:55 to 16:58 UTC (21:25 to 22:28 IST). What starts the 02:27 sweep isn't confirmed; GitHub's slot 0 run at about 05:58 UTC finds it "already swept". T35 in `progress.md` already notes 228 to 418 minutes |
| PF-4 | Delivery to 5,000 subscribers, timed (offline) | Under 240 s | Not run | The test in TS14 step 3 isn't written; it needs Resend's documented rate limit |
| PF-5 | Lighthouse mobile on `/`, `/demo/`, `/live/`, `/pricing/` | `/` 90 or more; `/live/` LCP under 2.5 s | Blocked | The PageSpeed API answered 429 to every call: the shared daily quota for calls without an API key was used up. Run it at pagespeed.web.dev, or in Chrome DevTools for `/live/` as Pro |
| PF-6 | Board bundles | No growth over 10% without a reason | Pass (baseline) | The same raw sizes as on `c848b94`. Sizes below |
| PF-7 | `/api/data` time over 10 board loads as Pro | No target | Needs owner | Needs a Pro session in DevTools |
| PF-8 | Page response time | No target | Recorded | 14 pages: 0.25 to 0.40 s warm; 0.49 to 1.76 s on the first run of the day, `/live/` slowest |

### Bundle and page sizes (production, by curl)

| File | Brotli | gzip | Raw |
|---|---|---|---|
| `/demo/radar.js` | 67,922 B | 65,854 B | 205,427 B |
| `/live/radar-live.js` | 66,531 B | 64,450 B | 202,161 B |
| `/` (HTML) | 10,807 B | 10,185 B | 33,686 B |

**Totals:** 2 Pass (PF-1, PF-6), 2 recorded (PF-2, PF-8), 1 Fail (PF-3, BUG-008), 1 Blocked (PF-5), 1 Not run (PF-4),
1 Needs owner (PF-7).

## Bugs found

BUG-008: scheduled sweeps run 2.5 to 7 hours after their slot, later than `/manage/` tells members. Proposed S3. See
[TS19 results](TS19-bug-reporting-and-retesting-results-2026-10-30.md).

## Left to do

| What | Who |
|---|---|
| Approve or change the targets in TS14 step 1 | Owner |
| Lighthouse at pagespeed.web.dev on the 4 pages; record scores and LCP here | Owner |
| Find what triggers the 02:27 UTC sweep (the Vercel cron is `30 1 * * *`), then fix BUG-008 or change the `/manage/` wording | Claude Code investigates; owner decides |
| The 5,000-subscriber delivery timing test (PF-4) | Claude Code |
| The bundle size rule in `check.mjs` (TS14 step 5) | Claude Code |
