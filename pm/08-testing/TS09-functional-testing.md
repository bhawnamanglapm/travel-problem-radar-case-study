# TS09 · Functional testing

| | |
|---|---|
| Component | Functional testing |
| Who | Claude Code runs the automated part; the owner (QA, BA) runs the manual part |
| Status | Partial: [traceability.md](../02-product-definition/traceability.md) maps each REQ to a test |
| Depends on | TS01, TS02, TS04 |
| Size | M |
| Unblocks | TS16 |

## What it means here

Checking each feature does what its requirement says, one REQ at a time, with a pass or fail and its evidence.
TS08 tests journeys across features; this tests features one by one against the PRD. It runs once per release
candidate that changes what a user can do.

## In place today

- `traceability.md` names the code and the test section for REQ-01 to REQ-32. Its counts are from 2026-10-23.
- `npm test` and `npm run check` prove the automated part on every pull request and push to `main`.

## Gaps

- REQ-28 shows "Planned" in `traceability.md`, but T22 built it on 2026-10-30.
- REQ-05, REQ-13 (Gmail one-click) and REQ-21 (the email side) have no automated or recorded manual check.
- The checks that need a browser or an inbox aren't recorded anywhere, so a release can't show they passed.
- T33 to T41 have no REQ ids yet (TS01), so they can't be listed here.

## The work

1. Before each release candidate, copy the checklist below into the PR description, or into a dated section at the
   end of this file.
2. **Auto rows:** CI green on the PR is the evidence.
3. **Manual rows:** run the TS04 case; write Pass or Fail with the date.
4. **Partly manual rows** need both.
5. When TS01 adds REQ-33 onwards, add their rows.

### The checklist

| REQ | Feature | Evidence | Type |
|---|---|---|---|
| REQ-01 | Four categories, up to 5 items each | test-sweep: "the sweep itself" | Auto |
| REQ-02 | Item fields and severity | test-sweep: "parser"; check §1 | Auto |
| REQ-03 | New flags | test-sweep: "the sweep itself" | Auto |
| REQ-04 | Keep 60 sweeps | test-sweep: "60-sweep cap" | Auto |
| REQ-05 | Digest with Copy | TS06 step 3 (text); TS04 manual case (clipboard) | Partly manual |
| REQ-06 | Partial and total failure | test-sweep: "partial and total failure" | Auto |
| REQ-07 | Demo makes no AI calls | check §3; TC-L-2 | Partly manual |
| REQ-08 | Scheduled sweep, secret | test-sweep: "/api/sweep" and the slot sections | Auto |
| REQ-09 | Key only on the server | test-sweep; check §6 | Auto |
| REQ-10 | Check-the-source notice | check §4b, §4c3, §4e, §4f; the live board's own notice by hand | Partly manual |
| REQ-11 | Slack digest | test-sweep: "Slack delivery after the sweep" | Auto |
| REQ-12 | Double opt-in, Confirm button | test-subscriptions: "T05", "T06"; TC-F-1, TC-F-2 | Partly manual |
| REQ-13 | Unsubscribe, one-click | test-subscriptions: "T07"; TC-U-1 | Partly manual |
| REQ-14 | Free daily email | test-subscriptions: "T09", "T18" | Auto |
| REQ-15 | Pro email after scheduled sweeps | test-subscriptions: "T09", "T10" | Auto |
| REQ-16 | Delivery never slows the save; stops before 300 s | test-subscriptions: "T10"; TS14 | Auto |
| REQ-17 | No addresses, tokens or keys in replies or logs | test-sweep: "/api/data"; test-subscriptions: "T05", "T11" and others | Auto |
| REQ-18 | One switch, a cap | test-subscriptions: "T05" | Auto |
| REQ-19 | Owner admin | test-subscriptions: "T11"; test-admin (the admin page); TC-A-1 | Partly manual |
| REQ-20 | Bounces, complaints, per-IP limit | test-subscriptions: "T13"; IT-5. The firewall rule is a setting | Partly manual |
| REQ-21 | Pro chooses categories | test-subscriptions: "T14"; TC-P-5 | Partly manual |
| REQ-22 | One subscription per inbox | test-subscriptions: "One inbox, one subscriber" | Auto |
| REQ-23 | Sign-in | test-subscriptions: "T16"; test-password; TC-S-1, TC-S-2 | Partly manual |
| REQ-24 | Locked board | test-subscriptions: "T17"; check §4 | Auto |
| REQ-25 | Pro outlives its emails | test-subscriptions: "T17"; TC-U-2 | Partly manual |
| REQ-26 | Checkout and cancel | test-subscriptions: "T19", "T20"; TC-P-1, TC-P-4 | Partly manual |
| REQ-27 | Signed webhook | test-subscriptions: "T21"; IT-1, IT-2 | Partly manual |
| REQ-28 | Expiry, paid unsubscribe, key safety | test-subscriptions (T22 sections); IT-7 | Partly manual |
| REQ-29 | `plan.json` is the one source | test-plan; check §4e; TC-L-1 | Partly manual |
| REQ-30 | Footer; policy pages | check §4d, §4f | Auto |
| REQ-31 | Summary before checkout | check §4e; test-plan; TC-P-1 | Partly manual |
| REQ-32 | Manual sweeps capped at 3 a day | test-sweep: "manual runs" | Auto |

The section names are copied from `traceability.md`. Where a T-file's tests have been renamed since, use the current
name.

## Done when

- `traceability.md` shows REQ-28 as built, with its tests, and fresh counts.
- The checklist has been run once in full, with every manual row Pass or Fail and dated.
- Any Fail has a TS19 bug.

## Tools and cost

None beyond the repo, a browser and test inboxes. Free.

## Risks and notes

- Auto rows prove only what their tests assert. A row is as good as its test; TS06 and TS11 strengthen them.
- Keep this checklist and `traceability.md` from drifting: change both in the same PR, or have this file link to
  `traceability.md` once that file gains a Manual column.
