# Progress: T01 to T11

Working log for the build of Phase 1 (Free and Pro email digests). One task at a time: implement, test locally
(`npm run build && npm run check && npm test`), commit, push, then the next. Branch: `feat/subscriptions`.

Status values: `todo`, `in progress`, `done` (tested offline, committed and pushed). Nothing here has been seen
working in a real inbox; that is T12's staged launch.

| Task | Status | Commit | Tests after | Notes |
|---|---|---|---|---|
| [T01](T01-storage-list.md) Storage `list()` + test helpers | done | 9175e84 | 73 pass (68 old + 5 new) | See T01 notes below |
| [T02](T02-subscriber-records.md) Subscriber records module | done | f0de053 | 96 pass (+23 new) | See T02 notes below |
| [T03](T03-http-helpers.md) HTTP helpers | done | 536cc33 | 117 pass (+21 new) | See T03 notes below |
| [T04](T04-email-builders.md) Email builders + batch send | done | 87bbdcb | 155 pass (+38 new) | See T04 notes below |
| [T05](T05-api-subscribe.md) `POST /api/subscribe` | done | 0f718c3 | 200 pass (+45 new) | See T05 notes below |
| [T06](T06-api-confirm.md) `/api/confirm` | done | 15c4478 | 221 pass (+21 new) | See T06 notes below |
| [T07](T07-api-unsubscribe.md) `/api/unsubscribe` | done | 5dfa7be | 238 pass (+17 new) | See T07 notes below |
| [T08](T08-subscribe-page.md) `/subscribe/` page, build, checks | done | PENDING_HASH | 238 pass + 7 new `npm run check` checks | See T08 notes below |
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

### T04
- `email.js` gains `withSubscriberFooter`, `buildConfirmEmail`, `sendBatch`, `sendOne` and `BATCH_SIZE` (100).
  `buildDigestEmail` takes an optional third argument `{ heading, subjectLead }`; without it the output is
  byte-for-byte the owner's digest (tested), so owner delivery is unchanged.
- `sendBatch` refuses to send unless `EMAIL_FROM` is on a verified domain (not the `resend.dev` default).
  Its result holds counts, positions and short reasons only: never an address, the key or Resend's message text.
  Messages after a quota, auth or deadline stop are neither sent nor failed; the caller (T09) counts them as deferred.
- A 429 that is not a quota error waits `retry-after` (capped at 2 s) and retries once. A 400/422 chunk is retried
  one message at a time so only the bad address fails.
- **Resend facts checked in its docs this session:** batch endpoint `POST /emails/batch`, at most 100 per call,
  per-email `headers` supported, no attachments; `Idempotency-Key` supported (expires after 24 h, up to 256
  characters); default limit 10 requests/second/team, `retry-after` header present; `daily_quota_exceeded` and
  `monthly_quota_exceeded` return 429.
- **Not confirmed:** the reply shape when only some messages in a batch fail (undocumented), and any
  validation-only mode. The code treats a reply with fewer ids than messages as "short reply" and counts the
  rest failed. The fake Resend in the tests is built from the docs, not from a real response.

### T05
- `api/_lib/subscription-handlers.js` (`makeSubscribeHandler`, `siteUrl`) and `api/subscribe.js`. The handler is
  off until `SUBSCRIPTIONS_ENABLED=1`; with it off nothing is read or written (tested).
- Every row of the task's table has a test. Rows 5, 7, 8, 9, 10, 11 and 12 reply with the identical body; the
  honeypot, new and pending-recent replies are compared including headers.
- **Choices beyond the task text:**
  - The daily confirmation cap (`MAX_CONFIRMS_PER_DAY`, default 10; `0` closes confirmations) also applies to the
    row 9 re-send, because a re-send spends the same email quota. If the events can't be counted, the cap counts as
    reached.
  - `radar:subscriberCount` may hold a bare number or `{count, at}`. T10 must write one of these. A missing file
    counts as 0 (no sweep has run yet; the daily cap still bounds sign-ups). An unreadable file counts as full.
  - A storage failure gives `500 {"error":"could not process the request; try again later"}`; the log line holds
    only the error's class name.
  - The confirmation email is sent with an idempotency key per record and `confirmSentAt`.
  - The `confirmsent` event is recorded when the send is attempted, so a Resend outage can't turn into a retry storm.
- **Known race:** two simultaneous first sign-ups of the same address both write a pending record; the later write
  wins, so the earlier email's link fails and the later one works. Storage has no conditional create.
- **Verify items not confirmed:** the Hobby plan's function-count limit (a Vercel docs search this session did not
  answer it; check the Vercel dashboard or limits page when deploying a preview: Phase 1 takes the project from
  2 to 5 functions). The visitor-IP header was not looked up, since the per-IP limit is T13.

### T06
- `makeConfirmHandler` and `api/confirm.js`. Shared helper `handleLink` in `subscription-handlers.js` does the
  method check, switch check, parameter reading and the id/token lookup; T07 reuses it.
- The expired-pending delete (older than 7 days) happens only when the token matches. Otherwise anyone who could
  compute an address's id (it is a hash of the address) could delete that person's pending record. A wrong token
  on an expired record gets the same 404 as any wrong token (tested).
- Page titles go through `esc()`, so an apostrophe appears as `&#39;` in the HTML (it displays correctly).
- Not done, as the task says: no welcome email.

### T07
- `makeUnsubscribeHandler` and `api/unsubscribe.js`, on the same `handleLink` helper as T06 with three options:
  id and token are read from the query string on POST too (a mail app's one-click POST has only a fixed body, which
  is never read); it ignores `SUBSCRIPTIONS_ENABLED`; and an unknown id or wrong token gives `200` "You're not
  subscribed" instead of 404.
- A still-paid `proSource: "razorpay"` record is kept on POST, with a page pointing to `/subscribe/` (T19 will
  provide the manage page). The explanation shows on POST only; GET shows the normal page.
- One test builds the link with `withSubscriberFooter` (T04) and POSTs it, so the two tasks agree.
- **Verify item (Gmail/Yahoo one-click rules), only partly checked:** a web search (no official Google or Yahoo
  page came back) gave the header pair (`List-Unsubscribe: <https URL>` and `List-Unsubscribe-Post:
  List-Unsubscribe=One-Click`), an HTTPS URL, and a non-interactive POST. **Not confirmed:** what response and
  redirect behaviour they require. The endpoint answers the POST directly with `200` and no redirect, which is the
  safest reading. Check against Google's sender guidelines and RFC 8058 before launch (T12).

### T08
- `subscribe/index.html`: one self-contained file (inline CSS and script), dark palette matching `live/`. Both plans
  in a two-row table, email field, off-screen honeypot `website` (with a label for screen-reader users),
  `aria-live` status line, privacy note, AI notice. A `503` shows "Subscriptions aren't open yet."
- Without JavaScript the form posts form-encoded data to `/api/subscribe`, which answers with JSON, so the visitor
  sees raw JSON. Acceptable as the task says.
- `vercel.json` `buildCommand` now copies `subscribe`. `scripts/check.mjs` has 7 new checks (posts to the API, both
  field names, privacy note, AI notice, self-contained, build copies it, any link from `index.html` is the absolute
  Vercel URL). `npm run check` passes.
- **Links are held back for T12, as the task says:** `live/index.html`, `index.html` and `README.md` are unchanged.
- **OWNER INPUT NEEDED, launch blocker:** the page has no contact address. It says "contact details will be added
  here before sign-ups open." I did not invent one. Add the address before T12.
- **Not verified:** the by-hand acceptance items (the page on a preview deployment at `/subscribe/` and
  `/subscribe`, phone width, the honeypot being skipped by keyboard and screen readers, the form without
  JavaScript). Those need a real browser and a deployment. The inline script was only checked to parse.

