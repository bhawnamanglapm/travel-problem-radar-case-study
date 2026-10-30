# TS20 · Production validation

| | |
|---|---|
| Component | Production validation |
| Who | The owner (release manager, DevOps) checks after each deploy and daily; Claude Code reads logs when asked |
| Status | Partial: the owner checks by hand, with no list or record; T30 step 11 is still to do |
| Depends on | TS13 |
| Size | S per release, plus daily checks |
| Unblocks | Closing a release; production bugs in TS19 |

## What it means here

Checking that what's live works for real users, with real keys, after a deploy and every day after. It's read-only
wherever possible: production holds real members, real payments and real email. Smoke ([TS13](TS13-smoke-testing.md))
says the site is up; this says the parts that matter (sweeps, email, payments) are right.

## In place today

- **Failure alerts.** A sweep with failed categories puts FAILED in the owner's email subject and posts to Slack when Slack is set up;
  one where everything fails sends a failure notice (`handlers.js`). The GitHub Actions sweep uses
  `curl --fail-with-body`, so a failed call fails the workflow run.
- **LLM logs.** `node --env-file=.env.local scripts/llm-logs.mjs list [--days 7]`: one line per sweep with tokens,
  searches, model and cost, read from Blob, since Vercel Hobby keeps function logs for an hour only. Read-only, runs
  on the owner's machine.
- **Admin page:** counts of members, Pro and payment mode ("live mode, production" since go-live, 2026-10-28).
- **The sweep reply** carries `subscribers.rzpMismatch` and `razorpay: "key mismatch"` when either applies (T22).
- **Roll-back steps:** for code, Instant Rollback in the Vercel dashboard ([DEPLOYMENT.md](../../DEPLOYMENT.md#8-day-to-day-changes-previews-and-rollbacks)); stored sweeps aren't touched. For payments, in [T27](../../docs/subscriptions/tasks/T27-razorpay-test-run-and-go-live.md#roll-back)
  and the [launch plan](../05-business-case-and-launch/launch-plan.md#rollback); incident playbooks in the
  [post-launch plan](../05-business-case-and-launch/post-launch-plan.md#incident-playbooks).
- **Known deliverability history:** in October the first confirmation and Free digests landed in spam or Junk
  ([progress.md](../../docs/subscriptions/tasks/progress.md)).

## Gaps

- [T30](../../docs/subscriptions/tasks/T30-owner-launch-checklist.md) step 11 is still todo: emailed sign-in, a Pro
  email after choosing categories, Gmail's one-click unsubscribe, all in production.
- No list for after a deploy beyond smoke, and no daily check written down.
- No trigger for when to roll back a code deploy, and the roll-back has never been tried.
- No current spam score on record.

## The work

1. **After each deploy** (once smoke passes):

| ID | Check | How | Pass |
|---|---|---|---|
| PV-1 | The next scheduled sweep ran | `llm-logs.mjs list --days 1` after the slot | One line per chosen slot; all 4 categories saved; cost in line with recent sweeps |
| PV-2 | No failure alert | The owner's inbox and Slack | No FAILED subject or failure notice |
| PV-3 | The board shows that sweep | `/live/` as the owner's Pro | Its time matches PV-1 |
| PV-4 | No key mismatch | The sweep reply in the GitHub Actions log | No `razorpay: "key mismatch"` |
| PV-5 | Payment mode | `/admin/` | "live mode, production" |

2. **Once, then after any change to sign-in, email or payments** (T30 step 11, on the owner's own account):

| ID | Check | Pass |
|---|---|---|
| PV-6 | Emailed sign-in | The link arrives, works once, and signs in |
| PV-7 | Pro email follows choices (TC-P-5) | After choosing categories and areas, the next scheduled Pro email holds only those (plus global items) |
| PV-8 | Gmail one-click unsubscribe | Email stops; the account stays Pro; then subscribe again on `/manage/` |
| PV-9 | Inbox placement | Send one email to mail-tester.com's address; record the score and fix anything it flags. Check the next digest lands in the inbox at Gmail and Outlook.com |

3. **Daily, 2 minutes:**
   - The day's sweeps ran (`llm-logs.mjs list --days 1`) and no FAILED email arrived.
   - Admin counts didn't move in a way nobody explains.
   - Until 28 Nov 2026: watch the 2 test-mode subscriptions counted as paid Pro (T27). They should turn Free on 25
     and 26 Nov, or 27 and 28 Nov with the 48-hour grace. After that, `rzpMismatch` should be 0. If not, follow LR-21
     in the [post-launch plan](../05-business-case-and-launch/post-launch-plan.md).
4. **Roll back a bad deploy.** Triggers, any one:
   - an S1 bug (TS19);
   - every sweep failing;
   - sign-in or payment broken for everyone.

   How: Instant Rollback in Vercel, as in DEPLOYMENT.md, then fix forward on a branch. If payments are the problem,
   use the payment roll-back in T27 as well. Afterwards: smoke
   (TS13), PV-1 to PV-5, and a TS19 entry.
5. **Record** each run in a table at the end of this file: date, deploy (commit), checks, pass or fail, bug ids.

## Done when

- T30 step 11 (PV-6 to PV-8) passed and recorded, and T30's row updated.
- PV-9 recorded with a score.
- PV-1 to PV-5 recorded after the next deploy.
- The roll-back triggers are agreed, and Instant Rollback has been tried once.

## Tools and cost

- `llm-logs.mjs`, the admin page, GitHub Actions logs, Vercel dashboard: free.
- mail-tester.com: free for a few tests a day.
- PV-7 waits for a scheduled sweep that runs anyway, so it adds no Anthropic cost. No manual production sweeps for
  testing without the owner's yes.

## Risks and notes

- Never make a test payment in production. A ₹1 live payment is still real money and a real record.
- Never paste output from `subscribers.mjs` or the admin page into a PR or issue: it holds addresses.
- Production checks use only the owner's own account.
