# T22 · Pro expiry, paid unsubscribe and key safety

| | |
|---|---|
| Phase | 2, paid Pro |
| Who | Developer |
| Size | M |
| Depends on | T17, T18, T20, T21 |
| Unblocks | T27 |

> **Changed 2026-10-22 ([decision log](../../decisions.md)):** Pro now pays for the live board on the website, not
> for email ([paid-website.md](../paid-website.md)). Accounts and sign-in (email link, login cookie) and the locked board come first, behind a
> `BOARD_PAYWALL` switch. Unsubscribing from email must not delete a paying account: a Pro record keeps its account and stops email. Go-live includes turning `BOARD_PAYWALL` on.

## Why

The pieces now exist; this task closes the gaps between them. The test-mode run and the switch to live keys are
T27.

## What to build

### 1. Expiry

- `effectivePlan` (T02) already treats a past `proUntil` as Free. Add a **grace period** for Razorpay records only:
  stay Pro until `proUntil + PRO_GRACE_HOURS` (proposed 48), because a renewal's `charged` event can arrive after the
  period end. Owner-granted Pro has no grace.
- In the sweep's tidy step (T09), for a `razorpay` record whose grace has passed and whose `rzp.status` is
  `cancelled`, `completed` or `halted`: set `plan: "free"`, `proSource: null`, record `prorevoked`. This keeps the
  stored plan honest for `stats`; delivery would already treat it as Free.
- If the grace has passed but `rzp.status` is still `active`: something was missed. Count it as `rzpMismatch` in the
  sweep reply (count only) and let the admin script's `show` call `fetchSubscription` to check.

### 2. Unsubscribing while on paid Pro

T07 deliberately didn't delete a paid record. Now:

- The unsubscribe page, for a record with `proSource: "razorpay"` and an open subscription, says: "You have Pro until
  <date>. Unsubscribing cancels it; there's no refund for the rest of this period" (**wording depends on the refund
  rule from T15**).
- On `POST`: `cancelSubscription({atCycleEnd: false})` (**verify**: immediate cancel), then delete the record and the
  `radar:rzpsub:` index. If the cancel call fails, **don't delete** (otherwise they keep being charged with no way to
  manage it); show "Something went wrong; please try again or write to <contact>".
- List-Unsubscribe one-click (RFC 8058) on a paid record does the same.
- Later webhooks for that subscription find no record and reply `200` (T21 step 5).

### 3. Key safety

- Production refuses test keys and Preview refuses live keys: if `VERCEL_ENV === "production"` and `isTestKey`, or
  not production and not `isTestKey`, every Razorpay endpoint answers `503` and the sweep reply shows
  `razorpay: "key mismatch"`. **Verify** that `VERCEL_ENV` is set this way.

### 4. Admin script additions (T11)

- `show` prints `rzp.status`, `currentEnd`, `cancelAtPeriodEnd`, and with `--check`, the live state from
  `fetchSubscription`.
- `revoke-pro` keeps refusing `razorpay` records and prints "cancel it in the Razorpay dashboard".

## Test run and go-live

Moved to [T27](T27-razorpay-test-run-and-go-live.md) on 2026-10-23, so going live also waits for the pricing page,
the policy pages and the new Pro wording (T23 to T26). The unsubscribe wording in step 2 follows T23's refund rule.

## Acceptance criteria

- [ ] Unsubscribing a paid record cancels billing before deleting; a failed cancel keeps the record
- [ ] Test keys can't work on Production, live keys can't work on Preview
- [ ] Docs updated: DEPLOYMENT.md (Razorpay section, roll back), TECHNICAL.md, README.md "What's next",
  pricing.md, decisions.md (refund rule, grace period), CHANGELOG.md

## Tests

- Grace: just before and just after; owner Pro has no grace; tidy step moves lapsed records to Free;
  `rzpMismatch` counted; paid unsubscribe with cancel success and with cancel failure; key mismatch both ways
