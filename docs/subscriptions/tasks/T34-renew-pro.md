# T34 · Renewing Pro

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer (owner: input P3 in T33) |
| Size | M |
| Depends on | T33 (the plans and periods); T22 (expiry and grace) |
| Unblocks | T27 |

> Added 2026-10-25 at the owner's request ("add facility to renew also"), with
> [T33](T33-pro-plan-builder.md)'s 1, 3, 6 and 12 month periods.

## Why

Checked on 2026-10-25 against the code:

| Case | Today |
|---|---|
| A subscription that keeps renewing | Razorpay charges each period; the `charged` webhook moves `proUntil` on (T21). **Not yet seen in a test-mode renewal** (T27's table) |
| Cancelled, and the paid period still running | **No way back.** `/manage/`'s "Keep Pro" button only backs out of the two-step cancel before it is confirmed. After that, checkout refuses with `already_pro` until the period ends (noted as not built in T26) |
| The period ended (cancelled, or Razorpay gave up: `halted`) | The member is Free and can pay again with Upgrade, but the page doesn't carry over their categories, emails a day or period |
| All billing cycles used (`RAZORPAY_TOTAL_COUNT` reached, status `completed`) | Pro ends at the end of the last period with **no warning** and no Renew button |
| Owner-granted Pro with an end date | Ends silently; there is no reminder |

## What to build

1. **Resume a cancelled plan before it ends.** A **Keep renewing** button on `/manage/` for a cancelled, still-running
   paid Pro. **Verify** at build time whether Razorpay can undo `cancel_at_cycle_end`. If it can, call it. If it
   can't, start a new subscription on the same plan that begins at the current `proUntil` (Razorpay's `start_at`,
   **verify**), so nothing is charged twice and there's no gap.
2. **Renew after the end.** For a member back on Free after a paid Pro (cancelled, `halted` or `completed`), `/manage/`
   shows **Renew Pro** with their last categories, emails a day and period filled in (T33's plan card), and the price
   as it is now.
3. **Warn before a plan that won't renew ends.** One email 7 days (owner's number) before the end of a cancelled
   plan, the last cycle of a `completed` one, a paid-once plan (if P3 chooses that), or an owner-granted Pro, with a
   link to `/manage/`. Sent by the sweep's delivery step, once per plan end, counts only in replies and logs.
   Automatic renewals need no email from us: the bank or Razorpay sends the pre-debit notice (**verify** what
   Razorpay sends for cards and UPI AutoPay).
4. **What `RAZORPAY_TOTAL_COUNT` means** with several periods: it becomes cycles per plan (e.g. 120 monthly, 40
   quarterly, 10 yearly) set beside each plan in `plan.json`, so every period renews for about the same number of
   years.

## Built (2026-10-25, on `fixes`, not deployed)

- **Keep renewing** (a cancelled paid Pro whose period is still running). Whether Razorpay can undo
  `cancel_at_cycle_end` was **not checked** against its docs; this uses the fallback, which works either way:
  `checkout` lets a cancelled paid Pro through and creates a
  **new subscription with `start_at` = `proUntil`**, for the plan chosen on the card (categories, emails a day,
  period). It is stored beside the running one as `rzp.next` and indexed for the webhook. Checkout's signed reply
  marks it `authenticated`; the page then says "Paid until DATE. Then it renews for N months at ₹P, which you've
  approved." **Verify** on the test run: that Razorpay accepts `start_at` with Checkout, what Checkout charges to
  approve it (an authorisation amount that is refunded, for cards and UPI AutoPay), and that the first charge lands
  at `start_at`.
- **The webhook** finds a record by `rzp.next` too. The renewal's first `activated` or `charged` makes it the plan
  (its choice applied, `paidFor` recorded, `proUntil` moved on); later events for the cancelled one are ignored. If
  the old plan's `cancelled` event comes first, Pro holds for `RENEW_GRACE_HOURS` (6) so there is no gap. A renewal
  that is `halted`, `cancelled` or `completed` before its first charge is dropped and the running plan is untouched.
- **Cancel again** after setting up a renewal cancels the renewal at once (it hasn't charged) and offers Keep
  renewing again.
- **Renew after the end.** `/api/account` sends `lastPlan` (the choice last paid for). A Free member who paid before
  sees **Renew Pro**, and the card opens with that plan filled in, priced as it is now; it is an ordinary checkout.
- **Warning email** (`buildPlanEndingEmail`, step 6 of `deliverToSubscribers`): one email 7 days (`END_WARNING_DAYS`)
  before a Pro ends that won't renew: a cancelled paid plan with no renewal approved, the last billing cycle
  (`remaining_count` 0, now stored as `rzp.remaining`), or an owner-granted Pro with an end date. Remembered as
  `endWarnedFor`, so it goes once per end date. Counts only in `endWarning` in the sweep reply. A renewing plan gets
  nothing from us; the pre-debit notice is Razorpay's or the bank's.
- Not built: item 4 (cycles per plan in `plan.json`). Instead `RAZORPAY_TOTAL_COUNT` now counts months and each
  subscription gets that many months' worth of cycles (T33).
- Tests: renew refused while a plan still renews; `start_at`, period plan and notes; reuse; approve; a second renewal
  refused; the grace hours; promotion on the first charge; a late event for the old plan; cancel again; a failed
  renewal dropped; `lastPlan` after the end; the warning for owner and cancelled plans, not a renewing one, not twice,
  no address in the result. The page was clicked through in headless Chrome against a stub API.

## Acceptance criteria

- [ ] A cancelled, still-running Pro can keep renewing with no double charge and no gap, on `staging` in test mode
- [x] A lapsed paid Pro renews with one button and their previous choices (offline; staging run to do)
- [x] The warning email goes once, 7 days before a plan that won't renew ends, and never for one that renews
- [x] Docs: DEPLOYMENT.md, CHANGELOG.md (the refunds and terms pages already say Pro renews at the end of each
  billing period until cancelled; [payments-razorpay.md](../payments-razorpay.md) is the original design and points
  to DEPLOYMENT.md)

## Tests

Resume (undo allowed, and the `start_at` fallback); `already_pro` no longer blocks a resume; Renew prefill for each
ending (`cancelled`, `halted`, `completed`); the warning sent once, not repeated by a later sweep, not sent for a
renewing plan, sent for owner Pro; no address in any reply.
