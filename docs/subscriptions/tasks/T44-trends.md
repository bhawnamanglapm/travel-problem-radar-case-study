# T44 · Trends: new problems by area and category over time, public, counts only

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T37 (`areaOf` and the area list), T38 (the search file), T42 (India as an area) |
| Unblocks | RM-39 (a monthly India report can cite `/trends/?area=India`) |

> Added 2026-10-31 at the owner's request: "Trends and an India view. Add charts of how many problems appear per area
> and per category over time, plus a 'rising this month' list." The owner chose **everyone** as the audience: a
> public page with counts only. The problems' text, summaries and links stay Pro only.
>
> **Built on `feat/t44-trends`; not merged.** The first tally is written by the first sweep after the merge.

## Why

The owner wants a page a government reader can click through (RM-39, RM-40), and the site to be more interactive.
The counts come from sweeps already saved, so the page costs no model calls.

The saved sweeps alone can't give this. The store keeps the last 60 sweeps (`MAX_SWEEPS`), about 12 days at a sweep
every 5 hours, so there is no month to compare. A running tally that isn't trimmed with the sweeps fixes that.

## What was built

- **The tally** (`api/_lib/trends.js`). `tallyTrends(prev, problems, at)` adds the sweep's new problems
  (`isNew === true`) to `days["YYYY-MM-DD"]["cat|Area"]`, on the sweep's UTC day; a sweep with nothing new records
  the day as empty. Keys hold the category key and the area name, so reordering `CATS` or `AREAS` doesn't move old
  counts. At most 400 days are kept, oldest dropped first. No ids, titles or links are stored.
- **Seeding.** A search file with no tally yet is seeded once by `seedTrends(items)`: the kept items counted by the
  day they were first seen. An item with `firstEarlier` is skipped (its day is only a lower bound), and every
  seeded day is marked `partial`, since items first seen in sweeps no longer kept are missing.
- **Where it lives.** The `trends` field of the `radar:search` file, which the sweep already writes every run, so no
  extra Blob write (Hobby allows 2,000 advanced operations a month). `mergeSearch` is unchanged, so it stays the
  same text as in the board file.
- **The public read.** `/api/data?key=radar:trends` returns `trendsView()`: `since`, `today`, `recorded`, the
  number of partial days, the category labels and areas, weekly counts (weeks start on Monday, UTC), the last 30
  days' totals, and the rising rows. It's handled before the paywall, because it holds no item text, and cached
  with `s-maxage=3600, stale-while-revalidate=3600` (the tally changes once a sweep; Hobby allows 10,000 simple
  operations a month). No file or no tally is `404`; a storage failure is `502`. No new API file (the 12-function
  limit).
- **Rising.** The last 30 days against the 30 before once 60 days are recorded; until then, 7 against 7, and the
  page says which. A row needs at least 3 new problems in the recent window (`RISE_MIN`, **Proposed**, for the
  owner to confirm) and more than before. Rows are per area and category, and per area across categories; an area
  row that only repeats one of its category rows is dropped. At most 10, by size of rise. `partialBefore` flags
  partial days in the earlier window, which make a rise look bigger than it is.
- **The page** (`trends/index.html`), self-contained like `/pricing/`: area chips (All, India first) and category
  chips, read from and written to `?area=` and `?cat=`; a rising list whose rows link to the live board's filters
  (`/live/?area=India&cat=gov_policy&all=1`), so a Pro member sees those problems and anyone else the sign-in or
  upgrade panel; new problems each week as columns (the last 26 weeks; the table has all); the last 30 days by
  area and by category as labelled bars, where picking a bar sets the filter. Each chart has a table, a tooltip on
  hover and keyboard focus, and is drawn at the width it has so the text stays readable on a phone. A "How these
  are counted" list says when counting started, that the first days are partial, that days are UTC, that a problem
  can rarely be counted again after the radar has seen about 800 others (`MAX_SEEN`), and that a count is what the
  radar found, not what happened.
- **Links.** Trends is in every page's site footer (`npm run check` expects it), the home page's top links and the
  board's tab row (live and demo). `build:site` copies `trends/`, and `sync-brand` fills its tokens.

### Changes from the plan

- **Cells are keyed `"cat|Area"`, not `[catIndex, areaIndex, n]` rows**, so old counts survive a reordered list.
- **One colour for every bar.** The brand's four category colours fail the colour-blind check as a categorical
  palette (the dataviz validator: purple and blue too close in light and dark), so the bars don't use them; each
  bar carries a text label instead.
- **`buildSearch` isn't changed.** When the search file is missing, the sweep rebuilds it with `buildSearch` and
  seeds the tally from the rebuilt items in the same step.

## Tests

`scripts/test-trends.mjs` (39): the tally (India and "India and Nepal" placement, only `isNew`, no ids or titles,
the 400-day trim, a damaged tally), seeding (`firstEarlier` skipped, days partial), the view (weeks on Monday, the
7- and 30-day windows, the minimum, area rows and repeated rows, partial days), `runDailySweep` writing the tally
and seeding an old file, and the handler (public with `BOARD_PAYWALL=1`, no ids, titles or links in the reply, the
1-hour cache, `radar:search` still `401`, `404`s, `502`). `npm test` 1,709 pass; `npm run check` 254.

## Not checked

- Checked in headless Chrome against a local stand-in server with made-up counts, at 1100 px (light) and a narrow
  window (dark). Not checked on a real deployment: Preview has no tally until a sweep runs there, and none is run
  without the owner's yes.
- Not in this task: filling earlier days from the LLM logs (kept 30 days; a production write), severity splits, a
  map, Hindi labels.
