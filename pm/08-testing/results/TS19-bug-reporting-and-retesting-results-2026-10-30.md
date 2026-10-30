# TS19 results · Bug reporting and retesting

| | |
|---|---|
| Task | [TS19](../TS19-bug-reporting-and-retesting.md) |
| Run | 2026-10-30 |
| Commit | `d2b9639` (main) |
| Environment | The log in TS19, updated from the TS01 to TS20 results |
| Run by | Claude Code. No addresses, names or account ids; GitHub Issues not used yet (the repo is public) |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| BR-1 | Where bugs live: Issues or this file | Needs owner | The log at the end of TS19 stays the record until the owner chooses |
| BR-2 | The issue template | Not run | Its own PR, after BR-1 |
| BR-3 | The owner's 7 notes are logged, each with a severity and a next step | Pass | BUG-001 to BUG-007 in the log |
| BR-4 | Every bug found by TS08 to TS18 is logged the same way | Pass | BUG-008 to BUG-011 added |
| BR-5 | One bug goes from New to Closed with a retest | Not yet | BUG-005 is Fixed and waits for the owner's signed-in retest; BUG-003 and BUG-007 wait for the owner to close |

## Retests this run

| Bug | Retest | Result | New state |
|---|---|---|---|
| BUG-001 | Google sign-in, pay, no redirect | Not retested: needs staging | New |
| BUG-002 | One account sees the live page, the other doesn't | Not retested: the owner hasn't named the accounts | New |
| BUG-003 | Which accounts get email | Answered by counts: all 8 confirmed members get email as chosen ([TS08](TS08-system-testing-results-2026-10-30.md)) | New: answered, owner to close |
| BUG-004 | Each sign-up path proves the inbox | Not retested: needs a test inbox | New |
| BUG-005 | Sign in shown when signed in | Fixed in `ebc4daf`; 10 pages swap to Account ([TS10](TS10-ui-ux-testing-results-2026-10-30.md)) | Fixed: retest due |
| BUG-006 | Spelling in the demo | Mechanical check passed; a person reads it | Open: partly retested |
| BUG-007 | `/subscribe/` and `/manage/` | `/subscribe/` gives 307 to `/pricing/` | Open: redirect confirmed |

## New bugs

| ID | What | Severity (proposed) | Found by |
|---|---|---|---|
| BUG-008 | Scheduled sweeps run 155 to 418 minutes after their slot, later than `/manage/` promises | S3 | [TS14](TS14-performance-testing-results-2026-10-30.md) PF-3; also TS09 REQ-08, TS13 SM-9, TS20 PV-1 |
| BUG-009 | `npm audit`: 4 high, 1 moderate | S3 | [TS15](TS15-security-testing-results-2026-10-30.md) |
| BUG-010 | No security headers beyond HSTS | S3 | [TS15](TS15-security-testing-results-2026-10-30.md) |
| BUG-011 | No skip link on 13 of 14 pages | S3 | [TS17](TS17-accessibility-testing-results-2026-10-30.md) |

**Open by proposed severity:** S1: 1 (BUG-002). S2: 2 (BUG-001, and BUG-004 if a path skips the inbox check).
S3: 6 (BUG-005 retest due, BUG-007, BUG-008 to BUG-011). S4: 1 (BUG-006). Question: 1 (BUG-003).

## Left to do

| What | Who |
|---|---|
| Set the severities, and choose Issues or this file | Owner |
| Retest BUG-005 signed in; close BUG-003 and BUG-007 if agreed | Owner |
| Name the two BUG-002 accounts privately so `show --check` can compare them | Owner |
| Fix BUG-010 and BUG-011, each in its own PR with a `check.mjs` rule | Claude Code |
| Investigate BUG-008's 02:27 UTC trigger | Claude Code |
