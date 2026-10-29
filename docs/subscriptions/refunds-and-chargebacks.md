# Refunds and chargebacks: the manual step

> Written 2026-10-29 for [T30](tasks/T30-owner-launch-checklist.md) step 8 and launch-plan
> [LR-20](../../pm/05-business-case-and-launch/launch-plan.md). The site has no refund code: refunds are made by
> hand in Razorpay's dashboard, then Pro is ended with the admin script. Razorpay dashboard names marked
> **verify** weren't checked against the live dashboard. Correct them the first time you use them.

## Which rule applies

The rule is `refund` in [`plan.json`](../../plan.json), shown on `/legal/refunds/`:

| Case | Refund | Pro |
|---|---|---|
| They ask within 7 days of their **first** payment | In full, no reason asked | Ends now (step 3 below) |
| A charge made by mistake: charged twice, or charged after they cancelled | That charge, in full, always | Stays as it was. If they had cancelled, it still ends at the period's end |
| Anything else (a renewal, or after 7 days) | None. Point them to Cancel on their account page | Stays until the period ends |

**First payment or renewal?**
- Run `node --env-file=.env.local scripts/subscribers.mjs show <email>`.
- `paidFor.sub` is the subscription they first paid for, and `rzp.subscriptionId` is the current one.
- On Razorpay's page for that subscription (Subscriptions → the id, **verify**), the invoices list every charge. Only the first one is under the 7-day rule.
- A renewal made with Keep renewing (T34) is a new subscription, but it isn't a first payment.

## Refund steps

1. Check the request comes from the address they subscribed with (the refunds page asks for that).
2. In Razorpay's dashboard: Payments → the payment → Refund, full amount (**verify** the menu names). Note the refund id.
3. **Full refund under the 7-day rule only:** end Pro now. This needs the live `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the shell, as `delete` does:
   ```
   node --env-file=.env.local scripts/subscribers.mjs revoke-pro <email> --paid
   node --env-file=.env.local scripts/subscribers.mjs revoke-pro <email> --paid --yes
   ```
   - The first command only says what it would do: which subscription it cancels.
   - The second cancels the Razorpay subscriptions at once, so nothing more is charged, and sets the account to Free.
   - If Razorpay refuses, nothing changes. Cancel the subscription in Razorpay's dashboard (cancel immediately, not at the cycle end), then run it again.
   - Razorpay's `cancelled` webhook comes afterwards and changes nothing.
4. A mistaken charge: refund that payment only. Don't run `revoke-pro`.
5. Reply the same day. Say the refund is made and reaches the way they paid within `refundDays` (14) days.

Don't use `delete` for a refund: it removes the account as well. Use it only when they ask for their data to be deleted.

## Chargebacks (disputes)

- The site gets no event: the webhook handles subscription events only, not disputes. Razorpay tells you by email and in the dashboard's Disputes section (**verify**).
- Answer there before the deadline it shows. Include:
  - the sign-up and confirmation dates (`show <email>`)
  - the payment id
  - the subscription with its invoices
  - the terms and refunds pages, with their dates
- If the dispute is accepted or lost, the money goes back to the member, so end Pro with step 3 as for a refund.
- If it's won, nothing changes.

## Costs

Each refund loses Razorpay's fee on that payment. [costing.md](costing.md) assumes 3.42% until the first settlement
report shows the real fee. Whether a dispute has a fee of its own is **verify** (Razorpay's pricing page).

## Later

[Post-launch plan](../../pm/05-business-case-and-launch/post-launch-plan.md) RM-21 automates this: refund and
dispute webhooks that end Pro on their own.
