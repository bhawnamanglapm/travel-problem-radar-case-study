# T38 · Search every saved sweep, filters in the URL, search on the home page

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T37 (for `?area=`; the rest can start before it) |
| Unblocks | — |

> Added 2026-10-29, from a comparison with Mindtrip (mindtrip.ai), where a search box is the home page's main
> feature. The comparison was read from public write-ups; Mindtrip's site didn't render in a headless browser.

## Why

The board's search only looks in the current sweep: title, summary and opportunity
([travel-problem-radar.jsx:536](../../../travel-problem-radar.jsx#L536)). A problem from last week is found only by
opening History and paging through. A filtered view can't be shared either, because the board reads nothing from the
URL except `#report`. The home page has no way in to the board's content beyond "open the board".

## What to build

- **All sweeps.** Next to the search box, a choice of "This sweep" or "All saved sweeps".
  - "All saved sweeps" loads the saved sweeps once per page view (from `radar:history`, then each
    `radar:sweep:<id>`), removes duplicates by id (the latest copy wins) and shows each result's sweep date.
  - Loading shows progress, and a failed sweep read is skipped and counted ("2 sweeps couldn't be loaded").
- **Filters in the URL.** The board reads and writes `?q=`, `?cat=` and `?area=` (T37), with `history.replaceState`,
  so a filtered view can be bookmarked or shared. `#report` and T36's `#p=` keep working alongside them.
- **Home page.** A search box in the hero that goes to `/live/?q=…`.
  - Signed-out and Free visitors get the board's existing "The board is for Pro members" or "The live board is part
    of Pro" screen, with the search kept in the URL, so it works after they sign in or upgrade.
  - The home page itself still shows no sweep data while the paywall is on.
- **No AI call**, so no new running cost beyond Blob reads.

## Verify at build time

- One all-sweeps search reads up to 61 files (the index and 60 sweeps). Check Vercel Blob's current operation limits
  and the store's usage before building. If they are too tight, the sweep writes one compact search file
  (`radar:search`, ids, titles, summaries, sweep ids) and the board reads that instead: one read per search.

## The Blob check (2026-10-29)

- The [Vercel Blob pricing page](https://vercel.com/docs/vercel-blob/usage-and-pricing) (updated 2026-09-23) gives
  the Hobby plan 10,000 simple operations a month (reads that miss the cache) and 2,000 advanced operations (writes
  and lists), with simple reads limited to 20 a second. Going over doesn't cost money: it locks Blob for 30 days, and
  Blob also holds the accounts and sessions.
- With the paywall on, every `/api/data` call also reads the session uncached. The first design above would cost
  about 61 session reads plus up to 60 sweep reads per search, so about 80 searches a month would use the allowance.
- The store's actual usage couldn't be read from the CLI on this plan; it is in the dashboard under
  Observability → Blob (owner step).
- So the search file was built: 1 extra read and 1 extra write per sweep (at most about 155 of each a month at 5
  sweeps a day), and 2 reads per all-sweeps search.

## What was built

- **The search file `radar:search`** (`radar/history/search.json`): `{ sweeps, items }`, the ids of the sweeps it
  holds and the latest copy of each item in the kept sweeps (the last 60), with `sweep` and `sweepAt` added.
  Items are stored whole, so a result is a normal card and opens the T36 Details panel.
  - `mergeSearch(prev, problems, sweepId, at, keepSweepIds)` drops entries from sweeps no longer kept and puts the
    new sweep's items in, replacing older copies. It is the same text in `api/_lib/radar.js` and the jsx, between
    `// Search file (T38):` and `// End of search file.`; check.mjs §5 fails if they differ.
  - `runDailySweep` reads, merges and writes it after the sweep and index are saved. When it's missing it is built
    once from the kept sweeps. A failed read or write never fails the sweep.
  - `/api/data` allows the key behind the same paywall and cache rules as the sweeps.
- **The board.**
  - "This sweep" and "All saved sweeps" chips beside the search box, with `aria-pressed`. All loads the file once per
    page view ("Loading saved sweeps…"), keeps only items whose sweep is in History, and says "N problems from M
    saved sweeps", plus "K saved sweeps couldn't be included" for kept sweeps the file lacks. A missing or unreadable
    file says so and stays on This sweep.
  - In All, the category, area, severity and search filters work on the pooled items, each card shows "Sweep of
    <date>" in place of New, and the stats tiles give way to the one line. Opening a sweep from History goes back to
    This sweep.
  - The demo keeps the same file in browser storage, so All works on `/demo/` too.
- **Filters in the URL.** `readBoardUrl` and `boardQuery` read and write `?q=` (at most 200 characters), `?cat=` (a
  category key), `?area=` (one of `AREAS`) and `?all=1`. Defaults and unknown values are left out, other
  parameters and the hash are kept, and changes are written with `history.replaceState`.
- **Kept through sign-in.** The locked screens keep the URL and save the filters in `sessionStorage` for 30 minutes;
  `/live/` with no filters in its URL puts them back and clears the copy. The URL is never passed to sign-in, so it
  can't send anyone to another site.
- **Home page.** A labelled GET form in the hero to `live/`, with `q` and a hidden `all=1`. It works without
  JavaScript and reads no sweep data.
- **Production size** (read-only, 2026-10-29): 9 indexed sweeps, 8 readable, 146 distinct items from 151 copies,
  about 105 KB (26 KB gzipped). The oldest indexed sweep has no file in Blob (it predates T38), so the board will
  count it as not included until it rolls off.

## Acceptance criteria

- [x] "All saved sweeps" finds a problem that is only in an older sweep, and shows its sweep date
- [x] A problem in several sweeps appears once
- [x] `/live/?q=visa&cat=gov_policy` opens with both filters set; changing a filter updates the URL
- [x] The home search sends signed-out visitors to the locked-board screen with `?q=` kept, and no sweep data is
  fetched or shown on the home page
- [x] Docs: TECHNICAL.md, CHANGELOG.md; the Blob check's result is noted in the PR

## Tests

The duplicate removal and the URL read and write are plain functions with offline tests. The home search is checked
in a browser at desktop and 375px, signed out and as Pro.
