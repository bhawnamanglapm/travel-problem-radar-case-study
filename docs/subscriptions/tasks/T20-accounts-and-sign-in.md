# T20 · Accounts and sign-in

| | |
|---|---|
| Phase | 2a, paid website ([paid-website.md](../paid-website.md)) |
| Who | Developer |
| Size | L |
| Depends on | T12 (the subscriber records, sign-up, confirm and `/manage/` it builds on) |
| Unblocks | T21, T17 (checkout needs a signed-in account) |
| Status | todo |

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
    code, 15 minutes) and email the sign-in link. The same reply for every address. Uses `MAX_SIGNUPS_PER_IP_HOUR`
    and `MAX_CONFIRMS_PER_DAY`, as sign-up does.
  - `GET ?id&c`: a page with a **Sign in** button (`hiddenForm` in `api/_lib/subscription-handlers.js`), so mail
    scanners can't use the link. `POST`: check the code and expiry, delete `signin` from the record, set the
    cookie, redirect to `/live/`. Expired or used: say so and offer a new link.
  - `GET ?action=me`: `{signedIn, plan}` (`effectivePlan`), and nothing else about the record.
  - `POST {action: "signout"}`: clear the cookie.
- **Confirm signs you in:** a successful `POST /api/confirm` also sets the cookie.
- **`/manage/` by cookie:** `/api/account` accepts the cookie when there is no `id`/`t`; a Sign out button.
- **`/signin/` page:** self-contained, styled like `/subscribe/`, with the GitHub Pages redirect snippet; linked
  from `/subscribe/` ("Already have an account? Sign in") and `/manage/`.
- **Email:** `buildSignInEmail()` in `api/_lib/email.js`.
- **Build:** add `signin` to `vercel.json`'s `buildCommand`.
- **Record fields:** `signin`, `sessionVer` (default 0). Both optional; no migration.

## Acceptance criteria

- [ ] A confirmed address gets a sign-in email; an unknown or pending one gets the same reply and no email
- [ ] The sign-in link works once, and not after 15 minutes
- [ ] A tampered cookie, an expired one, one for a deleted record and one with an old `sessionVer` are refused
- [ ] Confirming signs you in; `/manage/` works with the cookie alone; Sign out ends it
- [ ] No code, token or cookie value appears in a log or a reply

## Tests

- Cookie sign and verify with each refusal above; code single use and expiry; the same reply for unknown addresses;
  the per-IP and daily limits; `me` with and without a cookie; Confirm sets the cookie; `/api/account` by cookie

## Docs

- DEPLOYMENT.md: `SESSION_SECRET` (Production and Preview, different values, Sensitive), `/signin/`, the new
  record fields
- The draft privacy page: the login cookie and sign-in emails
- architecture.md: the new page and endpoint rows
