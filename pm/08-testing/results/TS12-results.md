# TS12 results · Regression testing

| | |
|---|---|
| Task | [TS12](../TS12-regression-testing.md) |
| Run | 2026-10-30, 08:50 to 09:00 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline (Windows 11, Node v24.18.0) and GitHub Actions history |
| Run by | Claude Code |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| RG-auto-1 | `npm test` | Pass | 8 suites, 1,582 checks, 0 failed ([TS04 results](TS04-results.md) has the count per suite) |
| RG-auto-2 | `npm run check` | Pass | 244 checks, 0 failed |
| RG-auto-3 | CI on recent PRs and pushes | Pass | `gh run list --workflow check.yml --limit 20`: 20 of 20 succeeded, 30 Oct 02:19 to 08:44 UTC |
| RG-0 | The rule: each bug fix adds a failing-first test | Not run | A rule for future PRs; nothing to run today |
| RG-1 | Home and demo | Needs owner | Pages load (200, [TS10](TS10-results.md)); the demo board, report and detail panel need a browser |
| RG-2 | Live board as Pro | Needs owner | Needs a Pro sign-in in a browser |
| RG-3 | Locked board | Needs owner | API-1 gives 401 `not_signed_in` ([TS11](TS11-results.md)), which is what the lock reads; seeing the lock needs a browser |
| RG-4 | Sign-in: link, Google, password | Needs owner | Needs an inbox and a browser |
| RG-5 | `/manage/` for Free and Pro | Needs owner | Needs both sign-ins |
| RG-6 | Checkout (staging only) | Blocked | Staging is about 121 commits behind `main` |
| RG-7 | Email: the next Pro digest and its links | Needs owner | The 29 Oct slot 10 reply shows Pro sent 4, failed 0; whether the links work needs the inbox |
| RG-8 | Unsubscribe (TC-U-1) | Needs owner | Needs a test inbox |

**Totals:** 3 Pass (automated), 6 Needs owner, 1 Blocked, 1 Not run.

## Bugs found

None.

## Left to do

| What | Who |
|---|---|
| Run RG-1 to RG-5, RG-7 and RG-8 before the next release that touches accounts, payments or delivery, and record them in the PR | Owner |
| RG-6 once staging is on `main` | Owner |
| Decide on a headless browser in CI (Playwright or Puppeteer; a new dependency: ask first) | Owner |
