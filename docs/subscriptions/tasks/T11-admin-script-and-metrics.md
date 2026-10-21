# T11 · Owner admin script, manual Pro and sign-up metrics

| | |
|---|---|
| Phase | 1d, operate |
| Who | Developer |
| Size | M |
| Depends on | T10 (and T02's event records) |
| Unblocks | T12, and the measurements behind the Phase 2 gate |

## Why

Three owner jobs have no tool today:
1. **Grant or remove Pro by hand** until payments exist (decision D1).
2. **Answer a deletion or "what do you hold on me" request** for one address.
3. **Read the numbers the Phase 2 gate depends on** ([pricing.md](../pricing.md)): sign-ups, the share who confirm,
   unsubscribes.

A local script does all three without adding a public endpoint (and so no new thing to attack). `.vercelignore`
already keeps `scripts/` out of the deployment.

## What to build: `scripts/subscribers.mjs`

Uses `blobStorage()` and the T02 module directly. Reads Blob credentials from the environment. Prints addresses
**only** for `show` and `list`. Never prints a token.

| Command | What it does |
|---|---|
| `node scripts/subscribers.mjs stats [--days 30]` | Counts now (pending, Free, Pro, Pro expiring in 7 days) and per day for the period: `subscribed`, `confirmsent`, `confirmed`, `unsubscribed` (by plan), `expired`, and the confirm rate (`confirmed / subscribed`). From event records and `radar:deliveries:*`. No addresses |
| `... list [--plan pro\|free\|pending]` | Address, status, plan, `proUntil`, confirmed date. For the owner's terminal only |
| `... show <email>` | One record without the token |
| `... grant-pro <email> [--until 2027-01-31]` | Must be `active`. Sets `plan: "pro"`, `proSource: "owner"`, `proUntil` (or null). Records `progranted` |
| `... revoke-pro <email>` | Sets `plan: "free"`, `proUntil: null`, `proSource: null`. Records `prorevoked`. Refuses a `razorpay` record (cancel it in Razorpay; Phase 2) |
| `... delete <email>` | Deletes the record. Asks for `--yes` |
| `... prune-events --older-than 400` | Deletes event records older than N days |

- Every write prints what changed and asks for `--yes` unless it's given.
- Exit codes: `0` OK, `1` not found or refused, `2` bad usage.
- The core logic lives in functions that take `storage` and `now`, so the tests run them against the memory store.
  The CLI is a thin wrapper.

## Running it

1. In the Vercel dashboard, create a read-write token for the Blob store (or use `vercel env pull .env.local`, if
   it brings a usable token; **verify**: the store may only expose `BLOB_STORE_ID` with an OIDC token that doesn't
   work off Vercel).
2. `node --env-file=.env.local scripts/subscribers.mjs stats` (Node 20.6 or later reads `--env-file`).
3. `.gitignore` already ignores `.env*`, and `npm run check` fails if a `.env` file is tracked.

## Acceptance criteria

- [ ] `grant-pro` then the next scheduled sweep: that address gets the Pro email
- [ ] `grant-pro --until` a past date: treated as Free by the sweep
- [ ] `stats` prints no address
- [ ] Writes need `--yes`
- [ ] Not included in the Vercel upload (already true through `.vercelignore`; confirm in the deploy's file list)

## Tests (in `test-subscriptions.mjs`)

- `grantPro` on an active record, on a pending one (refused), on an unknown address (not found)
- `revokePro` on a `razorpay` record is refused
- `stats` over seeded events: correct per-day counts and confirm rate; output has no `@`
- `deleteSubscriber` removes the record and nothing else

## Docs

- DEPLOYMENT.md: a short "Managing subscribers" subsection with the commands and the token step
- The Phase 2 gate in [pricing.md](../pricing.md): say that `stats` is where its numbers come from
