# T19 · Razorpay library

| | |
|---|---|
| Phase | 2, paid Pro |
| Who | Developer |
| Size | M |
| Depends on | T15 (test-mode account, plan id) |
| Unblocks | T20, T21 |
| Status | done (2026-10-23). Built and tested offline; no Razorpay keys used. Nothing calls it until T20 and T21 |

> **Changed 2026-10-22 ([decision log](../../decisions.md)):** Pro now pays for the live board on the website, not
> for email ([paid-website.md](../paid-website.md)). Accounts and sign-in (email link, login cookie) and the locked board come first, behind a
> `BOARD_PAYWALL` switch. This task's library is unchanged.

## Why

Checkout, cancel and the webhook all need the same few calls and the same two signature checks. Putting them in one
module, with fixed test vectors, keeps the security-relevant code in one place and testable offline. The repo's rule
of no new npm packages holds: Razorpay's REST API works with plain `fetch` and Basic auth, and HMAC comes from
`node:crypto`.

**Everything Razorpay-specific below must be checked against the current Razorpay docs before building**: endpoint
paths, field names, header names, event names and the signature formats.

## Checked against Razorpay's docs (2026-10-23)

- Create: `POST /v1/subscriptions`; `plan_id` required; `total_count` an integer of 1 or more (either `total_count`
  or `end_at` is required, not both); `customer_notify` boolean, default true; `notes` at most 15 pairs; unknown
  fields are refused. The reply has `id`, `status` and `short_url`.
  ([create](https://razorpay.com/docs/api/payments/subscriptions/create-subscription/))
- Cancel: `POST /v1/subscriptions/{id}/cancel` with `cancel_at_cycle_end`, a **boolean**; false (the default)
  cancels now. ([cancel](https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/))
- Fetch: `GET /v1/subscriptions/{id}`.
  ([fetch](https://razorpay.com/docs/api/payments/subscriptions/fetch-subscription-id/))
- Auth: `Basic base64(key_id:key_secret)`. ([authentication](https://razorpay.com/docs/api/authentication/))
- Webhook: header `X-Razorpay-Signature`, HMAC-SHA256 hex of the raw body with the webhook secret; don't parse the
  body first. ([validate webhooks](https://razorpay.com/docs/webhooks/validate-test/))
- Checkout: `hmac_sha256(razorpay_payment_id + "|" + subscription_id, key_secret)`, payment id first, using **our
  own saved subscription id**, not the one Checkout returns.
  ([subscriptions integration](https://razorpay.com/docs/payments/subscriptions/integration-guide/))
- Key ids: test keys begin `rzp_test_`, live keys `rzp_live_`. ([quickstart](https://razorpay.com/docs/payments/quickstart.md))
- **No official test vector** is published for either signature, so the tests pin vectors made separately with
  `openssl dgst -sha256 -hmac`.

## What to build: `api/_lib/razorpay.js`

| Export | What it does |
|---|---|
| `razorpayConfigured(env)` | True only if `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and `RAZORPAY_PLAN_ID` are all set |
| `isTestKey(env)` | True if `RAZORPAY_KEY_ID` starts with `rzp_test_`. Used by T22 to refuse test keys on Production and live keys on Preview |
| `verifyWebhook(rawBody, signatureHeader, secret)` | HMAC-SHA256 of the **raw body bytes** with the webhook secret, hex, compared with `timingSafeEqual` (lengths checked first). Header: `x-razorpay-signature` (**verify**) |
| `verifyCheckout({paymentId, subscriptionId, signature}, keySecret)` | HMAC-SHA256 of `paymentId + "|" + subscriptionId` with the key secret (**verify** the order). Same comparison |
| `createSubscription({env, fetchFn, planId, subscriberId, totalCount})` | `POST https://api.razorpay.com/v1/subscriptions` with `plan_id`, `total_count`, `customer_notify`, and `notes: {sid: subscriberId}`. Returns `{id, status, shortUrl}` or `{error}`. **No email in `notes`**; the subscriber id is enough to find the record |
| `cancelSubscription({env, fetchFn, subscriptionId, atCycleEnd})` | `POST /v1/subscriptions/<id>/cancel` with `cancel_at_cycle_end` (**verify** the field and its type) |
| `fetchSubscription({env, fetchFn, subscriptionId})` | `GET /v1/subscriptions/<id>`. For the admin script and for checking state when a webhook looks wrong |

- Auth header: `Basic base64(KEY_ID:KEY_SECRET)`.
- Timeouts through `AbortSignal.timeout` (10 seconds), like the rest of the code.
- Never throw. On a non-2xx reply return `{error: <status number or short code>}`. Never put the secret, the full
  reply body or any address in the return value or in logs.
- The `total_count` value (how many billing cycles before the subscription ends) is **OWNER INPUT NEEDED** in T15;
  Razorpay requires one (**verify**).

## Secret scanning

Add a pattern to `scripts/check.mjs` so a committed Razorpay secret fails the check. Key ids start with `rzp_test_`
or `rzp_live_` (**verify** the formats); the key id itself isn't secret, so flag any file that has an `rzp_` key id
**and** a 20-plus character value on a line naming `secret`. Test the check with a fixture string built at runtime,
so the test file itself doesn't trip it.

## Acceptance criteria

- [x] Both verify functions accept the fixed good vectors and refuse: one changed byte of the body, a wrong secret,
  an empty or missing header, a header of the wrong length
- [x] The create, cancel and fetch calls send the right method, path, auth header and body (checked with
  `fakeFetch`)
- [x] No function throws, whatever `fetchFn` does (rejects, times out, returns HTML)
- [x] `npm run check` catches a fake committed secret

## Tests (new block in `test-subscriptions.mjs`)

- Test vectors: compute expected signatures in the test with `createHmac` from known inputs, and also include **one
  vector copied from Razorpay's docs** if they publish one, so the test doesn't only agree with itself
- `fakeFetch` cases: 200, 400, 401, 500, network error, timeout

## Out of scope

- Razorpay's Node SDK (a new dependency; not needed for four calls)
- One-time payments, refunds through the API (do refunds by hand in the dashboard)

## Docs

- TECHNICAL.md file table
