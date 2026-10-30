# T29 · Per-category usage in each saved sweep (optional)

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer |
| Size | S |
| Depends on | — |
| Unblocks | T31 (pricing tiers by category needs each category's real cost) |

> Added 2026-10-24 with the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24). Optional: nothing in the
> launch waits for it.

> **Done 2026-10-30, through the private LLM logs, not the sweep record.** Since this task was written, every sweep
> saves an LLM log (`radar:llmlog:<id>`, kept 30 days) with each call's category, model and usage. The sweep record is
> served to anyone by `/api/data`, so usage stays out of it. Instead:
>
> - each log's summary has `usageByCat` (a failed call that reported usage included, because it was billed)
> - `scripts/cost-per-run.mjs` prices every call in the logs and prints each category's average cost and share.
>   It reads each call's usage, so logs from before `usageByCat` count too.
>
> The criteria below are met in that form. The sweep record and `/api/data` are unchanged. See
> [costing.md](../costing.md#how-to-re-measure).

## Why

The sweep sums the token and search usage of its 4 calls into one total (`addUsage` in
[radar.js](../../../api/_lib/radar.js)), so what each category costs isn't stored. The Plus and Starter tiers
(phase 3 of the [tier plan](../pricing.md#tiers-by-categories-and-sweeps-draft-2026-10-24)) price by number of
categories, and today that cost is an even split of $0.21, not a measurement. Only
`scripts/compare-models.mjs` records usage per category, and only for a test run.

## What to build

- In the sweep, keep the usage of each category's call and save it on the sweep record as `usageByCat`, keyed by
  category id (`traveler_pain`, `gov_policy`, `web_app`, `industry`), with the same fields as the total.
- The summed `usage` stays exactly as it is, so the failure email, costing.md's method and any reader of old sweeps
  are unchanged.
- A failed category saves the usage it reported, or nothing if it reported none.
- Older sweeps have no `usageByCat`; nothing may assume it's there.

## Acceptance criteria

- [ ] A new sweep has `usageByCat` for every category that returned a response
- [ ] The total `usage` equals the sum of `usageByCat`
- [ ] `/api/data` serves the field only where it already serves the sweep (no new key)

## Tests

In `scripts/test-sweep.mjs`: fake responses with different usage per category → `usageByCat` matches each, and the
total equals their sum; one category failing → the others are still recorded.

## Docs

[costing.md](../costing.md#measurement-checklist): a row for per-category cost, measured once a week of sweeps has
`usageByCat`. [progress.md](progress.md), CHANGELOG.
