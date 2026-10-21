# T13 · Optional: bounces, complaints and a per-IP limit

| | |
|---|---|
| Phase | 1d, after launch, **only if needed** |
| Who | Developer |
| Size | M |
| Depends on | T12 |
| Trigger | Build part A once Resend's dashboard shows bounces or complaints; part B once sign-up abuse appears in the event counts |
| Status | **Built** on 2026-10-22, both parts, before either trigger (owner's choice). Offline tests pass. The firewall rule is live (2026-10-22); the webhook secret is an owner step (see "Built" below) |

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

- [x] (A) A complaint or hard bounce removes the address within one webhook delivery (offline tests; not yet seen
  in production)
- [x] (A) Forged and replayed webhooks are refused (a replay after 5 minutes is refused; one inside 5 minutes
  deletes an already-deleted record, so it changes nothing)
- [x] (B) More than the limit from one IP in an hour stores nothing, with the same reply as always (offline tests)
- [x] Docs: DEPLOYMENT.md variables and setup steps for whichever parts are built

## Built

- **Checked against the docs (October 2026):** event names `email.bounced` and `email.complained`, and
  `data.bounce.type` `Permanent` / `Transient` / `Undetermined` (resend.com/docs); the Svix scheme, signed text
  `id.timestamp.body`, HMAC-SHA256 with the base64 key after `whsec_` (docs.svix.com); a Web-standard handler
  (`export default { fetch }`) gives the exact raw body on Vercel; Vercel overwrites `x-forwarded-for`, so a client
  can't set it (vercel.com/docs/headers/request-headers). **Not confirmed:** whether Resend sends `email.bounced`
  for soft bounces at all; they are ignored either way.
- **Part B uses both guards** (owner's choice): the Blob counters above, and a Vercel Firewall rate-limit rule
  (5 requests per 10 minutes per IP on `POST /api/subscribe`, `429`) so a flood doesn't spend Blob's 2,000 included
  advanced operations a month. The CAPTCHA was not needed.
- **Firewall rule: live on production since 2026-10-22**, added with the Vercel CLI after the owner's OK. The project
  had no firewall rules before, so it takes Hobby's one rate-limit slot without replacing anything. Read back from
  the live config: `subscribe rate limit`, path equals `/api/subscribe` and method `POST`, 5 requests per 600 s,
  fixed window, keyed by IP, action `rate_limit` (429). Not triggered on purpose, to avoid flooding production.
- **Owner steps after merge:** add the Resend webhook and `RESEND_WEBHOOK_SECRET`, then redeploy.
  Checks: DEPLOYMENT.md, "Subscriber email (optional)".
