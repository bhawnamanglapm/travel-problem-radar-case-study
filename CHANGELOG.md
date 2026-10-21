# Changelog

Built from the git history. Dates are commit dates. The project has no version numbers or releases, so entries are
grouped by date.

## 2026-10-22

- **Bounces, spam complaints and a per-IP sign-up limit** (T13): a signed Resend webhook (`/api/resend-webhook`)
  deletes an address that hard-bounces or marks the digest as spam, and `/api/subscribe` takes at most 5 sign-ups per
  connection per hour (`MAX_SIGNUPS_PER_IP_HOUR`), with a Vercel Firewall rate limit in front. Tested offline (355
  subscriber tests); the webhook secret and the firewall rule are owner steps after merge.
- **Subscriber email is switched on in production** (built in T01 to T11, merged as #6): `/subscribe/` with double
  opt-in by a Confirm button, one-click unsubscribe, a Free daily roll-up of the last 24 hours, a Pro email after
  every scheduled sweep, sending that resumes without duplicates after a cut-off, and an owner admin script
  (`scripts/subscribers.mjs`). One switch, `SUBSCRIPTIONS_ENABLED`, turns it all off. Sends from the verified domain
  `pehchanthetraveller.com`. Tested offline (306 subscriber tests); launch checks in progress (T12).
- The sign-up page gives a real contact address (#7).
- "Request Pro": a box at sign-up and a button on the new `/manage/` page, which every email links to; the owner gets
  an email and grants Pro by hand (#8).
- Fixed: a change could look lost for about a minute, because Blob served a cached copy. Every read now skips that
  cache except the public data feed's (#9).
- The case study, the live board and the README link to the sign-up page (#10). GitHub Pages copies of `/subscribe/`,
  `/manage/` and `/live/` now send the visit to Vercel, since Pages has no `/api/`.
- Docs: a "Subscriber email" section in `DEPLOYMENT.md` (variables, stored keys, quota, turning it off,
  troubleshooting); `TECHNICAL.md`, the README, the subscription design docs and the decision log brought up to date.

## 2026-10-21

- Sweep now runs every 5 hours from GitHub Actions, with Vercel's daily cron kept as a backstop (`b691d54`).
- Fixed categories coming back empty: the output token limit is raised to 16,000 because thinking counts toward it
  (`f200a79`). A manual run with the secret always sweeps (`66f25c8`).
- The server sweep can post the digest to Slack (`493ddbd`) and email it through Resend (`bb78fbb`, `64fae00`), or send a
  short failure notice. Both are optional and covered by the offline tests only. Added `DEPLOYMENT.md`.
- README brought up to date with the above (`6889060`).
- Added draft subscription plans under `docs/subscriptions/`: system diagrams, pricing and rollout, free email sign-up
  and paid Pro through Razorpay. Documents only; no code changed.
- Then the task list for building them (`docs/subscriptions/tasks/`) and the first eleven tasks, T01 to T11
  (`9175e84` to `7c908da`), merged on 2026-10-22.

## 2026-10-19

- Rewrote the README as a product case study; how-it-runs, files and rebuild steps moved to `docs/TECHNICAL.md`.
- Added `docs/PRD.md` (put together after the build), `docs/decisions.md`, this changelog and a screenshot of the
  sample digest.

## 2026-10-18

- Live daily page on Vercel (#2): a server job sweeps once a day and saves to a private Blob store; `/live/` shows
  the latest sweep read-only; `/api/data` serves only allow-listed keys. Offline tests for the sweep and data feed.
  The case study gained a "Live (updated daily)" button, and the README describes the page as not yet swept (#3).
- Working demo and honest claims (#1): the dashboard can replay a saved sample; a GitHub Pages demo; dead buttons
  fixed; unbacked claims removed or qualified; offline checks and CI; a demo screenshot; README rewritten; duplicate
  zip removed (owner approved); text files stored with LF line endings.

## 2026-08-01

- First upload: the case-study page, the dashboard component, sample data and a zip copy.
