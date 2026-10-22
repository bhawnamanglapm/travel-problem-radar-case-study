# T18 · Razorpay webhook

| | |
|---|---|
| Phase | 2, paid Pro |
| Who | Developer |
| Size | M |
| Depends on | T16, T17 |
| Unblocks | T19 |

> **Changed 2026-10-22 ([decision log](../../decisions.md)):** Pro now pays for the live board on the website, not
> for email ([paid-website.md](../paid-website.md)). Accounts and sign-in (email link, login cookie) and the locked board come first, behind a
> `BOARD_PAYWALL` switch. The webhook still grants and removes Pro; Pro now also unlocks `/api/data`.

## Why

The webhook is the only thing that may grant or remove paid Pro. It is signed by Razorpay, retried by Razorpay if it
fails, and keeps arriving after the subscriber has closed the tab.

## What to build: `POST /api/razorpay-webhook`

1. **Raw body.** Read the body bytes exactly as sent (T03's `readBody` must return the raw buffer for this path;
   **verify** how Vercel exposes it and that no body parser has already run).
2. **Signature.** `verifyWebhook(raw, req.headers["x-razorpay-signature"], RAZORPAY_WEBHOOK_SECRET)`. Bad or missing:
   `401`, nothing else done.
3. **Parse** the JSON only after the signature passes.
4. **Idempotency.** Razorpay sends an event id header (`x-razorpay-event-id`, **verify**). If
   `radar:rzp-event:<id>` exists, reply `200` and stop. Otherwise write it **after** applying the change. Prune these
   older than 30 days from the sweep.
5. **Find the record.** `radar:rzpsub:<subscriptionId>` → `id`; fall back to `payload.subscription.entity.notes.sid`.
   Not found: reply `200` and log `rzp webhook: unknown subscription` (no ids in the log beyond the event type).
6. **Ignore stale events.** If the event's `created_at` is older than `rzp.lastEventAt`, reply `200` without changes
   (Razorpay doesn't promise order; **verify**).
7. **Apply** the table below, set `rzp.status`, `rzp.lastEventAt`, `rzp.currentEnd`, write the record, record the
   event (`progranted` / `prorevoked` with `plan`).
8. Reply `200` quickly. Any thrown error inside: reply `500` so Razorpay retries, and log the event type only.

## Event → plan table (verify event names and fields against current Razorpay docs)

| Event | Plan change | `proUntil` | Note |
|---|---|---|---|
| `subscription.authenticated` | none | — | Mandate set up, no charge yet |
| `subscription.activated` | `plan: "pro"`, `proSource: "razorpay"` | `current_end` | First successful charge |
| `subscription.charged` | `plan: "pro"` | `current_end` | Each renewal moves the date forward |
| `subscription.pending` | none (stay Pro) | unchanged | A renewal failed and Razorpay is retrying |
| `subscription.halted` | `plan: "free"` | `null` | Retries used up |
| `subscription.cancelled` | none now | keep `current_end` | Pro ends when `proUntil` passes (T19); if Razorpay cancelled immediately and `current_end` is past, set Free now |
| `subscription.completed` | as cancelled | keep `current_end` | All `total_count` cycles done |
| `subscription.paused` / `resumed` | treat paused as halted, resumed as charged | | Only if pausing is enabled; otherwise ignore |
| anything else | none | — | Reply `200` |

`current_end` is a Unix time in seconds in Razorpay's payload (**verify**); store it as ISO.

If an owner-granted Pro record (`proSource: "owner"`) receives a paid activation, switch it to `razorpay` and use
the paid `proUntil`.

## Setting it up

- In the Razorpay dashboard (test mode), add a webhook to `https://<preview or test project>/api/razorpay-webhook`
  with the events above and a secret; put the secret in `RAZORPAY_WEBHOOK_SECRET`.
- Preview protection blocks it unless bypassed (T15 step 3).

## Acceptance criteria

- [ ] Test checkout → `subscription.activated` → the record is Pro with the right `proUntil`, and the next scheduled
  sweep sends it the Pro email
- [ ] The same event delivered twice changes nothing the second time
- [ ] A forged event (bad signature) is refused with `401` and writes nothing
- [ ] `halted` moves to Free; `pending` doesn't
- [ ] An older event arriving after a newer one doesn't undo it

## Tests (fixture payloads in the test file, signed in the test)

- One case per table row; duplicate event id; stale event; unknown subscription `200`; bad signature `401`; owner-Pro
  record taken over by a paid activation; thrown storage error gives `500`; logs and replies contain no `@`

## Docs

- DEPLOYMENT.md: webhook setup, the events to tick, troubleshooting ("paid but still Free": check the webhook's
  delivery log in Razorpay first)
- The new Blob keys (`radar:rzpsub:`, `radar:rzp-event:`) in the "What is stored" table, and a test that
  `/api/data` refuses them
