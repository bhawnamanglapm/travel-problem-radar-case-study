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
| BUG-001 | After Google sign-in to an existing account, the payment page shows; after paying, there's no redirect to the live page | S2 | P1 | Not recorded | Cause found in code 2026-10-30: `/manage/` went on to `/live/` only when Pro started at checkout-return; when it started later, by the webhook while the page waited, the page said "Pro is on" and stayed. Fixed: both now go to the board, with a `check.mjs` rule. Owner retests with one payment (TC-P-2), signed in with Google | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 1; also [TS16](results/TS16-user-acceptance-testing-results-2026-10-30.md) UAT-3 | Fixed: retest due |
| BUG-002 | One account sees the live page; another, the one used to test Razorpay, doesn't | S1 until the cause is known | P1 | Not recorded | Compare both records read-only with `subscribers.mjs show --check`; rule out the staging and production Blob stores being different, don't assume it | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 2; also [TS05](results/TS05-test-data-results-2026-10-30.md) TD-4, [TS16](results/TS16-user-acceptance-testing-results-2026-10-30.md) UAT-3 | New |
| BUG-003 | Which accounts still get email? | Question, not yet a bug | P4 | Production | Answered 2026-10-30 by counts: all 8 confirmed members (3 Free, 5 Pro, none with email off) get email as they chose; 29 Oct slot 10: Pro due 5, sent 4, 1 not this slot, failed 0. Owner to close as not a bug | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 3; also [TS05](results/TS05-test-data-results-2026-10-30.md) counts | New: answered |
| BUG-004 | Sign-up should verify the account | S2 if any path sends to an unproven inbox; otherwise closed | P2 | Not recorded | Checked in code 2026-10-30: every sign-up path proves the inbox. Email: the account stays pending, with no email and no sign-in, until the emailed Confirm link (`test-password.mjs`: "the right password before confirming is told to confirm first"). Password: turns on only with the key in that same link (`pendingPw`). Google: refused unless Google marks the address verified (`api/_lib/google.js`, `email_verified`; `test-subscriptions.mjs`: "an address Google hasn't verified"). Owner to close as not a bug | [TS08](results/TS08-system-testing-results-2026-10-30.md) note 4 | Closed: not a bug (proposed) |
| BUG-005 | A Sign in option shows on the pricing page when already signed in | S3 | P3 | Production | Fixed in `ebc4daf` (2026-10-28): 10 pages swap Sign in for Account when signed in. Owner retests signed in on each | [TS10](results/TS10-ui-ux-testing-results-2026-10-30.md) BUG-005 row | Fixed: retest due |
| BUG-006 | Check the demo for spelling mistakes | S4 | P4 | Production | Mechanical check 2026-10-30 passed (sample data, board copy, 14 built pages). A person reads the demo once | [TS10](results/TS10-ui-ux-testing-results-2026-10-30.md) BUG-006 row; also [TS17](results/TS17-accessibility-testing-results-2026-10-30.md) static scan | Open: partly retested |
| BUG-007 | `/subscribe/` and `/manage/`: what's the difference? | S3, or closed on retest | P4 | Production | Retest 2026-10-30: `/subscribe/` gives 307 to `/pricing/`. Owner decides whether pricing and manage each have one job, and closes | [TS10](results/TS10-ui-ux-testing-results-2026-10-30.md) BUG-007 row; also [TS13](results/TS13-smoke-testing-results-2026-10-30.md) SM-6 | Open: redirect confirmed |
| BUG-008 | Scheduled sweeps run 155 to 418 minutes (median 337) after their slot; `/manage/` promises about 05:47 and 15:47 IST, members get them about 07:57 and 21:25 to 22:28 IST | S3 | P2 | Production | Cause found 2026-10-30: GitHub starts each scheduled run 3.5 to 5.5 hours late (the `17 0` line started at 05:58 UTC, `17 20` at 23:57), and the 02:27 UTC sweep was the Vercel backstop (`30 1 * * *`). Fixed: the backstop is now `5 0 * * *`, so slot 00 sweeps about 00:00 to 01:00 UTC; the pages promise the first email for about 05:30 to 06:30 IST, and `/manage/` says later ones are sent from 10:47, 15:47, 20:47 and 01:47 IST and often arrive a few hours later. A `check.mjs` rule keeps the schedule and the promise together. Retest: the next slot 00 sweep in `llm-logs.mjs list` saved before about 01:05 UTC | [TS14](results/TS14-performance-testing-results-2026-10-30.md) PF-3; also [TS09](results/TS09-functional-testing-results-2026-10-30.md) REQ-08, [TS13](results/TS13-smoke-testing-results-2026-10-30.md) SM-9, [TS20](results/TS20-production-validation-results-2026-10-30.md) PV-1 | Fixed: retest due |
| BUG-009 | `npm audit`: 4 high (`zod` below 4.6.6 through `@vercel/blob`), 1 moderate (`esbuild`, dev only) | S3 | P3 | Local | Fixed 2026-10-30 with an `overrides` entry (the owner approved it in the bug-fix plan): no newer `@vercel/blob` helps, because `@vercel/cli-config` pins `zod` 4.1.11 exactly, even in its latest release (0.3.5). `zod` is now 4.6.6, `@vercel/blob` and `cli-config` still load and parse, and `npm audit` shows 0 high. The `esbuild` moderate is accepted: it's about `esbuild --serve`, never run here. A `check.mjs` rule keeps the override. Retest: `npm audit` shows 0 high, and the next production sweep saves | [TS15](results/TS15-security-testing-results-2026-10-30.md) Components | Fixed: retest due |
| BUG-010 | No security headers beyond HSTS: no CSP, `X-Content-Type-Options`, `frame-ancestors` or `Referrer-Policy` | S3 | P2 | Production | Fixed 2026-10-30: `vercel.json` sends `nosniff`, `X-Frame-Options: DENY` and `frame-ancestors 'none'` on every path, and `Referrer-Policy` on pages. The full CSP is report-only, so it can't break checkout; enforcing it is a later step once checkout and Google sign-in show no console violations. A `check.mjs` rule keeps the headers. Retest: `curl -I` on production, then one checkout and one Google sign-in with the console open | [TS15](results/TS15-security-testing-results-2026-10-30.md) Misconfiguration; also [TS09](results/TS09-functional-testing-results-2026-10-30.md) NFR headers | Fixed: retest due |
| BUG-011 | No skip link on 13 of 14 pages (only the home page has one) | S3 | P3 | Local | Fixed 2026-10-30: the other 13 pages start with the home page's skip link to their `<main>`. The style moved into `brand.css`, which `sync:brand` copies into the self-contained pages; demo and live wrap their React root in `<main id="main">`, so they also gain a main landmark. A `check.mjs` rule checks all 14 pages. Retest: on each page, press Tab once; "Skip to content" shows, and Enter moves to the content (A11Y-6) | [TS17](results/TS17-accessibility-testing-results-2026-10-30.md) static scan and A11Y-6; also [TS09](results/TS09-functional-testing-results-2026-10-30.md) NFR skip link | Fixed: retest due |
