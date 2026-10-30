# TS10 · UI/UX testing

| | |
|---|---|
| Component | UI/UX testing |
| Who | The owner (designer, PM, QA) reviews; Claude Code fixes and adds checks |
| Status | Not started |
| Depends on | TS03 |
| Size | M |
| Unblocks | TS16, TS17, TS18 |

## What it means here

Checking each page looks right, reads clearly and is easy to use: layout, navigation, copy, and every state a page
can be in (signed out, signed in, Free, Pro, locked, empty, loading, error). It also checks the pages say the same
true things about Pro, by the rules in
[T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md).

## In place today

- `npm run check` (244 checks) covers part of it automatically:
  - pages and links exist;
  - the footer is on every page;
  - the locked-board panels;
  - pages filled from `plan.json`;
  - contrast (42 pairs in each theme).
- [homepage-review.md](../../docs/site/homepage-review.md) audited the home page on 2026-10-22.
- [flows-and-screens.md](../03-design/flows-and-screens.md) describes the screens.

## Gaps

- No review of every page in every state.
- Three of the owner's bug notes are UI:

| Note | What was seen | Severity (proposed) |
|---|---|---|
| 5 | A Sign in option shows on the pricing page when already signed in | S3 |
| 6 | Check the demo for spelling mistakes | S4 |
| 7 | `/subscribe/` and `/manage/`: what's the difference? The two pages overlap | S3 |

## The work

1. **Review every page** in each state that applies, at 1280 px and 360 px wide, in both themes:

| Page | States to see |
|---|---|
| `/` home | Signed out, signed in |
| `/about/` | — |
| `/demo/` | Each tab: board, report (digest), detail panel |
| `/live/` | Locked (signed out, Free); open (Pro); empty search; no saved problems; a shared problem link |
| `/subscribe/` | New, already subscribed, closed, error |
| `/signup/`, `/signin/` | Each method; wrong code; too many tries |
| `/manage/` | Free, Pro, Pro cancelled, lapsed; checkout summary |
| `/pricing/` | Signed out, signed in Free, signed in Pro |
| `/admin/` | Signed out, signed in |
| `/legal/privacy/`, `/terms/`, `/contact/`, `/refunds/` | — |
| Emails | Confirm, welcome, Free daily, Pro digest, sign-in code |

2. **For each page, check:**
   - Can a first-time user tell what the page is for, and what to do next, in 5 seconds?
   - Does every button say what it does?
   - Does the header show the right state (signed in or not, Free or Pro)?
   - Price, renewal, cancelling and refund wording match `plan.json` and T23.
   - Errors say what went wrong and what to do.
   - No dead ends: every state has a next step.
3. **Bug note 5:** list every page that shows Sign in, and check each once signed in. If the header reads the session
   on some pages and not others, fix it in one place, and add a `check.mjs` rule that every page with a Sign in link
   also loads the session check.
4. **Bug note 6:** spell-check the demo and every shipped page. Copy the visible text out (the browser's Select All,
   or a script that strips tags from the built pages) and run it through a spell checker. The sample data's titles
   and summaries come from the AI and the news; fix only our own copy.
5. **Bug note 7:** write down each page's one job. A proposal for the owner to decide: `/subscribe/` is for joining
   (no account yet); `/manage/` is for members (plan, email choices, billing). Then remove what overlaps, and have
   each page link to the other for the wrong visitor.
6. Log each finding in [TS19](TS19-bug-reporting-and-retesting.md) with a screenshot (no addresses showing).

## Done when

- Every page in the table is reviewed in each state, at both widths and in both themes, with findings logged.
- Bug notes 5, 6 and 7 are fixed or decided, and retested.
- The `check.mjs` rule for note 5 is in, if the fix allows one.

## Tools and cost

- A browser and its DevTools (device mode for 360 px): free.
- A spell checker: the browser's own, or the one in VS Code. A VS Code spelling extension is free but an install.
  **Ask first.**

## Risks and notes

- UI review is opinion as well as fact. Mark each finding as a defect (it breaks a rule or a REQ) or a suggestion
  (the owner decides).
- Pages are filled at build time (`fill-plan.mjs`, `fill-legal.mjs`). Review the built pages or the deployed site,
  not the source HTML.
