# Free email sign-up: design

> **Draft design, nothing here is built.** Written on 21 Oct 2026 from the current code. External service behaviour
> (Resend headers, batch limits, Blob listing) is marked **verify at build time**. The picture of how this connects to
> the rest: [architecture.md](architecture.md), diagrams A to C and E.

## Goal

Let a visitor subscribe to the digest by email, so they get it without opening the board. Free, no account, no
password.

## Blocker: a verified domain

Today's shared sender (`onboarding@resend.dev`) delivers only to the address the Resend account was created with
(DEPLOYMENT.md, "Sending email"). Nothing in this design works for other people until a domain is verified in
Resend and `EMAIL_FROM` is set to a sender on it. `sendEmail()` in `api/_lib/email.js` already reads `EMAIL_FROM`.

Until then, build and test offline; leave the sign-up page off the live site.

## Flow

1. **Subscribe.** `/subscribe/` is a plain page with an email field and a hidden honeypot field. It posts to
   `POST /api/subscribe`.
   - The endpoint validates the address, stores a `pending` record with a random token and sends a confirmation
     email.
   - **Every request gets the same reply** ("If that address is new, we sent a confirmation link"), so the endpoint
     never reveals who is already subscribed.
   - A filled honeypot gets the same reply and does nothing.
2. **Confirm.** The email links to `GET /api/confirm?token=...`. That sets the record to `free` and shows a short
   page. Anything not confirmed within 7 days is deleted by the next sweep.
3. **Receive.** After each saved sweep, subscribers get a digest (see Sending).
4. **Unsubscribe.** Every digest has a link to `/api/unsubscribe?token=...`, and carries `List-Unsubscribe` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers so mail apps can offer one-click opt-out (**verify at
   build time** that Resend passes custom `headers`). `GET` shows a confirm button; `POST` deletes the record. The
   address is gone, not just flagged.

## Storage

One Blob file per subscriber, so two sign-ups at the same moment cannot overwrite each other (a single shared list
file could lose one).

| Key | Holds |
|---|---|
| `radar:sub:<sha256 of the lowercased address>` | `{ email, status: "pending" or "free" or "pro", cats, token, createdAt, confirmedAt, lastEmailedAt }` |
| `radar:lastFreeDigestAt` | The UTC date of the last free digest, so the free list is emailed once per day |

Implementation notes:
- `blobStorage()` in `api/_lib/storage.js` has `get`, `set` and `del` only. It needs a `list(prefix)`. `@vercel/blob`
  2.8.2 exports `list` (**verify the paging options at build time**). The in-memory test store in
  `scripts/test-sweep.mjs` needs the same method.
- Hashing the address gives a fixed-length key with no special characters. Store the plain address inside the record,
  because it is needed to send the email.
- Store a random token per subscriber and compare it with `timingSafeEqual`, as `bearerOk()` does for the sweep secret.
  If links should expire, derive them from `UNSUBSCRIBE_SECRET` with an HMAC instead.

## Sending

Hook into `makeSweepHandler` in `api/_lib/handlers.js`, after the owner's `deliver()` call and only when the sweep
saved. The owner's `EMAIL_TO` path stays exactly as it is.

- **Pro subscribers:** a digest after every saved sweep.
- **Free subscribers:** one digest per UTC day, sent after the first saved sweep of that day, tracked by
  `radar:lastFreeDigestAt`.
- **Build the message once** with `buildDigestEmail()`, then add each recipient's own unsubscribe link and send each
  person their own copy (not one email with everyone on the To line, which would expose addresses). Use Resend's batch
  endpoint to cut requests (**verify at build time** its per-call size limit).
- **Respect the cap:** `MAX_SUBSCRIBERS`, kept below the quota formula in [pricing.md](pricing.md). When the list is
  full, `POST /api/subscribe` still gives the same reply but stores nothing.
- The sweep must still finish inside its 300-second limit. Sending is after the save, a failure never fails the sweep,
  and a send that is cut off is retried at the next sweep for anyone not yet emailed that day.

## Guardrails

| Risk | Guardrail |
|---|---|
| Someone signs up another person | Double opt-in; nothing is sent after the one confirmation email until confirmed |
| Confirmation emails used to spam an address | At most one confirmation per address per 24 hours; a per-IP limit if abuse appears |
| Bots | Honeypot field. Add a CAPTCHA only if bots appear. |
| Addresses leak in logs | The sweep reply, which the public GitHub Actions log prints, gets **counts only** (for example `subscribers: { sent: 12, failed: 1 }`), never addresses or Resend messages. This follows the rule already used for `email`. |
| Subscriber data read through the public feed | `ALLOWED_KEY` in `api/_lib/handlers.js` only allows history and sweep keys; add a test that `radar:sub:...` is refused |
| Unsubscribe link guessed | Long random tokens, compared in constant time |
| Spam complaints | One-click unsubscribe, a visible sender name, a daily cap on free digests |
| Privacy | A short notice on the page saying what is stored (the address and the dates) and that unsubscribing deletes it. Get advice on India's DPDP Act before launch. |

## Changes needed when it is built

- **New files:** `api/subscribe.js`, `api/confirm.js`, `api/unsubscribe.js`, `api/_lib/subscribers.js` (storage and
  token logic), `subscribe/index.html`.
- **Edited files:** `api/_lib/storage.js` (`list`), `api/_lib/handlers.js` (send after the owner), `api/_lib/email.js`
  (a per-recipient digest and the confirmation email), `vercel.json` (add `subscribe` to the `buildCommand` copy
  step), `live/index.html` and `index.html` (links to the sign-up page).
- **New variables:** `SITE_URL` (for links in emails), `MAX_SUBSCRIBERS`, and `UNSUBSCRIBE_SECRET` if tokens are
  derived. All Production only; the secret marked Sensitive.
- **Docs:** a section in DEPLOYMENT.md, a row in the decision log, a line in the README.

## Test plan

Added to `scripts/test-sweep.mjs` (offline, with a fake Resend `fetch`), in the same style as the existing cases:

- Subscribe stores a pending record and sends one confirmation; the reply is identical for a new and an existing
  address; a filled honeypot sends nothing.
- Confirm with the right token activates; a wrong or missing token does nothing.
- Unsubscribe deletes the record; a wrong token does not.
- A saved sweep emails Pro subscribers every time and free subscribers once per UTC day; a skipped call and a failed
  sweep email no subscribers.
- A failing send for one subscriber does not stop the others or the sweep.
- The sweep reply contains no address.
- `/api/data` refuses `radar:sub:` keys.
- With `MAX_SUBSCRIBERS` reached, nothing new is stored.

Added to `scripts/check.mjs`: the sign-up page exists and links resolve, and the secret scan still passes.

## Open questions (OWNER INPUT NEEDED)

1. Which domain and sender name, for example `Travel Problem Radar <radar@yourdomain>`.
2. The free digest time: "first saved sweep of the UTC day" is about 05:47 IST. Is that the right moment?
3. Should subscribers choose categories from the start, or only on Pro?
4. The cap on free subscribers.
