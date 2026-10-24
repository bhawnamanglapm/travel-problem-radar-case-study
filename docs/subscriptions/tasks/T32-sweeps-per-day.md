# T32 · Each Pro member chooses 1 to 5 emails a day

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer |
| Size | L, in 2 PRs |
| Depends on | — (both PRs are merged; the checks after deploy wait for saved sweeps, RM-01) |
| Unblocks | T27 (the pages must state the schedule Pro is sold on) |

> Added 2026-10-24 at the owner's request. It **replaces [T28](T28-two-sweeps-a-day.md)**, a fixed move to 2 sweeps a
> day: the choice keeps 2 a day as the default, and T28's wording work moves here. Recorded in the
> [decision log](../../decisions.md) on 2026-10-24.

## Why

The owner asked for each Pro member to choose how many digests a day they get, 1 to 5, and for the site to sweep only
as often as needed, with the other scheduled runs stopping. The final Pro plan's "2 a day" becomes the default choice.

GitHub's schedule is fixed in `sweep.yml` and can't change itself. So the schedule keeps firing in all five slots,
and a slot nobody needs answers `skipped` before any Anthropic call: no credit, no email, no saved sweep.

## How it works

| Sweeps a day | UTC slots | IST |
|---|---|---|
| 1 | 00 | 05:47 |
| 2 | 00, 10 | 05:47, 15:47 |
| 3 | 00, 10, 15 | + 20:47 |
| 4 | 00, 05, 10, 15 | + 10:47 |
| 5 | 00, 05, 10, 15, 20 | + 01:47 (night) |

- The slots are nested: each choice holds every slot of the smaller ones, so sweeping for the largest choice serves
  everyone. Slot 00 always runs; it carries the Free teaser, and the Vercel 01:30 backstop falls in it.
- **The site's number** is the highest choice among active Pro members with email on. No choice counts as 2; with no
  Pro members it is 1. It is kept between `SWEEPS_PER_DAY_MIN` (default 1) and `SWEEPS_PER_DAY_MAX` (default 5).
- **Each Pro email** rolls up every scheduled sweep since that member's previous slot, so a member on 1 a day still
  sees what the 05 to 20 sweeps found. On the site's number, it is exactly the current sweep, as before.
- Free (the daily teaser) and manual runs (no Pro email, D4) are unchanged.

## Cost

Every choice costs the member the same ₹299, but the site's cost follows the highest choice.
[costing.md](../costing.md) budgets ₹6,797 a month at 5 sweeps a day, which breaks even at 24 Pro members at ₹299;
the [final Pro plan](../pricing.md#final-pro-plan-2026-10-24) budgets about ₹4,987 at 2 a day, 18 members.
`SWEEPS_PER_DAY_MAX` is the owner's cap. Charging more for more sweeps needs a Razorpay Plan per number; that is left to
[T31](T31-measure-and-add-tiers.md).

## PR 1: server (done, #88, 2026-10-24)

- `api/_lib/schedule.js`: the slots, the two limits, a member's choice and the site's number.
- `/api/sweep`: skips an unneeded scheduled slot before Anthropic; saved sweeps record `slot` and `slotAt`.
- Delivery: Pro grouped by categories × emails a day; each group sent at its own slots with a roll-up since its
  previous slot. All categories at the default 2 keep the old idempotency key; other groups add `-f<n>`.
- `/api/account` action `set-freq` (Pro only, 1 to the cap). `accountView` returns `sweepsPerDay`,
  `sweepsPerDayDefault` and `sweepsPerDayMax`.
- DEPLOYMENT: the two variables and [Sweeps a day](../../../DEPLOYMENT.md#sweeps-a-day-t32).

## PR 2: the page and the wording (done, #89, 2026-10-25)

### The manage page

- [manage/index.html](../../../manage/index.html): an "Emails a day" card next to the categories card, with a radio
  button for each number up to `sweepsPerDayMax` and its IST times. No choice shows the default (2) selected.
- The same save, message and keyboard pattern as the categories card (`set-cats`). Free and lapsed Pro see it
  disabled, with a note.

### Wording (from T28)

| Today | After |
|---|---|
| "about 5 times a day", "every 5 hours" | "Pro members choose 1 to 5 emails a day" (the board: "updates up to 5 times a day") |
| "about 5 a day", "up to 5 a day" | "1 to 5 a day, you choose (default 2)" |

- Pages: `index.html` (including the two meta descriptions), `live/`, `manage/` (4 variants), `pricing/`, `about/`,
  `subscribe/`.
- `travel-problem-radar.jsx`: the strings on the live board. Then `npm run build` refreshes `live/radar-live.js` and
  `public/`.
- Check `plan.json` and the email builders in `api/_lib/email.js` for the same phrases.
- **Leave alone** the prompt's "up to 5 objects": it is the number of items per category, not the schedule.
- **Do not** change the `cron` in `.github/workflows/sweep.yml` (T28's schedule step): every slot must keep firing.

### Docs

- README.md, docs/TECHNICAL.md: the schedule and its reasons.
- [pricing.md](../pricing.md): the email quota formula becomes `S + free + (Σ each Pro member's emails a day) +
  confirmations <= 100 emails a day`, where `S` is the site's sweeps a day (the owner's own digest).

## Acceptance criteria

- [x] A scheduled call in an unneeded slot answers `skipped` and never calls Anthropic (PR 1)
- [x] A Pro member can save 1 to the cap through `set-freq`; Free gets 403 (PR 1)
- [x] `/manage/` shows the card, saves a choice and shows the saved choice after a reload (PR 2; checked in
  headless Chrome against a stub `/api/account`)
- [x] No site page, built file or email says "5 times a day", "every 5 hours" or "about 5 a day" (PR 2; `check.mjs`)
- [ ] After deploy, with no Pro choice set, one day of GitHub Actions logs shows slots 05 to 20 `skipped` and slot 00
  saved (needs RM-01)
- [ ] A test Pro set to 3 on `/manage/` gets 3 emails the next day, at 00, 10 and 15 UTC

## Tests

- PR 1: `scripts/test-sweep.mjs` (slots, limits, the site's number, the handler skip) and
  `scripts/test-subscriptions.mjs` (delivery by number, roll-up windows, keys, `set-freq`).
- PR 2: `scripts/check.mjs` fails if any page under the site, or its built copy, contains the old phrases, and checks
  the manage card is present in every variant.
- `npm run build && npm run check && npm test` passes, with the bundles committed.

## Docs

The files under "Docs" above, [progress.md](progress.md), roadmap RM-26, and a CHANGELOG line.
