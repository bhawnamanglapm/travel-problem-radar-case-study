# Test run results, 2026-10-30

The first run of the [test plan](../README.md): TS01 to TS20, offline and read-only against production. It cost
nothing: no sweeps, emails or payments were triggered, and nothing was written to Blob, Razorpay or Vercel. Staging
wasn't used, because it's about 121 commits behind `main`.

**Run on** 2026-10-30, 08:50 to 09:55 UTC, on commit `d2b9639` (`main`), by Claude Code. Rows marked "Needs owner"
need a browser, an inbox, a phone, a sign-in or a decision only the owner has.

## Index

| Task | Environment | Pass | Fail | Blocked | Needs owner | Other | Results |
|---|---|---|---|---|---|---|---|
| TS01 Requirements validation | Offline, production read-only | 7 | 0 | 0 | 1 | | [TS01](TS01-requirements-validation-results-2026-10-30.md) |
| TS02 Acceptance criteria | Offline | 0 | 2 | 0 | 1 | | [TS02](TS02-acceptance-criteria-results-2026-10-30.md) |
| TS03 Test scenarios | Offline | 55 marked | 3 gaps | 0 | 0 | 43 auto, 9 manual only | [TS03](TS03-test-scenarios-results-2026-10-30.md) |
| TS04 Test cases | Offline | 2 | 1 | 0 | 14 cases | | [TS04](TS04-test-cases-results-2026-10-30.md) |
| TS05 Test data | Offline, production read-only | 2 | 1 | 1 | 1 | | [TS05](TS05-test-data-results-2026-10-30.md) |
| TS06 Unit testing | Offline | 2 | 1 | 0 | 0 | 1 not run | [TS06](TS06-unit-testing-results-2026-10-30.md) |
| TS07 Integration testing | Offline, production logs | 3 | 1 | 8 | 0 | | [TS07](TS07-integration-testing-results-2026-10-30.md) |
| TS08 System testing | Production read-only | 1 | 0 | 0 | 13 | | [TS08](TS08-system-testing-results-2026-10-30.md) |
| TS09 Functional testing | Both | 28 REQs | 2 NFRs | 0 | 0 | 4 REQs not tested | [TS09](TS09-functional-testing-results-2026-10-30.md) |
| TS10 UI and UX testing | Production by curl, offline | 5 | 0 | 0 | 2 | | [TS10](TS10-ui-ux-testing-results-2026-10-30.md) |
| TS11 API testing | Production read-only | 6 (+6 probes) | 0 | 0 | 0 | | [TS11](TS11-api-testing-results-2026-10-30.md) |
| TS12 Regression testing | Offline, GitHub Actions | 3 | 0 | 1 | 6 | 1 not run | [TS12](TS12-regression-testing-results-2026-10-30.md) |
| TS13 Smoke testing | Production read-only | 9 | 0 | 0 | 1 | | [TS13](TS13-smoke-testing-results-2026-10-30.md) |
| TS14 Performance testing | Production read-only | 2 | 1 | 1 | 1 | 2 recorded, 1 not run | [TS14](TS14-performance-testing-results-2026-10-30.md) |
| TS15 Security testing | Both | 9 | 2 | 0 | 2 | 2 not run | [TS15](TS15-security-testing-results-2026-10-30.md) |
| TS16 User acceptance | Production read-only | 2 | 0 | 1 | 3 | sign-off not done | [TS16](TS16-user-acceptance-testing-results-2026-10-30.md) |
| TS17 Accessibility testing | Offline | 1 | 1 | 0 | 5 | | [TS17](TS17-accessibility-testing-results-2026-10-30.md) |
| TS18 Cross-browser and device | None run | 0 | 0 | 2 | 7 | | [TS18](TS18-cross-browser-and-device-testing-results-2026-10-30.md) |
| TS19 Bug reporting and retesting | The log | 2 | 0 | 0 | 1 | 2 not yet | [TS19](TS19-bug-reporting-and-retesting-results-2026-10-30.md) |
| TS20 Production validation | Production read-only | 2 | 0 | 0 | 7 | | [TS20](TS20-production-validation-results-2026-10-30.md) |

## Bugs

4 new, all proposed S3, logged in [TS19](../TS19-bug-reporting-and-retesting.md#the-log):

| ID | What | Found by |
|---|---|---|
| BUG-008 | Scheduled sweeps run 155 to 418 minutes after their slot, later than `/manage/` promises | TS14 |
| BUG-009 | `npm audit`: 4 high (`zod` through `@vercel/blob`), 1 moderate | TS15 |
| BUG-010 | No security headers beyond HSTS | TS15 |
| BUG-011 | No skip link on 13 of 14 pages | TS17 |

Retests: BUG-005 fixed in code (signed-in retest due), BUG-006 passed a mechanical check, BUG-007's redirect
confirmed, BUG-003 answered by counts. BUG-001, 002 and 004 need staging or the owner.

## Release verdict

Against the plan's [exit criteria](../README.md#release-entry-and-exit), the production build on `d2b9639` is **not
ready to sign off**:

| Exit criterion | Met? | Why |
|---|---|---|
| 1. CI is green | Yes | The last 20 `check.yml` runs succeeded; `npm test` (1,582) and `npm run check` (244) pass |
| 2. The TS12 regression list passed | No | The automated part passes; the browser and inbox rows (RG-1 to RG-8) weren't run |
| 3. No open S1 or S2 bug | No | BUG-002 (proposed S1) and BUG-001 (proposed S2) are open, with BUG-004 as a possible S2. Severities are the owner's to set |
| 4. The owner signed off (TS16) | No | The 20 items for content UAT are ready to mark; no sign-off yet |
| 5. The TS13 smoke list passed | Partly | 9 of 10 pass by curl and logs; SM-4 and the browser halves need the owner |

## What the owner does next

1. Set severities for BUG-001 to BUG-011, and name the two BUG-002 accounts privately so they can be compared.
2. Bring staging up to `main`, so TS07, TS08, TC-P, journey UAT and phone payments can run.
3. Mark the 20 items for content UAT and sign off TS16.
4. Run the browser rows: SM-4, RG-1 to RG-5, TS18 priority 1, keyboard and axe (or connect a Chrome browser for
   Claude Code to run the desktop ones).
5. Run Lighthouse at pagespeed.web.dev on `/`, `/demo/`, `/live/` and `/pricing/`.
