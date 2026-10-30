# TS10 results · UI and UX testing

| | |
|---|---|
| Task | [TS10](../TS10-ui-ux-testing.md) |
| Run | 2026-10-30, 09:00 to 09:45 UTC |
| Commit | `d2b9639` (main) |
| Environment | Production (radar.pehchanthetraveller.com) by curl, and the built pages in the repo. No browser was connected |
| Run by | Claude Code, read-only |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| UI-0 | Every page loads | Pass | curl: `/`, `/about/`, `/demo/`, `/live/`, `/pricing/`, `/signup/`, `/signin/`, `/manage/`, `/admin/` and the 4 legal pages give 200 in 0.25 to 0.40 s (warm). The first run of the day took 0.49 to 1.76 s, `/live/` slowest |
| UI-1 | Every page in every state, 1280 and 360 px, both themes (the table in TS10 step 1) | Needs owner | Needs a browser and the signed-in states (Free, Pro, cancelled, lapsed). No browser was connected to Claude in Chrome |
| UI-2 | The 6 questions per page (purpose in 5 seconds, button labels, header state, `plan.json` wording, errors, no dead ends) | Needs owner | Same as UI-1. What could be checked from the HTML: `/pricing/` shows "₹1 a month or ₹1 a year", matching `plan.json`; the refund page says 7 days to ask and 14 days for the money to arrive, which matches `plan.json` (`refundDays` is the arrival time) |
| UI-3 | `npm run check` (pages, links, footer, locked panels, `plan.json` text, contrast) | Pass | 244 checks, 0 failed |
| BUG-005 | No Sign in once signed in | Fixed in code; retest signed in: Needs owner | Fix `ebc4daf` (2026-10-28). 10 pages swap the header's `#acct` link to "Account" when `/api/session?action=me` says `signedIn`: home, about, pricing, signup, subscribe, the 4 legal pages, live. `manage` is the account page; `signin`, `admin` and `demo` have no Sign in link. Sign in text left on purpose: the home footer, "Already have an account? Sign in" on signup, and `#inLink` inside the hidden sign-in dialog |
| BUG-006 | Spelling in our own copy | Pass (mechanical); a person still reads it | A script read `sampleData.json` (39 strings) and `travel-problem-radar.jsx` (59 strings): none of the common misspellings it checks, no doubled words. "traveler" (US) is used throughout; "traveller" appears only in the brand and domain. The static scan of 14 built pages found no typos; its doubled-word hits are separate elements (a plan name next to its price, "Demo" next to a "DEMO" badge), not copy errors |
| BUG-007 | `/subscribe/` against `/manage/` | Pass (redirect confirmed) | `/subscribe/` gives 307 to `/pricing/`. Whether pricing and manage now each do one job is the owner's call |

**Totals:** 5 Pass (UI-0, UI-3, BUG-006 mechanical, BUG-007, BUG-005 in code), 2 Needs owner (UI-1, UI-2).

## Bugs found

None new. Retests of BUG-005, 006 and 007 are recorded in [TS19 results](TS19-bug-reporting-and-retesting-results.md).

## Left to do

| What | Who |
|---|---|
| Review every page and state at both widths and themes (UI-1, UI-2) | Owner, or Claude Code once a browser is connected |
| Sign in, open each of the 10 pages, confirm "Account" shows (BUG-005) | Owner |
| Read the demo once by eye (BUG-006) | Owner |
| Close or keep BUG-007 | Owner |
| Add the `check.mjs` rule from TS10 step 3 (every page with a Sign in link also loads the session check) | Claude Code |
