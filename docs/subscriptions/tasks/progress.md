# Progress: T01 to T11

Working log for the build of Phase 1 (Free and Pro email digests). One task at a time: implement, test locally
(`npm run build && npm run check && npm test`), commit, push, then the next. Branch: `feat/subscriptions`.

Status values: `todo`, `in progress`, `done` (tested offline, committed and pushed). Nothing here has been seen
working in a real inbox; that is T12's staged launch.

| Task | Status | Commit | Tests after | Notes |
|---|---|---|---|---|
| [T01](T01-storage-list.md) Storage `list()` + test helpers | done | 9175e84 | 73 pass (68 old + 5 new) | See T01 notes below |
| [T02](T02-subscriber-records.md) Subscriber records module | done | f0de053 | 96 pass (+23 new) | See T02 notes below |
| [T03](T03-http-helpers.md) HTTP helpers | done | see T04 row | 117 pass (+21 new) | See T03 notes below |
| [T04](T04-email-builders.md) Email builders + batch send | todo | | | |
| [T05](T05-api-subscribe.md) `POST /api/subscribe` | todo | | | |
| [T06](T06-api-confirm.md) `/api/confirm` | todo | | | |
| [T07](T07-api-unsubscribe.md) `/api/unsubscribe` | todo | | | |
| [T08](T08-subscribe-page.md) `/subscribe/` page, build, checks | todo | | | |
| [T09](T09-delivery-engine.md) Delivery engine | todo | | | |
| [T10](T10-sweep-integration.md) Wire delivery into the sweep | todo | | | |
| [T11](T11-admin-script-and-metrics.md) Admin script + metrics | todo | | | |

## Notes per task

### T01
- `blobStorage()` now takes the `@vercel/blob` client as an optional argument (default: the real one), so the
  paging in `list()` is tested offline against a fake client that answers two blobs per page.
- Checked the **verify at build time** item against the installed `@vercel/blob` 2.8.2 type definitions: `list()`
  takes `prefix`, `cursor`, `limit` and returns `{ blobs, cursor, hasMore }`. **Not checked:** that it works on the
  private store with the same credentials as `get`, and its billing on the Hobby plan. Both need the real service
  (owner step: one read-only `list("radar:sweep:")` against the production store).
- `npm test` now runs both files. The 68 existing checks print as before.

### T02
- `api/_lib/subscribers.js`: every export in the task, imports only `node:crypto`. Times are milliseconds (the
  handlers' `now()`), so `effectivePlan` takes a number.
- `listSubscribers` returns `{ records, skipped }`; it also skips a file whose inner `id` doesn't match its name.
  A failing `list()` throws so the caller (T09) can stop rather than treat the list as empty.
- `countEvents` throws if listing fails. T05 must treat that as "cap reached" (fail closed).
- Added `utcDay(now)` (YYYYMMDD), which T05 and T09 need. `normaliseEmail` also rejects a missing local part or a
  domain starting or ending with a dot or containing `..`.
- Not done: the task's line "this folder's record shape and this file agree" refers to the draft design docs;
  T12 updates those.

### T03
- `api/_lib/http.js` has `esc`, `sendJson`, `bearerOk`, `allowMethods`, `readBody`, `parseForm` and `sendPage`.
  `handlers.js` and `email.js` now import from it; the 68 existing checks pass unchanged.
- Added `readFields(req)` (not in the task): returns the fields as an object whether the platform pre-parsed the
  body or not. T05 to T07 use it, so each handler doesn't repeat the logic. Also exported `BodyTooLargeError`
  (`statusCode: 413`).
- `sendPage` writes the title into an `<h1>` itself, so a page's `body` should not repeat it.
- **Verify item (Vercel body handling), checked against Vercel's docs (search, Oct 2026):** for Node.js functions
  `request.body` is an object when the request has a supported `Content-Type`, otherwise `undefined`. Docs show a
  signed-webhook function reading the raw bytes by exporting `config = { api: { bodyParser: false } }` and reading
  the stream (their example uses the `raw-body` package). **Not confirmed:** whether touching `req.body` first
  consumes the stream. For T18 (Razorpay, Phase 2) the raw route must be tested on a Preview deployment before
  relying on it; `readBody` already handles both a pre-read body and a stream.
