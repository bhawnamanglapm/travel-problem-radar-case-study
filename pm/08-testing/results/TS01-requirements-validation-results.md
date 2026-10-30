# TS01 results · Requirements validation

| | |
|---|---|
| Task | [TS01](../TS01-requirements-validation.md) |
| Run | 2026-10-30, 08:50 to 09:10 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (the repo), plus the production pricing page and the GitHub Actions sweep logs, read-only |
| Run by | Claude Code, read-only |

## Results

Each drift row from TS01 checked against the code and the live product. "Pass" means the drift is confirmed as
written, so the PRD needs the update TS01 proposes.

| ID | Check | Result | Evidence |
|---|---|---|---|
| D1 | REQ-08 says "every 5 hours"; the product runs up to 5 fixed slots a day, chosen by Pro | Pass (drift confirmed) | `prd.md` line 77 still says "now every 5 hours"; `api/_lib/schedule.js` exists; Actions logs 25 to 30 Oct show replies such as "slot 20 not needed: 2 a day" |
| D2 | REQ-23 says no passwords; passwords exist | Pass (drift confirmed) | `api/_lib/password.js` exists; `test-password` 56 checks pass |
| D3 | Razorpay live since 2026-10-28 | Needs owner | Live mode shows only on `/admin/` (TS20 PV-5), which needs the owner's sign-in |
| D4 | REQ-28 built: 48-hour grace, tidy step, key-mismatch guard | Pass (drift confirmed) | `PRO_GRACE_HOURS = 48` in `api/_lib/subscribers.js:195`; key-mismatch checks in `test-subscriptions` and `test-admin` (14 matching checks) |
| D5 | `plan.json` has `"paid": true` | Pass (drift confirmed) | `plan.json` read on `d2b9639` |
| D6 | Cost a sweep is Haiku's, not $0.21 | Pass (drift confirmed) | `llm-logs.mjs list --days 7`: 10 sweeps, all `claude-haiku-5-5`, $0.0921 to $0.1254, median about $0.114 |
| D7 | T33 to T41 aren't in the PRD | Pass (drift confirmed) | `progress.md`: T33 to T41 all listed, T35 "done", the rest "built" |
| D8 | Case study says ₹299; the product charges ₹1 | Pass (drift confirmed) | `plan.json`: monthly 1, yearly 1; live `/pricing/` shows "₹1 a month or ₹1 a year"; `CASE_STUDY.md` lines 12, 29, 49 say ₹299 |

## Bugs found

None new. The drift is a documentation gap, already listed in TS01.

## Left to do

| What | Who |
|---|---|
| Confirm D3 on `/admin/` ("live mode, production") | Owner |
| Update the PRD rows for D1 to D8 (TS01 step 2) | Claude Code, after the owner's yes |
| Decide how the case study states the price while ₹1 is a test price (D8) | Owner |
