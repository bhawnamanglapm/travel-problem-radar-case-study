# TS14 · Performance testing

| | |
|---|---|
| Component | Performance testing |
| Who | Claude Code measures and tests offline; the owner runs Lighthouse and reads the logs |
| Status | Not started: some numbers are logged, none has a target |
| Depends on | — |
| Size | M |
| Unblocks | TS20 |

## What it means here

Checking the product is fast enough and stays inside its limits as use grows. The limits that matter here:
- **The sweep** must finish, and delivery with it, inside Vercel's 300-second function limit (`maxDuration` 300 for
  `api/sweep.js` in `vercel.json`).
- **Delivery** must cope with the subscriber cap of 5,000 (REQ-16, REQ-18).
- **Pages** must load fast on a phone.
- **The data feed** must stay quick as the history grows to 60 sweeps.

Load testing with many users isn't needed: visitors only read cached data, and no visitor action calls the model
(the cost NFR).

## In place today

| Measure | Value | Source |
|---|---|---|
| Sweep time, Haiku, model test | 14 s a sweep (Sonnet 11 s), 3 runs each, from the owner's machine | [model-test-2026-10-30.md](../../docs/subscriptions/model-test-2026-10-30.md) |
| Sweep time in production | Logged per run | `node --env-file=.env.local scripts/llm-logs.mjs list` |
| Live board bundle | 202,161 bytes, minified, not compressed | `live/radar-live.js` on `c848b94` |
| Demo bundle | 205,427 bytes, minified, not compressed | `demo/radar.js` on `c848b94` |
| Data feed caching | `s-maxage=300` when the paywall is off; `private, no-store` when on | `makeDataHandler()` |
| Delivery stops before the limit | Tested offline | test-subscriptions: "T10" |

## Gaps

- No targets, so no number can fail.
- Production sweep times haven't been summarised (median, slowest).
- Delivery at 5,000 subscribers is tested for stopping in time, not timed.
- No page-speed measure. The board bundles carry React and the whole board for every visitor.
- With the paywall on, `/api/data` isn't cached, so each board load reads Blob.

## The work

1. **Set targets** with the owner. Proposals:

| Measure | Proposed target |
|---|---|
| Sweep, scheduled, slowest in 7 days | Under 120 s (40% of the limit) |
| Sweep plus delivery at 5,000 subscribers (offline, fakes timed at realistic delays) | Under 240 s |
| Home page, Lighthouse mobile, Performance | 90 or more |
| `/live/` as Pro, Largest Contentful Paint on a mid phone (Lighthouse mobile) | Under 2.5 s |
| Board bundles | No growth over 10% without a reason in the PR |

2. **Sweep times:** read the last 7 days with `llm-logs.mjs list` (read-only) and record the median and slowest.
3. **Delivery at the cap, offline:** a test in `test-subscriptions.mjs` that delivers to 5,000 fake subscribers with
   `fakeResend` adding a realistic delay per call, and asserts it stops before its time budget and records where it
   stopped. Use Resend's documented rate limit for the delay; don't guess it.
4. **Lighthouse** in Chrome DevTools, mobile, on `/`, `/demo/`, `/live/` (as Pro) and `/pricing/`. Record the four
   scores and LCP.
5. **Bundle size check:** add to `check.mjs` a rule that fails if either bundle grows over a set size (for example,
   current size plus 10%), so growth is a decision.
6. **The data feed:** time 10 board loads as Pro in DevTools' Network tab; record the `/api/data` times.

## Done when

- The owner agreed the targets.
- Steps 2, 4 and 6 are recorded with dates, against the targets.
- The delivery test and the bundle rule are in `npm test` and `npm run check`.

## Tools and cost

- Lighthouse and DevTools in Chrome: free, built in.
- `llm-logs.mjs`: free; reads Blob.
- No load-testing service is needed. **Ask first** before adding one.

## Risks and notes

- The model test's 14 s was measured from the owner's machine, not Vercel; production times may differ.
- Lighthouse scores vary between runs; take the median of 3.
- Splitting React out of the bundle, or loading the board lazily, is a code change. Raise it only if the targets
  fail.
