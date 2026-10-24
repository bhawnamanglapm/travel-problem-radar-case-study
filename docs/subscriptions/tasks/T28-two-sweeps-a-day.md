# T28 · Move to 2 sweeps a day

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer |
| Size | M |
| Depends on | One saved sweep after the owner adds Anthropic credit (RM-01), so the new schedule is checked against a working one |
| Unblocks | T27 (the pages must state the schedule Pro is sold on) |

> Added 2026-10-24 with the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24).

> **Replaced by [T32](T32-sweeps-per-day.md) on 2026-10-24. Do not build this task.** Each Pro member now chooses 1
> to 5 emails a day, with 2 as the default. The schedule step below would break that: changing `cron` to `0,12`
> stops slots 05, 15 and 20, so 3 to 5 a day could never run. The wording, check and docs steps moved to T32. To hold
> the site at T28's 2 sweeps a day, set `SWEEPS_PER_DAY_MAX=2` instead. Kept for the record.

## Why

The final Pro plan sells "a digest after every scheduled sweep, 2 a day" at ₹299 a month. The site runs about 5
sweeps a day today, and every page says so. Two a day cuts the sweep cost from about $32 to about $12.60 a month
(2 × $0.21 × 30, from [costing.md](../costing.md#one-sweep)) while there are no paying members, and it is the
setting the break-even of 18 members is worked out for.

## Before starting

- [ ] A sweep has saved all 4 categories since the owner added credit (RM-01, LR-01).
- [ ] **Verify** that GitHub Actions still accepts a comma list in the hour field (`0,12`).

## What to build

### Schedule

- [.github/workflows/sweep.yml](../../../.github/workflows/sweep.yml): set `cron` to `17 0,12 * * *` and rewrite the
  header comment, which explains the 5-hour schedule.
  - 00:17 UTC keeps the free teaser's timing (D3: after the first saved sweep of the UTC day).
  - 12:17 UTC is the second Pro digest.
- [vercel.json](../../../vercel.json): keep the `30 1 * * *` backstop. When the 00:17 run has saved, the existing
  2-hour skip in `runDailySweep` (`minGapHours = 2`, [radar.js](../../../api/_lib/radar.js)) stops it; when 00:17
  failed or GitHub didn't start it, the backstop runs it.
- The comment above `runDailySweep` in `radar.js` says "every 5 hours". Change it to match.

### Wording

| Today | After |
|---|---|
| "about 5 times a day" | "twice a day" |
| "every 5 hours" | "twice a day" |
| "about 5 a day", "up to 5 a day" | "2 a day" |

- Pages: `index.html` (including the two meta descriptions), `live/`, `manage/` (4 variants), `pricing/`, `about/`,
  `subscribe/`.
- `travel-problem-radar.jsx`: the 3 strings on the live board. Then `npm run build` refreshes
  `live/radar-live.js` and `public/`.
- Check `plan.json` and the email builders in `api/_lib/email.js` for the same phrases.
- **Leave alone** the prompt's "up to 5 objects": it's the number of items per category, not the schedule. The
  prompt drift check would fail anyway if only one copy changed.

### Docs

- README.md, DEPLOYMENT.md, docs/TECHNICAL.md: the schedule and its reasons.
- [pricing.md](../pricing.md): the tier table's "(up to 5 a day)", and the email quota formula becomes
  `2 + free + (2 × pro) + confirmations <= 100 emails a day`.
- [costing.md](../costing.md): say the current setting is 2 a day; keep the 5-a-day rows as the comparison they are.
- `pm/` docs only where they describe the current schedule, not where they record what was measured at 5 a day.

## Acceptance criteria

- [ ] `sweep.yml` runs at 00:17 and 12:17 UTC; the Vercel backstop is unchanged
- [ ] No site page, built file or email says "5 times a day", "every 5 hours" or "5 a day"
- [ ] The first day on the new schedule saves 2 scheduled sweeps (GitHub Actions log and `radar:index`); the backstop
  is skipped when 00:17 saved
- [ ] One Pro test account gets 2 digests that day, and a Free account gets 1 teaser

## Tests

- `scripts/check.mjs`: a new check that fails if any page under the site, or its built copy, contains "5 times a
  day", "every 5 hours" or "5 a day".
- `npm run build && npm run check && npm test` passes, with the bundles committed.

## Docs

The files under "Docs" above, [progress.md](progress.md), roadmap RM-26, and a CHANGELOG line.
