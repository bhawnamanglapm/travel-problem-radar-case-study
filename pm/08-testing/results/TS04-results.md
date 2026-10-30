# TS04 results · Test cases

| | |
|---|---|
| Task | [TS04](../TS04-test-cases.md) |
| Run | 2026-10-30, about 09:15 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (the repo) |
| Run by | Claude Code, read-only |

## Automated cases: suite counts

From `npm test` on `d2b9639` (Node v24.18.0), 2026-10-30 about 08:52 UTC. Every suite exits 0.

| Suite | Checks | Failed |
|---|---|---|
| test-sweep | 249 | 0 |
| test-subscriptions | 1,048 | 0 |
| test-compare | 40 | 0 |
| test-score | 42 | 0 |
| test-cost | 25 | 0 |
| test-plan | 73 | 0 |
| test-admin | 49 | 0 |
| test-password | 56 | 0 |
| **Total** | **1,582** | **0** |
| `npm run check` | 244 | 0 |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| TC-0 | Every scenario marked Covered (auto) names its suite and section | Pass | [TS03 results](TS03-results.md): all 43 auto rows name a suite and an example check label |
| TC-00 | Every scenario marked Manual has a case | Fail | 6 Manual scenarios have no TC: SC-V-1, SC-V-5, SC-P-11, SC-A-5, SC-L-3, SC-L-4. Each is covered by another task's sheet instead (TS13 SM-1/2, TS18, TS08, TS10) |
| TC-F-1 to TC-F-3 | Sign-up cases | Needs owner | Need a test inbox; not run |
| TC-U-1, TC-U-2 | Unsubscribe cases | Needs owner | Need Gmail and a Pro test account |
| TC-S-1 to TC-S-3 | Sign-in cases | Needs owner | Need a browser and Google |
| TC-P-1 to TC-P-5 | Pro and payment cases | Needs owner | Need staging, which is about 121 commits behind `main`; run after it's updated |
| TC-A-1 | Admin case | Needs owner | Needs the admin password |
| TC-L-1, TC-L-2 | Pages and `plan.json` values | Pass (by curl) | All 13 public pages 200; `/pricing/` shows "₹1 a month or ₹1 a year", matching `plan.json`; one legal page has the `aria-label="Site"` footer. Visual check still the owner's |

None of the 16 manual cases has been run by a person yet.

## Bugs found

None.

## Left to do

| What | Who |
|---|---|
| Decide whether the 6 Manual scenarios get their own TC or stay with TS08, TS10, TS13, TS18 | Owner |
| Run each manual case once with a result and date, after staging is brought up to `main` | Owner |
