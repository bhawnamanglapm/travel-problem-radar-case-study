# TS19 · Bug reporting and retesting

| | |
|---|---|
| Component | Bug reporting and retesting |
| Who | Anyone who finds a bug logs it; the owner (PM) sets the severity and order; Claude Code fixes, adds a test and retests; the owner closes it |
| Status | Not started: 7 bug notes kept outside the repo; no log, template or life cycle |
| Depends on | — |
| Size | S |
| Unblocks | Every testing task (each one logs here); the release exit criteria |

## What it means here

One place where every bug is written down the same way, ranked by harm, fixed, retested and closed, so none is
forgotten and a release can say "no open S1 or S2".

## In place today

- The owner's 7 notes, in a local file not in the repo. They hold email addresses, so the file stays out of git.
- The severity scale (S1 to S4) is in the [test plan](README.md#bug-severity).
- The rule that every fixed bug gets a test ([TS06](TS06-unit-testing.md), [TS12](TS12-regression-testing.md)).

## Gaps

- No log, so bugs live in people's heads and a local note.
- No template, so reports miss steps or the environment.
- No retest step, so "fixed" isn't checked.

## The work

1. **Where bugs live.** Proposal: GitHub Issues with a `bug` label and a severity label (`S1` to `S4`). Issues link to
   the PR that fixes them, and GitHub closes them on merge. The repo is public, so issues are public too: no
   addresses, names, keys, codes or account ids, ever. Until issues are set up, the log at the end of this file is the
   record.
2. **The template** (as `.github/ISSUE_TEMPLATE/bug.md`, its own PR):

| Field | What goes in it |
|---|---|
| Title | What's wrong, in one line |
| Severity | S1 to S4, proposed by the reporter, set by the owner |
| Environment | Local, `staging` Preview, or Production; browser and device; commit if known |
| Account state | Signed out, Free, Pro, cancelled, lapsed; sign-in method. Never the address |
| Steps | Numbered, from a fresh start |
| Expected | What should happen, with the REQ or TC id if there is one |
| Actual | What happened; the error text; a screenshot with addresses hidden |
| Found by | The TS task or TC case, or "owner, daily use" |

3. **Life cycle:**

| State | Who moves it on | To |
|---|---|---|
| New | The owner sets severity and checks it isn't a duplicate | Open, or Closed (not a bug, duplicate, won't fix, with the reason) |
| Open | Claude Code reproduces it. If it can't be reproduced, ask the reporter for more | In progress, or Needs info |
| In progress | Claude Code fixes it and adds a test that fails before the fix and passes after | Fixed (PR merged) |
| Fixed | The owner, or whoever found it, **retests** in the environment where it was found | Closed, or Reopened |
| Reopened | Back to Open, with what was seen on retest | Open |

4. **Retesting rules:**
   - Retest with the original steps, in the original environment.
   - Run the TS12 regression list for the journeys the fix touches.
   - A bug found in production is retested in production, read-only, after the deploy (TS20).
5. **Move the 7 notes** into the log below now, then into issues once step 1 is agreed.
6. **Weekly:** the owner reviews open bugs; any S1 or S2 blocks the next release.

## Done when

- The template and labels exist, or the owner chose to keep this file as the log.
- The 7 notes are logged, each with a severity and a next step.
- Every bug found by TS08 to TS18 is logged the same way.
- One bug has gone all the way from New to Closed with a retest, to prove the process.

## Tools and cost

GitHub Issues and labels: free. No new tools.

## Risks and notes

- A public tracker shows bugs to anyone, including security ones. Report a security bug privately (GitHub's private
  vulnerability reporting, or straight to the owner), not in a public issue.
- Severity is the owner's call. The ones below are proposals.

## The log

The owner's 7 notes, as of 2026-10-30, with addresses left out. Severities are proposals for the owner.

| ID | What was seen | Severity (proposed) | Found in | Next step | Task | State |
|---|---|---|---|---|---|---|
| BUG-001 | After Google sign-in to an existing account, the payment page shows; after paying, there's no redirect to the live page | S2 | Not recorded | Reproduce on staging with TC-P-2; record the URL after paying | TS08 | New |
| BUG-002 | One account sees the live page; another, the one used to test Razorpay, doesn't | S1 until the cause is known | Not recorded | Compare both records read-only with `subscribers.mjs show --check`; rule out the staging and production Blob stores being different, don't assume it | TS08 | New |
| BUG-003 | Which accounts still get email? | Question, not yet a bug | Not recorded | Read-only: `subscribers.mjs list` and the admin counts. A bug only if someone gets email they shouldn't | TS08 | New |
| BUG-004 | Sign-up should verify the account | S2 if any path sends to an unproven inbox; otherwise closed | Not recorded | TC-F-3: record how each sign-up path proves the inbox | TS08 | New |
| BUG-005 | A Sign in option shows on the pricing page when already signed in | S3 | Not recorded | List every page with Sign in and check each signed in | TS10 | New |
| BUG-006 | Check the demo for spelling mistakes | S4 | Not recorded | Spell-check our own copy on every page | TS10 | New |
| BUG-007 | `/subscribe/` and `/manage/`: what's the difference? | S3, or closed on retest | Not recorded | Retest: `/subscribe/` has redirected to `/pricing/` since 2026-10-28 (`aa080e2`); check pricing and manage each have one job | TS10 | New |
