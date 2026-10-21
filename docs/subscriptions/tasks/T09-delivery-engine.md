# T09 · Delivery engine: Free once a day, Pro every sweep

| | |
|---|---|
| Phase | 1c, delivery |
| Who | Developer |
| Size | L |
| Depends on | T02, T04 |
| Unblocks | T10 |

## Why

This is the heart of the feature: after a sweep is saved, decide who gets an email, build it, send it within the
time left, and remember who was sent what, so a send that's cut off can pick up later without sending anyone the
same digest twice.

## File

`api/_lib/subscriber-delivery.js`, exporting

```js
deliverToSubscribers({ env, storage, fetchFn, now, randomBytes, sweep, scheduled, deadlineAt, log })
```

- `sweep`: the result of `runDailySweep` with `status: "saved"` (`id`, `at`, `problems`, `perCat`, `newCount`).
- `scheduled`: whether the call was the timer (`trigger === "scheduled"` in `makeSweepHandler`).
- `deadlineAt`: a time (ms) after which no new send may start (T10 sets it).
- Returns a counts-only summary. **Never throws**: wrap the whole thing, and on an unexpected error return
  `{ error: "<message without addresses>" }`.

## Steps, in order

### 1. Should it run at all?

Return `"not configured"` (a string, like the existing `email` field) unless `SUBSCRIPTIONS_ENABLED` is `1`,
`RESEND_API_KEY` is set, `EMAIL_FROM` is set and isn't the shared sender, and a site URL is known (`SITE_URL` or
`VERCEL_PROJECT_PRODUCTION_URL`).

### 2. Load and tidy the list

- `listSubscribers(storage)`.
- Delete `pending` records whose `createdAt` is more than 7 days old; record one `expired` event each.
- Write `radar:subscriberCount` = active + remaining pending (the sign-up cap in T05 reads it).
- Split active records with `effectivePlan(record, now)` into **Pro** and **Free**.

### 3. Pro group: every saved sweep

Send to every Pro subscriber when all of these hold:
- the sweep was **scheduled** (decision D4: manual runs reach the owner only). If the owner picks "manual runs too",
  drop this condition;
- (only if D5 picks "skip when nothing is new") `sweep.newCount > 0`.

Content: `buildDigestEmail(sweep, liveUrl, { heading: "Travel Problem Radar: Pro update" })`, built once.

### 4. Free group: once per UTC day

- `today` = the UTC date of `now()`, as `YYYYMMDD`.
- Read `radar:deliveries:<today>` → `{ free: [ids already sent today] }` (missing = empty).
- **Due** = Free subscribers whose id isn't in that list.
- If none are due, skip. Otherwise send. Because it runs at every saved sweep, the first saved sweep of the day
  sends; any saved sweep later that day picks up anyone missed (cut off by the deadline, a quota stop, a failed
  send, or confirmed since the morning). That also covers a day whose first sweep failed: the next saved one sends.
  Manual runs count too, since they only finish off the day's Free send and never send anyone a second one.

Content (decision D2, recommended **roll-up**):
- From `radar:history`, take the entries with `at` in the 24 hours up to now (manual runs included: their items are
  real), read each `radar:sweep:<id>` (at most about 6 reads), and merge their problems by `id`. Keep the newest
  copy of each, and set `isNew` if **any** of those sweeps flagged it New. Sort like `runDailySweep` does: New
  first, then severity.
- If the owner picks the plain option instead, use just this sweep's problems.
- `buildDigestEmail({ at: sweep.at, problems: merged }, liveUrl, { heading: "Travel Problem Radar: daily digest", subjectLead: "daily" })`.
  Leave out the "Failed this run" line for the roll-up, since it's about one sweep.

### 5. Send

- For each recipient, `withSubscriberFooter(mail, { unsubscribeUrl, plan })` with
  `unsubscribeUrl = <site>/api/unsubscribe?id=<id>&t=<token>`.
- Send Pro first, then Free, through `sendBatch` (T04) in chunks, with idempotency keys
  `<sweep id>-pro-<n>` and `<YYYYMMDD>-free-<sweep id>-<n>`.
- **Before each chunk**, stop if `now() >= deadlineAt`; count the rest as `deferred`.
- **After each Free chunk**, add the ids that were sent to `radar:deliveries:<today>` and write it, so a timeout
  after chunk 2 doesn't resend chunks 1 and 2 at the next sweep.
- On `stopped: "quota"`, stop **both** groups and count the rest as `deferred`. The owner's own email has already gone
  out (T10 sends it first).
- Only the sweep writes `radar:deliveries:*`. User actions never touch it, so they can't overwrite it.
- Delete `radar:deliveries:<date>` files older than 7 days (list `radar:deliveries:`).

### 6. Return

```js
{
  pro:  { due: 3,  sent: 3,  failed: 0, deferred: 0 },           // or { skipped: "manual run" }
  free: { due: 41, sent: 41, failed: 0, deferred: 0, alreadySent: 12 },
  pending: 2, expired: 1, stopped: null                           // "quota", "deadline" or a failure reason
}
```

Log the same object as one `subscribers` line. No ids, no addresses.

## Time and quota budget

- **Time:** a sweep took 7–10 seconds a category in the local test (DEPLOYMENT.md 3), so a run usually has well over
  4 minutes left. One batch call per 100 recipients should take seconds (**verify** Resend's rate limit). The
  deadline is a safety net, not the expected path.
- **Quota:** on Resend's free plan (100 emails a day, as recorded in DEPLOYMENT.md in October 2026), the formula in
  [pricing.md](../pricing.md) is `5 (owner) + free + 5 × pro + confirmations ≤ 100`. `MAX_SUBSCRIBERS` (T05) is the
  control. The quota stop above is the backstop.
- **Blob reads per sweep:** 1 list + one read per subscriber + up to about 6 sweep reads once a day. **Verify** the
  Hobby plan's Blob operation allowance covers about 5 sweeps a day at the cap.

## Acceptance criteria

- [ ] Pro subscribers get one email per saved scheduled sweep; none for manual runs (D4 default)
- [ ] Free subscribers get exactly one email per UTC day, even across 5 sweeps, a timeout or a quota stop
- [ ] Someone who confirms at 12:00 UTC gets that day's Free digest at the next saved sweep
- [ ] The Free roll-up contains items from every sweep in the last 24 hours, deduplicated, New kept
- [ ] Expired pending records are deleted; `radar:subscriberCount` is written
- [ ] The result and log have no `@`, no ids, no tokens
- [ ] Never throws, whatever storage or Resend does

## Tests (in `test-subscriptions.mjs`, memory storage, fake Resend, controllable clock)

- Not configured: each missing piece, nothing read
- 2 Pro + 3 Free, first scheduled sweep of the day: 5 emails; second sweep of the day: 2 (Pro only)
- Manual run: Pro skipped; Free still sent if not yet sent today
- Next UTC day: Free sent again
- Deadline reached after the Pro chunk: Free all `deferred`; the next sweep sends them, and nobody gets two
- Quota stop in the middle of the Free chunk list: the sent ones are recorded, the next sweep sends the rest only
- One recipient in a failed chunk: counted `failed`, retried at the next sweep (not in the deliveries file)
- Roll-up: three sweeps in 24 h with overlapping items → merged, New if any sweep said New, older-than-24-h sweep
  excluded
- Each email has one recipient and its own unsubscribe link with the right id and token
- Expired pending deleted and counted; a 6-day-old pending kept
- Storage `list` throws → `{ error }`, no throw
- Pro with `proUntil` in the past goes to the Free group

## Out of scope

- Category filtering (T14), paid Pro (Phase 2). Leave a single place where the recipient's items are chosen, so T14
  can filter there.
