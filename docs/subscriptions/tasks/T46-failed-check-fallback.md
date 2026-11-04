# T46 · Keep each category's last good results when a check fails

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T35 (one sweep per slot), T38 (the search file), I-06 (partial sweeps are saved) |
| Unblocks | — |

> Added 2026-11-04, after a reader's feedback on the article. The reader suggested keeping each category's last
> successful results when a sweep fails, with their time and a note that the latest check couldn't complete, and
> showing "no new findings" only when a check really finished.

> **Changed by [T47](T47-failures-owner-only.md) (2026-11-04):** the board no longer says a check failed. The
> status lines lost "couldn't complete", the banner and the Copy report line are gone, and `/api/data` refuses
> `radar:lastRun` again. The subscriber emails now carry a failed category's last results too. The rest of this
> page describes T46 as it was built.

## Why

Before T46 the board handled a failed check in only one case.

- **Every category fails** (the credit outage: the 10:00 UTC sweeps on 2 and 3 Nov both failed with "credit balance
  is too low"). Nothing is saved, and the board keeps the last good sweep, but it doesn't say why the "last sweep"
  time is old.
- **Some categories fail** (the token-limit case, I-06). A sweep is saved with only the categories that worked. The
  board shows only the latest sweep and hides empty categories, so the failed category's earlier results disappear
  without a word. Which categories failed (`perCat`) went to the owner's alert only.
- There was no "nothing found" message anywhere.

## What to build

- **Server:** record each category's outcome with the sweep, and the last run, saved or not. Status only, never the
  error text.
- **Board:** a failed category shows its items from the newest earlier sweep where its check finished, with a line
  saying so. A failed run after the latest saved sweep is named above the stats. "Nothing found" appears only for a
  category whose check finished.
- **Nothing is copied between sweep files**, so item history (T36), the seen list, the search file (T38), the trends
  tally (T44) and subscriber roll-ups never count an item twice.

## What was built

### Server ([api/_lib/radar.js](../../../api/_lib/radar.js))

- **`cats` in each sweep file:** `{ traveler_pain: "ok" | "failed", … }`, built from `perCat`. The history entry is
  unchanged.
- **`radar:lastRun`** (`radar/state/last-run.json`): `{ at, saved, id (when saved), cats }`.
  - Written for every sweep that ran: saved, or empty.
  - Not written for a skipped run.
  - A best-effort write: one that throws never fails the sweep.
- **`catOk(sweep, key)`** and **`findCarry(entries, fromIndex, key, load, maxReads = 12)`**, one block of text that is
  the same in the server and the board; `npm run check` fails if they differ.
  - `catOk` uses `cats` when the sweep has it. A sweep saved before T46 has none, so a category counts as ok there
    when it has items.
  - `findCarry` walks the history back from the sweep being viewed, reads at most 12 sweeps, and returns
    `{ id, at, items }` for the newest one where the category's check finished, or `null`.
- **`/api/data`** serves `radar:lastRun`, behind the same Pro paywall as the sweeps
  ([api/_lib/handlers.js](../../../api/_lib/handlers.js)).
- **The owner's digest:** the FAILED line now ends "the board shows its last results instead" (was "its problems are
  missing from this sweep").

### Board ([travel-problem-radar.jsx](../../../travel-problem-radar.jsx), rebuilt into `live/` and `demo/`)

- **Carry-forward.** When a sweep opens, each category whose `cats` entry is `"failed"` runs `findCarry`. The
  categories share one cached read per sweep. The items found join the board in "This sweep" scope, marked with
  the sweep they came from. The sweep's own items, the header counts and the Copy report don't change.
- **A status line under the category's head:**

  | Case | Line |
  |---|---|
  | Failed, earlier results found | The latest check couldn't complete. Showing results from the sweep of {day}. |
  | Failed, the last check that finished found nothing | The latest check couldn't complete. The last check that finished, in the sweep of {day}, found nothing. |
  | Failed, nothing within 12 sweeps | The latest check couldn't complete, and there are no earlier results to show. |
  | Finished with 0 items | Checked {time}: nothing found this time. |

  On an archived sweep, "The latest check" reads "This sweep's check". An empty category with a line shows only
  when no filter is set; with a filter, "No problems match these filters" applies as before.
- **Carried cards** show the "Sweep of {day}" tag in place of New. Their star, votes and share link use the sweep
  that holds the item, so `/p/<sweep>/<item>` points at a sweep that really has it.
- **The banner.** When `radar:lastRun` is later than the latest saved sweep and saved nothing: "The latest check, at
  {time}, couldn't complete. Showing the results from {time}; they'll update after the next check that finishes."
  A missing or unreadable last run means no banner.
- **Copy report:** one line per failed category ("Gov & policy: the latest check couldn't complete"). Carried items
  aren't listed, because the report is stamped with this sweep's time.
- **Unchanged:** sweeps saved before T46, and sweeps in local and demo mode, which have no `cats`.

### Not in scope

- **Subscriber emails.** They already say nothing about failures, and a Pro digest just leaves out a failed category.
- **The local and demo `runSweep()`.** Their sweeps stay without `cats`.
- **The outage itself.** Topping up the Anthropic credit is the owner's action (T30 row 1); this change only makes
  the gap clear to users.

## How it was checked

- `npm test` 1,736 pass (17 new for T46); `npm run check` 258 pass (2 new).
- The live board rendered in headless Chrome against a local stub of `/api/data` serving made-up sweeps,
  screenshotted at desktop width and at about 500 px:
  - one category failed, with earlier results (cards tagged "Sweep of Nov 1");
  - one category failed, with nothing earlier;
  - a category that finished with nothing;
  - a last run that failed after the latest saved sweep (the banner);
  - an old sweep with no `cats`, which looks as before.
- **Not checked yet:** a production sweep. After the credit is topped up, the first sweep's file should have `cats`
  all "ok", `radar:lastRun.saved` true, and the board no banner.

## Acceptance criteria

- [x] Each saved sweep records ok or failed per category, with no error text
- [x] `radar:lastRun` is written for every sweep that ran, never for a skipped one, and never fails a sweep
- [x] `/api/data` serves `radar:lastRun` only behind the paywall when it is on
- [x] A failed category shows its last good results with their sweep's day
- [x] "Nothing found" only for a category whose check finished
- [x] A failed run after the latest saved sweep is named on the board
- [x] Sweeps without `cats` look as before
- [x] `catOk`/`findCarry` are the same text in the server and the board
- [x] Docs: TECHNICAL.md, CHANGELOG.md, DEPLOYMENT.md

## Tests

In `scripts/test-sweep.mjs`, the "T46" block:
- a partial failure saves `cats`, with no error text;
- a saved sweep writes `radar:lastRun` with its id; the history entry is unchanged;
- a skipped run leaves `radar:lastRun` alone;
- when every category fails, `radar:lastRun` is `{ saved: false }` and no sweep is saved;
- a `radar:lastRun` write that throws doesn't fail the sweep;
- `catOk` with and without `cats`;
- `findCarry` walks back to the newest finished check, shares reads through a caching loader, returns `null` when
  there is nothing, stops after 12 reads, and returns a finished check that found nothing.

Also `/api/data` serves `radar:lastRun` (404 when missing), and the all-failed key set now includes it. In
`scripts/test-subscriptions.mjs`, the blob path and the paywall (401, 402, 200). In `scripts/check.mjs`, the drift
check and a bundle check.
