# Changelog

Built from the git history. Dates are commit dates. The project has no version numbers or releases, so entries are
grouped by date.

## 2026-10-30

- The LLM logs keep more of each search page: its title and age, and the passages the model quoted (with links),
  not just the link. Page text is still encrypted by the API and left out. Titles and quotes are cleaned of control
  characters and capped. `scripts/llm-logs.mjs summary` prints them; older logs print as before.
- Cost per run (T29): `scripts/cost-per-run.mjs` reads the private LLM logs and prices each sweep, each category
  and failed calls at the list prices in `scripts/compare-models.mjs`. Each log's summary now also has `usageByCat`.
  The public sweep record and `/api/data` are unchanged. costing.md's re-measure steps use the script in place of
  reading Actions logs.
- When some categories fail in a sweep, subscribers no longer see it: Pro emails dropped their "Failed this run"
  line, as Free already had. The owner gets a clearer alert instead: the email subject starts `FAILED: <categories>`,
  and the email and Slack digest list each failed category with its error (cut to 300 characters).
- `scripts/score-items.mjs` scores saved live items with the README's rubric (T30 step 10): it picks 20 across the
  four categories from the saved sweeps without writing to them, checks each link and whether the item's date is within
  30 days of when it was found, and writes a CSV for the four lines a person judges. `--score` reports the shares.
- The admin page shows Pro members' areas: a Pro areas card with a count per area, an Areas column in the list, and an
  `areas` field in the CSV (T41 follow-up).
- Pro members can choose areas for their email as well as categories: All areas, or any of Asia, Europe, North
  America, Latin America, Middle East & Africa, Oceania and Other, on the account page. Worldwide problems always
  come. The email says which areas it covers. A choice with nothing in a sweep sends nothing. Free is unchanged
  (T41).

- One problem can be shared: Share in the problem's panel on the live board copies a link to it (on a phone, it
  opens the share sheet). The link, `/p/<sweep>/<item>`, opens a page with the headline, category, severity,
  source, region and date for everyone, and the summary, opportunity and source link for a signed-in Pro member,
  with "Open on the board". Others see Sign in and See Pro. The page isn't indexed by search engines. A link shows
  a preview card in apps that read Open Graph tags, with the headline and a new site image, `og.png`, which the
  home page now uses too. An old link says the problem is no longer on the board (T40).

## 2026-10-29

- Pro members can save problems: a "☆ Save" star on each card and in the detail panel, and a fourth tab, Saved,
  with the saved problems newest first, each with its sweep date, Details and Unsave. At most 100. The server
  keeps its own copy of each on the account, so a saved problem stays after its sweep is gone. A Pro whose plan
  ends keeps the list for when they renew, and can still remove items. Delete my account removes it. The demo
  keeps its saved problems in the browser. The privacy page lists the new stored data (T39).
- The board's search can look in every saved sweep: "This sweep" and "All saved sweeps" chips beside the search
  box. All shows each problem once (its latest copy) with "Sweep of <date>" on the card, and says how many saved
  sweeps it couldn't include. The sweep keeps one search file (`radar:search`) for it, so a search costs one read.
  The search and the category and area filters are in the URL (`?q=`, `?cat=`, `?area=`, `?all=1`), so a filtered
  view can be bookmarked or shared, and a search survives signing in. The home page has a search box that opens
  the live board on All saved sweeps (T38).
- The board can be filtered by part of the world: an "All areas" chip row with a count on each area, and area
  tiles above the categories when a sweep spans two or more areas. Each problem's region, as the AI wrote it, is
  placed in Global, Asia, Europe, North America, Latin America, Middle East & Africa, Oceania or Other; a region
  that names two or more areas counts as Global. The cards still show the AI's own region text. Every filter chip
  now says whether it is pressed (`aria-pressed`) (T37).
- Each problem on the board has a Details button that opens a panel (a side panel on desktop, a bottom sheet on a
  phone) with the problem in full and its history: when it was first seen, how many sweeps it has been in, and the
  earlier sweeps, each with Open while it is still kept. Cards in more than one sweep say "Seen in N sweeps". A
  `#p=<id>` link opens one problem's panel. The sweep keeps a private index of each item's sightings
  (`radar:items`) and saves the history on the items, so the board makes no extra request (T36).
- The site takes the Pehchan brand from pehchanthetraveller.com: deep teal and amber, in light or dark to match the
  visitor's system (it was dark only). The colors live in `brand.css`. The home page, demo and live board link it,
  with Inter Tight for text and Italiana for the board's title. The self-contained pages hold the same colors
  inline (`npm run sync:brand` copies them after an edit to `brand.css`) and use system fonts, so they still load
  nothing from another site. The pages the server writes (confirm, unsubscribe) use the same colors.
- The board groups its problems under one card per category, with the category's name, what it covers, and its
  counts ("2 problems · 1 new · 1 high"). Each category can be hidden and shown again, and picking a category chip
  opens its card. The cards inside drop their own category label and carry a stripe in the category's color.
- `npm run check` checks that the pages link or hold `brand.css`, that the old neon colors are gone, and that every
  text color passes 4.5:1 contrast in both modes.

## 2026-10-28

- Signing in no longer sends every account that once ticked Pro (and never paid) to the plan card. Only the sign-in
  that completes a sign-up with Pro ticked (the confirm link, or Google for a new or pending account) goes to
  `/manage/?pay=1`; every later sign-in, by Google or password, goes to `/live/`. After paying on `/manage/`, a
  signed-in browser is taken to the live board.
- `/subscribe/` now redirects to `/pricing/` (vercel.json), and the links that pointed at it (home page, board,
  sign-up, terms) go to `/pricing/` directly. The subscribe page's file is kept but no longer reachable.
- The site's one address is now https://radar.pehchanthetraveller.com. Pages on travel-problem-radar.vercel.app
  redirect there (vercel.json), and the home page, README and every page's GitHub Pages redirect use it. `/api/`
  isn't redirected, so the Razorpay webhook, the sweep workflow and links in emails already sent keep working.
  Signing in on one address and opening the other made the board look signed out, and a Google sign-in started on
  the custom domain came back to vercel.app without its cookie ("This Google sign-in didn't finish"). Needs
  `SITE_URL` set to the new address and its `/api/session` added to Google's redirect URIs (DEPLOYMENT.md).
- The privacy, contact and refunds pages show Account instead of Sign in when already signed in, like the rest.
- test-plan accepts `paid` either way (payments were switched on on 2026-10-27); plan.json must still be valid.

## 2026-10-27

- Delete my account deletes at once, paid Pro included: the account's Razorpay subscriptions (the plan and any
  renewal set up) are cancelled immediately first, so nothing more is charged. Pro ends with the account and the
  rest of the period isn't refunded; the page says so first. If Razorpay won't cancel a plan that could still
  charge, nothing is deleted. Unsubscribing, bounces and complaints, and the `delete` admin command cancel
  Razorpay the same way (unsubscribing keeps the account with emails off if Razorpay won't cancel). Deleting now removes every file that names the
  account, not only the record: its Razorpay index files and its id in the daily delivery files
  (`deleteSubscriberData`), also used by unsubscribing, bounces and complaints, and the `delete` admin command.

- Passwords, optional. `/signup/` takes one beside the email address; it turns on only when the confirmation link
  sent for that sign-up is pressed (the link carries a key, so nobody can set a password on someone else's address).
  `/signin/` signs in with email and password, and still emails a link when the password is left empty. The manage
  page's **Password** card sets, changes or removes it when signed in (not through an email's manage link); setting
  one signs other browsers out. scrypt hashes only; 10 wrong passwords per IP or per account an hour, then `429` for
  the rest of the hour. The home, subscribe and pricing pages and the privacy policy no longer say there's no
  password. Tests in `scripts/test-password.mjs`, run by `npm test`.

## 2026-10-26

- Admin dashboard: a Payments card saying whether payments are on for that deployment and, if not, which `RAZORPAY_*`
  variable is missing or unreadable (names only).
- Pick a plan, pay, and Pro starts at once (payments on only). `/signup/` (paid build) shows Monthly or Yearly when
  Pro is ticked; confirming the email redirects to `/manage/?pay=1`, which opens Razorpay's Checkout for that plan.
  `checkout-return` now starts Pro as soon as Checkout's signature checks out and Razorpay's subscription agrees
  (or can't be reached), until the period end Razorpay reports or the months paid for; the webhook still sets the
  real end. The email must still be confirmed before paying.
- Sign-up straight to payment (payments on only). Ticking Pro at sign-up and confirming now links to
  `/manage/?pay=1`, which opens the plan card ready for Pay with Razorpay; Google sign-up with Pro ticked goes there
  too. Without the box the confirm page offers Upgrade to Pro. No owner "Pro request" email while payments are on.
  After paying, `/manage/` checks every 5 seconds for 2 minutes and shows Pro once Razorpay's webhook has arrived.
  With payments off nothing changes.
- Admin dashboard: `/admin/` and `/api/admin` (the tenth function). Every subscriber with their address, plan, type
  (monthly, yearly, granted), price, categories, emails a day, dates and billing state, with search, filters and a
  CSV download; counts, Pro's categories and emails a day, the paid value per month, and the day-by-day sign-up
  counts `scripts/subscribers.mjs stats` prints (`computeStats` moved to `api/_lib/admin.js`). Sign-in takes
  `ADMIN_USER` and `ADMIN_PASSWORD` (16+ characters) from Vercel; the endpoint checks them and sets a strict,
  HttpOnly cookie for `/api/admin` only, for at most 8 hours. 5 wrong tries per IP an hour, each waiting a second.
  Tests in `scripts/test-admin.mjs`.
- Blob folders. Each kind of key now has its own folder under `radar/`: `logs/` (LLM logs), `sweeps/`, `history/`
  (the sweep index and seen ids), `state/` (last scheduled run, subscriber count), `subscribers/`, `events/`,
  `deliveries/`, `ip-hits/` and `razorpay/` (`subscriptions/`, `events/`). Files written over time are named by kind
  and UTC time, e.g. `logs/llm-log-2026-10-25-17-18-<id>.json`; subscribers, the Razorpay index and one-off files
  have no time in the name. A Razorpay event marker's key now carries the event's minute
  (`radar:rzp-event:<YYYYMMDD>-<HHMM>-<event id>`). Files written before this, directly in `radar/` as
  `radar-….json`, are no longer read; the data was test data, so there is no migration. Delete them by hand in the
  Blob browser.
- One Pro price (owner's decision). Categories and emails a day no longer change the price; Pro is paid **monthly or
  yearly** (3 and 6 months dropped). `plan.json` has `monthly` and `yearly` again, both ₹1 while testing, and its
  per-category `pricing` block is gone. `/manage/`'s plan card shows Monthly and Yearly with their prices; a Pro
  may now save any categories and emails a day (the `change_plan` refusal is gone). `RAZORPAY_PLANS` needs only
  `"1"` and `"12"`; `check-plan.mjs --create` makes those two. The pages read "₹1 a month or ₹1 a year".

## 2026-10-25

- Renewing Pro (T34, built, not deployed). A cancelled paid Pro whose period is still running gets **Keep renewing**:
  a new subscription for the plan they choose, starting when the paid period ends (Razorpay's `start_at`), so nothing
  is charged twice; its first charge makes it the plan, and Pro holds 6 hours if the old plan's end arrives first.
  Cancelling again stops the renewal. A Free member who paid before sees **Renew Pro** with their last plan filled in.
  A Pro that won't renew (cancelled, last billing cycle, or owner-granted with an end date) gets one email 7 days
  before it ends; the sweep reply counts it as `endWarning`.
- One Pro plan, chosen and paid for together (T33, built, not deployed). `/manage/` has one plan card: categories
  (all four, just one, or several), emails a day, and for Free the billing period (1, 3, 6 or 12 months) with each
  period's price. **Upgrade to Pro** opens it and **Pay with Razorpay** checks out that choice; with payments off,
  **Request Pro** opens it and **Send my request** stores the choice for `grant-pro`. A Pro saves changes with the new
  `set-plan`, and a paid Pro can't save more than they paid for. The owner chose the price model "a price per number
  of categories, plus an amount per extra email a day"; `plan.json`'s `monthly` (₹299) is replaced by `pricing`, set to
  **₹1 for every choice while testing**. Razorpay charges it with one ₹1 plan per period and the price as the
  subscription's quantity, so `RAZORPAY_PLANS` (made by `check-plan.mjs --create`) replaces `RAZORPAY_PLAN_ID`, and
  `RAZORPAY_TOTAL_COUNT` counts months. The pages say Pro renews "at the end of each billing period".
- Sweep slots survive GitHub's late runs (T35). `sweep.yml` has one cron line per slot and sends the slot the run
  was due for as `X-Sweep-Slot`; the sweep uses it if that slot began under 12 hours ago. The 2-hour gap becomes one
  scheduled sweep per slot, so the Vercel backstop and a late slot-00 run sweep once, and a late run no longer holds
  back the next slot. Scheduled replies add `slotAt` and `lateMinutes`. A leaked secret now allows at most 8 sweeps
  a day instead of about 15.
- New tasks from the owner's Pro plan request, after checking the code: [T33](docs/subscriptions/tasks/T33-pro-plan-builder.md)
  (one plan from categories, 1 to 5 emails a day and 1, 3, 6 or 12 months, priced and paid together, test mode first),
  [T34](docs/subscriptions/tasks/T34-renew-pro.md) (renewal) and [T35](docs/subscriptions/tasks/T35-sweep-slots-on-time.md)
  (GitHub's runs start up to 4 h 35 m late; past about 4 h 43 m a run lands in the wrong slot). Found while checking:
  T14 and T32 are combined only in delivery; Production shows no pay button because no Razorpay variables are set
  there (by design until T27); `staging`, where payment is tested, is 121 commits behind `main`. The tasks index,
  progress, T27, T31, T32, pricing.md, the decision log and the roadmap follow. Docs only.
- Sweeps run again (RM-01, LR-01; I-01 closed). The owner put a new Anthropic key with credit in Vercel; after the
  17:00 UTC deploy, a manual sweep at 17:18 UTC saved all four categories (18 items) on `claude-haiku-5-5`: 101,309
  input and 9,306 output tokens, 10 searches, 90 pages, about 20 seconds. Every sweep from 2026-10-23 15:09 UTC had
  failed with "Your credit balance is too low". Docs that named `claude-sonnet-5-5` as the default now say Haiku,
  the default since `533ab15`.
- `scripts/test-compare.mjs` compares Sonnet with Haiku again: `533ab15` had set both of its model constants to Haiku,
  failing 7 checks and the `check` workflow on `main`.
- Each sweep that runs saves an LLM log in the private Blob store (`radar:llmlog:<id>`), because Vercel's Hobby plan
  keeps function logs for an hour. It holds every Claude call's request and response (thinking, search queries,
  answer, stop reason, usage; encrypted page contents left out) and a summary: input and output tokens, searches,
  and the pages search found, as links. Written for saved, empty and unsaved sweeps; deleted after 30 days, listed
  once a UTC day to spare Blob operations. Not readable through `/api/data`. New owner script
  `scripts/llm-logs.mjs` (`list`, `summary`, `show`). The sweep reply adds `llmLog` and `usage.pages`.
- Pro members choose 1 to 5 emails a day on `/manage/` (T32, PR 2, #89): an "Emails a day" card that saves through
  `set-freq`, greyed out for Free. Every page, the live board, the Pro email footer and the account replies say "1 to 5
  a day" instead of "every 5 hours"; `check.mjs` fails if the old wording comes back. README, TECHNICAL and the
  pricing.md email quota follow.
- [T32](docs/subscriptions/tasks/T32-sweeps-per-day.md) gets its own task file, and [T28](docs/subscriptions/tasks/T28-two-sweeps-a-day.md)
  is marked replaced (its `cron` change would stop 3 to 5 a day from running). T27, T30, the tasks README, progress,
  pricing.md and roadmap RM-26 now point at T32. Docs only.

## 2026-10-24

- Each Pro member chooses 1 to 5 emails a day (T32, server side, #88). The site sweeps only as often as the most
  frequent member needs, between `SWEEPS_PER_DAY_MIN` and `SWEEPS_PER_DAY_MAX`; a scheduled slot nobody needs answers
  `skipped` before any Anthropic call. Pro emails roll up every sweep since the member's previous slot. New account
  action `set-freq`. With no Pro members the site now sweeps once a day. The manage page and the wording follow in
  PR 2.
- [pricing.md](docs/subscriptions/pricing.md#final-pro-plan-2026-10-24): the final Pro plan. Free and Pro only,
  Pro at ₹299 a month (monthly only), all 4 categories, a digest after every scheduled sweep at 2 a day, and the
  live board. Four new tasks carry it out: [T28](docs/subscriptions/tasks/T28-two-sweeps-a-day.md) (2 sweeps a
  day), [T29](docs/subscriptions/tasks/T29-usage-by-category.md) (usage per category, optional),
  [T30](docs/subscriptions/tasks/T30-owner-launch-checklist.md) (the owner's launch steps) and
  [T31](docs/subscriptions/tasks/T31-measure-and-add-tiers.md) (measure, then decide on tiers). Docs only: the
  schedule, the pages and `plan.json` are unchanged.
- [pricing.md](docs/subscriptions/pricing.md#tiers-by-categories-and-sweeps-draft-2026-10-24): a draft tier plan by
  categories and sweeps (Free, Starter, Plus, Pro at 2 sweeps a day), with example prices, break-even by mix and a
  rollout that launches with Pro only. Nothing is built or priced yet.
- [costing.md](docs/subscriptions/costing.md#tiers-by-number-of-categories-at-2-sweeps-a-day-illustrative): an
  illustrative table of Pro tiers by number of categories (1 to 4) at 2 sweeps a day, with monthly and yearly
  prices, the owner's cost and the customers needed to cover it. The prices are examples; nothing is decided.
- A product-management case study in [`pm/`](pm/README.md), in seven stages: discovery, product definition,
  design, planning and governance, business case and launch, executive communication, data and metrics, with a
  summary in [`pm/CASE_STUDY.md`](pm/CASE_STUDY.md). It summarises and links the existing docs; every figure names
  its source, and gaps are marked **OWNER INPUT NEEDED** or **Not measured**. Stages 5 to 7 are plans, since
  payments haven't opened. The README links it, and the v1 PRD points to v2.
- A failed sweep now says why Anthropic refused the call (`http 400 <type>: <message>`), not just `http 400`. The
  message is one line, capped, and never shows the key.
- Fixes from a code audit (PRs #81 to #84):
  - The sweep saves the new sweep, the index and the seen list before it deletes old files, and an item found again
    stays in the seen list. The live board no longer asks for two files it can't read. An unknown key on the
    paywalled `/api/data` gets its 400 instead of throwing. The artifact uses the server's model settings.
  - Pressing Confirm on an address that is already active (from a forwarded digest, say) no longer signs anyone in.
  - Two updates to a subscriber record at the same moment no longer undo each other: each write checks the record
    is unchanged and otherwise retries. A payment that lands during Checkout's return keeps its Pro, and sign-in
    links and Confirm work once.
  - The admin `delete` refuses a Razorpay subscription that will still charge, and deletes its index with the record.
    With `MAX_SUBSCRIBERS` unset, sign-up answers "subscriptions are not open yet" instead of promising a link.
    Once the day's sign-in emails run out, `/signin/` says so, for every address alike.

## 2026-10-23

- `/pricing/`, the contact page and the cancellation and refunds page are live. Every footer now reads Home · About ·
  Pricing · Contact · Privacy · Refunds. `plan.json` has the owner's answers: no GST charged (not registered), cards
  and UPI AutoPay, no free trial. `paid` stays `false`, so Pro still reads as free while it's being tested and no
  payment button shows. The terms (still a draft) now say how the renewal notice works and what happens if the service
  stops; the liability clause waits for an adviser.
- Signed in, the home page no longer offers **Create free account**. The hero button becomes **Your account**
  (Free) or **Open the live board** (Pro), the "No password" note is hidden, the current plan's button reads
  **Your plan**, and Free accounts get **Request Pro** (to `/manage/`) instead of the sign-up form. `npm run check`
  requires it.
- The contact address for questions is now **pehchanthetraveller19@gmail.com** on every page (footer Contact link,
  `/about/`, the legal pages, `/manage/`'s messages) and in `plan.json`. Emails are still sent from
  `hello@pehchanthetraveller.com`. `npm run check` requires the new address.
- Every footer now starts with **Home**: Home · About · Plans · Contact · Privacy, on every page and draft.
  `npm run check` requires it.
- The pages that call Pro "free while it's being tested" (home, `/subscribe/`, `/signup/`, the live board's locked
  panels, `/manage/`) now also hold the paid wording: price, GST, "renews automatically every month until you
  cancel", and links to `/pricing/`. `plan.json`'s `paid` picks one at build time; it stays `false`, so the live
  site doesn't change. In the paid version, `/manage/` shows the price, renewal and refund rule above a "Pay with
  Razorpay" button. Fixed: after a failed renewal the account read as Free and offered a second checkout while Razorpay
  was still retrying the first, which could charge twice. `/api/account` now refuses that (`payment_retrying`) and
  reports `billing` (`pending` or `halted`) so the page can say what's happening (T26).
- `/about/` is live, with who runs the site (from the owner's resume). Every shipped footer now starts with About:
  About · Plans · Contact · Privacy. The refund rule is set in `plan.json` (first payment back within 7 days, mistakes
  always refunded, within 14 days); it shows once the refunds and pricing pages ship.
- A footer on every page: About · Pricing · Contact · Terms · Privacy · Refunds, listing only the pages that ship.
  Today that's Plans (`/subscribe/`, standing in for Pricing), Contact (the email address, standing in for the
  contact page) and Privacy. It's added to the home, sign-up, sign-in, subscribe, manage, live and demo pages and the
  privacy policy. New `/about/` page, written but not shipped until the owner writes "Who runs it". The terms and
  refunds drafts now take Pro's price, GST, trial, payment methods and refund rule from `plan.json`, and say how
  payment, renewal, cancelling and failed payments work. They stay drafts. `npm run check` checks each page's footer
  and that no shipped page links a page that doesn't ship (T25).
- Pro's price set to ₹299 a month in `plan.json`, the candidate `costing.md` names to test first (24 to 28 members
  cover the running costs). GST is left blank for a CA, so `/pricing/` still isn't shipped and the live site doesn't
  change. The live Razorpay Plan must be created at the same amount (`scripts/check-plan.mjs` compares them).
- New `plan.json`, the one place for Pro's price, GST line, refund rule, trial and payment methods, all `null` until
  the owner sets them. `scripts/fill-plan.mjs` fills them into the pages at build time and switches between today's
  "free while it's being tested" wording and the paid wording on `paid` (false). `scripts/check-plan.mjs` (run by the
  owner with the keys) compares the Razorpay Plan with it. New `/pricing/` page, written but not shipped until
  `plan.json` has its values. `npm run check` now enforces T23's rules: no urgency words, no pre-ticked Pro box,
  `<th scope>` on every table, and "renews" next to any price. The build steps moved from `vercel.json`'s
  `buildCommand` to `package.json`'s `build:site`, because Vercel caps `buildCommand` at 256 characters and the
  longer command failed the preview deploy. The built site is unchanged (T24).
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
