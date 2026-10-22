# T17 · The locked board

| | |
|---|---|
| Phase | 2a, paid website ([paid-website.md](../paid-website.md)) |
| Who | Developer |
| Size | M |
| Depends on | T16 |
| Unblocks | T18, T22 (go-live turns the switch on) |
| Status | done (2026-10-23); the switch is on in production since 2026-10-23 |

## Why

The board is what Pro pays for, so only a signed-in Pro may read the sweeps. They sit in a private Blob store and
`/api/data` is the only way to them, so locking that endpoint locks the board. A paying account must also survive
unsubscribing from email, which today deletes the record.

## What to build

- **`BOARD_PAYWALL`:** `1` means on; anything else, or unset, means off and nothing changes.
- **`makeDataHandler`** (`api/_lib/handlers.js`), with the switch on:
  - no valid cookie → `401`; a signed-in Free (or lapsed Pro) → `402`; Pro → the data;
  - `cache-control: private, no-store` on every reply, so no shared cache serves the board.
- **`/live/`:** the `remote` store in `travel-problem-radar.jsx` reports `401` and `402` instead of failing quietly,
  and the page shows a panel: Sign in and Sign up (`401`), or Upgrade, which is Request Pro until T20 (`402`), plus
  a link to the demo.
- **A Pro account survives:**
  - The Unsubscribe link, a hard bounce and a spam complaint set `emailOff` on a Pro record instead of
    deleting it; delivery skips `emailOff`. Free records are deleted as today. (Built with the reason as the value:
    `"unsubscribed"`, `"bounced"` or `"complained"`.)
  - `/manage/` shows "Email: off" with a way to turn it back on, and **Delete my account** for anyone. For a paying
    account, deleting comes after cancelling (T22).
- **Record field:** `emailOff` (optional).

As built, the `402` panel's button is **Request Pro**, linking to `/manage/`. `/live/` has no Sign out of its own:
its "Account" link leads to `/manage/`, which has one.

## Acceptance criteria

- [x] With the switch off, `/api/data` behaves exactly as today, cache header included
- [x] With it on: not signed in `401`, Free `402`, lapsed Pro `402`, Pro `200`, never publicly cached
- [x] `/live/` shows the right panel for `401` and `402` (checked locally against a stub API)
- [x] A Pro who unsubscribes, bounces or complains keeps the board and gets no email; a Free one is deleted
- [x] Delete my account removes the record

## Tests

- `/api/data` for each case, switch on and off, and its cache header; unsubscribe, bounce and complaint for Free and
  Pro; delivery skips `emailOff`; delete account

## Docs

- DEPLOYMENT.md: `BOARD_PAYWALL`, and what visitors see with it on; email-signup.md: unsubscribe for Pro
- `npm run check`: the switch is not set in `vercel.json`, and `/live/` has the panel
