# Free email sign-up: design

> **Built** in October 2026 (tasks T01 to T11 in [tasks/](tasks/README.md)), and switched on in production on
> 21 Oct 2026. This page describes the design as built. The first draft, written on 21 Oct 2026 before the code, is in
> the git history; the [tasks README](tasks/README.md#where-these-tasks-differ-from-the-draft-designs) lists where the
> build differs from it. How to run it: [DEPLOYMENT.md, "Subscriber email"](../../DEPLOYMENT.md#subscriber-email-optional).
> The picture of how this connects to the rest: [architecture.md](architecture.md), diagrams A to C and E.

## Goal

Let a visitor subscribe to the digest by email, so they get it without opening the board. Free, no account, no
password.

## Prerequisite: a verified domain

Resend's shared sender (`onboarding@resend.dev`) delivers only to the address the Resend account was created with.
So subscriber email needs a domain verified in Resend and `EMAIL_FROM` set to a sender on it. The code refuses the
shared sender for subscribers (`senderOk()` in `api/_lib/subscription-handlers.js`).

Done for this project: `pehchanthetraveller.com` is verified with SPF, DKIM and DMARC, and the sender is
`hello@pehchanthetraveller.com` (decision D8).

## Flow

1. **Subscribe.** `/signup/` ("Create your account") is the one sign-up form: an email field, a hidden trap field
   for bots, and an "I'd also like Pro" box. It posts to `POST /api/subscribe`. `/subscribe/` is the plans page
   (Free and Pro) and links to it; its "ask for Pro" link opens `/signup/?pro=1` with the box ticked.
   - The endpoint checks the address, stores a `pending` record with a random token and sends a confirmation email.
   - **One inbox, one subscriber.** The record id is made from the address as the inbox sees it
     (`canonicalEmail()`): Gmail ignores dots and anything after `+`, and `googlemail.com` is `gmail.com`; Outlook,
     Hotmail, Live, MSN, iCloud, Proton and Fastmail ignore anything after `+`. Other domains are left as typed. So
     `a.b+news@gmail.com` finds the record for `ab@gmail.com`.
   - **An address that is already confirmed is told so.** With sign-in set up (`SESSION_SECRET`), the stored
     address gets a **sign-in link** ("This address already has an account. We've emailed it a sign-in link"), on
     the sign-in email limits: one every 5 minutes, `MAX_SIGNINS_PER_DAY` a day. Held back by either, the reply says
     to sign in from the sign-in page or use the Manage link in any digest.
   - Without `SESSION_SECRET`, it gets one email with its manage and unsubscribe links instead ("This address is
     already subscribed"), at most once every 24 hours. Those emails share `MAX_CONFIRMS_PER_DAY` with confirmation
     emails; with the cap reached, or within 24 hours of the last one, the reply says to use the Manage link in any
     digest instead.
   - Either way this shows whether an address subscribes; the owner chose that on 2026-10-22 (decision log).
   - **A pending address whose confirmation went out in the last 10 minutes** is told so, and to ask again after
     10 minutes; nothing is sent. After that it gets the same link again. One pending address gets at most 5
     confirmation emails (`confirmSends` on the record); after that the reply says a link was already sent several
     times. Asking to sign in at `/signin/` with a pending address re-sends the confirmation on the same limits
     (10 minutes apart, 5 per address, within `MAX_CONFIRMS_PER_DAY`), with the usual sign-in reply.
   - Every other accepted request gets the same reply ("If that address can be subscribed, a confirmation link is
     on its way"), so a full list, a closed list, the day's confirmation cap and the per-IP limit look alike.
   - A filled trap field gets that same reply and does nothing.
2. **Confirm.** The email links to `/api/confirm?id=<record id>&t=<token>`. `GET` shows a page with a **Confirm**
   button; only the `POST` from that button confirms (decision D9), so a mail scanner that opens links can't confirm
   anyone. Confirming sets `status: "active"`. A record not confirmed within 7 days is deleted by the next sweep.
3. **Receive.** After each saved sweep (see Sending).
4. **Manage.** Every email links to `/manage/?id=…&t=…`, which shows the plan and has a **Request Pro** button
   (through `GET` and `POST /api/account`; it never returns the address).
5. **Unsubscribe.** Every email links to `/api/unsubscribe?id=…&t=…` and carries `List-Unsubscribe` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, so mail apps can offer one-click opt-out. `GET` shows
   a button; `POST` deletes a Free record. The address is gone, not just flagged. A Pro account (since T17) is kept
   with `emailOff: "unsubscribed"`: no more email, but the board and the account stay until the person presses
   **Delete my account** on `/manage/`, or turns emails back on there. Unsubscribe works even while subscriptions
   are switched off.

## Storage

One Blob file per subscriber, so two sign-ups at the same moment can't overwrite each other.

| Key | Holds |
|---|---|
| `radar:sub:<sha256 of the canonical address>` | `{ v, id, email, status: "pending" or "active", plan: "free" or "pro", proUntil, proSource, token, createdAt, confirmSentAt, confirmedAt, noticeSentAt, proRequestedAt, cats, rzp }`, plus `signin` and `sessionVer` (T16) and `emailOff` (T17) |
| `radar:event:<YYYYMMDD>-<HHMMSSmmm>-<type>-<6 hex>` | One event (`subscribed`, `confirmsent`, `noticesent`, `confirmed`, `unsubscribed`, `expired`, `progranted`, `prorevoked`, `prorequested`, `emailoff` and `deleted` (T17), and `bounced` and `complained` from the Resend webhook): type, time and plan. No address and no id, so the counts survive a deletion |
| `radar:deliveries:<YYYYMMDD>` | The record ids already sent that day's Free digest. Written only by the sweep; deleted after 7 days |
| `radar:subscriberCount` | Pending plus active records at the last saved sweep, which the sign-up cap reads |
| `radar:iphit:<YYYYMMDDHH>-<16 hex of sha256 of the IP>-<6 hex>` | One sign-up attempt, for the per-IP limit (T13). No raw IP. Deleted by the sweep after 2 hours |

Notes:
- `status` and `plan` are separate fields because a paid plan can end while the address stays confirmed.
  `effectivePlan()` in `api/_lib/subscribers.js` treats anything but a confirmed Pro record with a future (or no)
  `proUntil` as Free.
- Links carry the record id as well as the token, so finding the record is one read, not a scan of every file.
- Records made before 2026-10-22 have an id from the address only trimmed and lowercased, and their links carry it.
  They keep it: `findSubscriber()` tries the canonical id, then that older one. Sign-up, the Resend webhook and the
  admin script all look addresses up this way.
- Tokens are 32 random bytes, stored on the record and compared in constant time. No `UNSUBSCRIBE_SECRET` is needed.
- `blobStorage()` in `api/_lib/storage.js` gained `list(prefix)`. Its reads skip Blob's CDN cache (`useCache: false`)
  because a read-change-write on a minute-old copy would undo a recent change; only `/api/data` reads the cached copy.

## Sending

`deliverToSubscribers()` in `api/_lib/subscriber-delivery.js`, called from the sweep handler after the owner's
Slack and email and only when the sweep saved. The owner's `EMAIL_TO` path is unchanged.

- **Pro subscribers:** the sweep's own digest after every saved **scheduled** sweep, including sweeps with nothing
  new (D5). Manual runs send Pro nothing (D4). Pro is granted by the owner with `scripts/subscribers.mjs grant-pro`
  until payments exist (D1).
- **Free subscribers:** one email per UTC day, after the first saved sweep of that day (normally 00:17 UTC, about
  05:47 IST; D3). It is a **roll-up** of every item saved in the 24 hours before it, one copy per item, with New flags
  kept (D2). While the board is locked (`BOARD_PAYWALL=1`, on since 2026-10-23) it is a **summary** (T18): the count
  and the headlines per category, with a sign-in link instead of detail and sources.
- Each person gets their own copy with their own links (never everyone on one To line), sent through Resend's batch
  endpoint, up to 100 per call.
- **Resuming:** the ids sent are written to `radar:deliveries:<day>` after each batch, so a send cut off by the
  240-second deadline or the quota picks up at the next sweep without sending anyone the same day's digest twice.
- **Order:** the owner's email goes first, so if Resend's daily quota runs out it is subscriber mail that stops.
- **One switch:** `SUBSCRIPTIONS_ENABLED=1` turns sign-up and delivery on together. Unset, sign-up answers `503`
  and the sweep reply says `"subscribers": "not configured"`.
- **The cap:** `MAX_SUBSCRIBERS`. Unset means not set up: no number is assumed, and sign-up answers `503` "subscriptions are not open yet" for every address. Production uses 5000 (D7), but Resend's
  free plan fits only about 90 Free subscribers (the quota formula in [pricing.md](pricing.md)).
- A failure never fails the sweep, and the reply's `subscribers` field holds counts only.

## Guardrails

| Risk | Guardrail |
|---|---|
| Someone signs up another person | Double opt-in by button; nothing is sent after the one confirmation email until confirmed |
| Confirmation emails used to spam an address | At most 5 confirmations per pending address, 10 minutes apart, and one already-subscribed email per address per 24 hours; variants of one inbox count as one address. `MAX_CONFIRMS_PER_DAY` (default 10) caps both kinds together across all addresses. At most `MAX_SIGNUPS_PER_IP_HOUR` (default 5) sign-ups per connection per hour, with a Vercel Firewall rate limit (5 per 10 minutes, `429`) in front so a flood costs no Blob operations (T13) |
| Bots | The trap field. A CAPTCHA only if bots appear |
| Addresses leak in logs | The sweep reply, which the public GitHub Actions log prints, gets **counts only**. Error text is cleaned of anything that looks like an address, id or token |
| Subscriber data read through the public feed | `ALLOWED_KEY` in `api/_lib/handlers.js` only allows history and sweep keys; tests check that every subscriber key is refused |
| A link guessed | 32-byte random tokens, compared in constant time; an unknown id and a wrong token get the same answer |
| Spam complaints and bounces | One-click unsubscribe, a visible sender name, at most one Free email a day. A complaint or a hard bounce deletes a Free address, through Resend's signed webhook (`/api/resend-webhook`, T13); a Pro account is kept with its emails off (T17) |
| Privacy | The sign-up page says what is stored (the address, the dates, whether Pro was asked for) and that unsubscribing deletes it, with a contact address for deletion requests. Advice on India's DPDP Act: not recorded as done |

## Tests

`scripts/test-subscriptions.mjs` (offline, with a fake Resend `fetch` and an in-memory store) covers: the same
reply for new, pending and trap sign-ups; the already-subscribed reply and email; address variants and records made
before canonical ids; the caps; confirm and unsubscribe with right and wrong tokens; one-click
unsubscribe; Pro every scheduled sweep and Free once a day; the roll-up; quota and deadline stops and resuming; no
address in any reply; `/api/data` refusing subscriber keys; the manage endpoint and Request Pro; and the admin script.
`scripts/check.mjs` checks the sign-up and manage pages (self-contained, the privacy note, the contact address, the
build step).

## Still open

- The launch checks in [T12](tasks/T12-docs-and-launch.md): Gmail's one-click Unsubscribe, a second mail provider
  (Outlook), and confirmation emails reaching the inbox rather than spam.
- Category choice: not in the first release (D6); Pro only, later ([T14](tasks/T14-optional-pro-categories.md)).
