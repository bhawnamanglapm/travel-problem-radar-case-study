# Paid Pro through Razorpay: design

> **Draft design, nothing here is built, and it should not be built until the Phase 1 gate in
> [pricing.md](pricing.md) is passed.** Written on 21 Oct 2026. Razorpay's endpoints, field names, event names and
> account requirements below come from general knowledge of its Subscriptions API, **not from this repository, and
> must be checked against Razorpay's current documentation before any code is written.** The picture of how this
> connects: [architecture.md](architecture.md), diagrams D and E.

## Goal

Let a confirmed email subscriber pay a recurring fee to move from Free to Pro. Razorpay is the source of truth for
whether someone has paid; the site only records what Razorpay tells it.

## Prerequisites

- Phase 1 running ([email-signup.md](email-signup.md)), with a verified domain.
- Vercel Pro, because the free Hobby plan is for non-commercial use (check the current terms).
- A Razorpay account activated for live payments. Test mode works without activation, so build against that first.
  Requirements for activation (business details, website review, bank account) change: **check current requirements**.
- Terms, privacy, refund and cancellation policies and a contact address published on the site. Payment providers
  usually review these.
- Advice on GST and income tax.
- Decide whether to accept international cards, which Razorpay must enable separately (**check**).

## Setup in Razorpay (once)

1. ~~Create a **Plan** in the dashboard and copy its id into `RAZORPAY_PLAN_ID`.~~ **Changed by T33 (2026-10-25):**
   one ₹1 plan per billing period (1, 3, 6, 12 months), made by `node scripts/check-plan.mjs --create`, with the ids
   in `RAZORPAY_PLANS`; each subscription's `quantity` is the price in rupees. See DEPLOYMENT.md, "How Razorpay
   charges a price it has no plan for".
2. Create API keys. Use the **test** key pair first.
3. Add a **webhook** pointing at `https://<site>/api/razorpay-webhook`, choose the subscription events below, and set a
   webhook secret.
4. Add four variables in Vercel (Production only; the two secrets marked Sensitive): `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLANS` (was `RAZORPAY_PLAN_ID` before T33). Test keys start with `rzp_test_`. Add a
   pattern for them to the secret scan in `scripts/check.mjs`.

## Flow

1. **Manage page.** A subscriber opens `/manage/?token=...` from the link in any digest. The token identifies the
   record; there are no passwords. The page shows the current plan and an Upgrade button.
2. **Create the subscription.** The page calls `POST /api/checkout` with the token. The endpoint checks the record
   is confirmed and not already Pro, then calls Razorpay's REST API to create a subscription for the plan (HTTP Basic
   auth with the key pair, using plain `fetch` like the rest of the code, so no new package). It saves the returned
   subscription id on the record and returns it.
3. **Pay.** The page loads Razorpay's Checkout script and opens it with the subscription id. The subscriber pays.
4. **Check the success signature (optional).** Checkout returns a payment id and a signature in the browser. The
   server can verify it (HMAC-SHA256 of `payment_id|subscription_id` with the key secret) to show "payment received"
   straight away. **This must not grant Pro.** Only the webhook does.
5. **Webhook grants Pro.** `POST /api/razorpay-webhook` is the source of truth:
   - Read the **raw** request body. Verify the `X-Razorpay-Signature` header as an HMAC-SHA256 of the raw body with the
     webhook secret, compared with `timingSafeEqual` as `bearerOk()` does. A parsed-then-reserialised body will not
     match.
   - Skip events already handled, using the event id header, stored as `radar:rzp-event:<id>`. Razorpay can deliver
     the same event more than once.
   - Look up the record by the subscription id, then change the plan:

| Razorpay event (verify names) | What the site does |
|---|---|
| `subscription.activated`, `subscription.charged` | Set `plan: "pro"` and store the paid-until date |
| `subscription.pending` | Keep Pro for now, and note the payment is being retried |
| `subscription.halted` (payment retries exhausted) | Set `plan: "free"` |
| `subscription.cancelled`, `subscription.completed` | Set `plan: "free"` at the end of the paid period |

   - Reply `200` quickly so Razorpay does not retry. Reply `401` for a bad signature.
6. **Cancel.** The manage page has a Cancel button that asks Razorpay to cancel at the end of the billing cycle. Pro
   continues until then. Razorpay has no hosted self-service billing page like some providers, so this page and the
   policy pages are the subscriber's way to leave. Receipts come from Razorpay (**verify** what it sends).
7. **Unsubscribe while Pro.** The unsubscribe link must not silently delete a paying subscriber's record. It cancels
   the Razorpay subscription first, or tells them to cancel on the manage page (see the state diagram, E).

## What Pro changes in the sweep

The sweep handler already sends to subscribers ([email-signup.md](email-signup.md)). Pro only changes who is in the
"after every saved sweep" group, plus the per-subscriber category filter if that ships. A Pro record whose paid-until
date has passed without a renewal event is treated as Free.

## Guardrails

| Risk | Guardrail |
|---|---|
| Someone claims they paid | Pro only changes through a webhook with a valid signature |
| A forged webhook | HMAC check on the raw body, constant-time compare, `401` otherwise |
| Duplicate webhooks | Event ids stored and skipped |
| Webhook arrives before the page returns | The webhook looks up by subscription id, which was saved before Checkout opened |
| Keys leak | Secrets only in Vercel (Sensitive); never in the page, logs or replies; the secret scan gets a `rzp_` pattern. Use restricted keys if Razorpay offers them (**check**). |
| Double charge from double clicks | `POST /api/checkout` refuses when the record already has an open subscription |
| Test and live mixed up | Test keys in Preview, live keys in Production only; check the key prefix (`rzp_test_` or `rzp_live_`) before a deploy |
| Refund disputes | A published refund policy and a support address |

## Changes needed when it is built

- **New files:** `api/checkout.js`, `api/razorpay-webhook.js`, `api/_lib/razorpay.js` (signature checks and API
  calls), `manage/index.html`.
- **Edited files:** `api/_lib/subscribers.js` (plan and paid-until fields), `api/_lib/handlers.js` (Pro group),
  `vercel.json` (copy `manage` in the build step), `scripts/check.mjs` (secret pattern).
- **Docs:** a section in DEPLOYMENT.md, a decision-log row, and the README status line.

## Test plan

Offline, with a fake Razorpay `fetch` and fixed test vectors for the signatures:

- A valid webhook signature is accepted; a changed body, a missing header and a wrong secret are refused.
- Each event type moves the plan as in the table; a repeated event id changes nothing.
- An event for an unknown subscription id is acknowledged and ignored.
- `POST /api/checkout` refuses an unconfirmed record, refuses a Pro record, and returns the subscription id for an
  eligible one.
- The Checkout success signature verifies for the correct pair and fails otherwise, and never changes the plan.
- Replies and logs contain no key, secret or address.

A test-mode end-to-end run in Razorpay's dashboard is still needed before going live, because the fake cannot prove
that Razorpay's real field and event names match.

## Open questions (OWNER INPUT NEEDED)

1. Price points and billing period, and the currency.
2. Whether to accept international cards.
3. Free trial or not; refund rules.
4. Who handles support emails and cancellations.
5. The business entity and tax setup that the Razorpay account will be under.
