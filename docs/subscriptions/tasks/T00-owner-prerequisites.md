# T00 · Owner: domain, sender and decisions

| | |
|---|---|
| Phase | 0, before any subscriber email can be sent |
| Who | Owner |
| Size | S (mostly waiting for DNS) |
| Depends on | — |
| Unblocks | T04 (needs the sender), T12 (launch) |

## Why

Today the server sends from Resend's shared address, `onboarding@resend.dev`. Resend delivers mail from that
address **only to the address the Resend account was created with** (DEPLOYMENT.md, "Sending email"). No subscriber
can receive anything until a domain is verified in Resend and `EMAIL_FROM` is set to a sender on it.

Code tasks T01 to T11 can be built and tested offline before this is done. Launch (T12) cannot.

**Status (2026-10-21, owner-reported):** the domain `pehchanthetraveller.com` is verified in Resend, and DMARC and
Resend's other prerequisites are in place (steps 1–3 done). The sender is `hello@pehchanthetraveller.com` (step 4):
`EMAIL_FROM=hello@pehchanthetraveller.com` is set in Vercel Production, and a manual sweep's email arrived from it
(step 5). Site URL: the Vercel URL for now (step 6). DPDP advice:
deferred by the owner (step 8).

## Steps

1. **Get a domain**, or pick a subdomain of one you own, for example `radar.<yourdomain>`. A subdomain keeps this
   app's sending reputation separate from your personal mail. Price: **check current price** with the registrar.
2. **Verify it in Resend:** Resend → **Domains → Add Domain**, then add the DNS records it lists (SPF, DKIM, and the
   others it asks for) at your DNS host. Wait until Resend shows the domain as verified.
3. **Add a DMARC record** if Resend or your DNS host recommends one. Gmail and Yahoo expect SPF, DKIM and DMARC from
   senders (**verify their current requirements at build time**).
4. **Pick the sender**, for example `Travel Problem Radar <radar@radar.yourdomain>`. Set it in Vercel as `EMAIL_FROM`
   (Production only). Your own `EMAIL_TO` digest then also comes from it.
5. **Check it:** run a sweep by hand (DEPLOYMENT.md 5.1). The reply's `email` field should say `sent`, and the email
   should arrive from the new sender.
6. **Decide the custom domain for the site, if any.** Links in emails use `SITE_URL`, or
   `https://$VERCEL_PROJECT_PRODUCTION_URL` when `SITE_URL` is unset. If the site moves to a custom domain, follow
   DEPLOYMENT.md section 8 ("Custom domain") first.
   **Decided 2026-10-21:** use the Vercel URL for now, `https://travel-problem-radar.vercel.app`. Either set
   `SITE_URL` to it or leave `SITE_URL` unset (the fallback gives the same address). `pehchanthetraveller.com` is used
   for sending only.
7. **Answer the decisions** D1 to D9 in [README.md](README.md#decisions-to-settle-before-or-during-the-build-owner-input-needed).
   Write the answers in the table below and commit it.
8. **Get advice on India's DPDP Act** for storing email addresses, before launch (T12). Note who gave it and what
   it changed. **Deferred by the owner on 2026-10-21**; revisit before T12 step 9 (publishing the links).

## Decisions record

Fill in as each is settled. "Default" means the recommended default in the README was accepted.

| # | Decision | Answer | Date |
|---|---|---|---|
| D1 | How Pro is granted before payments | Default: the owner grants it with the admin script (T11) | 2026-10-21 |
| D2 | Free daily email content | Default: a roll-up of every item saved in the last 24 hours, New flags kept | 2026-10-21 |
| D3 | Free send time | Default: after the first saved sweep of the UTC day (00:17 UTC, about 05:47 IST) | 2026-10-21 |
| D4 | Pro on manual runs | Default: no, scheduled sweeps only | 2026-10-21 |
| D5 | Pro when nothing is new | Default: yes, Pro gets every saved scheduled sweep | 2026-10-21 |
| D6 | Category choice | Default: not in the first release; Pro only, later (T14) | 2026-10-21 |
| D7 | `MAX_SUBSCRIBERS` value | `5000`. **Note:** on Resend's free plan (100 emails a day) the quota formula in [pricing.md](../pricing.md) fits about 90 Free subscribers. Beyond that, T09 stops at the quota and the remaining subscribers are deferred, so a paid Resend plan is needed before the list passes about 90 (owner to decide; **check current price**) | 2026-10-21 |
| D8 | Domain and sender | Domain `pehchanthetraveller.com`, verified in Resend with DMARC. Sender `hello@pehchanthetraveller.com` (a display name in front, such as `Name <hello@...>`, is optional) | 2026-10-21 |
| D9 | Confirm link style | Default: a page with a Confirm button that posts | 2026-10-21 |

## Acceptance criteria

- [x] The domain shows as verified in Resend (`pehchanthetraveller.com`, owner-reported 2026-10-21)
- [x] DMARC and Resend's other prerequisites are in place (owner-reported 2026-10-21)
- [x] `EMAIL_FROM=hello@pehchanthetraveller.com` is set in Vercel Production (owner-reported 2026-10-21)
- [x] After a redeploy, a manual sweep's email arrives from `hello@pehchanthetraveller.com` (step 5; owner-tested
  2026-10-21)
- [x] D1 to D9 are answered in the table above
- [x] Site URL decided: the Vercel URL for now
- [ ] DPDP advice is noted (who, when, what it changed). Deferred by the owner on 2026-10-21

## Verify at build time

- Resend's current DNS record list and verification steps
- Gmail and Yahoo sender requirements (authentication, one-click unsubscribe, complaint-rate limits)
- Resend's free-plan quota (DEPLOYMENT.md records 100 a day and 3,000 a month as of October 2026)
