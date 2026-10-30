# TS03 · Test scenarios

| | |
|---|---|
| Component | Test scenarios |
| Who | Claude Code drafts; the owner (QA lead, BA) reviews |
| Status | Not started |
| Depends on | TS02 |
| Size | M |
| Unblocks | TS04, TS08, TS12, TS16 |

## What it means here

A scenario is one situation a user or the system can be in, written in a line, before the steps. The catalogue
below covers every journey in the product: the happy path, the negative paths and the edge cases. TS04 turns each
into test cases; TS08 runs them end to end.

## In place today

- The offline suites already cover many scenarios, named by T-file section (for example "T17", "partial and total
  failure"). They aren't listed as scenarios.
- [flows-and-screens.md](../03-design/flows-and-screens.md) describes the journeys end to end.

## Gaps

- No list of scenarios, so nobody can see what's covered and what isn't.
- Negative and edge cases for browser, inbox and payment journeys exist only in people's heads.

## The work

1. Review the catalogue below with the owner; add or drop rows.
2. For each row, mark **Covered (auto)** with the test section, **Manual** for a TS04 case, or **Gap**.
3. Order the gaps by risk: money and access first.

### The catalogue

IDs are SC-<journey>-<n>. H is a happy path, N negative, E an edge case.

**V · Visitor and demo**

| ID | Type | Scenario |
|---|---|---|
| SC-V-1 | H | A visitor opens the home page, then the demo, and reads a saved sample with no sign-in |
| SC-V-2 | H | The demo makes no AI or API calls (REQ-07) |
| SC-V-3 | N | A visitor opens `/live/` and sees the locked board with a way to subscribe |
| SC-V-4 | E | A visitor opens a shared problem link (`/p/<sweep>/<item>`) |
| SC-V-5 | E | A visitor on a phone at 360 px |

**F · Free sign-up and email**

| ID | Type | Scenario |
|---|---|---|
| SC-F-1 | H | Sign up by email, open the confirm link, press Confirm, get the welcome |
| SC-F-2 | H | Free gets one email a day, after the day's first saved sweep (REQ-14) |
| SC-F-3 | N | Sign up with an address already subscribed, in a different spelling (REQ-22) |
| SC-F-4 | N | Sign-up when it isn't open (`MAX_SUBSCRIBERS` unset) or full (cap 5,000) |
| SC-F-5 | N | The confirm link is opened twice, or after 7 days (`PENDING_TTL_DAYS`) |
| SC-F-6 | N | Too many sign-ups from one IP |
| SC-F-7 | E | A mail scanner opens the confirm link without pressing Confirm (D9) |
| SC-F-8 | E | Each sign-up path proves the user owns the inbox (bug note 4) |

**U · Unsubscribe**

| ID | Type | Scenario |
|---|---|---|
| SC-U-1 | H | Unsubscribe from the link in an email |
| SC-U-2 | H | Gmail's one-click Unsubscribe button (REQ-13) |
| SC-U-3 | E | A Pro member unsubscribes and keeps Pro (REQ-25) |
| SC-U-4 | N | An invalid or old unsubscribe link |
| SC-U-5 | E | A bounce or spam complaint stops mail (REQ-20) |

**S · Sign-in and account**

| ID | Type | Scenario |
|---|---|---|
| SC-S-1 | H | Sign in by emailed link |
| SC-S-2 | H | Continue with Google, for an existing account and for a new one |
| SC-S-3 | H | Set a password, sign in with it, remove it |
| SC-S-4 | N | A wrong password, an expired or reused code, too many tries |
| SC-S-5 | E | The session ends when the browser closes or after 12 hours |
| SC-S-6 | E | The header shows the right state once signed in (bug note 5) |
| SC-S-7 | H | Sign out |
| SC-S-8 | H | Delete the account |

**P · Pro: buy, use, cancel, renew, expire**

| ID | Type | Scenario |
|---|---|---|
| SC-P-1 | H | A Free member buys Pro on `/manage/`, pays, returns, and the board unlocks |
| SC-P-2 | H | Pro picks categories, areas and 1 to 5 emails a day, and the email follows the choice |
| SC-P-3 | H | Pro searches all sweeps, saves a problem, shares one |
| SC-P-4 | H | Pro cancels and keeps Pro to the end of the paid period |
| SC-P-5 | H | Pro renews (Keep renewing) |
| SC-P-6 | E | Payment stops; Pro holds for 48 hours, then turns Free |
| SC-P-7 | N | The checkout is closed or fails; the account stays Free |
| SC-P-8 | E | The return arrives before the webhook; the page waits for it |
| SC-P-9 | N | A duplicate or unsigned webhook changes nothing (REQ-27) |
| SC-P-10 | E | Google sign-in, then payment, then the redirect to the live board (bug note 1) |
| SC-P-11 | E | An account paid in test mode doesn't see the live board in production (bug note 2) |
| SC-P-12 | N | A test key on Production or a live key on a Preview turns payments off |

**A · Admin**

| ID | Type | Scenario |
|---|---|---|
| SC-A-1 | H | The owner signs in to `/admin/` and sees the counts |
| SC-A-2 | H | The owner grants or revokes Pro and deletes a member |
| SC-A-3 | N | A wrong password 5 times in an hour gives 429 |
| SC-A-4 | N | Admin is off (503) when its settings aren't set |
| SC-A-5 | E | Which accounts still get email (bug note 3) |

**W · The sweep**

| ID | Type | Scenario |
|---|---|---|
| SC-W-1 | H | A scheduled sweep saves 4 categories and sends the due emails |
| SC-W-2 | E | One category fails; the others save (REQ-06) |
| SC-W-3 | N | All categories fail; nothing is saved and the run says so (REQ-06) |
| SC-W-4 | N | A call without the secret gets 401 |
| SC-W-5 | N | A fourth manual sweep in a UTC day gets 429 (REQ-32) |
| SC-W-6 | E | A slot nobody chose is skipped |
| SC-W-7 | E | The sweep nears the 300-second limit with many subscribers (REQ-16) |
| SC-W-8 | E | The 61st sweep drops the oldest (REQ-04) |

**L · Static and legal pages**

| ID | Type | Scenario |
|---|---|---|
| SC-L-1 | H | Every page loads, with the same footer (REQ-30) |
| SC-L-2 | H | Pricing, manage and the policy pages show the values in `plan.json` (REQ-29) |
| SC-L-3 | E | `/subscribe/` and `/manage/`: each page's job is clear (bug note 7) |
| SC-L-4 | E | No spelling mistakes (bug note 6) |

## Done when

- The owner reviewed the catalogue.
- Every row is marked Covered (auto), Manual or Gap.
- The gaps are ordered by risk and each has an owner.

## Tools and cost

None. Free.

## Risks and notes

- The catalogue lists scenarios, not steps. Keep it short so it stays read.
- When a feature ships, add its scenarios here in the same PR.
