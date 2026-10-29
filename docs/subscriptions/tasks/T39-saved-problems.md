# T39 · Saved problems for Pro members

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T36 (the Save star sits in the detail panel) |
| Unblocks | — |

> Added 2026-10-29, from a comparison with Mindtrip (mindtrip.ai), where places can be saved to a collection. The
> comparison was read from public write-ups; Mindtrip's site didn't render in a headless browser.

## Why

A reader who finds a problem worth building for has nowhere to keep it. Today they copy the headline somewhere else,
and after 60 sweeps the sweep holding it is deleted (`MAX_SWEEPS` in `api/_lib/radar.js`).

## What to build

- **Storage.** The account record (`radar:sub:<id>`) gets `saved: [{ id, sweepId, at, item }]`, newest first, at
  most 100 (owner decision O5). `item` is a copy of the problem's fields, so a saved problem outlives the sweep
  trim. Every change goes through `updateSubscriber`, like the other account changes.
- **API.** `/api/account` POST gets `save` (`{ sweepId, id }`) and `unsave` (`{ id }`). The server reads the item from
  the sweep itself and never trusts item fields sent by the browser. A full list gives `409 saved_full`, and a
  missing sweep or item gives `404`. `GET action=me` returns the saved ids, and a new `GET action=saved` returns the
  list. No new function.
- **Board.**
  - A star on each problem card and in the T36 panel, with `aria-pressed` and the label "Save" or "Saved".
  - A fourth tab, "Saved", after Board, Report and History, showing the saved problems with their sweep dates and an
    Unsave button.
- **Rules.**
  - Pro only, like the board. A Pro member who lapses to Free keeps the list (it's shown again if they renew), but
    can't add to it.
  - Delete my account deletes the list with the record.
  - The privacy page names the new stored data ("problems you saved").
  - Nothing about the list is logged; the sweep reply and the admin page show counts at most.

## Acceptance criteria

- [ ] Save, unsave and the 100 cap work, including twice in a row and on two tabs at once
- [ ] A saved problem still shows after its sweep is trimmed
- [ ] A Free account gets `402` on `save`; a lapsed Pro keeps its list
- [ ] Delete my account removes the list
- [ ] The star and the Saved tab work by keyboard and at 375px, in light and dark
- [ ] Docs: privacy page, TECHNICAL.md, CHANGELOG.md

## Tests

In `scripts/test-subscriptions.mjs`: `save` and `unsave`, the cap, a forged `item` in the body ignored, Free refused,
a missing sweep or item, a concurrent save through `updateSubscriber`, and delete-account clearing the list.
