# Changelog

Built from the git history. Dates are commit dates. The project has no version numbers or releases, so entries are
grouped by date.

## 2026-10-23

- New `plan.json`, the one place for Pro's price, GST line, refund rule, trial and payment methods, all `null` until
  the owner sets them. `scripts/fill-plan.mjs` fills them into the pages at build time and switches between today's
  "free while it's being tested" wording and the paid wording on `paid` (false). `scripts/check-plan.mjs` (run by the
  owner with the keys) compares the Razorpay Plan with it. New `/pricing/` page, written but not shipped until
  `plan.json` has its values. `npm run check` now enforces T23's rules: no urgency words, no pre-ticked Pro box,
  `<th scope>` on every table, and "renews" next to any price. The built site is unchanged (T24).
- Added `scripts/compare-models.mjs` and its plan, `docs/subscriptions/haiku-test.md`. It's a local test of Haiku
  5.5 against Sonnet 5.5 on the sweep, which could lower `F` and so the price. It doesn't touch Blob storage, email
  or Slack. It runs only with `--yes` and an API key, and it hasn't been run yet.
- A scheduled sweep that saves nothing now starts the 2-hour gap too, so a run of failed or empty scheduled calls
  (which may still be billed) can't repeat back to back. The start time is kept in `radar:lastScheduled`, which
  `/api/data` doesn't serve. Manual runs are unchanged.
- `costing.md` revised after a third audit: "GST on top" now uses the net after Razorpay's fee on price plus GST
  (₹190.96 at ₹199), which raises some stress-test counts by 1 or 2; break-even at `F` is unchanged. Added a
  rounding rule, a section for the business costs `F` leaves out, and a provisional ₹199/₹299/₹499 comparison that
  says demand is untested. The 15-sweeps-a-day limit is marked approximate, and a few rounding slips are fixed.
- `costing.md` revised after a second audit: Pro gets 5 or 6 emails a day (the Vercel cron sweep sends one too),
  so email volumes are shown at both, and the 1,000-user example passes Resend's 50,000 once sign-ins are counted.
  Card fees are split into three GST cases (break-even unchanged). The $1.07 sweep is now a high-cost scenario, not
  a limit. The manual-sweep cap and `MAX_SUBSCRIBERS` (set in production) are marked done.
- Manual sweeps are capped at 3 a UTC day (`MAX_MANUAL_SWEEPS_PER_DAY`; `0` stops them). A call past the cap gets
  `429` and runs nothing, so a leaked `CRON_SECRET` can't run up the Anthropic bill. Scheduled sweeps are unchanged.
- New `docs/subscriptions/costing.md`: what a sweep ($0.21, measured over 5 production runs), an email, a live-board
  view and a card payment (3.42%) cost, the fixed monthly bill (about ₹6,797 with Vercel Pro and Resend Pro) and how
  many Pro subscribers cover it at four prices. New plan for the Pricing and About pages Razorpay's review needs;
  it found that the build ships only the Privacy page of `legal/`.
- `costing.md` revised after an audit against the code: failed runs so far cost nothing, the Vercel backstop cron
  probably sweeps daily, and Resend Pro has no daily limit. Added the worst-case sweep (about $1.07), costs at 10 to
  1,000 users, stress tests, pricing options, risks and safeguards, tax questions for a CA, and measurement and
  pre-launch checklists.
- Paying now makes an account Pro: the new `/api/razorpay-webhook` takes Razorpay's signed subscription events.
  Activated or charged gives Pro until the paid period ends, a failed payment (halted) makes it Free, and a
  cancelled subscription runs to the end of the period. Repeated or late events change nothing. Owner-granted Pro
  is never taken away by a payment problem.
- Checked on the `staging` preview: a test-mode payment made the account Pro through the webhook, until the end of
  the paid month.
- Emails sent from a Vercel Preview link to that preview's own URL, never to production. New admin command
  `recount` writes the subscriber count, so a fresh store can take sign-ups. DEPLOYMENT.md explains how to test
  payments on a `staging` preview and how Razorpay connects to Vercel.
- A test-mode payment on the `staging` preview worked end to end: the account recorded the payment and stayed Free
  until the webhook (T21). The docs now give Razorpay's domestic test card.
- `/manage/` can sell Pro through Razorpay: Upgrade to Pro opens Razorpay Checkout, and a paid Pro can cancel at the
  end of the period. Off until the Razorpay variables are set, so production still shows Request Pro. Paying doesn't
  grant Pro yet; the webhook (T21) will.
- A Razorpay library for paid Pro: create, cancel and fetch a subscription, and the webhook and Checkout signature
  checks, tested offline. Nothing uses it yet. `npm run check` now also fails on a committed Razorpay key secret.
- The Free daily email is a summary while the board is locked: the count and headlines per category and a Sign in
  button, with no detail or source links. Pro emails don't change. The pages now say Free gets a daily summary.
- The live board can be locked to Pro accounts with `BOARD_PAYWALL=1`, turned on in production the same day. Signed-out visitors see
  a sign-in panel and signed-in Free accounts a Request Pro panel; `/api/data` answers `401` or `402`, never
  publicly cached.
- A Pro account is no longer deleted when its emails stop: the Unsubscribe link, a hard bounce or a spam complaint
  turns its emails off and keeps the board. Free accounts are deleted as before.
- `/manage/` shows whether emails are on, can turn them back on after an unsubscribe, and has Delete my account.
- The privacy policy and the home page FAQ say a Pro account stays until it is deleted.
- With the board locked: the navs say "Live board (Pro)", the home page's second button opens the sample demo, the
  Free plan no longer lists the live board, and "What it found recently" points visitors without Pro to the demo.

## 2026-10-22

- Continue with Google with a new address now shows "Create your account" first; the account is made only when
  the person presses Create account, and Cancel creates nothing. Existing accounts still go straight in.
- "Continue with Google" moved below the email form, full width, under an "or continue with" divider, on the home
  page popup, `/signin/` and `/signup/`.
- The privacy policy is live at `/legal/privacy/`, linked from the home, sign-in and sign-up pages. The other
  policy pages are still drafts.
- "Continue with Google" on the home page popup, `/signup/` and `/signin/`, beside the emailed link. A new address
  gets a free account at once, with no confirmation email. Hidden until `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` are set (DEPLOYMENT.md, "Google sign-in").
- The home page is a customer product page instead of the portfolio case study, with the latest findings, plans and
  a sign-up / sign-in popup on every signed-out visit (`docs/site/homepage-review.md`). A sign-in now lasts until the
  browser closes, 12 hours at most (was 30 days).
- Fix: the emailed sign-in link's "Sign in" button failed with `wrong_origin`. Its page sent
  `Referrer-Policy: no-referrer`, so the browser posted the button with `Origin: null`; the server's pages now use
  `same-origin`, which still sends no Referer to other sites.
- The other pages' "← Case study" link is now "← Home". The live board drops its "Sample demo" and "Source" links,
  and "Get it by email" becomes "Plans".
- A lost confirmation can be asked for again after 10 minutes instead of 24 hours, at most 5 times per address;
  the sign-in reply says a new link can be asked for every 5 minutes (#9 in `docs/subscriptions/account-flows.md`).
- Account-flow fixes (#2 to #5 in `docs/subscriptions/account-flows.md`): "Sign in" on the home page and the live
  board (it reads "Account" there when signed in); one sign-up form, on `/signup/`, with the Pro box, and
  `/subscribe/` as the plans page; signing up again with an existing account emails a sign-in link instead of the
  manage link; asking to sign in with a never-confirmed address re-sends its confirmation.
- Sign-up page: `/signup/` ("Create your account"), email only, no password. It posts to the same
  `/api/subscribe` as `/subscribe/`; pressing Confirm creates the account and signs that browser in, and the
  confirm page now says so. `/signin/` links to it.
- T16, accounts and sign-in: a `/signin/` page that emails a one-time sign-in link (no passwords), a 30-day login
  cookie signed with `SESSION_SECRET`, Confirm signs you in, `/manage/` works by the cookie, and Sign out. Nothing is
  locked yet. Off until `SESSION_SECRET` is set.
- Tasks renumbered to follow the build order: the paid-website tasks are now T16 to T18 (were T20 to T22)
  and the Razorpay tasks T19 to T22 (were T16 to T19). progress.md lists all of them.
- Tasks T20 to T22 for the paid website: accounts and sign-in, the locked board, the teaser email.
- Decision: Pro will pay for the live board on the website, not for email. The free email becomes a teaser, and
  sign-in works by an emailed link. Design in `docs/subscriptions/paid-website.md`; docs and the draft terms
  updated. Nothing is built or switched on yet.
- T15 checklist: how to answer Razorpay's "Does your website require users to login to complete a payment?".
- Policy pages: reply time and governing law filled in. The owner's name, address and phone are filled from Vercel
  variables at build time (`scripts/fill-legal.mjs`), so they never enter the repository. Still not deployed.
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
