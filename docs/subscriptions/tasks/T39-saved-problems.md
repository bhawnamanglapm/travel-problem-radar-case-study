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

## What was built

- **Storage.** `saved: [{ id, sweepId, at, item }]` on `radar:sub:<id>`, newest first, at most 100 (`MAX_SAVED`).
  `item` is the server's copy of the problem: the fields `normalize()` keeps, plus the sweep's `sweepAt`. It leaves
  out `isNew`, `seen`, `prev` and `firstEarlier`, so it doesn't go stale after its sweep is trimmed. About 700
  bytes an item, so at most about 70 KB per record. No new Blob key: deleting the record deletes the list.
- **API** (`makeAccountHandler` in `api/_lib/subscription-handlers.js`). It needs a signed-in session for that
  account (an emailed link alone gets `403 sign_in_first`), and POSTs need the same origin.
  - `POST { action: "save", sweepId, itemId }`. `sweepId` must match `/^\d{10,16}$/` (`400 bad_sweep`), and
    `itemId` must be a string of at most 200 characters (`400 bad_item`). Not Pro gives `402 pro_only`.
  - The server reads `radar:sweep:<sweepId>` itself and finds the item by id. A missing sweep or item gives
    `404 not_found`, and item fields in the body are ignored. Already saved gives `200` with no write, and 100
    saved gives `409 saved_full` (with `max`). The reply is `{ ok, ids, entry }`.
  - `POST { action: "unsave", itemId }`, on any plan, so a lapsed Pro can still tidy. An unknown id gives `200`
    with no write. The reply is `{ ok, ids }`.
  - `GET ?action=saved`: `{ saved }` for Pro, `402` otherwise. A lapsed Pro's list stays stored and comes back on
    renewal.
  - Every change goes through `updateSubscriber`'s conditional write, so two tabs saving at once both keep their
    item. Nothing about the list is logged, and the account view, admin page and sweep reply don't include it.
- **The board.**
  - A "☆ Save" / "★ Saved" star with `aria-pressed`, in each card's top row and before × in the T36 panel. It is
    `aria-disabled` while the server answers (not `disabled`, so focus stays on it), and a second press is ignored.
  - A 409, a 402 or a gone sweep shows a short note beside the star (role=status), and the star doesn't change.
  - On All saved sweeps (T38) the star sends the item's own sweep id.
  - A fourth tab, Saved: the saved copies newest first, each with "Sweep of <date>", Details (the panel says it's
    the copy kept when it was saved, in place of the history) and Unsave. A count line says "N saved, newest first,
    with room for 100"; with nothing saved, it says how to save one. After an unsave there, focus moves to that
    line.
  - `/live/` calls `GET ?action=saved` once after the board loads. A 401, 402 or 403 hides the stars and the tab.
    Paused subscriptions (`503`, as on Preview) count the same. Any other failure hides the stars and keeps the
    tab, which says the list couldn’t be loaded.
  - The demo keeps its own copy in browser storage under `radar:saved`, with no account calls.
- **Privacy page.** "What we store" lists saved problems: what's kept, at most 100, until removed or the account
  is deleted, and kept through a lapse for renewal. check.mjs checks the line and both bundles.

### Changes from the task as written

- The body field is `itemId`, not `id`, because `id` is already the account id on `/api/account`.
- `GET action=me` doesn't return the saved ids. The board gets the stars and the tab from one `GET action=saved`
  call, so adding them to `me` would only make every page's `me` reply bigger.
- Saving needs a signed-in session, not just the emailed manage link, because the board is only ever signed in.
- A Free account gets `402 pro_only`, the code the board's data already uses.

### Blob cost

Counted from the code; operation types from Vercel's pricing page (uploads, copies and lists are advanced, reads
are simple, deletes are free).

- **Per action.**
  - A save is 3 simple operations (the session, the sweep, the read inside `updateSubscriber`) and 1 advanced (the
    write).
  - An unsave is 2 simple and 1 advanced.
  - A Pro board view adds 1 simple (`GET saved`).
  - Saving something already saved, or unsaving something not saved, writes nothing.
- **Before T39, each sweep** uses 12 advanced operations:
  - 8 writes: `lastScheduled`, the LLM log, the sweep, the index, the seen ids, the item index, the search file,
    and the subscriber count.
  - 4 lists: the subscribers, then the delivery, IP-counter and Razorpay-event tidies.
  - On top of that, the first sweep of each day lists the LLM logs, and each Free email run writes the deliveries
    file.
  - At 5 sweeps a day for 31 days, that's about 155 × 12 + 31 + 31 ≈ 1,920 a month, close to the Hobby plan's
    2,000. That's before any sign-up, sign-in, admin page view or dashboard browsing.
- **So T39's 1 write per save or unsave matters.** Even a few dozen saves a month could take the month over 2,000,
  and going over locks Blob, and so the site, for 30 days. This is an estimate from the code; the store's actual
  usage is only in the dashboard (Observability → Blob, owner step). The PR suggests a follow-up to cut the
  sweep's own advanced operations.

## Acceptance criteria

- [x] Save, unsave and the 100 cap work, including twice in a row and on two tabs at once
- [x] A saved problem still shows after its sweep is trimmed
- [x] A Free account gets `402` on `save`; a lapsed Pro keeps its list
- [x] Delete my account removes the list
- [x] The star and the Saved tab work by keyboard and at 375px, in light and dark
- [x] Docs: privacy page, TECHNICAL.md, CHANGELOG.md

## Tests

In `scripts/test-subscriptions.mjs`: `save` and `unsave`, the cap, a forged `item` in the body ignored, Free refused,
a missing sweep or item, a concurrent save through `updateSubscriber`, and delete-account clearing the list.
