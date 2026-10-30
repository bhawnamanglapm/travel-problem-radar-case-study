# TS01 · Requirements validation

| | |
|---|---|
| Component | Requirements validation |
| Who | The owner (PM, BA, product owner) decides; Claude Code reviews and drafts |
| Status | Partial |
| Depends on | — |
| Size | S |
| Unblocks | TS02, TS09 |

## What it means here

Checking that each requirement is clear, testable, still true of the product and still wanted, before anything is
tested against it. The requirements are PRD v2 ([prd.md](../02-product-definition/prd.md), dated 2026-10-23):
REQ-01 to REQ-32, the non-functional requirements and goals G1 to G9. PRD v1 ([docs/PRD.md](../../docs/PRD.md)) is
the original and is kept for history.

## In place today

- PRD v2 lists each REQ with its source (a T-file, a decision or a PR) and a status.
- [traceability.md](../02-product-definition/traceability.md) maps each REQ to code and to a test. Its counts are
  from `662bded` (2026-10-23: 952 tests, 199 checks). On `c848b94` they are 1,582 and 244.
- The T-files in [docs/subscriptions/tasks/](../../docs/subscriptions/tasks/) are the detailed requirements for
  each feature, with acceptance criteria.

## Gaps

PRD v2 has drifted from the product in its first week. Found while writing this task:

| # | Where | PRD says | Product today | Source |
|---|---|---|---|---|
| D1 | REQ-08 | Sweeps "now every 5 hours" | Up to 5 fixed slots a UTC day (0, 5, 10, 15, 20); Pro picks 1 to 5 emails a day | T32, T35; `api/_lib/schedule.js` |
| D2 | REQ-23 | "Accounts with no passwords" | Passwords exist alongside the link and Google | CHANGELOG, 2026-10-27; `api/_lib/password.js` |
| D3 | REQ-26, REQ-27 | Built; test mode passed on staging | Razorpay live since 2026-10-28; first live payments captured that day | T27, [progress.md](../../docs/subscriptions/tasks/progress.md) |
| D4 | REQ-28 | Planned (T22) | Built 2026-10-30: 48-hour grace, tidy step, key-mismatch guard | progress.md, T22 |
| D5 | REQ-29, REQ-31 | `paid: false` | `plan.json` has `"paid": true` | `plan.json` |
| D6 | G5 | $0.21 a sweep (Sonnet) | $0.1215 a sweep measured on Haiku, which runs production | [model-test-2026-10-30.md](../../docs/subscriptions/model-test-2026-10-30.md) |
| D7 | Not in the PRD | — | T33 to T41: one Pro plan, renewing, slots on time, detail panel, areas, search all sweeps, saved problems, share one problem, areas in the email | progress.md |
| D8 | Price | The case study says ₹299 a month | `plan.json` charges ₹1 a month and ₹1 a year while testing; the real prices are an open T27 step | `plan.json`, T27 |

Also:
- **G1 to G4 aren't measured.** They are quality goals. The 2026-10-30 model test is the first evidence (40% of items
  kept, marked by ChatGPT), but it isn't a KPI.
- **Some REQs bundle several rules** (REQ-12, REQ-20, REQ-28), so one failing part fails the whole REQ. TS02 splits
  them.

## The work

1. **Review each REQ** against four questions and record the answer in a table in this file:
   - **Clear:** one reading only?
   - **Testable:** can a test or a person say pass or fail?
   - **Current:** is it what the product does today?
   - **Wanted:** does the owner still want it?
2. **Resolve D1 to D8** with the owner, one decision each: change the PRD, change the product, or drop the REQ.
3. **Add REQ-33 onwards** for T33 to T41, each with its T-file as the source.
4. **Split bundled REQs** (REQ-12, REQ-20, REQ-28) into parts with their own ids, for example REQ-28a.
5. **Give G1 to G4 a measure** each, or mark them "no measure yet". The model test's keep rate is a candidate for G3.
6. **Refresh the counts** in `traceability.md` and date them.
7. Record which PRD version is current and that v1 is history only.

## Done when

- Every REQ has a row with Clear, Testable, Current and Wanted, and a decision where any is "no".
- D1 to D8 each have the owner's decision and the PRD is updated to match.
- T33 to T41 have REQ ids.
- `traceability.md` counts match an `npm test` run, dated.

## Tools and cost

None beyond the repo. Free.

## Risks and notes

- The PRD will drift again with each feature. The release rule in the [test plan](README.md#release-entry-and-exit)
  should add: a PR that changes what a user can do updates the PRD row.
- Don't rewrite history: where the product changed, keep the old wording in the change log
  ([change-log.md](../04-planning-and-governance/change-log.md)).
