# TS04 · Test cases

| | |
|---|---|
| Component | Test cases |
| Who | Claude Code writes them; the owner (QA) runs the manual ones |
| Status | Partial: 1,719 automated checks (2026-10-31); no manual cases written |
| Depends on | TS03 |
| Size | M |
| Unblocks | TS08, TS09, TS12, TS16 |

## What it means here

A test case is a scenario turned into steps, data and an expected result that someone can follow without asking.
Here the automated cases already exist as checks in the 10 suites. What's missing is the manual cases: the ones that
need a browser, an inbox, a card or a Google account.

## In place today

Automated cases, counted on `fa4f8e6` (2026-10-31), every one passing. At the first test run (`c848b94`,
2026-10-30) there were 8 suites, 1,582 checks and 244 site checks:

| Suite | Checks |
|---|---|
| [test-sweep.mjs](../../scripts/test-sweep.mjs) | 253 |
| [test-subscriptions.mjs](../../scripts/test-subscriptions.mjs) | 1,062 |
| [test-compare.mjs](../../scripts/test-compare.mjs) | 40 |
| [test-score.mjs](../../scripts/test-score.mjs) | 46 |
| [test-cost.mjs](../../scripts/test-cost.mjs) | 25 |
| [test-plan.mjs](../../scripts/test-plan.mjs) | 73 |
| [test-admin.mjs](../../scripts/test-admin.mjs) | 49 |
| [test-password.mjs](../../scripts/test-password.mjs) | 56 |
| [test-ask.mjs](../../scripts/test-ask.mjs) (T43) | 76 |
| [test-trends.mjs](../../scripts/test-trends.mjs) (T44) | 39 |
| **Total (`npm test`)** | **1,719** |
| [check.mjs](../../scripts/check.mjs) (`npm run check`) | 256 |

Each check prints `PASS` and a sentence that says what it proves, so the output reads as a case list.

## Gaps

- No manual cases, so browser, inbox and payment checks are done from memory and not recorded.
- No link from a scenario (TS03) to its automated checks.

## The work

1. Use the template below for every manual case.
2. Write a case for each TS03 scenario marked Manual. The first set is below.
3. For each scenario marked Covered (auto), name the suite and section; don't copy the steps.
4. Keep the cases in this file until there are more than about 40, then move them to `cases.md`.

### Template

| Field | What goes in it |
|---|---|
| ID | TC-<journey>-<n>, matching the scenario |
| Scenario | The SC id from TS03 |
| Environment | Local, `staging` Preview, or Production (read-only) |
| Preconditions | Account state, plan, data |
| Steps | Numbered, one action each |
| Expected | What the user sees and what the record holds |
| Type | Manual or Auto (suite and section) |
| Result | Pass, Fail (with a TS19 bug id), Blocked; date and who ran it |

### The first manual cases

All on the `staging` Preview with Razorpay test keys and the owner's test inboxes, unless marked.

| ID | Scenario | Preconditions | Steps | Expected |
|---|---|---|---|---|
| TC-F-1 | SC-F-1 | A test inbox not yet subscribed | 1. Sign up on `/signup/`. 2. Open the confirm email. 3. Open the link. 4. Press Confirm | The confirm page shows a button and doesn't confirm on open. After pressing, the page says you're subscribed and a welcome email arrives |
| TC-F-2 | SC-F-7 | A new pending sign-up | Open the confirm link only (don't press) | Still pending after 1 minute (`subscribers.mjs` on staging) |
| TC-F-3 | SC-F-8 | Three test inboxes | Sign up once by email, once by Google, once with a password | Each path proves the inbox before anything is sent to it. Record what each path does |
| TC-U-1 | SC-U-2 | A confirmed test subscriber in Gmail | Press Gmail's own Unsubscribe next to the sender | No more email to that inbox; the record shows unsubscribed |
| TC-U-2 | SC-U-3 | A Pro test account | Unsubscribe from an email | Email stops; `/manage/` still shows Pro; the board stays open |
| TC-S-1 | SC-S-2 | An existing test account | Continue with Google | Lands on `/manage/` signed in to the same account, with no new account made |
| TC-S-2 | SC-S-5 | Signed in | Close the browser fully and reopen `/manage/` | Signed out |
| TC-S-3 | SC-S-6 | Signed in | Open home, pricing, subscribe and the legal pages | No page offers Sign in; each shows the signed-in state |
| TC-P-1 | SC-P-1 | A Free test account | 1. On `/manage/`, choose Pro. 2. Read the summary. 3. Pay with a Razorpay test card. 4. Return | The summary shows price, renewal, cancelling and the refund rule from `plan.json`. After the webhook, Pro is on and `/live/` opens |
| TC-P-2 | SC-P-10 | An existing account, signed out | 1. Continue with Google. 2. Buy Pro with a test card | After paying, the user reaches the live board, or a page that takes them there |
| TC-P-3 | SC-P-7 | A Free test account | Open checkout and close it | Still Free; `/manage/` offers checkout again |
| TC-P-4 | SC-P-4 | A Pro test account | Cancel on `/manage/` | The page says when Pro ends; Pro stays until then |
| TC-P-5 | SC-P-2 | Production: the owner's own Pro account | Choose 2 categories and 1 area; wait for the next scheduled sweep | The email holds only those categories and that area (plus global items) |
| TC-A-1 | SC-A-1 | Admin settings set on staging | Sign in to `/admin/` | Counts show; addresses only when asked |
| TC-L-1 | SC-L-2 | — | Open pricing, manage and the refund page | The same price, period and refund rule as `plan.json` |
| TC-L-2 | SC-L-1 | Production, read-only | Open every page in the TS13 list | Each loads with the same footer and no console errors |

## Done when

- Every TS03 scenario marked Manual has a case.
- Every scenario marked Covered (auto) names its suite and section.
- Each case has been run once, with a result and a date.

## Tools and cost

- Razorpay test cards and test mode: free.
- Test inboxes the owner already has: free.
- No new tools.

## Risks and notes

- Staging must have test keys only. T22's key-mismatch guard turns payments off if a live key is on a Preview; check
  the sweep reply before a payment case.
- Don't run payment cases in production. A live ₹1 payment is still a real payment.
- TC-P-5 runs in production because Pro email goes out only after scheduled sweeps (REQ-15), and only production
  has the schedule. It changes only the owner's own choices and costs nothing extra; set them back afterwards.
