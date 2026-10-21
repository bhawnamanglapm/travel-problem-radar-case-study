# T05 · `POST /api/subscribe`

| | |
|---|---|
| Phase | 1b, sign-up flow |
| Who | Developer |
| Size | M |
| Depends on | T02, T03, T04 |
| Unblocks | T08 |

## Why

This is the only way into the list. It must not reveal who is subscribed, must not let anyone flood an inbox with
confirmation emails, and must not let the list outgrow the email quota.

## Files

- `api/_lib/subscription-handlers.js` (new): `makeSubscribeHandler({ env, storage, fetchFn, now, randomBytes })`.
  The confirm and unsubscribe handlers (T06, T07) go in the same file.
- `api/subscribe.js` (new): wires in the real dependencies, like `api/sweep.js` does.

## Behaviour

Request: `POST`, JSON or form-encoded, fields `email` and `website` (the honeypot: a field hidden from people, which
bots tend to fill in).

**Every outcome below that ends in "reply OK" sends the identical reply**:
`200 {"ok":true,"message":"If that address can be subscribed, a confirmation link is on its way."}`. The order of
the checks does not change the reply.

| # | Condition | Action | Reply |
|---|---|---|---|
| 1 | Method isn't `POST` | — | `405` |
| 2 | `SUBSCRIPTIONS_ENABLED` isn't `1` | — | `503 {"error":"subscriptions are not open yet"}` |
| 3 | `RESEND_API_KEY` missing, or `EMAIL_FROM` unset or the shared sender | Log `subscribe not configured` | `503`, same message |
| 4 | Body over 8 KB | — | `413` |
| 5 | `website` is filled in | Nothing | OK |
| 6 | `normaliseEmail` returns `null` | — | `400 {"error":"enter a valid email address"}` (this reveals nothing about the list) |
| 7 | Record exists and is `active` | Nothing | OK |
| 8 | Record exists, `pending`, confirmation sent less than 24 h ago | Nothing | OK |
| 9 | Record exists, `pending`, older confirmation | Send a new confirmation with the **same** token; update `confirmSentAt` | OK |
| 10 | No record, list full (see cap) | Nothing stored | OK |
| 11 | No record, daily confirmation cap reached | Nothing stored | OK |
| 12 | No record | Store `newPending(...)`, send the confirmation, record `subscribed` and `confirmsent` events | OK |

If the confirmation email fails to send in rows 9 and 12, still reply OK, keep the record (a later sign-up after
24 hours retries), and log `subscribe confirm-email <failed: ...>` without the address.

### The two caps

- **List cap, `MAX_SUBSCRIBERS`.** Compare against `radar:subscriberCount`, the count of active plus pending
  records that the sweep writes after each run (T10). Reading one small file is cheaper than listing every
  subscriber on every sign-up. The count can be up to one sweep out of date, so the cap is soft by a few sign-ups.
  **If `MAX_SUBSCRIBERS` is unset or not a positive number, the list counts as full** (decision D7).
- **Daily confirmation cap, `MAX_CONFIRMS_PER_DAY`** (proposed default 10; the owner confirms it from the quota
  formula in [pricing.md](../pricing.md), which counts confirmations). Count today's `confirmsent` events with
  `countEvents` (T02). This stops a bot from spending the day's email quota on confirmation emails.

### The confirmation link

`<site>/api/confirm?id=<id>&t=<token>`, where `<site>` is `SITE_URL`, or `https://$VERCEL_PROJECT_PRODUCTION_URL`
when that is unset. If neither is set, treat the endpoint as not configured (row 3).

## Acceptance criteria

- [ ] Rows 5, 7, 8, 9, 10, 11 and 12 all give byte-identical replies
- [ ] No reply or log line contains the address, the id or the token
- [ ] With `SUBSCRIPTIONS_ENABLED` unset, nothing is read or written
- [ ] A pending record is created with `status: "pending"`, `plan: "free"`
- [ ] At most one confirmation email per address per 24 hours

## Tests (in `test-subscriptions.mjs`)

One test per row of the table, plus:
- Same reply body for a new address and an already-active one
- Uppercase and padded address finds the existing record
- `MAX_SUBSCRIBERS` unset → nothing stored; `radar:subscriberCount` at the cap → nothing stored
- Eleven new addresses with `MAX_CONFIRMS_PER_DAY=10` → ten confirmation emails
- Resend fails → reply OK, record kept, log line has no `@`
- The confirmation email's link has the record's id and token, and the site URL from `SITE_URL`
- Form-encoded and JSON bodies both work

## Verify at build time

- That the Vercel Hobby plan's function count limit (if one still applies to this project) leaves room: Phase 1 adds
  3 functions to the existing 2, and Phase 2 up to 3 more
- What the visitor's IP header is on Vercel (`x-forwarded-for` or `x-real-ip`), if T13's per-IP limit is built

## Out of scope

- CAPTCHA. Add it only if bots get past the honeypot (T13).
