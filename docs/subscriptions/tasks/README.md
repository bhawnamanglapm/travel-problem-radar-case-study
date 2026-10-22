# Subscription tasks: Free and Pro email digests

> **Implementation backlog, nothing here is built yet.** Written on 21 Oct 2026 from the current code (`api/_lib/`,
> `scripts/`, `vercel.json`, `.github/workflows/`) and the draft designs in this folder's parent:
> [architecture.md](../architecture.md), [email-signup.md](../email-signup.md), [pricing.md](../pricing.md),
> [payments-razorpay.md](../payments-razorpay.md). Anything that depends on an outside service's current behaviour
> (Resend, Vercel Blob, Vercel limits, Razorpay) is marked **verify at build time**. Sizes are rough guesses, not
> measurements.

> **Changed 2026-10-22:** Pro now pays for the live board on the website, not for email
> ([paid-website.md](../paid-website.md)). T16 to T18 add accounts, sign-in, the locked board and the teaser email;
> T20 now also needs T16.
>
> **Renumbered 2026-10-22** so the numbers follow the build order. Was → now: T20 → T16, T21 → T17, T22 → T18,
> T16 → T19, T17 → T20, T18 → T21, T19 → T22. Merged PR titles and older CHANGELOG lines keep the old numbers.

## The requirement

People subscribe with an email address to get the digest by email. There are two plans:

| Plan | What they get | When |
|---|---|---|
| **Free** | One digest a day | After the first saved sweep of each UTC day (the 00:17 UTC run, about 05:47 IST, when GitHub starts it on time) |
| **Pro** | A digest every time the data updates | After every saved scheduled sweep, about 5 a day (every 5 hours from 00:17 UTC) |

The owner's own Slack post and `EMAIL_TO` email stay exactly as they are today.

## How the work is split

The work is in three phases. Each phase ships on its own and leaves the site working.

```mermaid
flowchart TD
  T00["T00 Owner: domain, sender, decisions"]
  subgraph P1A["Phase 1a: foundations"]
    T01["T01 Storage list() + test helpers"]
    T02["T02 Subscriber records module"]
    T03["T03 HTTP helpers"]
    T04["T04 Email builders + batch send"]
  end
  subgraph P1B["Phase 1b: sign-up flow"]
    T05["T05 POST /api/subscribe"]
    T06["T06 /api/confirm"]
    T07["T07 /api/unsubscribe"]
    T08["T08 /subscribe/ page, links, build"]
  end
  subgraph P1C["Phase 1c: delivery"]
    T09["T09 Delivery engine (Free daily, Pro every sweep)"]
    T10["T10 Wire delivery into the sweep"]
  end
  subgraph P1D["Phase 1d: operate and launch"]
    T11["T11 Owner admin script + metrics"]
    T12["T12 Docs, staged launch"]
    T13["T13 Optional: bounces, complaints, IP limit"]
    T14["T14 Optional: Pro category choice"]
  end
  subgraph P2A["Phase 2a: paid website"]
    T16["T16 Accounts and sign-in"]
    T17["T17 Locked board"]
    T18["T18 Free email becomes a teaser"]
  end
  subgraph P2["Phase 2: paid Pro (gated)"]
    T15["T15 Owner: gate review + accounts"]
    T19["T19 Razorpay library"]
    T20["T20 Manage page, checkout, cancel"]
    T21["T21 Razorpay webhook"]
    T22["T22 Pro lifecycle, go-live"]
  end
  T00 --> T04
  T01 --> T02
  T02 --> T05 & T06 & T07 & T09
  T03 --> T05 & T06 & T07
  T04 --> T05 & T09
  T05 & T06 & T07 --> T08
  T09 --> T10
  T10 --> T11 --> T12
  T12 --> T13 & T14
  T12 --> T15 --> T19 --> T20 & T21
  T20 & T21 --> T22
  T12 --> T16 --> T17 --> T18
  T16 --> T20
  T17 & T18 --> T22
```

**Pro before payments.** Phase 1 builds both plans. Until Phase 2, the owner grants Pro by hand with the admin
script (T11), for example to test users or early supporters. Phase 2 adds Razorpay so people can pay for Pro
themselves. It is built only if the Phase 1 numbers pass the owner's gate ([pricing.md](../pricing.md)).

## Task list

| ID | Task | Who | Size | Depends on |
|---|---|---|---|---|
| [T00](T00-owner-prerequisites.md) | Domain, sender and decisions | Owner | S | — |
| [T01](T01-storage-list.md) | Add `list(prefix)` to storage; share test helpers | Dev | S | — |
| [T02](T02-subscriber-records.md) | Subscriber records module (`api/_lib/subscribers.js`) | Dev | M | T01 |
| [T03](T03-http-helpers.md) | HTTP helpers: body reader, HTML pages, method checks | Dev | S | — |
| [T04](T04-email-builders.md) | Confirmation email, subscriber digest, batch sending | Dev | M | T00 (sender) |
| [T05](T05-api-subscribe.md) | `POST /api/subscribe` | Dev | M | T02, T03, T04 |
| [T06](T06-api-confirm.md) | `GET` and `POST /api/confirm` | Dev | S | T02, T03 |
| [T07](T07-api-unsubscribe.md) | `GET` and `POST /api/unsubscribe`, one-click | Dev | S | T02, T03 |
| [T08](T08-subscribe-page.md) | `/subscribe/` page, links, build step, checks | Dev | M | T05, T06, T07 |
| [T09](T09-delivery-engine.md) | Delivery engine: Free daily roll-up, Pro every sweep | Dev | L | T02, T04 |
| [T10](T10-sweep-integration.md) | Call delivery from the sweep handler | Dev | M | T09 |
| [T11](T11-admin-script-and-metrics.md) | Owner admin script, manual Pro, sign-up metrics | Dev | M | T10 |
| [T12](T12-docs-and-launch.md) | Docs and staged launch of Phase 1 | Dev + Owner | M | T11 |
| [T13](T13-optional-hardening.md) | Optional: bounces, complaints, per-IP limit | Dev | M | T12 |
| [T14](T14-optional-pro-categories.md) | Optional: Pro subscribers choose categories | Dev | M | T12 |
| [T15](T15-phase2-gate-and-accounts.md) | Phase 2 gate review and accounts | Owner | S | T12 + measuring period |
| [T16](T16-accounts-and-sign-in.md) | Accounts and sign-in: email link, login cookie, `/signin/` | Dev | L | T12 |
| [T17](T17-locked-board.md) | Locked board behind `BOARD_PAYWALL`; Pro survives unsubscribe | Dev | M | T16 |
| [T18](T18-teaser-email.md) | Free email becomes a teaser | Dev | S | T17 |
| [T19](T19-razorpay-library.md) | `api/_lib/razorpay.js`: signatures and API calls | Dev | M | T15 |
| [T20](T20-manage-page-and-checkout.md) | `/manage/` page, checkout, cancel | Dev | L | T16, T19 |
| [T21](T21-razorpay-webhook.md) | `POST /api/razorpay-webhook` | Dev | M | T19, T20 |
| [T22](T22-pro-lifecycle-and-go-live.md) | Pro expiry, paid unsubscribe, go-live | Dev + Owner | M | T17, T18, T20, T21 |

## Decisions to settle before or during the build (OWNER INPUT NEEDED)

Each row has a recommended default so work can start. The tasks are written for the default; the task named in the
last column says what changes if the owner picks otherwise. Record each final choice in T00.

| # | Question | Recommended default | Why | Affects |
|---|---|---|---|---|
| D1 | How does someone get Pro before payments exist? | The owner grants it with the admin script | No payment code to build or secure until demand is shown | T11 |
| D2 | What does the Free daily email contain? | A **roll-up** of every item saved in the last 24 hours, with New flags kept | With only the first sweep of the day, Free readers never see items found at 05:17–20:17 UTC, and their New flags are used up before the next morning | T09 |
| D3 | When does the Free email go out? | After the first saved sweep of the UTC day (00:17 UTC, about 05:47 IST) | Matches the existing schedule; no new timer | T09 |
| D4 | Do Pro subscribers get the owner's manual runs? | No, scheduled sweeps only | Manual runs are usually tests; each one would email paying users | T09 |
| D5 | Does Pro get an email when a sweep finds nothing new? | Yes, every saved scheduled sweep (as asked) | Matches "whenever data is updated". Option: skip when `newCount` is 0, to cut noise and complaints | T09 |
| D6 | Can subscribers choose categories? | Not in the first release; Pro only, later (T14). The owner picked T14 on 2026-10-22, and it is built | Keeps Phase 1 small | T14 |
| D7 | Cap on subscribers (`MAX_SUBSCRIBERS`) | No default: unset means sign-ups are closed. **Owner set `5000`** (above the free Resend quota; see T00) | The owner must set it from the quota formula in [pricing.md](../pricing.md) | T05 |
| D8 | Domain and sender name | Domain `pehchanthetraveller.com` (verified in Resend, DMARC set). Sender `hello@pehchanthetraveller.com` | Required: the shared Resend sender cannot reach other people | T00 |
| D9 | Confirm link: one click, or a page with a button? | A page with a **Confirm** button that posts | Mail security scanners open links in emails, which would confirm addresses nobody asked to subscribe | T06 |

## Where these tasks differ from the draft designs

The drafts were written before the code was read line by line. These changes fix problems found while writing the
tasks. T12 updates [email-signup.md](../email-signup.md) and [architecture.md](../architecture.md) to match.

| Draft said | Tasks do | Why |
|---|---|---|
| One `status` field: `pending`, `free` or `pro` | Two fields: `status` (`pending` or `active`) and `plan` (`free` or `pro`), with `proUntil` | A paid plan can expire or lapse while the address stays confirmed |
| Links carry `?token=...` only | Links carry `?id=<record id>&t=<token>` | Without the id, finding the record means reading every subscriber file |
| `radar:lastFreeDigestAt`, one marker for the day | `radar:deliveries:<YYYYMMDD>`, the list of record ids already sent today, written only by the sweep | A send cut off halfway can resume at the next sweep without double-sending, and user actions never overwrite it |
| Free gets the first sweep of the day | Free gets a 24-hour roll-up (D2) | See D2 |
| `UNSUBSCRIBE_SECRET` | Not needed | Tokens are random and stored on the record |
| No on/off switch | `SUBSCRIPTIONS_ENABLED` turns sign-up and delivery on together | Lets the code ship to production switched off, and gives a one-step way to stop all subscriber mail |
| Cap with no default | Unset `MAX_SUBSCRIBERS` means closed | Fails safe; no invented number |
| Sign-up metrics not designed | Event records with no addresses, `radar:event:...` (T11) | The Phase 2 gate needs sign-up, confirm and unsubscribe counts, and deleted records leave no trace |

## Rules every task follows

These come from how the current code already works. A task is not done until each one holds.

1. **No addresses, tokens or keys in any reply or log line.** The GitHub Actions job prints the `/api/sweep` reply
   in a public log. Subscriber results are counts only, the same rule `sendEmail()` already follows.
2. **The owner's delivery does not change.** `EMAIL_TO`, Slack and their existing tests stay as they are. All 68
   current tests must still pass.
3. **Subscriber work never fails or slows the sweep's save.** It runs after the save, never throws, and stops
   before the 300-second limit.
4. **Handlers take their dependencies as arguments** (`env`, `storage`, `fetchFn`, `now`, a random source), like
   `makeSweepHandler`, so the offline tests can run them with fakes.
5. **Tests are offline.** No network, no API key. New tests go in `scripts/test-subscriptions.mjs` (T01), run by
   `npm test`.
6. **Subscriber data stays private.** `/api/data` keeps serving history and sweep keys only; a test proves each new
   key prefix is refused.
7. **No new npm packages** unless the owner agrees. The current code uses plain `fetch` and `node:crypto`; keep it
   that way.
8. **Docs move with the code.** Each task lists the docs it touches. Claims stay evidence-based: "tested offline"
   until a real send is seen in an inbox.

## Definition of done for each task

- [ ] Code and tests written as the task describes; `npm run build && npm run check && npm test` passes
- [ ] Each acceptance criterion in the task is checked off
- [ ] Each **verify at build time** item is checked against the service's current docs, and the result noted in the
  pull request
- [ ] Docs listed in the task are updated
- [ ] One small commit or pull request per task, with a message that says what changed and why
