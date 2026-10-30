# TS07 results · Integration testing

| | |
|---|---|
| Task | [TS07](../TS07-integration-testing.md) |
| Run | 2026-10-30, about 09:20 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (the repo). Staging not used |
| Run by | Claude Code, read-only |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| IT-1 to IT-8 | Real Razorpay, Resend and Google on `staging` | Blocked | Staging is about 121 commits behind `main`, so it would test old code; updating it is a deploy, outside this run's zero-change rule |
| IT-off-1 | Offline: a sweep and a sign-up writing to `memStorage` in the same tick | Fail (not written) | No such test found; the nearest is `listSubscribers(st, { concurrency: 2 })` at `test-subscriptions.mjs:172`, which is about reading |
| IT-off-2 | Offline: Anthropic answers 529 for one category; that category fails cleanly | Pass (already covered) | `test-sweep.mjs:298` (`gov_policy failed: http 529`) and `:676` ("no error body: just the status"); `:696` all failing gives 502 |
| IT-live-1 | GitHub Actions → `/api/sweep` works in production | Pass | 30 most recent `sweep.yml` runs (24 to 30 Oct): 27 succeeded, 3 failed. 6 saved, 21 skipped as not needed or already swept. The 3 failures (24 Oct 14:01, 25 Oct 04:49 and 14:25 UTC) were Anthropic refusing every call with "credit balance is too low"; nothing was saved and the run showed as failed, which is REQ-06 working as designed. None since 25 Oct 17:18, when a manual Haiku sweep saved |
| IT-live-2 | Anthropic in production | Pass | 10 sweeps in 7 days, each 4 of 4 calls OK (`llm-logs.mjs list --days 7`) |

## Bugs found

None.

## Left to do

| What | Who |
|---|---|
| Bring staging up to `main` (a deploy) | Owner |
| Run IT-1 to IT-8 on staging with test keys and TS05's test inboxes | Owner, with Claude Code reading the results |
| Write the same-tick write test (IT-off-1) | Claude Code |
