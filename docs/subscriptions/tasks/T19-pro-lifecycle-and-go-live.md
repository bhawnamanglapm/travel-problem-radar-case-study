# T19 · Pro expiry, paid unsubscribe and go-live

| | |
|---|---|
| Phase | 2, paid Pro |
| Who | Developer (code, docs) and owner (go-live) |
| Size | M |
| Depends on | T17, T18 |
| Unblocks | — |

## Why

The pieces now exist; this task closes the gaps between them and switches to live keys only after a full test-mode
run.

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
- Later webhooks for that subscription find no record and reply `200` (T18 step 5).

### 3. Key safety

- Production refuses test keys and Preview refuses live keys: if `VERCEL_ENV === "production"` and `isTestKey`, or
  not production and not `isTestKey`, every Razorpay endpoint answers `503` and the sweep reply shows
  `razorpay: "key mismatch"`. **Verify** that `VERCEL_ENV` is set this way.

### 4. Admin script additions (T11)

- `show` prints `rzp.status`, `currentEnd`, `cancelAtPeriodEnd`, and with `--check`, the live state from
  `fetchSubscription`.
- `revoke-pro` keeps refusing `razorpay` records and prints "cancel it in the Razorpay dashboard".

## Test-mode end-to-end run (before go-live)

Run on the Preview or test project with test keys and Razorpay's test cards (**verify** the current test card
numbers in Razorpay's docs):

| Step | Check |
|---|---|
| Subscribe, confirm | Free |
| Upgrade, pay with a test card | Page says received; webhook arrives; record Pro; Pro email after the next scheduled sweep |
| Wait for or simulate a renewal (Razorpay test mode may allow it, **verify**) | `proUntil` moves forward |
| Simulate a failed renewal | `pending` keeps Pro; `halted` moves to Free |
| Cancel at period end | Pro until the date, then Free after grace |
| Upgrade again, then unsubscribe | Subscription cancelled in Razorpay; record gone |
| Replay a webhook from the Razorpay dashboard | No change |

Write the results and date in the pull request.

## Go-live (owner)

1. Razorpay live activation approved (T15).
2. Create the live Plan(s); set live `RAZORPAY_*` variables for **Production only**; set the live webhook to the
   production URL with a new secret.
3. Change the Pro line on `/subscribe/` from "owner-granted, on request" to the price and an Upgrade link, and update
   pricing.md's tiers table.
4. Do one real payment with the owner's own card, check it end to end, then refund it in the dashboard if wanted.
5. Announce.

**Roll back:** unset `RAZORPAY_KEY_ID` (checkout and upgrade disappear; `razorpayConfigured` is false). Existing
paid subscribers keep Pro until `proUntil`; cancel their Razorpay subscriptions in the dashboard if billing must stop.
The webhook endpoint keeps working only while its secret is set, so leave `RAZORPAY_WEBHOOK_SECRET` until the last
period ends.

## Acceptance criteria

- [ ] Every row of the test-mode run passes, recorded with the date
- [ ] Unsubscribing a paid record cancels billing before deleting; a failed cancel keeps the record
- [ ] Test keys can't work on Production, live keys can't work on Preview
- [ ] Docs updated: DEPLOYMENT.md (Razorpay section, roll back), TECHNICAL.md, README.md "What's next",
  pricing.md, decisions.md (refund rule, grace period), CHANGELOG.md

## Tests

- Grace: just before and just after; owner Pro has no grace; tidy step moves lapsed records to Free;
  `rzpMismatch` counted; paid unsubscribe with cancel success and with cancel failure; key mismatch both ways
