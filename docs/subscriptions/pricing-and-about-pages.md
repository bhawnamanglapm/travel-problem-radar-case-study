# Plan: Pricing and About pages

> **Plan only, nothing here is built.** Written 2026-10-23. This is step 2 of the order agreed for paid Pro:
> T21 docs → **Pricing and About pages** → T22 code → go-live by the owner. The build waits for the owner's answers
> under "Owner inputs".
>
> **Split into tasks 2026-10-23:** [T23](tasks/T23-pro-display-standards.md) (rules and owner inputs),
> [T24](tasks/T24-pricing-page.md) (`/pricing/`), [T25](tasks/T25-about-footer-legal.md) (`/about/`, footer, policy
> pages), [T26](tasks/T26-pro-copy-and-checkout-summary.md) (Pro wording elsewhere) and
> [T27](tasks/T27-razorpay-test-run-and-go-live.md) (go-live). Where they differ from this plan, the tasks win.

## Why

Razorpay's website review needs an **About us** page and a page with **pricing details** (T15 Step 2, row 2). The
site already has Contact, Terms, Privacy and Refunds under `legal/`. The price on the page has to cover what the
service costs. [costing.md](costing.md) has those costs, measured or sourced: about ₹6,797 a month with Vercel Pro
and Resend Pro, plus 3.42% of each card payment.

## What gets built

**Two static pages, no new function.** Vercel Hobby allows 12 functions and 9 are used. Both pages are plain HTML
like `legal/*/index.html`, with the same styles.

**The build has to ship them.**
- `vercel.json`'s `buildCommand` copies a fixed list of folders into `public/`.
- Today it ships only `legal/privacy`, not `contact`, `terms` or `refunds`. So those three pages aren't on the site
  yet, and Razorpay's review would find them missing.
- The build step adds `pricing` and `about` and the other three `legal/` folders to that list.
- `scripts/fill-legal.mjs` already fills the owner's details into every page it finds and fails the build if a slot is
  unset. So shipping `contact` and `terms` needs `LEGAL_NAME`, `LEGAL_ADDRESS` and `LEGAL_PHONE` set for that
  environment.

### `/pricing/`

1. **The plans.** The Visitor / Free account / Pro table from [pricing.md](pricing.md#tiers-draft), in plain words.
2. **The Pro price.** Monthly and yearly in ₹, and one line saying whether GST is included or added.
   `[OWNER INPUT NEEDED]`
3. **Trial.** Either the trial or the line "No free trial; the Free account and the sample demo show what you get".
   `[OWNER INPUT NEEDED]`
4. **How billing works.** These lines match what T20 and T21 built:
   - Pro is a Razorpay subscription that renews automatically each period.
   - You cancel on `/manage/`.
   - After cancelling, Pro lasts until the end of the period you paid for, then the account becomes Free.
   - If Razorpay gives up on a renewal (`halted`), the account becomes Free until a payment succeeds.
5. **Refunds.** One or two lines summarising the rule, linking to `legal/refunds/`. The two pages must say the same
   thing. `[OWNER INPUT NEEDED]`
6. **Payment methods.** Only the ones the live Razorpay account has activated: cards, plus UPI AutoPay if enabled.
   Whether international cards are accepted is the owner's choice. `[OWNER INPUT NEEDED]`
7. **"Get Pro" button.**
   - Signed out: `/signup/?pro=1`. The sign-up page already ticks "I want Pro" from that parameter.
   - Signed in: `/manage/`.
   - The page's script picks the link from `/api/session?action=me`, as `index.html` does. Without script, the link
     goes to `/signup/?pro=1`.

### `/about/`

- **What the radar is.**
  - It looks for travel problems worth building products for, in 4 categories.
  - It sweeps every 5 hours.
  - Items are gathered by an AI model with web search, so readers should check each source link. This uses the
    same wording as the live board's note.
- **Who runs it.** The brand name and a line or two. `[OWNER INPUT NEEDED]` **No legal name, postal address or phone
  number.** Those live only in the Vercel variables `LEGAL_NAME`, `LEGAL_ADDRESS` and `LEGAL_PHONE`.
  `scripts/fill-legal.mjs` puts them into the legal pages at build time.
- **Contact.** A link to `legal/contact/`.

### A footer on every page

**Links:** About · Pricing · Contact · Terms · Privacy · Refunds.

**Pages:**
- `index.html`, `subscribe/`, `signup/`, `signin/` and `manage/`;
- the four `legal/` pages;
- the two new pages.

**Today:**
- the home page footer links the Live board, Plans, Sign in and Privacy;
- the legal pages link each other;
- `subscribe/`, `manage/`, `live/` and `demo/` have no footer.

`live/` and `demo/` are built React bundles. They get a footer in their `index.html`, outside the app's root, so no
rebuild is needed.

### Checks

`scripts/check.mjs` gets four more checks:
- `pricing/index.html` and `about/index.html` exist and resolve their local links;
- every page in the list above links all six footer pages; as built in T25, a shipped page links only the pages that
  ship, in this order, and a draft links all six;
- `vercel.json`'s build copies `pricing`, `about` and all four `legal/` folders;
- neither new page contains a phone number or postal-address pattern. This is the same idea as the existing
  secret checks.

Then `npm run check` and `npm test`.

## Rule for go-live

**The price on `/pricing/` must equal the amount of the live Razorpay Plan in `RAZORPAY_PLAN_ID`.**
- The test plan on `staging` is ₹99. That is a test amount only.
- A line saying so goes into the go-live checklist (now [T27](tasks/T27-razorpay-test-run-and-go-live.md)), next to
  creating the live plan.
- If the price changes later, these come in this order:
  1. create a new Plan in Razorpay for the new amount;
  2. update `RAZORPAY_PLAN_ID`;
  3. update the page, in the same deploy.
- Existing subscribers stay on their old plan.

## Owner inputs

| # | Question | Where it's used |
|---|---|---|
| 1 | Pro price a month in ₹, and a year if offered. **Answered 2026-10-23: ₹299 a month, monthly only**, the candidate [costing.md](costing.md#199-299-and-499-compared-provisional) names to test first. In `plan.json` | `/pricing/`, the live Razorpay Plan(s) |
| 2 | GST: registered or not; price includes it or adds it | `/pricing/` wording; break-even in [costing.md](costing.md#break-even) |
| 3 | Free trial: none, or how many days | `/pricing/`; a trial changes checkout, so it would be T22 code |
| 4 | Refund rule (for example: none for a part-used period, a double charge always refunded) | `/pricing/` and `legal/refunds/` |
| 5 | International cards: accept or not | `/pricing/` payment methods; Razorpay activation |
| 6 | Brand name and one or two lines about who runs it | `/about/` |
| 7 | Domain renewal price a year | [costing.md](costing.md#fixed-monthly-cost) |

`legal/contact/`, `legal/refunds/` and `legal/terms/` still have their own owner-input markers. They are checked in
the same pass, since Razorpay reviews those pages too.

## Not in this step

- Changing what Pro includes, or any API code. That's T22.
- A Team tier.
- A price chosen by Claude. [costing.md](costing.md) gives the costs and the break-even table; the price is the
  owner's decision.
