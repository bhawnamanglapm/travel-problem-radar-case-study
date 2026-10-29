# T36 · Problem detail panel, with "first seen" and "in N sweeps"

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | — (start any time) |
| Unblocks | T39 (the panel holds the Save star), T40 (the panel holds Share) |

> Added 2026-10-29, from a comparison with Mindtrip (mindtrip.ai), where each place opens a detail view. The
> comparison was read from public write-ups; Mindtrip's site didn't render in a headless browser.
>
> Built 2026-10-29. The design changed from the first draft of this file once the code was read. The cards already
> show the full summary and every tag, so the panel's value is the problem's history. And the history goes on the
> saved items, not in a key the board fetches, so `/api/data` is unchanged. The first draft is in git history.

## Why

A reader can't tell whether a problem is new this week or has come up in every sweep for a month, and that history is
what makes a problem worth building for. Every sweep is saved (`radar:sweep:<id>`, up to 60), but `radar:seenIds` is
a plain list of ids with no dates, so "first seen" could only be worked out by reading every saved sweep.

## What was built

- **Item index, private.** The sweep keeps `radar:items` (Blob path `radar/history/items.json`):
  `{ [id]: { f: first sweep id, n: sweeps it was in, s: [up to 6 latest sweep ids], e?: 1 } }`.
  - `e: 1` means the item was already seen before the index knew it (its `isNew` was false), so `f` and `n` are
    lower bounds.
  - It is trimmed to the ids `trimSeen` keeps, so it never holds more ids than the seen list.
  - It is not in `ALLOWED_KEY`, so `/api/data` refuses it like `radar:seenIds`.
  - A store with sweeps but no index builds it once from the saved sweeps, oldest first (at most 60 reads).
  - On the server, a failed read or write of the index doesn't fail the sweep. Its items are then saved without
    history fields.
- **History on each saved item.** `trackItems(index, items, sweepId, keepIds)` returns the new index and the items
  with:
  - `firstAt`: the ISO time of the first sweep the item was in
  - `seen`: how many sweeps it has been in, this one included
  - `prev`: up to 5 earlier sweep ids
  - `firstEarlier: true`: present when `e` is set

  The board reads these from the sweep it already loads, so there is no extra fetch. An old sweep opened from
  History shows the history as it stood then.
- **Two copies, one text.** `trackItems` is in `api/_lib/radar.js` and in `travel-problem-radar.jsx` (the demo and
  Claude's app sweep in the browser). check.mjs §5 fails if the two differ.
- **Card.** A "Details" button at the bottom of each card, and a "Seen in N sweeps" tag once `seen > 1` ("N+" when
  `firstEarlier`). The whole card isn't clickable, because it already holds the source link.
- **Panel.**
  - A native `<dialog>` opened with `showModal()`, so Esc closes it, focus moves inside, the page behind is inert,
    and focus returns to the Details button. It has `aria-labelledby` on the headline, a Close button, and a click
    on the backdrop closes it.
  - It is a side panel on desktop (up to 440px wide) and a bottom sheet under 640px.
  - It shows the item in full (summary, source link, region, date, severity, opportunity).
  - **History:** "First seen Oct 29, 2026 · in 3 sweeps" (the date in the reader's locale), with "or earlier" and "or more" when `firstEarlier` is set.
    The earlier sweeps are listed newest first, each with Open while it is still in History, or "No longer kept".
  - A sweep saved before T36 has no history fields, and the panel says so.
  - Brand tokens only, in light and dark.
- **Deep link.** `#p=<encoded id>` opens that problem after the first load on `/live/` and `/demo/`, or when the hash
  changes on an open board. Opening the panel sets the hash, and closing it clears it (`history.replaceState`). An
  unknown id does nothing. `#report` works as before.

## Limits

- An item's id is its category plus its headline (`normalize()` in `travel-problem-radar.jsx`), so a reworded
  headline counts as a new problem. This is already recorded in decisions.md (2026-08-01).
- On the live board, the history starts with the first sweep after deploy. That sweep builds the index from the
  saved sweeps, so items already in them get their real first sighting, back to the oldest kept sweep.

## Acceptance criteria

- [x] After 3 sweeps an item has `seen: 3`, the right `firstAt`, and its 2 earlier sweeps in `prev`
- [x] An item missing from one sweep keeps its count
- [x] The index never holds an id the seen list has dropped
- [x] A store without the index builds it from the saved sweeps; an item already seen there is `firstEarlier`
- [x] A failed read or write of the index doesn't fail the sweep
- [x] `/api/data` refuses `radar:items`
- [x] The panel opens by mouse and keyboard, closes on Esc and Close, and returns focus to the button
- [x] `#p=<id>` opens the problem; an unknown id opens nothing
- [x] At 375px the bottom sheet has no horizontal scroll, in light and dark
- [x] check.mjs §5 fails if the two `trackItems` copies differ
- [x] Docs: TECHNICAL.md, DEPLOYMENT.md (stored keys), CHANGELOG.md

## Tests

- **`scripts/test-sweep.mjs`:**
  - `trackItems` on its own: a new item, `firstEarlier`, the count and `prev` over 9 sweeps, the trim to keepIds, and
    a malformed entry
  - the sweep over 3 runs: the saved fields and the reply
  - the index trimmed with the seen list
  - the rebuild from saved sweeps
  - an unreadable index and a failed index write
  - `/api/data` refusing the key
- **`scripts/test-subscriptions.mjs`:** the key's Blob path.
- **check.mjs:** the two copies match, and both bundles hold the item index, the `<dialog>` and the `#p=` link.
- **Headless Chrome on a locally served `/demo/`** (by hand, not in CI): 3 replays, then the panel by mouse and
  keyboard, Esc, focus, Open, the `#p=` link both ways, an unknown id, and 375px in light and dark.
