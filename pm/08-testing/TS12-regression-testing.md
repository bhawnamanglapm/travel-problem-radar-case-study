# TS12 · Regression testing

| | |
|---|---|
| Component | Regression testing |
| Who | Claude Code keeps the automated suite; the owner runs the manual list |
| Status | Partial: CI on every PR and push to `main`; no browser or email regression |
| Depends on | TS04, TS06 |
| Size | S |
| Unblocks | TS20 |

## What it means here

Checking that a change didn't break what already worked. Here that's two layers:
- **Automated:** every check in `npm test` and `npm run check`, run in CI on every pull request and every push to `main`.
- **Manual:** a short list of the top journeys, run before a release that touches them.

## In place today

[check.yml](../../.github/workflows/check.yml) runs on every pull request and push to `main`, on Node 22:
1. `npm ci`;
2. `npm run build`, then fails if the built bundles differ from the committed ones (bundle freshness);
3. `npm run check` (256 checks);
4. `npm test` (1,719 checks).

All pass on `fa4f8e6` (2026-10-31); at the first test run (`c848b94`, 2026-10-30) they were 244 and 1,582. The suites have grown from 952 tests and 199 checks on 2026-10-23, as each task
added its own.

## Gaps

- Nothing in CI opens a browser, so a page that builds but breaks when run isn't caught.
- No email regression: a template change is checked offline (the text), not in a real inbox.
- No written manual list, so what was rechecked before a release isn't recorded.
- The "every fix gets a test" rule isn't written down (TS06 adds it).

## The work

1. **The rule.** A bug fix adds a test that fails without the fix (TS06 step 5). The PR says which test.
2. **The manual regression list.** Run the rows a change touches; all rows before a release that changes accounts,
   payments or delivery.

| ID | Journey | Check | Time |
|---|---|---|---|
| RG-1 | Home and demo | Pages load; demo board, report and detail panel work | 2 min |
| RG-2 | Live board as Pro | Board loads, filters, search, save, share | 3 min |
| RG-3 | Locked board | Signed out and Free see the lock and a way to Pro | 1 min |
| RG-4 | Sign-in | Link, Google and password each sign in | 5 min |
| RG-5 | `/manage/` | Plan, choices and billing show right for Free and Pro | 3 min |
| RG-6 | Checkout (staging only) | TC-P-1 with a test card | 5 min |
| RG-7 | Email | The next Pro digest arrives and its links work | Next sweep |
| RG-8 | Unsubscribe | TC-U-1 on a test inbox | 2 min |

3. **Record each run** in the PR: the rows run, pass or fail.
4. **Later, optional:** a browser check in CI would catch RG-1 to RG-3 automatically. It needs a headless browser
   package (Playwright or Puppeteer). **Ask first**: it's a new dependency and slows CI.

## Done when

- The rule is in the test plan.
- The manual list is used for the next release and recorded in its PR.

## Tools and cost

- GitHub Actions on a public repository: free.
- A headless browser in CI: free software but a new dependency. **Ask first.**

## Risks and notes

- The bundle-freshness step means a PR that changes `travel-problem-radar.jsx` must commit the rebuilt bundles, or
  CI fails. That's intended.
- A long manual list gets skipped. Keep it under 30 minutes; move rows to automation when they can be.
