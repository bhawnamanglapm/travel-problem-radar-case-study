# T10 · Call delivery from the sweep handler

| | |
|---|---|
| Phase | 1c, delivery |
| Who | Developer |
| Size | M |
| Depends on | T09 |
| Unblocks | T11 |

## Why

`makeSweepHandler` in `api/_lib/handlers.js` already sends the owner's Slack post and email after a saved sweep.
Subscriber delivery goes right after that, under the same rules: it never fails the sweep, and its reply holds
counts only.

## Changes to `api/_lib/handlers.js`

1. Accept `randomBytes` in `makeSweepHandler`'s dependencies (default `crypto.randomBytes`), and pass it through.
2. Note the start time at the top of the handler: `const startedAt = now();`
3. In the `out.status === "saved"` branch, **after** `await deliver(...)` for the owner:

   ```js
   summary.subscribers = await deliverToSubscribers({
     env, storage, fetchFn, now, randomBytes, log,
     sweep: out, scheduled, deadlineAt: startedAt + SUBSCRIBER_DEADLINE_MS,
   });
   ```

   with `SUBSCRIBER_DEADLINE_MS = 240_000`: 60 seconds short of the 300-second function limit in `vercel.json`, to
   leave time for the reply.
4. `empty`, error and `skipped` outcomes: **no subscriber email**. Don't add a `subscribers` field to those replies,
   so they look exactly as they do today.
5. Order matters: the owner's email goes out first, so if the Resend quota runs out it hits subscribers, not the
   owner's own digest.

`api/sweep.js` passes `randomBytes` from `node:crypto`.

## The reply

A saved sweep's reply gets one more field, for example:

```json
"subscribers": { "pro": { "due": 3, "sent": 3, "failed": 0, "deferred": 0 },
                 "free": { "due": 41, "sent": 41, "failed": 0, "deferred": 0, "alreadySent": 0 },
                 "pending": 2, "expired": 0, "stopped": null }
```

or `"subscribers": "not configured"` when the switch is off. This reply is printed in the public GitHub Actions
log, so it must never hold an address, id or token. The tests check it.

## Changes to `/api/data`

None. `ALLOWED_KEY` (`^radar:(history|sweep:\d{10,16})$`) already refuses the new keys. Add tests that prove it.

## Acceptance criteria

- [ ] All 68 existing sweep tests pass unchanged
- [ ] A saved scheduled sweep sends the owner's email, then subscriber emails, and the reply has `subscribers`
- [ ] `empty`, `skipped` and error replies are unchanged
- [ ] A subscriber delivery that throws inside (forced in a test) still leaves a `200` saved reply
- [ ] The `subscribers` field and the log line contain no `@`
- [ ] `/api/data` refuses `radar:sub:<id>`, `radar:deliveries:<date>`, `radar:event:<...>` and `radar:subscriberCount`

## Tests

In `test-subscriptions.mjs`, using `makeSweepHandler` with fakes for Anthropic (as in `test-sweep.mjs`) and Resend:
- Saved scheduled sweep with 1 Pro and 1 Free: Resend sees the owner's email first, then the batch
- Owner's Resend call answers quota-exceeded: owner reply `email: failed: http 429 ...`, subscriber send reports
  `stopped: "quota"` and doesn't loop
- The four `/api/data` refusals above
- Clock past `startedAt + 240 s` before delivery: all `deferred`, sweep still `200`
- Reply body has no subscriber address (search for each test address)

## Docs

- DEPLOYMENT.md 5.2 ("Read the answer"): describe the `subscribers` field
- DEPLOYMENT.md section 1 diagram: add "then: digests to subscribers (optional)"
