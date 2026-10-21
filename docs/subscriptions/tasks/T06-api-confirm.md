# T06 · `GET` and `POST /api/confirm`

| | |
|---|---|
| Phase | 1b, sign-up flow |
| Who | Developer |
| Size | S |
| Depends on | T02, T03 |
| Unblocks | T08 |

## Why

Double opt-in: nobody is emailed digests until the owner of the address clicks the link. Many company mail systems
open every link in an incoming email to scan it. If a plain `GET` confirmed, those scanners would confirm addresses
nobody signed up. So the link opens a page, and the page's button confirms (decision D9).

## Files

- `makeConfirmHandler({ env, storage, now, randomBytes })` in `api/_lib/subscription-handlers.js`
- `api/confirm.js`

## Behaviour

| Request | Condition | Action | Page |
|---|---|---|---|
| `GET ?id&t` | Record exists, token matches, `pending` | Nothing | "Confirm your subscription" with a **Confirm** button: a form that `POST`s `id` and `t` to `/api/confirm` |
| `GET ?id&t` | Token matches, already `active` | Nothing | "You're already subscribed" |
| `GET` or `POST` | Missing id or token, unknown record, wrong token | Nothing | `404` "This link isn't valid. It may have expired: sign up again." |
| `GET` or `POST` | `pending` and `createdAt` older than 7 days | Delete the record, record `expired` | `404`, same page as above |
| `POST` (form `id`, `t`) | Token matches, `pending` | `status: "active"`, `confirmedAt: now`; record `confirmed` | "You're subscribed. The next daily digest arrives after the first sweep of the UTC day (about 05:47 IST)." Link to `/live/` |
| `POST` | Token matches, already `active` | Nothing | Same success page |
| other method | — | — | `405` |

- Wrong token and unknown record return the **same** page and status, so the endpoint can't be used to test ids.
- Pages are built with `sendPage` (T03): `no-store`, `noindex`, `no-referrer`.
- Confirming does **not** rotate the token. The same token is used for unsubscribe links later; rotating it would
  break the link in the confirmation email if it's clicked twice.
- `SUBSCRIPTIONS_ENABLED` off: `503` page "Subscriptions are paused." Links stay valid for when it's back on.

## Acceptance criteria

- [ ] A `GET` never changes a record (except deleting an expired pending one)
- [ ] `POST` with the right token activates; any other token changes nothing
- [ ] Wrong token and unknown id give identical responses
- [ ] No address appears on any page or in any log line

## Tests

- `GET` with the right token: page contains a form posting to `/api/confirm`, record still `pending`
- `POST` with the right token: `active`, `confirmedAt` set, a `confirmed` event written
- `POST` twice: second is a no-op with the success page
- Wrong token, a token of a different length, missing `t`, unknown id: `404`, record unchanged, identical bodies
- Pending record older than 7 days: deleted, `404`
- Page HTML has no `@` and the headers from `sendPage`

## Out of scope

- A welcome email after confirming. The first digest is the welcome.
