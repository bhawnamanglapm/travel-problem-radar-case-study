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

## Why

A problem card shows the headline, a clipped summary and a few tags, and nothing else. A reader can't tell whether a
problem is new this week or has come up in every sweep for a month, and that history is what makes a problem worth
building for. The data to answer it is half there: every sweep is saved (`radar:sweep:<id>`, up to 60), but
`radar:seenIds` ([radar.js:18](../../../api/_lib/radar.js#L18)) is a plain list of ids with no dates, so "first
seen" can only be worked out by reading every saved sweep.

## What to build

- **Item index.** A new key `radar:items`: `{ [id]: { first, last, n, sweeps: [up to 10 latest sweep ids] } }`,
  where `first` and `last` are sweep times and `n` counts the sweeps the item was in.
  - The server sweep (`runDailySweep` in `api/_lib/radar.js`) updates it after `KEY_SEEN`, and trims it by the same
    rule as `trimSeen`, so it stays the same size as the seen list.
  - The jsx sweep (`travel-problem-radar.jsx`, in Claude's app via `window.storage`) writes the same key the same
    way. Put the update in one function per copy, and extend check.mjs §5 so the two stay alike.
  - `ALLOWED_KEY` in [handlers.js:111](../../../api/_lib/handlers.js#L111) gains `radar:items`. With
    `BOARD_PAYWALL=1` it is Pro only, like the sweeps.
  - Older stores have no index. The first sweep after deploy builds it from the saved sweeps (one-off, at most 60
    reads), then keeps it up to date.
- **Panel.** Clicking a problem card (or Enter on it) opens a side panel on desktop and a bottom sheet under 640px.
  - It shows the full summary, the source with its link, region, date, severity and the opportunity.
  - It also shows "First seen 24 Oct · in 5 sweeps". Each of the last sweeps is a link that opens it in History.
  - Keyboard and screen readers: `role="dialog"`, `aria-modal`, a labelled heading, focus moves into the panel and
    stays there, Esc and a Close button close it, and focus returns to the card.
  - A deep link `#p=<id>` opens that problem on load (on `/live/` and `/demo/`). Closing the panel clears the hash.
    `#report` keeps working as before.
- **Limits, said on the panel's help text and here:**
  - An item's id is its category plus its headline (`normalize()`,
    [travel-problem-radar.jsx:283](../../../travel-problem-radar.jsx#L283)), so a reworded headline counts as a new
    problem. This is already recorded in decisions.md (2026-08-01).
  - The demo has no index, so its panel says "First seen in this sweep".

## Acceptance criteria

- [ ] A sweep writes `radar:items`; an item seen in 3 sweeps has `n: 3` and the right `first` and `last`
- [ ] The index never holds more ids than `radar:seenIds`
- [ ] The first sweep on a store without the index builds it from the saved sweeps
- [ ] `/api/data` serves `radar:items` (Pro only with the paywall on) and still refuses every other new key
- [ ] The panel opens by click and by keyboard, traps focus, closes on Esc and returns focus to the card
- [ ] `#p=<id>` opens the problem; an unknown id opens nothing and shows no error
- [ ] At 375px the bottom sheet has no horizontal scroll, in light and dark
- [ ] check.mjs §5 fails if the jsx and server index updates differ
- [ ] Docs: TECHNICAL.md (the new key), DEPLOYMENT.md (stored keys), CHANGELOG.md

## Tests

In `scripts/test-sweep.mjs`: the index after 1, 2 and 3 sweeps; trimming with the seen list; the one-off build from
saved sweeps; a failed index write doesn't fail the sweep's save. In `scripts/test-subscriptions.mjs`: `/api/data`
allows `radar:items` and keeps the paywall on it.
