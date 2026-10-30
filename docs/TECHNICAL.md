# Travel Problem Radar: technical reference

How the three versions run, how the live page works, what each file is, and how to rebuild. The product story is
in the [README](../README.md).

## Three ways it runs

| | In Claude's app | Public demo | Live page (Vercel) |
|---|---|---|---|
| Where it runs | Inside Claude's app, as an artifact | GitHub Pages, any browser | Vercel, any browser |
| What a sweep does | 4 real web-search calls to Claude | Replays the 8 saved items in `sampleData.json` | A server job makes the 4 web-search calls 1 to 5 times a day |
| Who triggers it | You, with a button | You, with a button (replay only) | A GitHub Actions schedule (plus Vercel's daily cron as a backstop); visitors can't trigger it |
| AI or API calls | Yes, through Claude's app | None | 1 to 5 sweeps a day, whatever the traffic |
| History is saved in | Claude's artifact storage | This browser's localStorage | A private Vercel Blob store |
| Digest | A scheduled task in Claude posts it to Slack | The "Sample digest" view | The page itself; optionally posted to Slack and emailed to the owner after each sweep; anyone can subscribe by email at `/subscribe/` (Free: one a day; Pro: every scheduled sweep) |
| Status | Owner-reported working | Verified | Deployed; first production sweep saved 1 of 4 categories (token limit, since fixed and tested locally) |

All three use the same component, [`travel-problem-radar.jsx`](../travel-problem-radar.jsx). With no props it
runs inside Claude's app; with `sample={...}` it replays the sample; with `remote="/api/data"` it shows the
latest saved sweep read-only. It can't run live on a plain website by itself: it calls the Anthropic API
from the browser without a key, which only works inside Claude's app. That is why the live page uses a server.

## Live page: how it works and what it needs

```
GitHub Actions, every 5 hours (00:17, 05:17, 10:17, 15:17, 20:17 UTC); a slot no Pro member needs is
  skipped before any Claude call (T32)
  + Vercel cron, once a day (01:30 UTC), as a backstop
  -> /api/sweep   (refuses calls without the secret; each slot sweeps once, counted as the slot the
                   GitHub run was due for even when it starts late (T35); a manual call always runs)
       4 Claude calls with web search, one per category, same prompts as the component
       merge, de-duplicate, flag "New", keep the last 60 sweeps -> private Vercel Blob store
       then post the digest (or a failure notice) to Slack and by email, for each one that is set up;
       a category that failed is flagged FAILED there, with its error, and never shown to subscribers
       then, if subscriptions are on, email subscribers: Pro at the slots of their 1 to 5 a day, Free once a UTC day
Visitor -> /live/ -> /api/data (read-only, cached) -> same dashboard, no sweep button
Visitor -> /subscribe/ -> /api/subscribe -> confirmation email -> /api/confirm (Confirm button) -> active
Subscriber -> links in each email -> /manage/ (/api/account: plan, Request Pro or Upgrade, cancel) or /api/unsubscribe
```

- Visitors only read the saved result and never trigger an AI call, so cost is 1 to 5 sweeps a day (at most about $1 a day at the measured ~$0.21 a sweep).
- **Sweeps a day (T32).** Each Pro member chooses 1 to 5 emails a day on `/manage/` (default 2). The site sweeps as
  often as the highest choice, between `SWEEPS_PER_DAY_MIN` and `SWEEPS_PER_DAY_MAX`; with no Pro members, once a day.
  The slots are nested (1: 00; 2: + 10; 3: + 15; 4: + 05; 5: + 20 UTC), so one sweep serves every choice. The GitHub
  schedule can't change itself, so it keeps firing and an unneeded slot answers `skipped`. Each Pro email rolls up
  every sweep since that member's previous slot. Details: [DEPLOYMENT.md](../DEPLOYMENT.md#sweeps-a-day-t32).
- If every category fails, nothing is saved and the run shows as failed. If some fail, the rest are saved.
- **Item history (T36).** The sweep keeps a private index of every item it has seen (`radar:items`: first sweep,
  count, latest sweep ids) and saves each item with `firstAt`, `seen` and `prev`, so the board's Details panel shows
  "First seen … · in N sweeps" from the sweep it already loaded. `trackItems` is the same text in the server and the
  component, and `npm run check` fails if they differ. A failed read or write of the index never fails the sweep.
- **Areas (T37).** The board filters by a fixed list of areas (Global, Asia, Europe, North America, Latin America,
  Middle East & Africa, Oceania, Other). `areaOf` places the AI's free-text `region` in one from a name table;
  text that names two or more areas counts as Global, and text it can't place as Other. The area is worked out
  when needed, never stored, so `/api/data` is unchanged. The block is the same text in the server and the
  component, and `npm run check` fails if they differ.
- **Search all sweeps (T38).** Beside the board's search box, "This sweep" or "All saved sweeps". All reads one
  search file (`radar:search`) that the sweep keeps: the latest copy of each item in the kept sweeps, with its
  sweep's id and time. `mergeSearch` is the same text in the server and the component, and `npm run check` fails
  if they differ. One file instead of up to 60 sweep reads keeps a search at two Blob reads (the session and the
  file), within the Hobby plan's 10,000 simple operations a month. Kept sweeps the file lacks are counted on the
  board. A failed read or write never fails the sweep.
- **Filters in the URL (T38).** The board reads `?q=`, `?cat=`, `?area=` and `?all=1` on load and writes them with
  `history.replaceState` on every change; unknown values are dropped and the hash (`#report`, `#p=`) is kept. On a
  locked screen the search is kept in `sessionStorage` for 30 minutes, so `/live/` puts it back after sign-in. The
  home page's search box is a plain GET form to `live/?q=…&all=1`.
- **Saved problems (T39).** A Pro member's star on a card or in the panel calls `/api/account` (`save` with the
  sweep id and item id, `unsave`, `GET ?action=saved`). The server copies the item from the sweep file itself, so
  nothing the browser sends ends up in the copy, and keeps at most 100 on the account record (`saved`), newest
  first. Changes go through `updateSubscriber`'s conditional write, so two tabs can't undo each other. The copy
  has no history fields, so it outlives the sweep trim. Free gets `402`; a lapsed Pro keeps the list and can only
  unsave. The board's fourth tab, Saved, shows the copies; the demo keeps its own in browser storage. Each save
  or unsave is one Blob write, an advanced operation, and the sweeps already use most of the Hobby plan's 2,000 a
  month (see the T39 task file).
- **Share one problem (T40).** Share in the panel links to `/p/<sweepId>/<itemId>`, which `vercel.json` rewrites to
  `/api/data?page=item`, so there's no new function. The ids are checked before anything is read; then one sweep
  read finds the item (`404` if it's gone). The page is written on the server with `sendPage`: the teaser fields
  for everyone, the summary, opportunity and source for a signed-in Pro. The Open Graph and Twitter tags carry only
  the teaser fields, with `og.png` as the image, so a link preview is the same for everyone. `noindex` and
  `no-store`. On a phone Share opens the share sheet; elsewhere it copies the link.
- **Areas in the Pro email (T41).** `areas` on the record (`null` for all), checked by `normaliseAreas` against
  T37's areas without Global, and saved with `set-plan` or `set-areas` (Pro only, `403 pro_only` otherwise).
  Delivery groups Pro members by `cats|areas|f` and keeps a problem when `areaOf(region)` is Global or chosen. With
  all areas the email and its idempotency key are byte for byte what they were before; otherwise the key gets
  `-a-<areas>` and the email a "Your areas" line.

- The API key is held as a Vercel secret, never in the page or the code.
- Items are AI-gathered and not verified; the page tells visitors to check each source link.

**To run your own copy** (owner steps, not done by this repo):

1. Import the repo into Vercel and connect a Blob store (included on the free plan at the time of setup).
2. Add `CRON_SECRET` (any long random string) and `ANTHROPIC_API_KEY` as secret environment variables.
   Add the same `CRON_SECRET` as a GitHub Actions repository secret, for the 5-hour schedule.
3. Set a monthly spend limit in the Anthropic Console. That is the real cost cap.
4. Optional: `RADAR_MODEL` to choose the model (default `claude-haiku-5-5`).
5. Optional: `SLACK_WEBHOOK_URL` (a Slack incoming webhook) to post each sweep's digest to a channel.
6. Optional: `RESEND_API_KEY` and `EMAIL_TO` to email each sweep's digest through Resend. No domain is needed:
   it sends from Resend's shared address, which delivers only to the Resend account's own email.
7. Optional: subscriber email. Needs a domain verified in Resend, `EMAIL_FROM` on it, `MAX_SUBSCRIBERS` and
   `SUBSCRIPTIONS_ENABLED=1`. See [DEPLOYMENT.md, "Subscriber email"](../DEPLOYMENT.md#subscriber-email-optional).

Full deployment steps are in [DEPLOYMENT.md](../DEPLOYMENT.md).

Slack posting from Vercel is covered by the offline tests but has not yet been tried against a real Slack workspace.
Email has been sent through a real Resend account since 21 Oct 2026, from the verified domain
`pehchanthetraveller.com`. Both are separate from the Slack digest set up in Claude's app.

## Files

| File | What it is |
|---|---|
| `index.html` | The case-study page (served by GitHub Pages) |
| `demo/` | The demo page; `demo/radar.js` is built from the component and the sample |
| `live/` | The live page; `live/radar-live.js` is built from the component |
| `subscribe/` | The sign-up page (one self-contained file); posts to `/api/subscribe` |
| `manage/` | A subscriber's own page, reached from the link in each email or signed in: plan, and one plan card (T33) for categories, emails a day and monthly or yearly, priced from `plan.json`. Free opens it with Request Pro (payments off) or Upgrade to Pro, then Pay with Razorpay (T20); Pro saves changes to it. Cancel, unsubscribe |
| `api/sweep.js` | Scheduled job: runs the 4 searches, saves the result, then sends the owner's and subscribers' email (needs a secret to call) |
| `api/data.js` | Read-only feed the live page uses (allow-listed keys only) |
| `api/subscribe.js`, `api/confirm.js`, `api/unsubscribe.js`, `api/account.js` | Sign-up, the Confirm button, unsubscribe (also one-click from mail apps), and the manage page's data and actions: Request Pro (with the chosen plan), set-plan, and checkout (with the chosen plan), checkout-return and cancel when payments are on |
| `api/resend-webhook.js` | Resend's signed bounce and complaint events: a hard bounce or a spam complaint deletes the address |
| `api/razorpay-webhook.js` | Razorpay's signed subscription events (T21): activated or charged makes the account Pro until the paid period ends; halted makes a paid Pro Free; cancelled lets it run out. Duplicates and out-of-order events change nothing |
| `api/_lib/radar.js`, `handlers.js` | Sweep logic and the sweep and data handlers |
| `api/_lib/storage.js` | The private Blob store: `get`, `set`, `del`, `list`; reads skip Blob's CDN cache except for `/api/data` |
| `api/_lib/slack.js`, `email.js` | The Slack post; every email (owner digest, subscriber digest, confirmation, Pro request) and Resend sending |
| `api/_lib/http.js` | Shared request helpers: allowed methods, body reading with a size limit, JSON and HTML replies |
| `api/_lib/subscribers.js` | Subscriber records, tokens, plans and event records |
| `api/_lib/subscription-handlers.js` | The four subscriber endpoints, the per-IP sign-up limit and the Resend webhook |
| `api/_lib/subscriber-delivery.js` | After a saved sweep: Pro and Free sends, the 24-hour roll-up, resuming a cut-off send |
| `api/_lib/plan.js` | Pro's price from `plan.json` (T33): one plan, a `monthly` and a `yearly` price; the periods on sale; and `RAZORPAY_PLANS` (one ₹1 Razorpay plan per period; a subscription's quantity is the price). Used by `/api/account`, `fill-plan` and `check-plan` |
| `api/_lib/razorpay.js` | Razorpay for paid Pro (T19): create, cancel and fetch a subscription, and the webhook and Checkout signature checks. Used by `/api/account`'s checkout, checkout-return and cancel (T20) |
| `vercel.json` | Daily backstop cron (01:30 UTC), 300 s limit, build that publishes `index.html`, `demo/`, `live/`, `subscribe/`, `manage/`; the `/p/<sweep>/<item>` rewrite to `/api/data` (T40) |
| `og.png`, `scripts/og-card.html` | The link-preview image (1200×630) and the page it was rendered from (T40) |
| `travel-problem-radar.jsx` | The dashboard component (live in Claude's app, demo on the web) |
| `sampleData.json` | 8 saved items, two per category, each with a source link |
| `scripts/check.mjs` | Offline checks: sample data, page links, bundles, the subscribe and manage pages, prompt drift, secrets (Razorpay key secrets too), Hobby's 12-function limit |
| `scripts/subscribers.mjs` | Owner admin tool, run on your own machine: `stats`, `list`, `show`, `grant-pro`, `revoke-pro`, `delete`, `prune-events`, `recount`. Not deployed |
| `scripts/llm-logs.mjs` | Owner tool, run on your own machine: `list`, `summary`, `show` for the LLM logs each sweep saves in the Blob store (requests, responses, tokens, page links; kept 30 days). Read-only, not deployed |
| `.github/workflows/sweep.yml` | Calls `/api/sweep` every 5 hours (the sweep skips slots nobody needs), and on demand from the Actions tab |
| `scripts/test-sweep.mjs` | Offline tests for the sweep, the Slack post, the email and the data feed (no network, no key) |
| `scripts/test-subscriptions.mjs` | Offline tests for the subscriber features: storage, records, emails, every endpoint (the Resend webhook's signature check too), the per-IP limit, delivery, the sweep wiring and the admin script (fake Resend, no network) |
| `scripts/test-helpers.mjs` | Shared by both test files: PASS/FAIL printer, in-memory store, fake response |

## Rebuild the demo and live page

Needs Node.js 18 or later.

```bash
npm install
npm run build   # rebuilds demo/radar.js and live/radar-live.js from the component
npm run check
npm test        # sweep, data-feed and subscriber tests, no key needed
```

Commit both bundles after rebuilding; GitHub Pages serves them as is, and CI fails if either is stale.
