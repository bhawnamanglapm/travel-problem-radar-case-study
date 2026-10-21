# T13 · Optional: bounces, complaints and a per-IP limit

| | |
|---|---|
| Phase | 1d, after launch, **only if needed** |
| Who | Developer |
| Size | M |
| Depends on | T12 |
| Trigger | Build part A once Resend's dashboard shows bounces or complaints; part B once sign-up abuse appears in the event counts |

## Why

Sending to addresses that bounce, or to people who mark the digest as spam, hurts the sender's reputation, and
then mail stops reaching everyone, the owner included. Removing those addresses quickly is the fix. The honeypot and
the daily confirmation cap (T05) may not stop a determined bot.

## Part A: Resend events webhook

- New endpoint `POST /api/resend-webhook`, handler in `subscription-handlers.js`.
- In Resend, add a webhook for the bounce and complaint events (**verify** the event names, for example
  `email.bounced` and `email.complained`) and copy its signing secret into `RESEND_WEBHOOK_SECRET` (Production,
  Sensitive).
- Verify the signature on the **raw body** before parsing (Resend signs webhooks the Svix way: `svix-id`,
  `svix-timestamp`, `svix-signature` headers; **verify** the exact scheme and write the check with `node:crypto`,
  no new package). Refuse timestamps more than 5 minutes off. `401` on a bad signature.
- On a hard bounce or a complaint: find the record by `subscriberId(recipient)`, delete it, record a `bounced` or
  `complained` event. Ignore soft bounces.
- Reply `200` quickly, also for unknown addresses.
- Tests with fixed test vectors: valid signature accepted; changed body, old timestamp and wrong secret refused;
  hard bounce deletes; complaint deletes; unknown address `200`; replies have no `@`.

## Part B: per-IP limit on `POST /api/subscribe`

- Count sign-up attempts per IP per hour in an event-style record: `radar:iphit:<YYYYMMDDHH>-<sha256(ip) first 16>-<rand>`,
  counted with `list`. No raw IP is stored.
- Over `MAX_SIGNUPS_PER_IP_HOUR` (proposed 5): the usual OK reply, nothing stored or sent.
- The sweep deletes `radar:iphit:*` older than 2 hours.
- **Verify** which header carries the client IP on Vercel and that it can't be set by the client.
- If list calls per sign-up become a cost problem, this is the point to consider a CAPTCHA instead (a free tier of
  a service such as Cloudflare Turnstile; **check its terms**; no package needed, it's a script tag and one server
  `fetch`). Ask the owner before adding any third-party service.

## Acceptance criteria

- [ ] (A) A complaint or hard bounce removes the address within one webhook delivery
- [ ] (A) Forged and replayed webhooks are refused
- [ ] (B) More than the limit from one IP in an hour stores nothing, with the same reply as always
- [ ] Docs: DEPLOYMENT.md variables and setup steps for whichever parts are built
