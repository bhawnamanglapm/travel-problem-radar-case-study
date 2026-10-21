# T04 · Confirmation email, subscriber digest, batch sending

| | |
|---|---|
| Phase | 1a, foundations |
| Who | Developer |
| Size | M |
| Depends on | T00 for the real sender (code can be written and tested before it) |
| Unblocks | T05, T09 |

## Why

`api/_lib/email.js` builds one digest and sends it to `EMAIL_TO`. Subscribers need three more things: a
confirmation email, a digest with their own unsubscribe link, and a way to send many single-recipient emails without
one HTTP call each. Everyone gets their own copy: putting subscribers on one To line would show every address to
every reader.

## What to build (all in `api/_lib/email.js`)

### 1. Options on `buildDigestEmail`

Add an optional third argument, `{ heading, subjectLead }`, used by the subscriber emails:

| Email | Heading | Subject |
|---|---|---|
| Owner (today, unchanged) | `Travel Problem Radar: digest` | `Travel Problem Radar · <time> · N problems, M new` |
| Pro | `Travel Problem Radar: Pro update` | `Travel Problem Radar · <time> · N problems, M new` |
| Free daily | `Travel Problem Radar: daily digest` | `Travel Problem Radar daily · <date> · N problems, M new` |

With no third argument the output must be byte-for-byte what it is today (the owner's email tests check the
subject and body).

### 2. `withSubscriberFooter(mail, { manageUrl, unsubscribeUrl, plan })`

Returns a copy of a built message with:
- a footer in both parts: "You get this because you subscribed (Free plan: one email a day)." or "(Pro plan: an
  email after every sweep)", then an **Unsubscribe** link, and in Phase 2 a **Manage subscription** link;
- `headers`:
  - `List-Unsubscribe: <unsubscribeUrl>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

The digest body is built **once per send** and only the footer differs per person.

### 3. `buildConfirmEmail({ confirmUrl, siteUrl })`

Subject: `Confirm your Travel Problem Radar subscription`. Body: one sentence on what they will get (Free: one
digest a day), a **Confirm** link, "If you didn't ask for this, ignore this email; nothing more will be sent", and
what is stored (the address and dates; unsubscribing deletes it). HTML and text parts, styled like the digest.

### 4. `sendBatch({ apiKey, from }, messages, { fetchFn, timeoutMs, idempotencyKey })`

- `messages`: array of `{ to, subject, html, text, headers }`, one recipient each.
- Sends to Resend's batch endpoint, `POST https://api.resend.com/emails/batch`, in chunks of at most
  `BATCH_SIZE` (100, **verify**), with the same `authorization` and `user-agent` headers as `sendEmail()`.
- Refuses to run with Resend's shared sender (`DEFAULT_FROM`) or an empty `from`, returning
  `"not configured: EMAIL_FROM must be on a verified domain"`. The shared sender can't reach subscribers, so trying
  would only use up quota on errors.
- Never throws. Returns counts and a reason, never addresses or Resend's message text:

```js
{ sent: 37, failed: 0, stopped: null }                     // all good
{ sent: 100, failed: 0, stopped: "quota" }                 // 429 *_quota_exceeded: stop, don't retry
{ sent: 0, failed: 100, stopped: "http 401 ..." }          // auth problem: stop
```

- On a `429` rate-limit (not quota) reply, wait the `retry-after` time once (at most 2 seconds), then retry that
  chunk once.
- Send an `Idempotency-Key` header per chunk when the caller gives one (T09 passes `<sweep id>-<group>-<chunk n>`),
  so a retried request is not delivered twice (**verify** Resend supports it on batch).

### 5. `sendOne(...)`

A thin wrapper used by the confirmation email: `sendBatch` with one message. It returns `"sent"` or the same
`failed: ...` strings `sendEmail()` uses.

## Acceptance criteria

- [ ] The owner's digest and failure email are unchanged (existing tests pass untouched)
- [ ] Pro and Free digests have their own heading and subject, and a footer with the unsubscribe link
- [ ] Every subscriber message has both `List-Unsubscribe` headers
- [ ] `sendBatch` splits 250 messages into 3 requests of 100, 100 and 50
- [ ] `sendBatch` stops at the first quota reply and reports how many were sent before it
- [ ] Nothing returned contains an address, the key or Resend's error message

## Tests (in `test-subscriptions.mjs`, with a fake Resend `fetch`)

- Footer links are escaped in HTML, present in text, and differ per recipient while the body is identical
- Free subject format, Pro subject format
- Confirmation email contains the confirm URL and the "ignore this" line
- Batch chunking (250 → 100/100/50), each request has one address in each `to`
- Quota stop after chunk 1: `{ sent: 100, stopped: "quota" }`, chunk 2 never sent
- `429` rate limit, then success: retried once
- Network error and timeout: counted as failed, no throw
- Shared sender refused before any request is made
- The result JSON has no `@`

## Verify at build time

- Resend batch endpoint: path, maximum emails per call, whether it accepts per-email `headers`, its reply shape on
  partial failure (and the batch "validation mode" option, if it exists), and `Idempotency-Key` support
- Resend's default API rate limit (requests per second), to size the chunk timing in T09
- If the batch endpoint does not accept custom headers: send each subscriber email through `POST /emails`, one at a
  time within the rate limit, and note the change in T09's time budget

## Out of scope

- Templates or an email-design system. Keep the existing inline-styled HTML.
