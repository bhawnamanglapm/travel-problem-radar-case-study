# T02 · Subscriber records module

| | |
|---|---|
| Phase | 1a, foundations |
| Who | Developer |
| Size | M |
| Depends on | T01 |
| Unblocks | T05, T06, T07, T09, T11 |

## Why

Every endpoint and the delivery step read and write subscriber records. Put the record shape, the key scheme, the
token check and the plan rule in one module, `api/_lib/subscribers.js`, so they are defined and tested once.

## The record

Stored at `radar:sub:<id>` (Blob path `radar/subscribers/<id>.json`; `radar/radar-sub-<id>.json` before 2026-10-26).

```js
{
  v: 1,                          // schema version, for later migrations
  id: "<64 hex chars>",          // sha256 of the normalised address
  email: "reader@example.com",   // needed to send; never logged or returned
  status: "pending" | "active",  // active = confirmed
  plan: "free" | "pro",
  proUntil: null | "<ISO date>", // pro with null = no end date (granted by the owner)
  proSource: null | "owner" | "razorpay",
  token: "<43 chars base64url>", // 32 random bytes; proves the link holder owns the record
  createdAt: "<ISO>",
  confirmSentAt: "<ISO>",        // last confirmation email, for the once-a-day limit
  confirmedAt: null | "<ISO>",
  cats: null,                    // T14: null = all categories
  rzp: null                      // T20/T21: { subscriptionId, status }
}
```

## What to build

| Export | What it does |
|---|---|
| `normaliseEmail(s)` | Trim, lowercase; return `null` unless it looks like one address: at most 254 characters, one `@`, no spaces, commas, `<`, `>` or quotes, and a dot in the domain. Deliberately simple: the confirmation email is the real check |
| `subscriberId(email)` | `sha256(normalised email)` as hex |
| `newToken(randomBytes)` | 32 bytes from the injected random source, base64url |
| `tokenOk(record, token)` | Constant-time compare with `timingSafeEqual`, length checked first, as `bearerOk()` in `handlers.js` does. `false` for a missing record or token |
| `getSubscriber(storage, id)` | Read and parse; `null` if missing or unreadable. Reject ids that aren't 64 hex characters before touching storage |
| `putSubscriber(storage, record)` | Write the JSON |
| `deleteSubscriber(storage, id)` | Delete |
| `listSubscribers(storage, { concurrency = 8 })` | `list("radar:sub:")`, then read each record with at most `concurrency` reads at once. Skip unreadable records and count them |
| `effectivePlan(record, now)` | `"pro"` only if `status === "active"`, `plan === "pro"`, and `proUntil` is null or later than `now`. Otherwise `"free"` |
| `newPending(email, { now, randomBytes })` | A fresh pending record |

Constants: `KEY_SUB_PREFIX = "radar:sub:"`, `PENDING_TTL_DAYS = 7`, `CONFIRM_RESEND_HOURS = 24`.

### Event records (used by T05–T07 and T10, reported by T11)

Deleted subscribers leave no trace, so sign-up metrics for the Phase 2 gate need their own records. Each event is
its own small file, so concurrent writes never collide, and **holds no address or id**.

| Export | What it does |
|---|---|
| `recordEvent(storage, type, { now, randomBytes, plan })` | Write `radar:event:<YYYYMMDD>-<HHMMSSmmm>-<type>-<6 hex>` with `{ type, at, plan }`. Never throws (a failed metric must not fail a sign-up) |
| `countEvents(storage, { day, type })` | `list("radar:event:<YYYYMMDD>-")` and count suffixes containing `-<type>-`. Reads no file contents |

Types (letters only, so the key round-trips through `path()`): `subscribed`, `confirmsent`, `confirmed`,
`unsubscribed`, `expired`, `bounced`, `complained`, `progranted`, `prorevoked`.

### Why the id is a hash

It gives a fixed-length key with only safe characters, so `path()` and `list()` round-trip, and the address itself
is not in any URL or file name. The plain address is still inside the record, because it is needed to send. A plain
sha256 can be checked against a guessed address, but the id alone grants nothing without the token. (An HMAC with a
secret would hide even that; it was left out because rotating the secret would orphan every record.)

## Acceptance criteria

- [ ] All exports above exist, with no imports beyond `node:crypto`
- [ ] No function logs or returns an address or token except `getSubscriber`/`listSubscribers` to their caller
- [ ] `effectivePlan` treats pending records, expired Pro and unknown plans as `"free"`
- [ ] The README of this folder's record shape and this file agree

## Tests (in `test-subscriptions.mjs`)

- `normaliseEmail`: `" A@Example.COM "` → `"a@example.com"`; `"a@b"`, `"a b@c.com"`, `"a@b.com,c@d.com"`, a
  255-character address and `""` → `null`
- `subscriberId` is stable and is the same for `A@x.com` and `a@x.com`
- `tokenOk`: right token true; wrong token, a token of a different length, `undefined` and a missing record false
- `effectivePlan`: active pro with `proUntil` null → pro; active pro with `proUntil` in the past → free; pending pro →
  free; active free → free
- `getSubscriber` with `"../x"` or a 63-character id returns `null` without calling storage
- `listSubscribers` returns every record from the memory store and skips one holding invalid JSON
- `recordEvent` writes a key matching `^radar:event:\d{8}-\d{9}-[a-z]+-[0-9a-f]{6}$` whose value has no `@`;
  `countEvents` counts only that day and type; a storage that throws on `set` doesn't make `recordEvent` throw

## Out of scope

- Any endpoint. This task is the module and its tests.
