# Stage 8 · Testing: the test plan

> This stage holds the plan and the tasks for testing, not the results. Each task file says what is in place today,
> with the file it was read from, and what is still to do. Counts were taken on `main` at `c848b94` on 2026-10-30.

## Why this stage

Testing is strong offline and thin everywhere else.

- **In place:**
  - 8 offline suites with 1,582 checks (`npm test`);
  - 244 site checks (`npm run check`);
  - both run in CI on every pull request and push to `main`, with a check that the built bundles match their source
    ([check.yml](../../.github/workflows/check.yml)).
- **Not written down anywhere:**
  - browser, email-client, accessibility, performance, security and production checks;
  - a bug log;
  - acceptance criteria for most requirements;
  - a way to sign off a release.
- **Open bugs:** 7 owner notes that weren't tracked anywhere. They are now in [TS19](TS19-bug-reporting-and-retesting.md).

## Scope

**In scope**
- **The radar:** the sweep, the data feed (`/api/data`), the live board, the public demo.
- **Email:** sign-up, double opt-in, Free and Pro digests, unsubscribe and one-click unsubscribe.
- **Accounts:** emailed sign-in link, Continue with Google, password, the `/manage/` page.
- **Payments:** Razorpay checkout, cancel, renew, expiry and the webhook.
- **Admin:** the admin page and `scripts/subscribers.mjs`.
- **Static pages:** home, about, pricing, sign-in, sign-up and the legal pages (`/subscribe/` redirects to `/pricing/`).

**Out of scope.** Anthropic, Vercel, Blob, Resend, Razorpay and Google themselves. We test only our use of them.

## Environments

| Environment | Data | Used for | Rules |
|---|---|---|---|
| Local, offline | Fakes in [test-helpers.mjs](../../scripts/test-helpers.mjs) (`memStorage`, `mockRes`); `sampleData.json` | Unit and integration tests, site checks | Free; run any time |
| Preview, branch `staging` | Razorpay **test** keys; the owner's test inboxes | System, payments, UAT, browsers | Writes to the Preview Blob store only; test cards only |
| Production, radar.pehchanthetraveller.com | Real | Smoke and production validation only | Read-only; the owner's own account; nothing that sends email, charges or sweeps without the owner's yes |

`travel-problem-radar.vercel.app` redirects to the custom domain, except for `/api/` paths.

## Who does what

The pasted table names the roles a team usually has. This is a one-person team, so they map like this:

| Usual role | Here |
|---|---|
| Product manager, business analyst, product owner | The owner |
| Business users, UAT testers | The owner first; PMs once there are users |
| UI/UX designer | The owner |
| Developers | Claude Code, reviewed by the owner |
| QA tester, automation tester, performance tester | Claude Code writes and runs the tests; the owner runs the manual checks that need a browser, an inbox or a card |
| Security tester | Claude Code reviews the code; the owner checks settings in Vercel, Razorpay and Google |
| DevOps, release manager | The owner (Vercel, GitHub) |
| Outside | A CA, for GST and compliance only, not testing |

## Status of the 20 components

From the first test run, 2026-10-30. The [results index](results/README.md) has the counts and the release verdict.

| # | Component | Status | Evidence |
|---|---|---|---|
| [TS01](TS01-requirements-validation.md) | Requirements validation | Run 2026-10-30 | Drift D1 to D8 confirmed (7 Pass, D3 needs the owner); the PRD isn't updated yet. [Results](results/TS01-results.md) |
| [TS02](TS02-acceptance-criteria.md) | Acceptance criteria | Run: fails | 9 of 32 REQs have Given/When/Then lines; 5 drafts await the owner. [Results](results/TS02-results.md) |
| [TS03](TS03-test-scenarios.md) | Test scenarios | Run 2026-10-30 | 55 scenarios marked: 43 automated, 9 manual only, 3 gaps. [Results](results/TS03-results.md) |
| [TS04](TS04-test-cases.md) | Test cases | Partial | 1,582 + 244 automated checks pass; 14 manual cases wait for the owner; 6 manual scenarios have no case. [Results](results/TS04-results.md) |
| [TS05](TS05-test-data.md) | Test data | Partial | Production counted read-only; the 2 test-mode subscriptions are still in the paid count. [Results](results/TS05-results.md) |
| [TS06](TS06-unit-testing.md) | Unit testing | In place (server) | 8 suites pass; no coverage measure; the React boards have no tests. [Results](results/TS06-results.md) |
| [TS07](TS07-integration-testing.md) | Integration testing | Partial | Production sweeps work (27 of 30 runs; 3 failed on credit, as designed); staging rows blocked. [Results](results/TS07-results.md) |
| [TS08](TS08-system-testing.md) | System testing | Needs owner | BUG-003 answered by counts; the run sheet needs staging, inboxes and a browser. [Results](results/TS08-results.md) |
| [TS09](TS09-functional-testing.md) | Functional testing | Run 2026-10-30 | 28 of 32 REQs pass, 4 not tested; the skip-link and header NFRs fail. [Results](results/TS09-results.md) |
| [TS10](TS10-ui-ux-testing.md) | UI/UX testing | Partial | Pages load; BUG-005 fixed in code, 006 and 007 retested; the page-by-page review needs a browser. [Results](results/TS10-results.md) |
| [TS11](TS11-api-testing.md) | API testing | Run 2026-10-30 | API-1 to API-6 pass on production. [Results](results/TS11-results.md) |
| [TS12](TS12-regression-testing.md) | Regression testing | Partial | CI green (20 of 20); the manual list RG-1 to RG-8 not run. [Results](results/TS12-results.md) |
| [TS13](TS13-smoke-testing.md) | Smoke testing | Run 2026-10-30 | 9 of 10 pass by curl and logs; SM-4 needs the owner. [Results](results/TS13-results.md) |
| [TS14](TS14-performance-testing.md) | Performance testing | Partial | Sweeps take 14 to 16 s but start 2.5 to 7 hours late (BUG-008); Lighthouse blocked by the API quota. [Results](results/TS14-results.md) |
| [TS15](TS15-security-testing.md) | Security testing | Run: 2 fails | Checklist 8 of 10 pass; `npm audit` (BUG-009) and headers (BUG-010) fail; no keys in history. [Results](results/TS15-results.md) |
| [TS16](TS16-user-acceptance-testing.md) | UAT | Needs owner | 20 live items picked for marking; no sign-off. [Results](results/TS16-results.md) |
| [TS17](TS17-accessibility-testing.md) | Accessibility testing | Partial | Static scan: 7 of 8 checks pass; skip link on 1 of 14 pages (BUG-011); keyboard and screen reader not run. [Results](results/TS17-results.md) |
| [TS18](TS18-cross-browser-and-device-testing.md) | Cross-browser and device | Needs owner | Matrix ready; nothing run. [Results](results/TS18-results.md) |
| [TS19](TS19-bug-reporting-and-retesting.md) | Bug reporting and retesting | In use | 11 bugs logged (BUG-008 to 011 from this run); 4 retested. [Results](results/TS19-results.md) |
| [TS20](TS20-production-validation.md) | Production validation | Partial | The latest sweep ran and no key mismatch; inbox and admin checks need the owner. [Results](results/TS20-results.md) |

## Order of work

| Phase | Tasks | Why this order |
|---|---|---|
| 1. Define | TS01 to TS05 | Every later task tests against these: what the product should do, and how we'd know |
| 2. Automate what exists | TS06, TS07, TS11, TS12 | Cheap, offline and repeatable; closes the gaps in what CI already runs |
| 3. Before charging more people | TS08 to TS10, TS13 to TS18 | The checks a paying user would notice: whole journeys, pages, browsers, access, speed, security |
| 4. Every release | TS19, TS20 | The loop that keeps running: log bugs, retest, check production |

Razorpay has been in live mode since 2026-10-28, so phase 3 matters now, not later. TS08, TS10, TS15 and TS19 come
first within it, because they hold the open bugs.

## Release entry and exit

**Entry: a change is ready to test when**
- it's on a branch with a PR;
- `npm test` and `npm run check` pass locally;
- the bundles are rebuilt if `live/src` or `demo/src` changed.

**Exit: a release can go to production when**
1. CI is green on the PR.
2. The regression list in [TS12](TS12-regression-testing.md) passed for the journeys the change touches.
3. No open S1 or S2 bug (below).
4. For a change a user can see, the owner signed it off ([TS16](TS16-user-acceptance-testing.md)).
5. After the deploy, the smoke list in [TS13](TS13-smoke-testing.md) passed.

## Bug severity

| Severity | Meaning | Example | Fix by |
|---|---|---|---|
| S1 | Money, data or security: a user is charged wrongly, loses access they paid for, or data leaks | Paid but the board stays locked | Now; consider a rollback |
| S2 | A main journey is blocked with no workaround | Sign-in fails for one method | Before the next release |
| S3 | A journey works but is wrong or confusing; a workaround exists | Sign in shows when already signed in | When planned |
| S4 | Cosmetic | A spelling mistake | When convenient |

The template and the life cycle are in [TS19](TS19-bug-reporting-and-retesting.md).

## Rules

1. No new npm packages and no paid tools without asking. Free tools that need no install (browser DevTools,
   Lighthouse, axe DevTools, NVDA) are fine.
2. No real customer data in tests or docs. No email addresses in the repo.
3. No secrets in docs, logs or screenshots.
4. No spend, sweeps, emails, Slack messages, Razorpay calls or production writes without the owner's yes.
5. Every bug fixed gets a test that would have caught it, where it can be automated.
6. A count or a result in these docs names its source and date. Nothing is filled in to look complete.

## The tasks

| Task | Who | Size |
|---|---|---|
| [TS01 Requirements validation](TS01-requirements-validation.md) | Owner, Claude Code | S |
| [TS02 Acceptance criteria](TS02-acceptance-criteria.md) | Owner, Claude Code | M |
| [TS03 Test scenarios](TS03-test-scenarios.md) | Claude Code, owner reviews | M |
| [TS04 Test cases](TS04-test-cases.md) | Claude Code | M |
| [TS05 Test data](TS05-test-data.md) | Claude Code, owner for staging | S |
| [TS06 Unit testing](TS06-unit-testing.md) | Claude Code | M |
| [TS07 Integration testing](TS07-integration-testing.md) | Claude Code, owner on staging | M |
| [TS08 System testing](TS08-system-testing.md) | Owner, Claude Code | L |
| [TS09 Functional testing](TS09-functional-testing.md) | Claude Code, owner | M |
| [TS10 UI/UX testing](TS10-ui-ux-testing.md) | Owner | M |
| [TS11 API testing](TS11-api-testing.md) | Claude Code | M |
| [TS12 Regression testing](TS12-regression-testing.md) | Claude Code, owner | S |
| [TS13 Smoke testing](TS13-smoke-testing.md) | Owner | S |
| [TS14 Performance testing](TS14-performance-testing.md) | Claude Code, owner | M |
| [TS15 Security testing](TS15-security-testing.md) | Claude Code, owner | L |
| [TS16 User acceptance testing](TS16-user-acceptance-testing.md) | Owner | M |
| [TS17 Accessibility testing](TS17-accessibility-testing.md) | Owner, Claude Code | M |
| [TS18 Cross-browser and device testing](TS18-cross-browser-and-device-testing.md) | Owner | M |
| [TS19 Bug reporting and retesting](TS19-bug-reporting-and-retesting.md) | Owner, Claude Code | S |
| [TS20 Production validation](TS20-production-validation.md) | Owner | S |

Each task file has the same parts: a header, what the component means here, what's in place, the gaps, the work,
when it's done, tools and cost, and risks.
