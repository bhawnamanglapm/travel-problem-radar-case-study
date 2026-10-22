# Changelog

Built from the git history. Dates are commit dates. The project has no version numbers or releases, so entries are
grouped by date.

## 2026-10-22

- T15 prerequisites checklist, checked against Vercel's and Razorpay's docs with links, and a pricing worksheet for
  the owner. Razorpay also wants About us and Pricing details pages.
- Draft policy pages for Phase 2 (privacy, terms, cancellation and refunds, contact) under `legal/`, with the owner's
  facts still to fill in. Not deployed yet; `npm run check` stops them going live with a gap left.
- T15 started: the owner chose to begin the Phase 2 (paid Pro) prerequisites without the gate; nothing is charged
  and no payment code is written. T12 results recorded: Pro emails reached Gmail's inbox, Gmail's own Unsubscribe
  button deleted the record, and Outlook.com filed every email in Junk.
- Fixed: an Unsubscribe link from before a re-subscribe said "This address isn't on the list" although the person
  was still subscribed. It now says the link is no longer active and to use the most recent email's link.
- **One inbox, one subscription.** Gmail addresses are matched without dots or `+tags` (and `googlemail.com` as
  `gmail.com`); Outlook, Hotmail, Live, MSN, iCloud, Proton and Fastmail without `+tags`. Records made before this
  keep their ids and links. Signing up an address that is already confirmed now says so, and emails that inbox its
  manage and unsubscribe links (at most once a day, within `MAX_CONFIRMS_PER_DAY`). A pending address with a link
  sent in the last 24 hours is told so. `stats` counts the new emails. Tested offline (417 subscriber tests),
  merged as #19 and checked on production with the owner's Gmail address; the notice email landed in the inbox.
- **Pro subscribers choose their categories** (T14): a Categories card on `/manage/` saves the choice. Each Pro
  email then carries only those categories, with its own counts, and a Pro whose categories had nothing in a sweep
  gets no email for it. Free always gets all four. Tested offline (386 subscriber tests); not deployed yet.
- The sign-up reply now adds "Not in your inbox within a few minutes? Check your spam or junk folder." Gmail and
  Outlook file the confirmation email as spam although SPF, DKIM and DMARC pass; mail-tester points to the domain
  being under two weeks old.
- The admin script's `stats` shows `bounced` and `complained` per day and in the totals: the addresses the Resend
  webhook deleted.
- Fixed: `/live` and `/demo` typed without the trailing slash showed a blank page, because the script loaded from
  the site root. Each page now adds the slash itself (Known issue 1 in `DEPLOYMENT.md`); confirmed on production.
- **Bounces, spam complaints and a per-IP sign-up limit** (T13): a signed Resend webhook (`/api/resend-webhook`)
  deletes an address that hard-bounces or marks the digest as spam, and `/api/subscribe` takes at most 5 sign-ups per
  connection per hour (`MAX_SIGNUPS_PER_IP_HOUR`), with a Vercel Firewall rate limit in front. Tested offline (355
  subscriber tests). Both are live on production; the webhook was tested there with Resend's test addresses.
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
