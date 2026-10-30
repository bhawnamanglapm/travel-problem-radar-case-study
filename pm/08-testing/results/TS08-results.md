# TS08 results · System testing

| | |
|---|---|
| Task | [TS08](../TS08-system-testing.md) |
| Run | 2026-10-30, about 09:25 UTC |
| Commit | `d2b9639` (main) |
| Environment | Production, read-only (`subscribers.mjs`, GitHub Actions logs). Staging not used |
| Run by | Claude Code, read-only. Counts only; no address or id |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| ST-1 to ST-10 | The full run sheet, end to end | Needs owner | Needs a browser, test inboxes and staging (about 121 commits behind `main`). The sheet is in TS08 as written |
| Note 1 (BUG-001) | Google sign-in, pay, then no redirect | Needs owner | TC-P-2 on staging with a test card. Not reproducible read-only |
| Note 2 (BUG-002) | One account sees the live page, the Razorpay test account doesn't | Needs owner | `subscribers.mjs show <address> --check` on both accounts. The owner hasn't named them, and this run doesn't guess. What's known: production has 5 Pro records, all active, paid to 25 to 28 Nov, none with email off |
| Note 3 (BUG-003) | Which accounts still get email? | Pass (answered, counts) | `stats`: 3 Free, 5 Pro, 0 pending. `list --plan pro`: none of the 5 has email off. The 29 Oct slot 10 sweep's reply: Pro due 5, sent 4, 1 not this slot (it chose fewer emails a day), failed 0; Free 3 already sent that day. So all 8 confirmed members get email as they chose |
| Note 4 (BUG-004) | Each sign-up path proves the inbox | Needs owner | TC-F-3 with a test inbox |

## Bugs found

None new. BUG-003 can be closed as "not a bug" if the owner agrees: no one gets email they shouldn't, by the counts.

## Left to do

| What | Who |
|---|---|
| Name the two accounts in note 2 (privately, in chat) so their records can be compared | Owner |
| Update staging to `main`, then run ST-1 to ST-10 once and record it | Owner |
| Confirm BUG-003 is closed | Owner |
