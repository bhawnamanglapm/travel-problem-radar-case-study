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

1. **Subscribe.** `/subscribe/` is a self-contained page with an email field, a hidden trap field for bots, and an
   "I'd also like Pro" box. It posts to `POST /api/subscribe`.
   - The endpoint checks the address, stores a `pending` record with a random token and sends a confirmation email.
   - **Every accepted request gets the same reply** ("If that address can be subscribed, a confirmation link is on
     its way"), so the endpoint never reveals who is already subscribed, whether the list is full, or whether a
     limit was hit.
   - A filled trap field gets the same reply and does nothing.
2. **Confirm.** The email links to `/api/confirm?id=<record id>&t=<token>`. `GET` shows a page with a **Confirm**
   button; only the `POST` from that button confirms (decision D9), so a mail scanner that opens links can't confirm
   anyone. Confirming sets `status: "active"`. A record not confirmed within 7 days is deleted by the next sweep.
3. **Receive.** After each saved sweep (see Sending).
4. **Manage.** Every email links to `/manage/?id=…&t=…`, which shows the plan and has a **Request Pro** button
   (through `GET` and `POST /api/account`; it never returns the address).
5. **Unsubscribe.** Every email links to `/api/unsubscribe?id=…&t=…` and carries `List-Unsubscribe` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, so mail apps can offer one-click opt-out. `GET` shows
   a button; `POST` deletes the record. The address is gone, not just flagged. Unsubscribe works even while
   subscriptions are switched off.

## Storage

One Blob file per subscriber, so two sign-ups at the same moment can't overwrite each other.

| Key | Holds |
|---|---|
| `radar:sub:<sha256 of the lowercased address>` | `{ v, id, email, status: "pending" or "active", plan: "free" or "pro", proUntil, proSource, token, createdAt, confirmSentAt, confirmedAt, proRequestedAt, cats, rzp }` |
| `radar:event:<YYYYMMDD>-<HHMMSSmmm>-<type>-<6 hex>` | One event (`subscribed`, `confirmsent`, `confirmed`, `unsubscribed`, `expired`, `progranted`, `prorevoked`, `prorequested`, and `bounced` and `complained` reserved): type, time and plan. No address and no id, so the counts survive a deletion |
| `radar:deliveries:<YYYYMMDD>` | The record ids already sent that day's Free digest. Written only by the sweep; deleted after 7 days |
| `radar:subscriberCount` | Pending plus active records at the last saved sweep, which the sign-up cap reads |

Notes:
- `status` and `plan` are separate fields because a paid plan can end while the address stays confirmed.
  `effectivePlan()` in `api/_lib/subscribers.js` treats anything but a confirmed Pro record with a future (or no)
  `proUntil` as Free.
- Links carry the record id as well as the token, so finding the record is one read, not a scan of every file.
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
  kept (D2).
- Each person gets their own copy with their own links (never everyone on one To line), sent through Resend's batch
  endpoint, up to 100 per call.
- **Resuming:** the ids sent are written to `radar:deliveries:<day>` after each batch, so a send cut off by the
  240-second deadline or the quota picks up at the next sweep without sending anyone the same day's digest twice.
- **Order:** the owner's email goes first, so if Resend's daily quota runs out it is subscriber mail that stops.
- **One switch:** `SUBSCRIPTIONS_ENABLED=1` turns sign-up and delivery on together. Unset, sign-up answers `503`
  and the sweep reply says `"subscribers": "not configured"`.
- **The cap:** `MAX_SUBSCRIBERS`. Unset means closed: no number is assumed. Production uses 5000 (D7), but Resend's
  free plan fits only about 90 Free subscribers (the quota formula in [pricing.md](pricing.md)).
- A failure never fails the sweep, and the reply's `subscribers` field holds counts only.

## Guardrails

| Risk | Guardrail |
|---|---|
| Someone signs up another person | Double opt-in by button; nothing is sent after the one confirmation email until confirmed |
| Confirmation emails used to spam an address | At most one confirmation per address per 24 hours, and `MAX_CONFIRMS_PER_DAY` (default 10) across all addresses. A per-IP limit only if abuse appears (T13) |
| Bots | The trap field. A CAPTCHA only if bots appear |
| Addresses leak in logs | The sweep reply, which the public GitHub Actions log prints, gets **counts only**. Error text is cleaned of anything that looks like an address, id or token |
| Subscriber data read through the public feed | `ALLOWED_KEY` in `api/_lib/handlers.js` only allows history and sweep keys; tests check that every subscriber key is refused |
| A link guessed | 32-byte random tokens, compared in constant time; an unknown id and a wrong token get the same answer |
| Spam complaints | One-click unsubscribe, a visible sender name, at most one Free email a day |
| Privacy | The sign-up page says what is stored (the address, the dates, whether Pro was asked for) and that unsubscribing deletes it, with a contact address for deletion requests. Advice on India's DPDP Act: not recorded as done |

## Tests

`scripts/test-subscriptions.mjs` (offline, with a fake Resend `fetch` and an in-memory store) covers: identical
replies for new, existing and trap sign-ups; the caps; confirm and unsubscribe with right and wrong tokens; one-click
unsubscribe; Pro every scheduled sweep and Free once a day; the roll-up; quota and deadline stops and resuming; no
address in any reply; `/api/data` refusing subscriber keys; the manage endpoint and Request Pro; and the admin script.
`scripts/check.mjs` checks the sign-up and manage pages (self-contained, the privacy note, the contact address, the
build step).

## Still open

- The launch checks in [T12](tasks/T12-docs-and-launch.md): Gmail's one-click Unsubscribe, a second mail provider
  (Outlook), and confirmation emails reaching the inbox rather than spam.
- Category choice: not in the first release (D6); Pro only, later ([T14](tasks/T14-optional-pro-categories.md)).
