# TS05 results · Test data

| | |
|---|---|
| Task | [TS05](../TS05-test-data.md) |
| Run | 2026-10-30, about 09:00 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (the repo), plus production Blob read-only through `subscribers.mjs` |
| Run by | Claude Code, read-only. Only counts are written here; no address or id |

## Production data, counts only

`node --env-file=.env.local scripts/subscribers.mjs stats` and `list --plan pro`, read-only:

| Measure | Count |
|---|---|
| Pending | 0 |
| Free | 3 |
| Pro | 5 (0 ending within 7 days; all paid to 25 to 28 Nov 2026) |
| Waiting for Pro | 1 |
| Last 30 days: subscribed / confirmed / unsubscribed | 15 / 15 / 3 |
| Bounced / complained | 0 / 0 |
| Sign-in emails sent | 2 |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| TD-1 | Offline fakes and samples exist and are free of real data | Pass | `memStorage()` and fake fetches in `test-helpers.mjs`; `sampleData.json` 8 sample items; Razorpay key-like strings in tests are short placeholders (see [TS15](TS15-security-testing-results.md)) |
| TD-2 | Each test state has a named inbox, recorded privately | Needs owner | No private record seen; it lives outside the repo by design |
| TD-3 | The staging clean-up step is written and run once | Blocked | Staging is about 121 commits behind and its Blob store isn't reachable from here |
| TD-4 | The two test-mode subscriptions are gone from production's paid count | Fail (not yet) | All 5 Pro records are still active to 25 to 28 Nov. Which 2 are test mode can't be told from the list; it needs `subscribers.mjs show <address> --check` on the accounts the owner names |
| TD-5 | Production test data visible as counts only | Pass | The table above; the commands print addresses only to the terminal |

## Bugs found

None new. TD-4 is the known T27 item.

## Left to do

| What | Who |
|---|---|
| Name the test inboxes privately; name the 2 test-mode accounts so `show --check` can confirm them | Owner |
| Remove the 2 test-mode subscriptions from the paid count, or record that they lapse on their end dates | Owner |
| Write and run the staging clean-up after staging is updated | Claude Code writes it; owner runs it |
