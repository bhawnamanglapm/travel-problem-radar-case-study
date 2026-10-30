# TS02 results · Acceptance criteria

| | |
|---|---|
| Task | [TS02](../TS02-acceptance-criteria.md) |
| Run | 2026-10-30, about 09:05 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (the repo) |
| Run by | Claude Code, read-only |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| AC-1 | Every REQ has at least one Given/When/Then line | Fail | `prd.md` names 32 REQs (REQ-01 to REQ-32). TS02 has 21 "Given" lines naming 9 distinct REQs. The rest have criteria only inside the T-files, which TS02 counts as "partial" |
| AC-2 | Each line is marked auto (with a test section) or manual (with a TS04 case) | Fail | Not marked yet; TS03 results below give the mapping to start from |
| AC-3 | The owner approved the drafts for REQ-05, 13, 21, 23 and 28 | Needs owner | The five drafts are in TS02's "Gaps" table, awaiting approval |

## Bugs found

None. These are missing documents, not product faults.

## Left to do

| What | Who |
|---|---|
| Approve or edit the five drafts (REQ-05, 13, 21, 23, 28) | Owner |
| Write Given/When/Then lines for the other 23 REQs, from the T-files | Claude Code, after the drafts are approved |
| Mark each line auto or manual using the [TS03 results](TS03-test-scenarios-results.md) | Claude Code |
