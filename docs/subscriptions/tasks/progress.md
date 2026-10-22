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
| [T12](T12-docs-and-launch.md) Staged launch | in progress: one check open (a Pro email with one category) | | | Steps recorded under "T12" below |
| [T13](T13-optional-hardening.md) Bounces, complaints, per-IP limit | done, live on production (webhook and firewall rule) | merged as #12 | 423 pass (355 subscriber + 68 sweep; +49 new) and 3 new `npm run check` checks | See "T13" below |
| [T14](T14-optional-pro-categories.md) Pro chooses categories | done, live on production; the email side not checked yet | merged as #18 | 454 pass (386 subscriber + 68 sweep; +29 new); 46 `npm run check` checks (+1) | See "T14" below |
| One subscription per inbox (fix, not in the original task list) | done, live on production and checked | merged as #19 (33d1ef1, 3af6403) | 485 pass (417 subscriber + 68 sweep; +31 new); 46 `npm run check` checks | See "One subscription per inbox" below |
| Old unsubscribe links say "no longer active" (fix) | done, live on production | merged as #23 (f43e25f) | 486 pass (418 subscriber + 68 sweep; +1 new); 46 `npm run check` checks | An old link's page said the address was off the list when it wasn't |
| [T15](T15-phase2-gate-and-accounts.md) Gate and accounts | in progress: gate skipped by the owner; prerequisites started | | | See "T15" below |
| [T16](T16-accounts-and-sign-in.md) Accounts and sign-in | done; sign-up half checked in production, sign-in link not yet | branch `feat/t16-accounts-and-sign-in` | 548 pass (480 subscriber + 68 sweep; +62 new); 71 `npm run check` checks (+9) | See "T16" below |
| [T17](T17-locked-board.md) Locked board | todo | | | Behind `BOARD_PAYWALL`, off |
| [T18](T18-teaser-email.md) Free email becomes a teaser | todo | | | Same switch |
| [T19](T19-razorpay-library.md) Razorpay library | todo | | | Needs T15's prices and Razorpay test keys |
| [T20](T20-manage-page-and-checkout.md) `/manage/` page, checkout, cancel | todo | | | Needs T16 and T19 |
| [T21](T21-razorpay-webhook.md) Razorpay webhook | todo | | | Needs T19 and T20 |
| [T22](T22-pro-lifecycle-and-go-live.md) Pro expiry, paid unsubscribe, go-live | todo | | | Needs Vercel Pro (T15 Step 2, row 3) |

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
  consumes the stream. For T21 (Razorpay, Phase 2) the raw route must be tested on a Preview deployment before
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
- A still-paid `proSource: "razorpay"` record is kept on POST, with a page pointing to `/subscribe/` (T22 will
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
  in at the same point later (T20/T21).
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
| 3. Confirmation email | Arrived from `EMAIL_FROM`, but **in spam**, so the check "not in spam" failed. SPF, DKIM (`resend._domainkey`) and DMARC (`p=none`) records exist for the domain. **Rechecked 2026-10-21 22:00 UTC:** Gmail's headers show SPF, DKIM (`d=pehchanthetraveller.com`) and DMARC all `pass`; Gmail still files it as spam ("similar to messages that were identified as spam in the past"). mail-tester scores it 9.1/10; nearly all the lost points are `FROM_FMBLA_NEWDOM14` ("From domain was registered in last 7-14 days"), so the likely cause is the domain's age, not the setup or the content. The sign-up reply now says to check spam or junk. Recheck with mail-tester in about two weeks |
| 4. Confirm, `stats` | Done |
| 5. Free digest | A manual sweep at 19:50 UTC replied `free.sent: 1`. **2026-10-22:** Free digests from the 23:25 and 02:27 UTC sweeps reached the owner's Outlook.com address, in **Junk** |
| 6. Pro | Done. Pro emails from the three scheduled sweeps after `grant-pro` (23:25 UTC on 2026-10-21, and 02:27 and 04:57 UTC on 2026-10-22) all reached the owner's Gmail **Inbox** |
| 7. Gmail Unsubscribe button | Done 2026-10-22. The owner used Gmail's own Unsubscribe button; `stats` then showed a second Pro unsubscribe and 0 Pro, so the record was deleted. It must have been on an email sent after the owner signed up again at about 08:05 UTC, since older emails' links no longer match (#23) |
| 8. Other providers (Outlook) | Done by the owner with their own Outlook.com address, not by other people: the confirmation, the Free digests and the already-subscribed notice all landed in **Junk**; the confirm page and Confirm button worked; the Unsubscribe link worked (see "One subscription per inbox"). Only Gmail and Outlook.com were tried |
| 9. Links | Done (#10). The Pages redirect above completes "links work from both GitHub Pages and Vercel" once merged |

- **Seen while checking:** the scheduled GitHub runs at 10:15 and 15:22 UTC on 2026-10-21 failed with "Add
  CRON_SECRET". The repository secret was added at 19:46 UTC, after both. No scheduled GitHub run has succeeded yet;
  the first chance after the secret was the 20:17 UTC slot, which had not started by 21:03 UTC.
- **Not written down (owner):** the Phase 2 gate thresholds and the measuring period (acceptance item 3). On
  2026-10-22 the owner chose to start the Phase 2 prerequisites without the gate (decisions.md), so this item is
  closed as skipped, not met.
- **Still open:** a Pro email after the owner chose categories (T14). The owner unticked Industry, but the Pro record
  was deleted by step 7 before the next sweep. It needs a sign-up, `grant-pro`, the categories set again and a
  scheduled sweep.
- **Owner's checks, 2026-10-22:** `/manage/` on a phone, reported fine. An unsubscribe link from before the re-signup
  now shows "This link is no longer active" (#23; also checked on production with a made-up link).

### T13
- **Part A:** `api/resend-webhook.js` (function 7 of Hobby's 12) is a Web-standard handler, so the signature is
  checked on the exact raw body. `verifySvix` uses `node:crypto` only (no new package) and refuses a missing header,
  a timestamp more than 5 minutes off, or no matching `v1` signature. A hard bounce or a complaint deletes the record
  and records a `bounced` or `complained` event; soft bounces, other events and unknown addresses get `200` and
  change nothing. No reply or log line has an address (tested).
- **Part B:** the sign-up limit runs after the email check and before any other storage call. The client IP is
  `x-vercel-forwarded-for`, else `x-forwarded-for`, else `x-real-ip`; Vercel overwrites `x-forwarded-for`, so a
  client can't choose it. Counter keys hold a 16-hex SHA-256 prefix of the IP, never the IP. The sweep's tidy-up
  deletes counters older than 2 hours (only when subscriptions are configured, like the other tidy-ups).
- **Why the firewall rule too:** each allowed attempt costs one list and one upload, on top of what sign-up already
  spends, and Hobby includes 2,000 advanced Blob operations a month (going over locks Blob for 30 days). Today's
  usage was not measured. The rule answers a flood with `429` before the function runs.
- **Firewall rule:** live on production since 2026-10-22, added with the Vercel CLI (the claude.ai Vercel connector
  answered 403 for this team). It was the project's first firewall rule. Its settings were read back from the live
  config and match DEPLOYMENT.md. It has not been triggered on purpose.
- **Webhook:** live on production since 2026-10-22, after the owner added the Resend endpoint and the secret.
  Tested there with `bounced@resend.dev` and `complained@resend.dev`: Resend's log shows `200` for both, both
  pending records were deleted, and `stats` (which now has `bounced` and `complained` columns, #15) counts one of
  each. Those two test sign-ups are in the 21 Oct (UTC) sign-up counts, so they lower that day's confirm rate.

### T14
- Built on `/manage/` and `/api/account` (no new function; still 7 of 12). Free sees the boxes disabled.
- A Pro whose categories have nothing in a sweep gets no email for it; the sweep reply counts them in
  `pro.emptyForCats`.
- **Checked on production, 2026-10-22:** the Categories card saved a choice ("Saved. Your next Pro email has only
  these categories."), and the owner reported the page fine on a phone.
- **Not checked yet:** a real Pro email after choosing categories (see T12, "Still open").

### One subscription per inbox (branch `fix/one-subscription-per-inbox`)
- `canonicalEmail()` makes the id: Gmail drops dots and `+tags` and maps `googlemail.com` to `gmail.com`; Outlook,
  Hotmail, Live, MSN, iCloud, Proton and Fastmail drop `+tags`; other domains are unchanged, so most existing ids
  stay the same. `findSubscriber()` tries the canonical id, then the pre-change id, so older records and their
  links still work.
- An already-confirmed address is told so, and gets one email with its manage and unsubscribe links at most every
  24 hours (`noticeSentAt` on the record, a `noticesent` event). Those emails count towards `MAX_CONFIRMS_PER_DAY`
  with confirmations. A failed send stores nothing and points to a digest's Manage link.
- A pending address with a confirmation sent in the last 24 hours is told so, and nothing is sent.
- The honeypot, the per-IP limit, a full or closed list and the confirmation cap keep the generic reply.
- **Owner's choice (2026-10-22):** accept that the reply shows whether an address subscribes.
- **Checked on production, 2026-10-22 (about 07:45 UTC), by the owner signing up their confirmed Gmail
  address again, typed exactly as subscribed (no dot or `+tag` variant):**
  1. `/subscribe/` replied "This address is already subscribed. We've emailed it a link to manage the
     subscription."
  2. "You're already subscribed to Travel Problem Radar" arrived from `hello@pehchanthetraveller.com` in Gmail's
     **Inbox** (not spam, unlike the confirmation emails in T12). Its Manage subscription link opened `/manage/`
     with the record's plan (Pro) and categories.
  3. A second try straight after replied "Use the Manage link in any digest email to change it", and no second
     email came.
  4. `stats` for 2026-10-22: 1 notice and 0 sign-ups, so no new record was made.
- **Variant checked on production, later on 2026-10-22:** the owner signed up a Gmail variant of the same address
  with both a dot and a `+tag` added (the form `first.last+test@gmail.com`). The page replied "This address is already subscribed. Use the Manage link in any digest
  email to change it." (within 24 hours of the notice), and `stats` still showed 0 sign-ups and 1 notice. A variant
  that missed the record would have stored a new pending record and sent a confirmation, so it found the existing
  one.
- **Outlook checked on production, 2026-10-22 (about 07:58 UTC):** the owner signed up their confirmed Outlook.com
  address with a `+test` tag. The page replied "already subscribed. We've emailed it a link…", and `stats` showed 2
  notices and still 0 sign-ups, so the `+tag` was dropped and the existing record found. The notice landed in
  Outlook's **Junk**, as the confirmation and the Free digests had (Gmail put its notice in the inbox).
- **Unsubscribe link checked:** the owner opened Unsubscribe from a notice email, saw the button page, pressed it
  and got "You're unsubscribed". `stats` then showed 1 Pro unsubscribe and 0 Pro subscribers, so the owner's Pro
  record was deleted.
- Not checked on production: `+tags` on the other listed providers (iCloud, Proton, Fastmail and the other
  Microsoft domains); the offline tests cover them.

### T15
- **2026-10-22: the owner chose to skip the gate** and start the Phase 2 prerequisites (decisions.md). No thresholds
  or measuring period were set and no real sweep has been scored, so Step 1's table stays empty.
- pricing.md's rule still applies: don't charge anyone before at least one real sweep is scored with the README's
  rubric.
- **Policy pages drafted** (`legal/privacy`, `legal/terms`, `legal/refunds`, `legal/contact`): facts the repo
  already holds (what is stored, for how long, Vercel and Resend, deletion), and a highlighted
  `[OWNER INPUT NEEDED: …]` gap for everything else (legal name, address, prices, refund rule, governing law,
  response times). Each has a draft notice and `noindex`. They are **not** in `vercel.json`'s build, so they aren't
  live. `npm run check` fails if the build ships them with a gap, the draft notice or `noindex` left, or if
  `/subscribe/` or `/manage/` link them before then. To publish: fill the gaps, have them reviewed, remove the
  notice and `noindex`, add `legal` to `buildCommand`, then link them from the page footers.
- **Prerequisites checked against Vercel and Razorpay docs (2026-10-22)**, now a table in T15 Step 2 with sources.
  The owner created a Razorpay account the same day; activation is not submitted. Razorpay's website check wants
  **About us** and **Pricing details** pages as well as the four drafts. Vercel's Hobby terms rule out "any method
  of requesting or processing payment", so Pro ($20 a month per developer seat) comes before live payments.
- **Owner details filled (2026-10-22)**: reply time ("within the same day") and governing law (India; courts at
  Patiala, Punjab) are in the pages. The name, postal address and phone are **not** in the repo: the pages carry
  `{{LEGAL_NAME}}`, `{{LEGAL_ADDRESS}}` and `{{LEGAL_PHONE}}`, and `scripts/fill-legal.mjs` fills them from Vercel
  variables of the same names at build time, failing the build if one is unset. `npm run check` tests the filler,
  that the pages use exactly those slots and hold no phone number, and, once `legal` ships, that the build runs
  the filler. Still open: the go-live date, prices and payment terms, the refund rule and timing, notice to paying
  subscribers, liability, the DPDP grievance contact, and Razorpay's details.
- **Row 10 added to Step 2**: Razorpay's "login to complete a payment?" question. Suggested answer Yes, with the
  sign-up steps; what the form asks for next is not in Razorpay's docs, so it is unchecked.
- **2026-10-22: Pro pays for the website, not email** (decision log; design in
  [paid-website.md](../paid-website.md)). The whole live board becomes paid; the free
  email becomes a teaser; sign-up and sign-in by email link, no passwords. Planned PRs: accounts and sign-in, the
  locked board behind `BOARD_PAYWALL` (off), the teaser email. pricing.md, T19 to T22 and the draft terms updated.
  Step 2 row 10: Razorpay's "login to complete a payment?" is answered Yes.

### T16
- New function `api/session.js` (8 of Hobby's 12) and module `api/_lib/session.js`; no new package.
- Decisions made while building (also in [paid-website.md](../paid-website.md)):
  - The cookie's signature also covers the record's `createdAt`, so a cookie from before an unsubscribe and
    re-sign-up is refused.
  - Sign-in emails have their own limits (5 minutes per address, `MAX_SIGNINS_PER_DAY` default 50, and the shared
    per-IP limit), not `MAX_CONFIRMS_PER_DAY`, so bot sign-ups can't lock subscribers out.
  - Confirm sets the cookie but stays on the "You're subscribed" page.
  - `/manage/` opened by cookie has no Unsubscribe link (it never gets the token).
  - A cookie `POST` from another `Origin` gets `403`.
- Nothing is locked: the board stays open until T17.
- `SESSION_SECRET` is set on Production (2026-10-22), not on Preview, so the check ran on production.
- **Checked in production, 2026-10-22, with a real inbox:** confirm showed "Your account is ready, and you're signed
  in on this browser"; `/manage/` with no email link showed the plan and Sign out; `/signup/` showed "You're signed
  in"; after Sign out, `/manage/` went to `/signin/`.
- **Not checked yet:** a sign-in link requested at `/signin/` (lands on `/live/` signed in), and that the same link is
  refused the second time.

### Sign-up page (after T16)
- `/signup/`: "Create your account", email only. The same `POST /api/subscribe` as `/subscribe/`, without the Pro
  box; no new function. It says plainly that the account includes the free daily email and that unsubscribing
  deletes it, because the account is the subscriber record.
- The confirm page now says "you're signed in on this browser" when the cookie was set.
- Checked in production on 2026-10-22 (see T16 above). The sign-up page said a confirmation link had already gone out
  in the last 24 hours, since that address had an unconfirmed sign-up, and that earlier link was used.

### Account-flow fix #9 (2026-10-22, branch `fix/confirm-resend-wait`)
The owner hit #9: a lost confirmation and "already sent in the last 24 hours".
- A pending address can get its confirmation again after 10 minutes (was 24 hours), from `/signup/` or `/signin/`.
  At most 5 per address (`confirmSends` on the record; older records count as 1), still within
  `MAX_CONFIRMS_PER_DAY`. The replies say when to ask again, or that the limit is reached.
- The sign-in reply adds "You can ask for a new link once every 5 minutes", the same for every address.
- `npm test`: 568 passing (5 new). Not yet checked in production.

### Account-flow fixes (2026-10-22, branch `fix/account-flows`)
Issues #2 to #5 from [account-flows.md](../account-flows.md); no new function (8 of 12).
- #2: "Sign in" on the home page and the live board; on the board it reads "Account" when signed in.
- #3: one sign-up form, on `/signup/`, which gains the Pro box. `/subscribe/` is now the plans page and links to it.
- #4: signing up again with a confirmed address emails a sign-in link (sign-in limits apply). Without
  `SESSION_SECRET` the manage-link notice stays.
- #5: asking to sign in with an address that never confirmed re-sends the confirmation, on sign-up's limits.
- `npm test`: 563 passing (13 new). Not yet checked in production: #4's email with a real inbox.

### Chrome "Dangerous site" warning (2026-10-22)
- Chrome showed a full-page "Dangerous site" warning on the Vercel site. Search Console listed "Deceptive pages" with
  no sample URLs, so the cause is unknown.
- The site was verified in Search Console with a meta tag on `index.html` (PR #33; the tag must stay), a review was
  requested, and Search Console then showed "No issues detected".
- Later the same day, after `/signup/` went live, Chrome warned again on the confirm link, and Google's public
  Safe Browsing status for `/signup/` and `/api/confirm` changed. Its fields aren't documented, so whether the site
  is listed again should be read in Search Console, not from that status.
- Guess, not confirmed: a new site on a shared `*.vercel.app` address with sign-in and sign-up forms that ask for an
  email. A custom domain is the likely longer-term fix; not started.
