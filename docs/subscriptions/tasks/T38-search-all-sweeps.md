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

## Acceptance criteria

- [ ] "All saved sweeps" finds a problem that is only in an older sweep, and shows its sweep date
- [ ] A problem in several sweeps appears once
- [ ] `/live/?q=visa&cat=gov_policy` opens with both filters set; changing a filter updates the URL
- [ ] The home search sends signed-out visitors to the locked-board screen with `?q=` kept, and no sweep data is
  fetched or shown on the home page
- [ ] Docs: TECHNICAL.md, CHANGELOG.md; the Blob check's result is noted in the PR

## Tests

The duplicate removal and the URL read and write are plain functions with offline tests. The home search is checked
in a browser at desktop and 375px, signed out and as Pro.
