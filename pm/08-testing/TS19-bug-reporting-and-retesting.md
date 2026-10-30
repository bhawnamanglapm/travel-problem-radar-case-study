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

The owner's 7 notes, as of 2026-10-30, with addresses left out, then the bugs found by the first test run
(BUG-008 onwards, [results](results/TS19-bug-reporting-and-retesting-results-2026-10-30.md)). Severities and priorities
are proposals for the owner.

Severity is the harm (S1 to S4, from the [plan](README.md#bug-severity)). Priority is the order to fix in:

| Priority | Fix |
|---|---|
| P1 | Now |
| P2 | Before the next release |
| P3 | In the next few PRs |
| P4 | When convenient, or close |

"Found by" names the test result that first showed the bug and the check in it; "also" lists other results that
saw it.

| ID | What was seen | Severity (proposed) | Priority (proposed) | Found in | Next step | Found by | State |
|---|---|---|---|---|---|---|---|
| BUG-001 | After Google sign-in to an existing account, the payment page shows; after paying, there's no redirect to the live page | S2 | P1 | Not recorded | Reproduce on staging with TC-P-2; record the URL after paying | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 1; also [TS16](results/TS16-user-acceptance-testing-results-2026-10-30.md) UAT-3 | New |
| BUG-002 | One account sees the live page; another, the one used to test Razorpay, doesn't | S1 until the cause is known | P1 | Not recorded | Compare both records read-only with `subscribers.mjs show --check`; rule out the staging and production Blob stores being different, don't assume it | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 2; also [TS05](results/TS05-test-data-results-2026-10-30.md) TD-4, [TS16](results/TS16-user-acceptance-testing-results-2026-10-30.md) UAT-3 | New |
| BUG-003 | Which accounts still get email? | Question, not yet a bug | P4 | Production | Answered 2026-10-30 by counts: all 8 confirmed members (3 Free, 5 Pro, none with email off) get email as they chose; 29 Oct slot 10: Pro due 5, sent 4, 1 not this slot, failed 0. Owner to close as not a bug | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 3; also [TS05](results/TS05-test-data-results-2026-10-30.md) counts | New: answered |
| BUG-004 | Sign-up should verify the account | S2 if any path sends to an unproven inbox; otherwise closed | P2 | Not recorded | TC-F-3: record how each sign-up path proves the inbox | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 4 | New |
| BUG-005 | A Sign in option shows on the pricing page when already signed in | S3 | P3 | Production | Fixed in `ebc4daf` (2026-10-28): 10 pages swap Sign in for Account when signed in. Owner retests signed in on each | [TS10](results/TS10-ui-ux-testing-results-2026-10-30.md) BUG-005 row | Fixed: retest due |
| BUG-006 | Check the demo for spelling mistakes | S4 | P4 | Production | Mechanical check 2026-10-30 passed (sample data, board copy, 14 built pages). A person reads the demo once | [TS10](results/TS10-ui-ux-testing-results-2026-10-30.md) BUG-006 row; also [TS17](results/TS17-accessibility-testing-results-2026-10-30.md) static scan | Open: partly retested |
| BUG-007 | `/subscribe/` and `/manage/`: what's the difference? | S3, or closed on retest | P4 | Production | Retest 2026-10-30: `/subscribe/` gives 307 to `/pricing/`. Owner decides whether pricing and manage each have one job, and closes | [TS10](results/TS10-ui-ux-testing-results-2026-10-30.md) BUG-007 row; also [TS13](results/TS13-smoke-testing-results-2026-10-30.md) SM-6 | Open: redirect confirmed |
| BUG-008 | Scheduled sweeps run 155 to 418 minutes (median 337) after their slot; `/manage/` promises about 05:47 and 15:47 IST, members get them about 07:57 and 21:25 to 22:28 IST | S3 | P2 | Production | Find what triggers the 02:27 UTC sweep, then fix the timing or the `/manage/` wording. Related: T35 in `progress.md` | [TS14](results/TS14-performance-testing-results-2026-10-30.md) PF-3; also [TS09](results/TS09-functional-testing-results-2026-10-30.md) REQ-08, [TS13](results/TS13-smoke-testing-results-2026-10-30.md) SM-9, [TS20](results/TS20-production-validation-results-2026-10-30.md) PV-1 | New |
| BUG-009 | `npm audit`: 4 high (`zod` below 4.6.6 through `@vercel/blob`), 1 moderate (`esbuild`, dev only) | S3 | P3 | Local | Owner picks the fix (a newer `@vercel/blob`, or an `overrides` entry); ask before upgrading | [TS15](results/TS15-security-testing-results-2026-10-30.md) Components | New |
| BUG-010 | No security headers beyond HSTS: no CSP, `X-Content-Type-Options`, `frame-ancestors` or `Referrer-Policy` | S3 | P2 | Production | A `headers` block in `vercel.json`, tested on staging first (a wrong CSP breaks checkout), plus a `check.mjs` rule | [TS15](results/TS15-security-testing-results-2026-10-30.md) Misconfiguration; also [TS09](results/TS09-functional-testing-results-2026-10-30.md) NFR headers | New |
| BUG-011 | No skip link on 13 of 14 pages (only the home page has one) | S3 | P3 | Local | Add one to each page, plus a `check.mjs` rule | [TS17](results/TS17-accessibility-testing-results-2026-10-30.md) static scan and A11Y-6; also [TS09](results/TS09-functional-testing-results-2026-10-30.md) NFR skip link | New |
