# TS20 results · Production validation

| | |
|---|---|
| Task | [TS20](../TS20-production-validation.md) |
| Run | 2026-10-30, about 09:55 UTC |
| Deploy | Production, built from `d2b9639` (main) |
| Environment | Production, read-only: `llm-logs.mjs`, GitHub Actions logs, curl |
| Run by | Claude Code. No sweep, email or payment was triggered |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| PV-1 | The latest scheduled sweep ran | Pass, late (BUG-008) | `llm-logs.mjs list --days 1`: 30 Oct 02:27 UTC (slot 0), saved, 4 of 4 calls OK, Haiku, $0.1142, in line with the 7-day range of $0.0921 to $0.1254. The one before: 29 Oct 16:58 UTC (slot 10), saved, $0.1143. Both hours after their slot ([TS14](TS14-results.md)) |
| PV-2 | No failure alert | Needs owner | Needs the owner's inbox and Slack. From the logs: the last failed runs were 24 Oct 14:01 and 25 Oct 04:49 and 14:25 UTC (Anthropic credit too low); each should have sent an alert. None since |
| PV-3 | The board shows that sweep | Needs owner | `/live/` as the owner's Pro. The share link for an item of that sweep loads (API-5, [TS11](TS11-results.md)) |
| PV-4 | No key mismatch | Pass | The sweep replies in the Actions logs read for this run have no `razorpay: "key mismatch"` |
| PV-5 | Payment mode | Needs owner | `/admin/` needs the owner's sign-in (signed out it gives 401) |
| PV-6 | Emailed sign-in | Needs owner | Needs an inbox |
| PV-7 | Pro email follows choices (TC-P-5) | Needs owner | Needs a Pro inbox |
| PV-8 | Gmail one-click unsubscribe | Needs owner | Needs a Gmail inbox |
| PV-9 | Inbox placement | Needs owner | mail-tester.com needs an email sent, which this run doesn't do |

**Totals:** 2 Pass (PV-1 with BUG-008, PV-4), 7 Needs owner.

## Bugs found

None new; PV-1 shows BUG-008 again.

## Left to do

| What | Who |
|---|---|
| PV-2, PV-3 and PV-5 after the next scheduled slot | Owner |
| PV-6 to PV-9 once, then after any release that touches sign-in or email | Owner |
