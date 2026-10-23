# Paid website: design

> **Planned, not built.** Decided on 2026-10-22 ([decision log](../decisions.md)). The plan replaces "Pro is a paid
> email" with "Pro pays for the live board". Until the `BOARD_PAYWALL` switch is turned on, the board stays open
> and the emails work as described in [email-signup.md](email-signup.md). Payments themselves are
> [payments-razorpay.md](payments-razorpay.md) and tasks T19 to T22; this page covers what comes before them:
> accounts, sign-in, the locked board and the teaser email. The flows as built, with proposed changes:
> [account-flows.md](account-flows.md).

## Goal

People pay to see the sweeps on the website. A visitor who comes straight to the site, without ever seeing an
email, can sign up, sign in and upgrade there. No passwords: an emailed link, or Continue with Google (added 2026-10-22,
off until the owner sets it up).

## Who sees what

| | Visitor | Free account | Pro (paid) |
|---|---|---|---|
| Demo with saved sample data (`/demo/`, GitHub Pages) | Yes | Yes | Yes |
| Live board (`/live/`): every sweep, history, Copy report | No: a sign-in or upgrade panel | No: an upgrade panel | Yes |
| Email | No | A teaser once a day: counts and headlines, a link to sign in | The full digest after every saved sweep (up to 5 a day) |
| Choose categories | No | No | Yes (built, T14) |
| Price | Free | Free | **OWNER INPUT NEEDED** ([T15 pricing worksheet](tasks/T15-phase2-gate-and-accounts.md#pricing-worksheet-owner)) |

An account is the existing subscriber record (`radar:sub:<id>`, one per inbox). Signing up for the email and making
an account are the same thing.

## Flow

1. **Sign up.** `/signup/` ("Create your account") is the one form: an email address and an optional "I'd also like
   Pro" box, posted to `/api/subscribe`. `/subscribe/` is the plans page and links to it. Enter an address, get a
   confirmation email, press **Confirm**.
   Confirming now also **signs you in** in that browser (sets the login cookie). It stays on the "You're subscribed"
   page, which says you're signed in and links to `/live/`, so the confirmation still shows. An account is the
   subscriber record, so it comes with the free daily email; `/signup/` says so. Signing up again with an address
   that already has an account emails a sign-in link instead.
2. **Sign in.** New `/signin/` page with one email field, linked from the home page, `/subscribe/`, `/signup/`,
   and `/manage/` when not signed in. The live board's strip shows "Sign in", or "Account" when signed in (the panel
   for a locked board is built, T17).
   - `POST /api/session` with `action: "request"` and the address. If the address has a confirmed record, the
     record gets a sign-in code (only its hash is stored, valid for 15 minutes, usable once), and the inbox gets an
     email with a sign-in link. An address that never pressed Confirm gets its confirmation link again instead,
     on sign-up's limits (10 minutes apart, 5 per address, within `MAX_CONFIRMS_PER_DAY`).
   - The reply is the same whether or not the address has an account. Sign-up already shows whether an address
     subscribes (the owner's choice, decision log), so this hides nothing new; it just keeps the form simple.
   - Sign-in emails have their own limits, so a burst of bot sign-ups can't use up the day's emails and stop paying
     subscribers signing in: at most one per address every 5 minutes, at most `MAX_SIGNINS_PER_DAY` a day (default
     50, counted by a `signinsent` event), and the per-IP limit `MAX_SIGNUPS_PER_IP_HOUR`, counted together with
     sign-ups. They don't count against `MAX_CONFIRMS_PER_DAY`.
3. **The sign-in link** opens a page with a **Sign in** button, like Confirm, because mail scanners open links but
   don't press buttons. Pressing it checks the code, deletes it from the record, sets the login cookie and goes to
   `/live/`. An expired or used code says so and offers a new link.
   - **Continue with Google** (added 2026-10-22) is the other way in, on the same endpoint and with no new
     package: `GET /api/session?action=google` goes to Google (OpenID Connect, `scope=openid email`, PKCE), and
     Google sends the person back to `GET /api/session?state&code`. A short signed cookie, `tpr_oauth` (10
     minutes), ties the return to the browser that started it. The address Google verified signs in its account,
     or activates a pending one. A new address gets a "Create your account" page first (its address, the daily
     email, the Pro box): the cookie then holds the verified address for 10 minutes, and only
     `POST {action: "google-signup"}` (its Create account button) makes the Free account, active at once with no
     confirmation email, under `MAX_SUBSCRIBERS` and the per-IP limit. Cancel creates nothing. Then the login
     cookie is set and it goes to `/live/`. Only the
     address is kept: no Google id, name or token. Hidden until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are
     set (`action=me` reports `google`).
4. **The board.** `/live/` reads `/api/data` as today. With the switch on (built in T17; on in production since 2026-10-23):
   - not signed in → `401`, and the page shows "Sign in" and "Sign up", plus a link to the demo;
   - signed in, Free → `402`, and the page shows **Request Pro** while Pro is free; in a paid build (T26) it shows the
     price and renewal, "Go to your account" and a link to `/pricing/`;
   - signed in, Pro (`effectivePlan()` in `api/_lib/subscribers.js`) → the data.
5. **Upgrade.** On `/manage/` while signed in (checkout is T20). The `id`/`t` link from the emails keeps working.
6. **Sign out.** A button on `/manage/` and `/signin/` (`action: "signout"`) clears the cookie in that browser;
   `/live/` has none of its own: its "Account" link leads to `/manage/`, which has one.
7. **Unsubscribe and delete.**
   - Free: the Unsubscribe link deletes the record, as today.
   - **Pro: unsubscribing stops email but keeps the account** (`emailOff: "unsubscribed"`), because they paid for
     the board. A hard bounce or a spam complaint does the same for Pro (`"bounced"`, `"complained"`). Built in T17.
   - `/manage/` has **Delete my account** (T17), which deletes the record for anyone. A paying subscriber gets
     "cancel first" (`409`) until T22 adds cancelling.

## The login cookie

- Name `tpr_session`. Value: the record id, an expiry and a session version, signed with HMAC-SHA256 using
  `SESSION_SECRET` (at least 32 characters; shorter counts as unset, and then nobody can sign in).
- The signature also covers the record's `createdAt`, which is not in the cookie. Someone who unsubscribes and signs
  up again gets a new record under the same id but a new `createdAt`, so a cookie from before stops working.
- `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Max-Age`: it ends when the browser closes. The signed
  expiry is 12 hours (`SESSION_HOURS`), for browsers that restore session cookies. (It was 30 days until 2026-10-22.)
- Checked on every use against the stored record: a deleted record, or a record whose `sessionVer` has moved on,
  makes the cookie worthless. Bumping `sessionVer` ("sign out everywhere") is how to end every session for an
  account.
- It holds no address and no plan; the plan is always read from the record, so a lapsed Pro loses the board at once.
- New module `api/_lib/session.js` (sign, verify, read and set the cookie); new endpoint `api/session.js`
  (`request`, the sign-in link's `GET` and `POST`, `me`, `signout`). Functions: 8 of 12 on Hobby.
- `/manage/` without `id`/`t` uses the cookie. Opened that way it never gets the token, so it shows no Unsubscribe
  link ("use the Unsubscribe link in any digest email"), but it has Delete my account (T17).
- A `POST` authenticated by the cookie is refused (`403`) if its `Origin` header names another host, on top of
  `SameSite=Lax`.

## Storage

New fields on the subscriber record, all optional, so existing records need no migration:

| Field | Meaning |
|---|---|
| `signin` | `{ hash, exp, sentAt }` of the current sign-in code, or `null`. Set to `null` when used. `sentAt` spaces the emails 5 minutes apart |
| `sessionVer` | Whole number, default 0. Bumped to end every session (by hand for now) |
| `emailOff` | Absent while emails are on. For a Pro account whose emails stopped: `"unsubscribed"`, `"bounced"` or `"complained"`. Delivery skips it. Only `"unsubscribed"` can be turned back on from `/manage/` |

`/api/data` changes only its access rule and its cache header: with the switch on it answers
`cache-control: private, no-store`, so no shared cache can hand the board to someone who hasn't paid.

## The teaser email

`buildDigestEmail()` in `api/_lib/email.js` gets a teaser mode for Free accounts: the number of findings per
category and their headlines, with no detail and no source links, and a "Sign in to see everything" link. Pro
emails don't change. The teaser follows the same switch as the board, so the free email keeps every finding until
the board is locked.

**Built** (T18, 2026-10-23), headlines for all four categories (owner's choice). Each category shows its count and its
headlines, New marked; no summary, source, region, date, severity tag or product idea. A **Sign in** button goes to
`/signin/`. The subject reads "Travel Problem Radar daily summary · <date> · N problems, M new". The teaser has its
own Resend idempotency key, and the sweep's `subscribers` log line says `"teaser":true` or `false`.

## The switch

`BOARD_PAYWALL=1` turns on the locked board and the teaser email together; anything else, or unset, means off.
Accounts, sign-in and sign-out work either way.

Turning it on before checkout exists locks the board for everyone except accounts given Pro by hand (`grant-pro`).
So it goes on with go-live (T22), unless the owner chooses sooner. On that day, the "Live" button in the case study,
the README and the `/subscribe/` nav also change wording.

**The owner turned it on on 2026-10-23**, before checkout. The board is locked; the Free email stays complete until
T18 is deployed, and then turns into the teaser at once, because the switch is already on (T18 was deployed the
same day). The wording changes
above were made the same day: "Live board (Pro)" in the navs, the home page's second button goes to the
demo, the Free plan no longer lists the board, and the home page's "What it found recently" section (empty for
anyone without Pro) points to the demo.

## Guardrails

- No passwords stored. Sign-in codes are random, stored hashed, expire in 15 minutes and work once.
- Never log or return a sign-in code, a token or a cookie value.
- Continue with Google: the `id_token` is read only straight from Google's token endpoint over TLS, and its
  `iss`, `aud`, `exp`, `nonce` and `email_verified` are checked. Logs name only the kind of failure.
- The sign-in email and the sign-in page carry no subscriber data beyond what the person typed.
- `SESSION_SECRET` is set for Production and Preview with **different** values and marked Sensitive, so a Preview
  cookie never works on Production.
- The paywall is enforced only by `/api/data`. The page's panel is a convenience, not the lock.

## Build order

As tasks: [T16](tasks/T16-accounts-and-sign-in.md), [T17](tasks/T17-locked-board.md),
[T18](tasks/T18-teaser-email.md), then T19 to T22.

1. Accounts and sign-in (the cookie, `/api/session`, `/signin/`, Confirm signs you in, `/manage/` by cookie,
   sign-out, the privacy draft gains the cookie and sign-in emails).
2. The locked board behind `BOARD_PAYWALL`, the `/live/` panel, and Pro accounts that survive unsubscribing.
   **Built** (T17, 2026-10-23); the switch went on in production the same day.
3. The teaser email behind the same switch.
4. Payments: T19 to T22, with checkout on `/manage/` while signed in.

## Tests

Offline, in `scripts/test-subscriptions.mjs` with fake storage and a fake `fetch`, as for the rest:

- the cookie: a valid one, a tampered one, an expired one, one for a deleted record, one for a re-subscribed record,
  one with an old `sessionVer`, no secret or a short one;
- sign-in codes: work once, expire after 15 minutes, the same reply for an unknown address, the limits respected;
- `/api/data` with the switch off (unchanged) and on (not signed in, Free, Pro, lapsed Pro), and its cache header;
- Pro unsubscribe, bounce and complaint keep the account and stop email; Free still deletes;
- the teaser email holds no detail or source link.

`npm run check`: the switch is off in `vercel.json` and the docs' defaults, `/signin/` is self-contained with the
GitHub Pages redirect snippet, and `/api/data` is never publicly cached when locked.

Then on a Vercel Preview with the switch on: sign up and confirm, sign in from another browser, see the panel as
Free, see the board after `grant-pro` (owner's OK), sign out, unsubscribe as Pro and keep the board.

## Razorpay's "login to complete a payment?"

Yes. For the reviewer: sign up at `/signup/` with any address, press Confirm (which signs you in), then Upgrade
on `/manage/`. Not in Razorpay's docs: what the form asks for after "Yes" (T15 Step 2, row 10).

## Still open (OWNER INPUT NEEDED)

1. Prices, currency, trial and refund rule (the T15 pricing worksheet).
2. How long a sign-in lasts: decided 2026-10-22, until the browser closes, 12 hours at most.
3. Whether the teaser shows headlines from every category, or only counts for some: decided 2026-10-23, headlines
   for all four.
4. Whether turning on the paywall before payments is wanted (only hand-granted Pro could see the board).
5. Not checked: whether a locked board with no way to pay counts as commercial use under Vercel Hobby's terms.
   Payments themselves need Vercel Pro (T15 Step 2, row 3).
