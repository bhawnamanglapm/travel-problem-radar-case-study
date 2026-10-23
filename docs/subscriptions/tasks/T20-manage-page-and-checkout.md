# T20 · Manage page and checkout

| | |
|---|---|
| Phase | 2, paid Pro |
| Who | Developer |
| Size | L |
| Depends on | T16 (sign-in), T19 |
| Unblocks | T21 (the record shape it writes), T22 |
| Status | built (2026-10-23) and tested offline with a fake Razorpay; the end-to-end test checkout waits for test keys on Preview |

> **Changed 2026-10-22 ([decision log](../../decisions.md)):** Pro now pays for the live board on the website, not
> for email ([paid-website.md](../paid-website.md)). Accounts and sign-in (email link, login cookie) and the locked board come first, behind a
> `BOARD_PAYWALL` switch. Checkout lives on `/manage/` **while signed in**; the `id`/`t` link still works for email readers.

## Built (2026-10-23), and how it differs from below

- **No new functions.** `checkout`, `checkout-return` and `cancel` are actions on the existing `/api/account`, as the
  function-count note below allows. The site stays at 8 of Hobby's 12, leaving room for T21's webhook.
- **Auth** is the existing kind: the email link's `id`/`t`, or the login cookie, where a `POST` must also come from
  the site's own origin.
- **An open checkout is reused, not refused.** A `created` subscription under an hour old is handed back with the
  same id, so a second click reopens Checkout. A paid one waiting for the webhook (`authenticated`) gets
  `409 payment_pending`, so nobody pays twice.
- **`RAZORPAY_TOTAL_COUNT`** is a new variable for `total_count`. Payments count as on (`paymentsReady`) only when
  it is a whole number of 1 or more and `razorpayConfigured` is true. Off means "Request Pro" and `503 payments_off`.
- **The reply** adds `payments`, `paymentPending` and `cancelAtPeriodEnd`. The renewal date is `proUntil`, which
  T21 sets from Razorpay's `current_end`; no separate field.
- **No price on our page**: Razorpay's Checkout shows it. No email is sent to Checkout.
- **Known gap:** a record stuck in `authenticated` (no webhook) blocks a new checkout until T21 or the owner
  settles it.
- Razorpay details checked on 2026-10-23: the script URL, the handler's three field names, and the signature over
  `payment_id|subscription_id` with our saved id ([integration guide](https://razorpay.com/docs/payments/subscriptions/integration-guide/)).
  No CSP was added, since no page has one.

## Why

A subscriber needs one place to see their plan, upgrade, cancel and unsubscribe. The footer of every email (T04)
already links to `manageUrl`; until now that link points at the unsubscribe page.

> **Already built (before T15, with the "Request Pro" feature):** `/manage/`, `GET`/`POST /api/account`
> (`makeAccountHandler`), the `manage` build copy and checks, and the footer's `manageUrl` pointing at
> `/manage/?id&t`. `GET` returns `{status, plan, effectivePlan, proUntil, proSource, proRequestedAt}`; `POST` takes
> `action: "request-pro"` and emails the owner, who grants Pro with the admin script. What is left here: add
> `cancelAtPeriodEnd` and `cats` to the reply, and when `razorpayConfigured`, show "Upgrade to Pro" (checkout) in
> place of "Request Pro". Keep "Request Pro" as the fallback when payments aren't configured.

## What to build

### 1. `GET /api/account?id&t` (JSON) and the `/manage/` page

- Handler in `subscription-handlers.js`. Returns, for a matching `id` and token only:
  `{status, plan, proUntil, proSource, cancelAtPeriodEnd, cats}`. **No email address** (the page can't be shown to
  the wrong person through a forwarded link and leak more than the plan).
  Wrong token or unknown id: `404`, same body for both.
- `manage/index.html`, self-contained like `subscribe/`. Reads `id` and `t` from the query, calls `/api/account`, and
  shows:
  - Free: "Upgrade to Pro" button (only if `razorpayConfigured`; otherwise "Pro is not on sale yet")
  - Pro from Razorpay: renewal date, "Cancel at the end of this period" button
  - Pro from the owner: "Pro until <date>" or "Pro", no billing buttons
  - Categories form if T14 is built
  - "Unsubscribe" link to the existing page (T07)
- Add `manage` to the build copy in `vercel.json` and to the link checks in `check.mjs`.
- Point `withSubscriberFooter`'s `manageUrl` at `/manage/?id&t` once this ships.

**Function count:** `account`, `checkout` and `cancel` could be one function with an `action` field, if the Vercel
plan's function limit gets close (**verify** the current limit for the plan in use).

### 2. `POST /api/checkout`

Body: `id`, `t`. Steps:

1. Token check (same `404` as above).
2. Refuse with `409` and a short code if: `status !== "active"` (`not_confirmed`); `effectivePlan === "pro"`
   (`already_pro`); `rzp.subscriptionId` is set and its status is still `created` or `authenticated` and less than
   one hour old (`checkout_open`; reuse it instead of creating a second one).
3. `createSubscription` with `notes.sid = id`.
4. Store on the record: `rzp: {subscriptionId, status: "created", createdAt}`, and write the index
   `radar:rzpsub:<subscriptionId>` → `{id}` so the webhook can find the record without listing.
5. Reply `{keyId, subscriptionId}` for Razorpay Checkout on the page.

The page then opens Razorpay Checkout (script tag from Razorpay's own domain, **verify** the URL) with
`subscription_id`. On the Checkout success callback, the page `POST`s `/api/checkout-return` with the three
values Checkout gives (`razorpay_payment_id`, `razorpay_subscription_id`, `razorpay_signature`, **verify** the
names).

### 3. `POST /api/checkout-return`

- `verifyCheckout` with the key secret. Bad signature: `400`.
- Good signature: set `rzp.status = "authenticated"` and reply "Payment received; Pro starts in a minute or two".
  **Do not set `plan: "pro"` here.** The webhook (T21) is the only thing that grants paid Pro, because the browser
  callback can be lost or replayed and the webhook is signed by Razorpay.

### 4. `POST /api/cancel`

- Token check. Must have `proSource: "razorpay"` and a `rzp.subscriptionId`.
- `cancelSubscription({atCycleEnd: true})`. On success set `rzp.cancelAtPeriodEnd = true`. Plan stays Pro until
  `proUntil`; T21 handles the switch to Free.

## Record shape (adds to T02)

```js
rzp: {
  subscriptionId: "sub_...",
  status: "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed",
  createdAt: "ISO",
  currentEnd: "ISO" | null,
  cancelAtPeriodEnd: false,
  lastEventAt: "ISO" | null
}
```

## Content Security Policy

Checkout loads a script and opens a frame from Razorpay's domains. If a CSP header is added to `manage/` (it isn't
on the other pages today), it must allow those (**verify** the domains).

## Acceptance criteria

- [ ] Free subscriber → Upgrade → Razorpay test checkout → page says payment received; record has
  `rzp.status: "authenticated"` and is **still Free** until the webhook arrives
- [x] Pending, already-Pro and paid-but-waiting cases refused with the right code and no new Razorpay subscription;
  an open checkout under an hour old is reused
- [x] Cancel sets `cancelAtPeriodEnd` and leaves the plan Pro
- [x] `/api/account` never returns the email address or the token
- [x] All three actions answer `503` when payments are off; `/api/account`'s other actions still work

## Tests

- Each refusal case; `createSubscription` called once; the index record written; tampered checkout signature `400`;
  checkout-return doesn't change `plan`; cancel on an owner-Pro record refused; replies contain no `@`

## Docs

- DEPLOYMENT.md: the Razorpay variables, Preview-only for test keys (T15), and the manage page
- TECHNICAL.md file table
