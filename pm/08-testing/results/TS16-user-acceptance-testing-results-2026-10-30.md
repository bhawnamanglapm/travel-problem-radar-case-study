# TS16 results · User acceptance testing

| | |
|---|---|
| Task | [TS16](../TS16-user-acceptance-testing.md) |
| Run | 2026-10-30, about 09:35 UTC |
| Commit | `d2b9639` (main) |
| Environment | Production Blob, read-only, through `score-items.mjs` |
| Run by | Claude Code prepared the sample; the judging and the sign-off are the owner's |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| UAT-1a | Pick 20 live items for content UAT | Pass (prepared) | `node --env-file=.env.local scripts/score-items.mjs --out <scratchpad>`: read the last 10 sweeps (1 more is listed but its file is missing; noted, not a bug), 183 unique items, picked 20, 5 per category. The CSV is kept outside the repo for the owner to mark |
| UAT-1b | The mechanical checks on those 20 | Pass | Links: 17 load, 0 broken, 3 blocked to scripts (the site refuses automated requests; a person opens them). Dates: 20 of 20 within 60 days |
| UAT-1c | The four judged checks (source supports the summary, recent, right category, severity fair) and the `--score` shares | Needs owner | Needs a person to mark the CSV, then `score-items.mjs --score <dir>` |
| UAT-1d | Agreement with the ChatGPT marks on the 28 Haiku items | Needs owner | The owner marks the same 28 items; under 80% agreement means the LLM marks can't stand in for a person |
| UAT-1e | The bar: 80% or more pass "the source supports the summary", none invented | Needs owner | The owner sets it, then reads the shares against it |
| UAT-2 | Journeys with the owner, then 3 to 5 target users, on staging | Blocked | Staging is about 121 commits behind `main` |
| UAT-3 | Sign-off form for this release | Not done | Depends on UAT-1c to UAT-2. Open S1 or S2 bugs must be none, and BUG-001 (proposed S2) and BUG-002 (proposed S1) are still open |

**Totals:** 2 Pass (the sample is ready), 3 Needs owner, 1 Blocked, 1 Not done.

## Bugs found

None.

## Left to do

| What | Who |
|---|---|
| Mark the 20 items in the CSV (Claude Code gives the path in chat); run `--score` | Owner |
| Mark the 28 Haiku items; record the agreement with ChatGPT | Owner |
| Set the content bar | Owner |
| Journey UAT once staging is on `main` | Owner, then 3 to 5 target users |
| Fill in the sign-off form | Owner |
