# TS06 results · Unit testing

| | |
|---|---|
| Task | [TS06](../TS06-unit-testing.md) |
| Run | 2026-10-30, about 08:52 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline: Windows 11, Node v24.18.0 |
| Run by | Claude Code |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| UT-1 | `npm test`: every suite passes | Pass | 8 suites, 1,582 checks, 0 failed (counts per suite in [TS04 results](TS04-results.md)) |
| UT-2 | `npm run check` passes | Pass | 244 checks, 0 failed |
| UT-3 | Line coverage measured | Not run | Node's built-in coverage (`--experimental-test-coverage`) works only with `node --test`, and these suites use their own `check()`. `NODE_V8_COVERAGE` writes raw V8 data that needs a package (c8) to summarise. No package was added (test plan rule 1) |
| UT-4 | The React boards have unit tests | Fail | No test file imports `travel-problem-radar.jsx` or `live/src`. `check.mjs` checks the bundles are built and fresh, not their behaviour |

## Bugs found

None. UT-4 is the known TS06 gap; it's why SC-P-3 is a Gap in [TS03](TS03-results.md).

## Left to do

| What | Who |
|---|---|
| Decide whether to add c8 (free, a dev dependency) for coverage | Owner (test plan rule 1: ask first) |
| Board tests for search, save and share (SC-P-3) | Claude Code, after the owner picks an approach |
