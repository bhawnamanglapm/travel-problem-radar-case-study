# TS13 · Smoke testing

| | |
|---|---|
| Component | Smoke testing |
| Who | The owner (release manager), after each deploy |
| Status | Not started |
| Depends on | TS11 |
| Size | S |
| Unblocks | TS20 |

## What it means here

A 5-minute check, right after a deploy, that the build is alive: the main pages load, the API answers, and the last
sweep ran. If smoke fails, nothing else is tested; the deploy is rolled back or fixed first.

## In place today

- Vercel shows whether a deploy built.
- The owner opens the site after deploys, but there's no list.

## Gaps

- No list, so what was checked isn't the same each time and isn't recorded.

## The work

1. **The list.** Production, read-only. Nothing here sends email, charges or sweeps.

| ID | Check | Pass |
|---|---|---|
| SM-1 | Open `/` | Loads; no console errors |
| SM-2 | Open `/demo/` | The board shows the sample |
| SM-3 | Open `/live/` signed out | The locked board shows |
| SM-4 | Open `/live/` as the owner's Pro | The board shows the latest sweep, with its time |
| SM-5 | Open `/pricing/` | The price matches `plan.json` |
| SM-6 | Open `/subscribe/`, `/signin/`, `/manage/` | Each loads |
| SM-7 | Open one legal page | Loads, with the footer |
| SM-8 | API-1 and API-2 from [TS11](TS11-api-testing.md) | 401 and 401 |
| SM-9 | The last sweep's time on the board | Within the last scheduled slot (slots at 0, 5, 10, 15 and 20 UTC; a slot nobody chose is skipped) |
| SM-10 | `travel-problem-radar.vercel.app` | Redirects to the custom domain |

2. **Record** the deploy, the date and pass or fail, in the PR or a short log at the end of this file.
3. **If a check fails:** an S1 or S2 bug in [TS19](TS19-bug-reporting-and-retesting.md), and the rollback in
   [TS20](TS20-production-validation.md).
4. **Later, optional:** `scripts/smoke.mjs`, a read-only script that runs SM-1 to SM-3 (status codes only), SM-8 and
   SM-10 with `fetch`. No new packages. Its own PR, with offline tests against a fake `fetch`.

## Done when

- The list is used after the next deploy and the result recorded.

## Tools and cost

A browser and `curl`. Free.

## Risks and notes

- Smoke proves the site is up, not that it's right. It doesn't replace TS12 or TS20.
- SM-8's API-2 must be sent without the secret.
