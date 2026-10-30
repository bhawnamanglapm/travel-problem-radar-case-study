# TS08 · System testing

| | |
|---|---|
| Component | System testing |
| Who | The owner runs the journeys; Claude Code prepares the run sheet and reads the records |
| Status | Not started: runs so far were ad hoc |
| Depends on | TS03, TS04, TS05, TS07 |
| Size | L |
| Unblocks | TS16, TS20 |

## What it means here

Testing the whole product as one system, as deployed, through its real pages: sweep, save, board, emails, sign-in,
checkout, webhook, cancel and expiry, in the order a user meets them. Here that's a full run on the `staging`
Preview, which has its own Blob store (`radar-preview`) and Razorpay test keys.

## In place today

- One test checkout on `staging`, 2026-10-23 (T20), and a webhook check (T21).
- The owner's own use of production since go-live (2026-10-28).
- The T30 owner steps in [progress.md](../../docs/subscriptions/tasks/progress.md), partly done.

## Gaps

- No run sheet, so a full pass isn't repeatable and isn't recorded.
- Four of the owner's bug notes are system-level and not yet reproduced:

| Note | What was seen | Scenario |
|---|---|---|
| 1 | After Google sign-in to an existing account, the payment page shows; after paying, there's no redirect to the live page | SC-P-10 |
| 2 | One account sees the live page; another, the one used to test Razorpay, doesn't | SC-P-11 |
| 3 | Which accounts still get email? | SC-A-5 |
| 4 | Sign-up should verify the account | SC-F-8 |

## The work

1. **Write the run sheet** from TS03's scenarios, in journey order. One pass is about 2 hours.
2. **Run it on `staging`** with TS05's named test inboxes:

| Step | Journey | Check |
|---|---|---|
| ST-1 | Visitor | Home, demo, locked `/live/`, a shared problem link |
| ST-2 | Free sign-up | Sign up, confirm by button, welcome email |
| ST-3 | Sign-in | Link, Google and password on the same account; sign out |
| ST-4 | Buy Pro | Summary, test card, return, webhook, board opens |
| ST-5 | Use Pro | Categories, areas, emails a day, search, save, share |
| ST-6 | Unsubscribe as Pro | Email stops, Pro stays |
| ST-7 | Cancel | Razorpay cancelled, Pro to the end date |
| ST-8 | Renew | Keep renewing; `rzp.next` set |
| ST-9 | Admin | Counts match what the run did |
| ST-10 | Clean up | TS05's clean-up step |

3. **Reproduce bug notes 1 to 4** inside the run, and log each result in [TS19](TS19-bug-reporting-and-retesting.md):
   - **Note 1:** run TC-P-2. Record the URL after paying and what the page says.
   - **Note 2:** for both accounts, compare plan, `proUntil` and Razorpay status with
     `subscribers.mjs show <email> --check` (read-only). A possible cause to rule out: the test payment was made on
     `staging`, whose records are in a different Blob store from production's. Don't assume it; check.
   - **Note 3:** `subscribers.mjs list` and the admin counts give who gets email. Read-only; addresses stay on the
     owner's screen.
   - **Note 4:** TC-F-3. Record how each sign-up path proves the inbox.
4. **The sweep in the system run:** a manual sweep on `staging` checks save, board and New flags. Pro email follows
   scheduled sweeps only (REQ-15), so the email side is checked in production (TS20). Whether a manual sweep sends
   Free's daily email isn't stated in REQ-14; record what happens.

## Done when

- The run sheet is in this file and one full pass is recorded, with a date and a result for each step.
- Bug notes 1 to 4 each have a TS19 entry: reproduced with steps, or not reproduced with what was tried.
- No S1 or S2 bug is open from the run.

## Tools and cost

- Razorpay test mode and the Preview: free.
- A manual sweep on `staging`: about $0.12. **Ask first.** Manual sweeps are capped at 3 a UTC day.

## Risks and notes

- `staging` is behind `main` until it's updated. Merge `main` into `staging` before a run, or the run tests old code.
- Running `subscribers.mjs` with `.env.local` reads the store that file points at. Check which before running it.
- Don't make test payments in production. Bug note 2 is diagnosed by reading records, not by paying again.
