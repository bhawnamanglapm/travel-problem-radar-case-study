# Paid website: design

> **Planned, not built.** Decided on 2026-10-22 ([decision log](../decisions.md)). The plan replaces "Pro is a paid
> email" with "Pro pays for the live board". Until the `BOARD_PAYWALL` switch is turned on, the board stays open
> and the emails work as described in [email-signup.md](email-signup.md). Payments themselves are
> [payments-razorpay.md](payments-razorpay.md) and tasks T16 to T19; this page covers what comes before them:
> accounts, sign-in, the locked board and the teaser email.

## Goal

People pay to see the sweeps on the website. A visitor who comes straight to the site, without ever seeing an
email, can sign up, sign in and upgrade there. No passwords.

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

1. **Sign up.** `/subscribe/` as today: enter an address, get a confirmation email, press **Confirm**. Confirming
   now also **signs you in** in that browser (sets the login cookie) and goes to `/live/`.
2. **Sign in.** New `/signin/` page with one email field, linked from `/subscribe/`, `/live/` and `/manage/`.
   - `POST /api/session` with `action: "request"` and the address. If the address has a confirmed record, the
     record gets a sign-in code (only its hash is stored, valid for 15 minutes, usable once), and the inbox gets an
     email with a sign-in link.
   - The reply is the same whether or not the address has an account. Sign-up already shows whether an address
     subscribes (the owner's choice, decision log), so this hides nothing new; it just keeps the form simple.
   - The per-IP limit (`MAX_SIGNUPS_PER_IP_HOUR`) and the daily email cap (`MAX_CONFIRMS_PER_DAY`) apply, as for
     sign-up.
3. **The sign-in link** opens a page with a **Sign in** button, like Confirm, because mail scanners open links but
   don't press buttons. Pressing it checks the code, deletes it from the record, sets the login cookie and goes to
   `/live/`. An expired or used code says so and offers a new link.
4. **The board.** `/live/` reads `/api/data` as today. With the switch on:
   - not signed in → `401`, and the page shows "Sign in" and "Sign up", plus a link to the demo;
   - signed in, Free → `402`, and the page shows "Upgrade" (until payments exist: the existing **Request Pro**);
   - signed in, Pro (`effectivePlan()` in `api/_lib/subscribers.js`) → the data.
5. **Upgrade.** On `/manage/` while signed in (checkout is T17). The `id`/`t` link from the emails keeps working.
6. **Sign out.** A button on `/manage/` and `/live/` (`action: "signout"`) clears the cookie in that browser.
7. **Unsubscribe and delete.**
   - Free: the Unsubscribe link deletes the record, as today.
   - **Pro: unsubscribing stops email but keeps the account** (`emailOff: true`), because they paid for the board.
     A hard bounce or a spam complaint does the same for Pro.
   - `/manage/` gets **Delete my account**, which deletes the record for anyone. For a paying subscriber it comes
     after cancelling (T19).

## The login cookie

- Name `tpr_session`. Value: the record id, an expiry and a session version, signed with HMAC-SHA256 using
  `SESSION_SECRET`.
- `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 30 days.
- Checked on every use against the stored record: a deleted record, or a record whose `sessionVer` has moved on,
  makes the cookie worthless. Bumping `sessionVer` ("sign out everywhere") is how to end every session for an
  account.
- It holds no address and no plan; the plan is always read from the record, so a lapsed Pro loses the board at once.
- New module `api/_lib/session.js` (sign, verify, read and set the cookie); new endpoint `api/session.js`
  (`request`, the sign-in link's `GET` and `POST`, `me`, `signout`). Functions: 8 of 12 on Hobby.

## Storage

New fields on the subscriber record, all optional, so existing records need no migration:

| Field | Meaning |
|---|---|
| `signin` | `{ hash, exp }` of the current sign-in code, or `null`. Deleted when used |
| `sessionVer` | Whole number, default 0. Bumped to end every session |
| `emailOff` | `true` when a Pro account has unsubscribed from email. Delivery skips it |

`/api/data` changes only its access rule and its cache header: with the switch on it answers
`cache-control: private, no-store`, so no shared cache can hand the board to someone who hasn't paid.

## The teaser email

`buildDigestEmail()` in `api/_lib/email.js` gets a teaser mode for Free accounts: the number of findings per
category and their headlines, with no detail and no source links, and a "Sign in to see everything" link. Pro
emails don't change. The teaser follows the same switch as the board, so the free email keeps every finding until
the board is locked.

## The switch

`BOARD_PAYWALL=1` turns on the locked board and the teaser email together; anything else, or unset, means off.
Accounts, sign-in and sign-out work either way.

Turning it on before checkout exists locks the board for everyone except accounts given Pro by hand (`grant-pro`).
So it goes on with go-live (T19), unless the owner chooses sooner. On that day, the "Live" button in the case study,
the README and the `/subscribe/` nav also change wording.

## Guardrails

- No passwords stored. Sign-in codes are random, stored hashed, expire in 15 minutes and work once.
- Never log or return a sign-in code, a token or a cookie value.
- The sign-in email and the sign-in page carry no subscriber data beyond what the person typed.
- `SESSION_SECRET` is set for Production and Preview with **different** values and marked Sensitive, so a Preview
  cookie never works on Production.
- The paywall is enforced only by `/api/data`. The page's panel is a convenience, not the lock.

## Build order

1. Accounts and sign-in (the cookie, `/api/session`, `/signin/`, Confirm signs you in, `/manage/` by cookie,
   sign-out, the privacy draft gains the cookie and sign-in emails).
2. The locked board behind `BOARD_PAYWALL`, the `/live/` panel, and Pro accounts that survive unsubscribing.
3. The teaser email behind the same switch.
4. Payments: T16 to T19, with checkout on `/manage/` while signed in.

## Tests

Offline, in `scripts/test-subscriptions.mjs` with fake storage and a fake `fetch`, as for the rest:

- the cookie: a valid one, a tampered one, an expired one, one for a deleted record, one with an old `sessionVer`;
- sign-in codes: work once, expire after 15 minutes, the same reply for an unknown address, the limits respected;
- `/api/data` with the switch off (unchanged) and on (not signed in, Free, Pro, lapsed Pro), and its cache header;
- Pro unsubscribe, bounce and complaint keep the account and stop email; Free still deletes;
- the teaser email holds no detail or source link.

`npm run check`: the switch is off in `vercel.json` and the docs' defaults, `/signin/` is self-contained with the
GitHub Pages redirect snippet, and `/api/data` is never publicly cached when locked.

Then on a Vercel Preview with the switch on: sign up and confirm, sign in from another browser, see the panel as
Free, see the board after `grant-pro` (owner's OK), sign out, unsubscribe as Pro and keep the board.

## Razorpay's "login to complete a payment?"

Yes. For the reviewer: sign up at `/subscribe/` with any address, press Confirm (which signs you in), then Upgrade
on `/manage/`. Not in Razorpay's docs: what the form asks for after "Yes" (T15 Step 2, row 10).

## Still open (OWNER INPUT NEEDED)

1. Prices, currency, trial and refund rule (the T15 pricing worksheet).
2. How long a sign-in lasts: 30 days is proposed.
3. Whether the teaser shows headlines from every category, or only counts for some.
4. Whether turning on the paywall before payments is wanted (only hand-granted Pro could see the board).
5. Not checked: whether a locked board with no way to pay counts as commercial use under Vercel Hobby's terms.
   Payments themselves need Vercel Pro (T15 Step 2, row 3).
