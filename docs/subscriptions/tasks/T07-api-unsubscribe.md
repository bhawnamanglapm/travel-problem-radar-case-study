# T07 · `GET` and `POST /api/unsubscribe`, with one-click

| | |
|---|---|
| Phase | 1b, sign-up flow |
| Who | Developer |
| Size | S |
| Depends on | T02, T03 |
| Unblocks | T08 |

## Why

Every digest must have a working unsubscribe link, and mail apps should be able to offer a one-click "Unsubscribe"
button (the `List-Unsubscribe` headers T04 adds). Unsubscribing **deletes** the record: the address is gone, not
flagged.

## Files

- `makeUnsubscribeHandler({ env, storage, now, randomBytes })` in `api/_lib/subscription-handlers.js`
- `api/unsubscribe.js`

## Behaviour

The link in every email and the `List-Unsubscribe` header are both `<site>/api/unsubscribe?id=<id>&t=<token>`.

| Request | Condition | Action | Reply |
|---|---|---|---|
| `GET ?id&t` | Token matches | Nothing | Page: "Unsubscribe from Travel Problem Radar?" with an **Unsubscribe** button (a form that `POST`s to the same URL) |
| `POST ?id&t` (from the page, or a mail app's one-click with body `List-Unsubscribe=One-Click`) | Token matches, plan isn't paid Pro | Delete the record; record `unsubscribed` with its plan | Page: "You're unsubscribed. Your address has been deleted." (`200`) |
| `POST` | Token matches, `proSource: "razorpay"` and still paid | Don't delete (Phase 2, T22) | Page explaining they must cancel on the manage page first, with the link |
| `GET` or `POST` | Unknown id or wrong token | Nothing | `200` page "You're not subscribed" |
| other method | — | — | `405` |

- The one-click `POST` comes from the mail provider, with no browser and no cookies. Read `id` and `t` from the
  query string, not the body. The body only says `List-Unsubscribe=One-Click`; don't require it, because the page's
  own form doesn't send it.
- **Unknown or wrong token gives `200`, not `404`**, so a repeat click or a second one-click delivery doesn't look
  like an error to the person or the mail app. It changes nothing, so it reveals nothing.
- Unsubscribe works even when `SUBSCRIPTIONS_ENABLED` is off. Leaving must always work.
- Until Phase 2 exists, owner-granted Pro (`proSource: "owner"`) unsubscribes like Free.

## Acceptance criteria

- [ ] One `POST` with the right token deletes the record; nothing else is kept about the address
- [ ] `GET` never deletes (link scanners again)
- [ ] Works with `SUBSCRIPTIONS_ENABLED` off
- [ ] The `unsubscribed` event holds the plan, not the address

## Tests

- `GET`: confirm page, record still there
- `POST` with `List-Unsubscribe=One-Click` body and the id and token in the query: deleted, `200`
- `POST` from the page form (no one-click body): deleted
- Wrong token: record kept, `200` "not subscribed"
- Second `POST` after deletion: `200` "not subscribed"
- Works with `SUBSCRIPTIONS_ENABLED` unset
- Pages contain no `@`

## Verify at build time

- RFC 8058 one-click requirements as Gmail and Yahoo apply them now (for example whether the `POST` must succeed
  without redirects, and response expectations)
