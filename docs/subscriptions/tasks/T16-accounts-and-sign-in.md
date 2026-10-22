# T16 · Accounts and sign-in

| | |
|---|---|
| Phase | 2a, paid website ([paid-website.md](../paid-website.md)) |
| Who | Developer |
| Size | L |
| Depends on | T12 (the subscriber records, sign-up, confirm and `/manage/` it builds on) |
| Unblocks | T17, T20 (checkout needs a signed-in account) |
| Status | **Built** on 2026-10-22 and live in production (`SESSION_SECRET` set on Production, not Preview). Sign up, confirm, `/manage/` by cookie and Sign out checked in production with a real inbox on 2026-10-22; the emailed sign-in link not yet |

## Why

Pro now pays for the live board on the website (decision log, 2026-10-22). A visitor who comes straight to the
site, without an email in hand, must be able to sign up, sign in and reach `/manage/`. Today the only way in is the
`id`/`t` link inside an email. No passwords: sign-in is a link emailed to the inbox.

## What to build

- **`api/_lib/session.js`:** sign and verify the login cookie `tpr_session` (record id, expiry, `sessionVer`,
  HMAC-SHA256 with `SESSION_SECRET`); read it from a request; build the `Set-Cookie` header (`HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, 30 days) and the one that clears it. Constant-time compare, as `tokenOk` does.
- **`api/session.js`** (functions: 8 of 12):
  - `POST {action: "request", email}`: for a confirmed record, store `signin: {hash, exp}` (SHA-256 of a random
    code, 15 minutes) and email the sign-in link. The same reply for every address. **Built with its own limits**
    instead of `MAX_CONFIRMS_PER_DAY`, so a burst of bot sign-ups can't stop subscribers signing in: one email per
    address every 5 minutes (`signin.sentAt`), `MAX_SIGNINS_PER_DAY` a day (default 50, counted by a new
    `signinsent` event), and `MAX_SIGNUPS_PER_IP_HOUR`, counted together with sign-ups (`ipLimitReached()`).
  - `GET ?id&c`: a page with a **Sign in** button (`hiddenForm` in `api/_lib/subscription-handlers.js`), so mail
    scanners can't use the link. `POST`: check the code and expiry, delete `signin` from the record, set the
    cookie, redirect to `/live/`. Expired or used: say so and offer a new link.
  - `GET ?action=me`: `{signedIn, plan}` (`effectivePlan`), and nothing else about the record.
  - `POST {action: "signout"}`: clear the cookie.
- **Confirm signs you in:** a successful `POST /api/confirm` also sets the cookie (when `SESSION_SECRET` is set). It
  stays on the "You're subscribed" page, which links to the board, rather than redirecting.
- **The cookie's signature also covers the record's `createdAt`** (not stored in the cookie), so after someone
  unsubscribes and signs up again under the same id, an older cookie is refused.
- **`/manage/` by cookie:** `/api/account` accepts the cookie when there is no `id`/`t`; a Sign out button. Its
  replies gain `signedIn`. Opened by cookie, the page has no token, so it shows "use the Unsubscribe link in any
  digest email" instead of an Unsubscribe link. A cookie `POST` whose `Origin` names another host gets `403`.
- **`/signin/` page:** self-contained, styled like `/subscribe/`, with the GitHub Pages redirect snippet; linked
  from `/subscribe/` ("Already subscribed? Sign in") and `/manage/` (when not signed in). When already signed in it
  shows "You're signed in" with Sign out.
- **Email:** `buildSignInEmail()` in `api/_lib/email.js`.
- **Build:** add `signin` to `vercel.json`'s `buildCommand`.
- **Record fields:** `signin` (`{hash, exp, sentAt}`, `null` once used), `sessionVer` (default 0). Both optional; no
  migration.
- **`stats`** in `scripts/subscribers.mjs` gains a sign-ins column and total.

## Acceptance criteria

- [x] A confirmed address gets a sign-in email; an unknown or pending one gets the same reply and no email (offline tests)
- [x] The sign-in link works once, and not after 15 minutes (offline tests)
- [x] A tampered cookie, an expired one, one for a deleted record and one with an old `sessionVer` are refused
  (offline tests; also one for a re-subscribed record, and any cookie when the secret is unset or short)
- [x] Confirming signs you in; `/manage/` works with the cookie alone; Sign out ends it (offline tests)
- [x] No code, token or cookie value appears in a log or a reply (offline tests)
- [x] In production with a real inbox: confirm signs you in, `/manage/` works by cookie, Sign out (2026-10-22)
- [ ] In production with a real inbox: a sign-in link from `/signin/` lands on `/live/` signed in, and is refused when
      used again

## Tests

- Cookie sign and verify with each refusal above; code single use and expiry; the same reply for unknown addresses;
  the per-IP and daily limits; `me` with and without a cookie; Confirm sets the cookie; `/api/account` by cookie

## Docs

- DEPLOYMENT.md: `SESSION_SECRET` (Production and Preview, different values, Sensitive), `/signin/`, the new
  record fields
- The draft privacy page: the login cookie and sign-in emails
- architecture.md: the new page and endpoint rows
