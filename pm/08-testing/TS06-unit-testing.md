# TS06 · Unit testing

| | |
|---|---|
| Component | Unit testing |
| Who | Claude Code (developer) |
| Status | In place for the server; thin for the board |
| Depends on | — |
| Size | M |
| Unblocks | TS12 |

## What it means here

Testing the smallest parts of the code, each function or handler on its own, with fakes in place of Blob, Resend,
Razorpay, Google and Anthropic. Here that's the 8 suites `npm test` runs. They need no network and no packages beyond
Node.

## In place today

Counted on `c848b94`, 2026-10-30. All pass, locally and in CI ([check.yml](../../.github/workflows/check.yml)).

| Suite | Checks | Covers |
|---|---|---|
| [test-sweep.mjs](../../scripts/test-sweep.mjs) | 249 | The sweep (`api/_lib/radar.js`), the schedule, the data feed, Slack and the owner's email, the board's URL helpers |
| [test-subscriptions.mjs](../../scripts/test-subscriptions.mjs) | 1,048 | Subscribers, sign-up, confirm, unsubscribe, sessions, Google, accounts, delivery, Razorpay, webhooks |
| [test-plan.mjs](../../scripts/test-plan.mjs) | 73 | `plan.json` and the pages filled from it |
| [test-admin.mjs](../../scripts/test-admin.mjs) | 49 | The admin page's API |
| [test-password.mjs](../../scripts/test-password.mjs) | 56 | Password rules, hashing and sign-in |
| [test-compare.mjs](../../scripts/test-compare.mjs) | 40 | The model-compare script (a tool, not the product) |
| [test-score.mjs](../../scripts/test-score.mjs) | 42 | The item-scoring script (a tool) |
| [test-cost.mjs](../../scripts/test-cost.mjs) | 25 | The cost-per-run script (a tool) |

**How they're written.** `check(ok, label)` and `finish()` from
[test-helpers.mjs](../../scripts/test-helpers.mjs). Each label is a sentence saying what is proved. Handlers are
made by factories (`make*Handler` in `api/_lib`) that take their storage and senders as arguments, so tests pass
fakes in.

## Gaps

1. **The board.** [travel-problem-radar.jsx](../../travel-problem-radar.jsx) (1,514 lines) runs both the live board
   and the demo. Only its URL helpers (T38) are tested, from a marked block. Untested pure functions include:
   - `extractProblems`, `normalize` (reading a sweep);
   - `trackItems`, `mergeSearch` (New flags and search);
   - `groupByDay`, `sourceDay`, `sourceAgo` (dates);
   - `savedCopy` (saved problems);
   - `areaOf`, which is a second copy of the server's `areaOf` in `api/_lib/radar.js`. The two can drift.
2. **REQ-05's Copy button** was checked by hand once (18 Oct 2026) and never since.
3. **No coverage figure.** Nobody knows which lines no test reaches.
4. **No rule written down** that a bug fix brings its test.

## The work

1. **Test the board's pure functions the way T38 did:** wrap each group in a marked block in the jsx and run it from
   `test-sweep.mjs` (or a new `test-board.mjs`) with `new Function`. No new packages. Start with:
   - `areaOf`: the board's copy and the server's give the same area for every region in `sampleData.json` and a list
     of edge cases (empty, unknown, mixed case);
   - `normalize` and `extractProblems`: a sweep with missing fields, extra fields and bad severities;
   - `trackItems`: New is set only for unseen items;
   - `groupByDay`: items around midnight UTC and in the reader's time zone.
2. **Add `test-board.mjs` to `npm test`** if a new file is used.
3. **REQ-05:** test the digest text builder offline the same way; leave the clipboard itself to a TS04 manual case.
4. **Coverage, optional:** `c8` through `npx` would report it. **Ask first**: it downloads a package. A free option
   with no package: Node's `NODE_V8_COVERAGE` writes raw coverage files, but reading them needs a small script.
5. **Write the rule** into the [test plan](README.md#rules): every bug fix adds a test that fails before the fix.

## Done when

- `areaOf` on the board and the server is proved to agree.
- `normalize`, `extractProblems`, `trackItems` and `groupByDay` each have tests.
- `npm test` runs them, and CI passes.
- The bug-fix rule is in the test plan.

## Tools and cost

- Node (22 in CI, 24 locally) and the existing `check()` helper: free.
- `c8`: free and open source, but a new package. **Ask first.**

## Risks and notes

- Testing code from a marked block reads the source as text. If someone moves the markers, a check like T38's "the
  board URL block is in the jsx" fails, which is the right warning.
- The better long-term fix for the two copies of `areaOf` is one shared module that both the bundle and the server
  import. That's a code change; raise it as its own task.
