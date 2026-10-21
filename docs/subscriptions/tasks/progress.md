# Progress: T01 to T12

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
| [T08](T08-subscribe-page.md) `/subscribe/` page, build, checks | done | 147fd24 | 238 pass + 7 new `npm run check` checks | See T08 notes below |
| [T09](T09-delivery-engine.md) Delivery engine | done | ef7831b | 281 pass (+43 new) | See T09 notes below |
| [T10](T10-sweep-integration.md) Wire delivery into the sweep | done | 0d3b008 | 300 pass (+19 new) | See T10 notes below |
| [T11](T11-admin-script-and-metrics.md) Admin script + metrics | done | d344d34 | 340 pass (+37 new; 303 before T11) | See T11 notes below |
| Request Pro (owner-approved, before payments) | done | aba8d26 (#8) | 371 pass (+31 new) + 7 new `npm run check` checks | See "Request Pro" notes below |
| Fresh Blob reads (bug fix) | done | 61b2f79 (#9) | 374 pass (+3 new) | Reads skip Blob's CDN cache except `/api/data`'s |
| [T12](T12-docs-and-launch.md) Docs | done | branch `fix/pages-redirect-and-launch-docs` | 374 pass; 39 `npm run check` checks | Docs 1 to 6; see "T12" below |
| [T12](T12-docs-and-launch.md) Staged launch | in progress | | | Steps recorded under "T12" below |

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

### T09
- `api/_lib/subscriber-delivery.js`: `deliverToSubscribers` (never throws; returns `"not configured"`, the counts
  object, or `{ error }`) and `buildRollup`. Every acceptance item and test line in the task has a test, plus: the
  roll-up falls back to this sweep when history is unreadable, old delivery files are deleted, an unreadable record
  or one with no token is skipped and counted (`unreadable`), and `/api/data` refuses the new key prefixes.
- Uses decisions D2 (roll-up), D4 (scheduled only) and D5 (Pro gets every saved scheduled sweep) as recommended. D5's
  "skip when nothing is new" option is not built.
- **Choices beyond the task text:**
  - `radar:subscriberCount` is written as `{count, at}`, which T05 already reads.
  - A failed save of the count or of the deliveries file is reported in the result (`countSaveFailed`,
    `deliveriesSaveFailed`) and the run carries on. A failed deliveries save means that Free chunk could be sent
    again at the next sweep, so the owner should look at that flag.
  - The deliveries file is only written for a chunk that sent at least one email.
  - Any stop (quota, auth failure, deadline) in the Pro group also defers the Free group.
  - `expired` events are recorded with no plan. `pending` in the result is the count of pending records kept.
  - The roll-up reads at most 12 earlier sweeps from the last 24 hours.
- **Retries and idempotency:** Resend's idempotency key is `<sweep id>-pro-<n>` and `<YYYYMMDD>-free-<sweep id>-<n>`.
  If the same sweep were delivered twice with a different recipient set under the same key, Resend would refuse
  the second call (not tested against the real service); that call would count as failed and be retried at the next
  sweep.
- **Verify items:** Resend's rate limit (10 requests a second, from its docs) is far above one call per 100
  recipients. **Not verified:** the Hobby plan's Blob operation allowance for about 5 sweeps a day at the cap (needs
  the plan's published limits or a real run); the roll-up reads and deliveries writes are small.

### T10
- `makeSweepHandler` takes `randomBytes` (default `node:crypto`'s; `api/sweep.js` passes it) and takes `startedAt`
  from `now()` at the top of the call. In the saved branch, after the owner's Slack and email, it sets
  `summary.subscribers = await deliverToSubscribers({... deadlineAt: startedAt + SUBSCRIBER_DEADLINE_MS })`
  (`SUBSCRIBER_DEADLINE_MS = 240_000`, exported). A throw from it is caught and becomes `{error: "subscriber delivery
  failed"}`; the answer stays 200 saved. Skipped, `empty` and error answers are unchanged and have no `subscribers` field.
- The 68 original checks pass unchanged. 19 new checks in `scripts/test-subscriptions.mjs` run the real sweep handler
  with one fake `fetch` for Anthropic, Resend single and Resend batch: order of calls (owner, then Pro batch, then Free
  batch), the owner's quota error alongside `stopped: "quota"` with one batch request only, the 240 s deadline
  (everything deferred, nothing sent, still 200), a storage failure and a Resend network error during delivery,
  manual runs (Pro skipped), the switch off, and no address or token in the reply or the log.
- `/api/data` refusals of the four key prefixes are already tested in the T09 block; the T10 block adds a check that
  the keys a sweep actually wrote are refused too.
- `DEPLOYMENT.md`: the section 1 diagram has the "then: digests to subscribers (optional)" line, and 5.2 describes the
  `subscribers` field.
- **Not verified:** the 240 s deadline against a real run's timing (the 4 Anthropic calls run in parallel; the
  owner's measured duration is the 5.4 step in DEPLOYMENT.md). The sweep's total time with 5000 subscribers (50 batch
  requests) has not been measured against the 300 s limit.

### Bug found and fixed on the way (commit 9ddaba3)
- `countEvents` lists `radar:event:<day>-`, but `blobStorage().list` accepted only prefixes ending in `:`. On the real
  store it would have thrown, and T05 treats that as "cap reached", so **every sign-up would have been refused a
  confirmation email**. The memory store used in the tests accepts any prefix, so it was not caught. Now `list`
  accepts a prefix that starts with `radar:` and ends in `:` or `-`, and two tests run `countEvents` through
  `blobStorage()` with a fake Blob client. Lesson: any test of code that lists should go through `blobStorage()` too.

### T11
- `scripts/subscribers.mjs`: `stats`, `list`, `show`, `grant-pro`, `revoke-pro`, `delete`, `prune-events`, as in the
  task. The logic is exported as functions that take `storage` and `now` (`computeStats`, `grantPro`, `revokePro`,
  `removeSubscriber`, `pruneEvents`, `listRows`, `showRecord`, `main`); the file runs the CLI only when it is the
  entry point, so the tests import it without side effects.
- **Choices beyond the task text:**
  - Without `--yes`, a write prints what it would change, changes nothing and exits **1** (there is no interactive
    prompt, so it works in a script).
  - `--until 2027-01-31` means the end of that UTC day (`23:59:59.999Z`), so the date given is the last day of Pro.
    A past date is accepted and the sweep treats it as Free. A malformed or impossible date is a usage error (2).
  - `grant-pro` also refuses a record that is a paid Razorpay Pro, and `revoke-pro` says "nothing to do" for a record
    already on Free.
  - `delete` records no event (there is no event type for it, and the task does not ask for one).
  - `stats` unsubscribe-by-plan reads the file of each `unsubscribed` event in the period; every other count comes
    from the key names alone. The confirm rate is `confirmed / subscribed` over the same days, as the task defines
    it, so people who subscribed before the period can push it above what a cohort would give.
  - `.vercelignore` is checked by a test, so the script cannot slip into the deployment unnoticed.
- DEPLOYMENT.md has "Managing subscribers" (commands, token step); pricing.md's gate question points at `stats`.
- **Not verified:** whether `vercel env pull` gives a token that works from a laptop (the task's own verify item;
  the script's error message when there is no usable credential is shown by running it with none). Nothing here has
  been run against the real store. Whether the deploy's file list excludes `scripts/` needs a real deploy to confirm
  (acceptance item 5): `.vercelignore` lists it.

### Request Pro (branch `feat/pro-request`, not in the original task list)
- Asked for by the owner during the T12 launch: let a subscriber ask for Pro, the owner grants it, and payments slot
  in at the same point later (T17/T18).
- Two places to ask: the "I'd also like Pro" box on `/subscribe/` (stored as `proRequestedAt` on the pending record;
  the event and the owner email happen only at Confirm), and a "Request Pro" button on the new `/manage/` page.
- `/api/account` (the sixth function): `GET` returns the plan without the address or token; `POST`
  `action: "request-pro"` gives `409 not_confirmed` / `409 already_pro`, `200` with nothing sent on a repeat, and
  otherwise stores the date, records a `prorequested` event and emails `EMAIL_TO` (subject "Travel Problem Radar: Pro
  request", naming nobody). A failed owner email is logged and still returns `200`.
- Every digest's footer now links to `/manage/?id&t` ("Manage subscription"). The confirm page links there too, and
  the "Cancel your Pro plan first" unsubscribe page points there instead of `/subscribe/`.
- Admin script: `list --plan requested`, a `proRequestedAt` column, `stats` "N waiting for Pro" and a `pro asked`
  column per day.
- **Choice beyond the plan:** `grant-pro` clears `proRequestedAt`, so a later lapse or `revoke-pro` doesn't put the
  person straight back on the waiting list; the `prorequested` event keeps the history.
- **Not verified:** none of this has run on the real deployment yet. The function count (6) against the Hobby limit
  has not been re-checked.
- Update, 2026-10-21: deployed. The manage page showed a real record's plan and took a Pro request, so the sixth
  function deploys and answers on Hobby.

### T12
- **Docs 1 to 6 done:** DEPLOYMENT.md "Subscriber email (optional)" plus the 4.3 and section 7 tables, stored keys,
  troubleshooting rows and the `vercel.json` block; TECHNICAL.md; README; email-signup.md and architecture.md now
  describe the build; decision log rows D1 to D9 and three later choices; CHANGELOG.
- **Fix found on the way:** GitHub Pages also served `/subscribe/`, `/manage/` and `/live/`, but has no `/api/`, so
  those copies couldn't work. Each page now sends a Pages visit to the Vercel copy (`c518855`, with checks).
- **Launch steps, as of 2026-10-21 21:00 UTC** (facts only; the owner's checks of inboxes are theirs to record):

| Step | Result |
|---|---|
| 1. Deploy switched off | Not run as a separate step: production was configured before this check |
| 2. Variables | Done. All set for Production (checked by name only): `EMAIL_FROM`, `MAX_SUBSCRIBERS`, `MAX_CONFIRMS_PER_DAY`, `SITE_URL`, `SUBSCRIPTIONS_ENABLED` and the rest |
| 3. Confirmation email | Arrived from `EMAIL_FROM`, but **in spam**, so the check "not in spam" failed. SPF, DKIM (`resend._domainkey`) and DMARC (`p=none`) records exist for the domain |
| 4. Confirm, `stats` | Done |
| 5. Free digest | A manual sweep at 19:50 UTC replied `free.sent: 1`. Arrival not yet confirmed by the owner |
| 6. Pro | `grant-pro` done for one address. Waiting for the next scheduled sweep (00:17 UTC on 2026-10-22) |
| 7. Gmail Unsubscribe button | Not done |
| 8. Other providers (Outlook) | Not done |
| 9. Links | Done (#10). The Pages redirect above completes "links work from both GitHub Pages and Vercel" once merged |

- **Seen while checking:** the scheduled GitHub runs at 10:15 and 15:22 UTC on 2026-10-21 failed with "Add
  CRON_SECRET". The repository secret was added at 19:46 UTC, after both. No scheduled GitHub run has succeeded yet;
  the first chance after the secret was the 20:17 UTC slot, which had not started by 21:03 UTC.
- **Not written down yet (owner):** the Phase 2 gate thresholds and the measuring period (acceptance item 3). They
  must be set before looking at results.
