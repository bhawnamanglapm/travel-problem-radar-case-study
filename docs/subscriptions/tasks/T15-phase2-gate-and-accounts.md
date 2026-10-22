# T15 · Phase 2 gate review and accounts

| | |
|---|---|
| Phase | 2, paid Pro: **start only if the gate passes** |
| Who | Owner |
| Size | S of owner time, plus waiting for account reviews |
| Depends on | T12, and the measuring period the owner set before launch |
| Unblocks | T16–T19 |

## Why

[pricing.md](../pricing.md) says to build payments only if Phase 1 shows demand, and not to charge anyone before at
least one real sweep has been scored for quality. Payments also bring legal, tax and hosting requirements that take
time to clear, so start them before any code.

## Step 1: the gate

> **2026-10-22: skipped by the owner.** No thresholds or measuring period were set before launch, and no real
> sweep has been scored, so the table below is left empty. The decision is in [decisions.md](../../decisions.md).
> Not charging anyone before a scored sweep still applies.

Run `node scripts/subscribers.mjs stats --days <period>` (T11) and fill in:

| Measure | Threshold (set before launch, T12) | Result |
|---|---|---|
| Confirmed subscribers | | |
| Confirm rate (`confirmed / subscribed`) | | |
| Unsubscribes per digest sent | | |
| People who said they'd pay, and how much (`stats` counts Pro requests; the "how much" still needs asking) | | |
| At least one real sweep scored with the README's rubric | Required | |

If any threshold is missed: stop here, stay Free, and record the decision in decisions.md. Owner-granted Pro (T11)
keeps working.

## Step 2: prerequisites (from pricing.md's checklist)

Checked against the sources below on **2026-10-22**. Providers change these pages, so check again before acting.
"Owner" means only you can do it; "Dev" means it can be done in the repo.

| # | Item | Who | Status | What the source says |
|---|---|---|---|---|
| 1 | **Razorpay account**, test mode first | Owner | Account created 2026-10-22 (owner's screenshot of the dashboard). Activation not submitted | Test mode works before activation and moves no money. Activation asks for: business type (an **unregistered individual** is an option), PAN and brand name; KYC through CKYC, else DigiLocker/Aadhaar or an uploaded ID, else video KYC with physical PAN and Aadhaar; a bank account, checked with a ₹1 deposit. Registered businesses also need a GST or Udyam certificate plus one more document. [Activation steps][rzp-kyc] |
| 2 | **Website for Razorpay's review** | Owner + Dev | Drafts of 4 of the 6 pages exist (`legal/`, #25); not live | The website must link **About us, Contact us, Pricing details, Terms and conditions, Privacy policy and a Refunds policy**. A primary website gets automatic checks of the site, the policy pages and the business industry; without website details there are no live API keys (Payment Links still work). [Business website details][rzp-web] **Missing: an About us page and a Pricing details page.** The case study (`/`) may do for About; Pricing needs your prices (row 6) |
| 3 | **Vercel Pro** | Owner | Not started | Hobby is "restricted to non-commercial personal use only", and commercial use includes "any method of requesting or processing payment from visitors of the site". Pro is $20 a month per developer seat, with $20 of included usage credit. [Fair use][vercel-fair], [Pricing][vercel-price] Move before live payments. Whether a **test-mode** checkout on Hobby counts isn't said; ask Vercel support if you want to build T16–T17 on Hobby |
| 4 | **International cards** | Owner | Not decided | Not confirmed from a Razorpay page. Razorpay's Subscriptions settings have a **Card** switch for recurring card payments; UPI and eMandate are INR only; cards and UPI take recurring charges up to ₹15,000. The page says nothing about international cards. [Subscriptions settings][rzp-subs-settings] Decide, then ask Razorpay support |
| 5 | **Tax and legal advice**: GST, income tax, DPDP Act | Owner | Not started | No source checked; this needs an adviser |
| 6 | **Prices**, currency, trial, refund rule | Owner | Not set | See the worksheet below. Then create the Razorpay Plan(s) in test mode and note each plan id |
| 7 | **Policy pages filled and published** | Owner, then Dev | Drafts exist; reply time and governing law filled; name, address and phone come from Vercel variables (`scripts/fill-legal.mjs`) | Fill the remaining gaps, have them reviewed, then remove the draft notice and `noindex` and add `legal && node scripts/fill-legal.mjs public` to the build. `npm run check` stops them going live with a gap left |
| 8 | **Support route**: who answers, where, how fast | Owner | Not set | The reply time also goes on the contact and refunds pages |
| 9 | **A real sweep scored** with the README's rubric | Owner | Not done | Not a provider rule: pricing.md says not to charge anyone before this |
| 10 | **Activation form: "Does your website require users to login to complete a payment?"** | Owner | Not answered | Answer **Yes** ([paid-website.md](../paid-website.md)): the board is paid and paying happens on `/manage/` while signed in. Steps for the reviewer: sign up at `/subscribe/` with any address, click Confirm (which signs you in), then Upgrade on `/manage/`. Don't give the reviewer the owner's own account. Not found in Razorpay's docs: what the form asks for after "Yes" (for example test credentials); see it in the form or ask Razorpay support. Sign-in and Upgrade don't exist yet (paid-website PRs, then T17) |

[rzp-kyc]: https://razorpay.com/docs/payments/easy-submit-kyc/
[rzp-web]: https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/
[rzp-subs-settings]: https://razorpay.com/docs/payments/subscriptions/settings/
[vercel-fair]: https://vercel.com/docs/limits/fair-use-guidelines
[vercel-price]: https://vercel.com/pricing

### Pricing worksheet (owner)

Answer these before the Pricing details page, the terms and the Razorpay Plans can be written. They come from
pricing.md's open questions; no numbers are suggested here.

1. Who pays: PMs on a team, solo PMs, founders, recruiters? Is it a personal or a company expense?
2. Currency: INR only, or other currencies too (row 4)?
3. Price per month, and per year if offered.
4. Free trial: none, or how many days?
5. Refund rule: none, pro-rata, or full within N days; and always for a double charge?
6. What Pro adds over Free when it's paid: today it's an email after every sweep and a choice of categories.
7. GST: included in the price or added on top (row 5)?

## Step 3: variables (test mode first)

Add to Vercel, **Preview only** to start, so test keys never reach Production:

| Name | Value | Sensitive |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_test_...` | No (it's shown in the browser by Checkout) |
| `RAZORPAY_KEY_SECRET` | test secret | Yes |
| `RAZORPAY_WEBHOOK_SECRET` | the secret set on the test webhook | Yes |
| `RAZORPAY_PLAN_ID` | test plan id (add `RAZORPAY_PLAN_ID_YEARLY` if there's a yearly plan) | No |

Preview deployments are behind Vercel Authentication by default (DEPLOYMENT.md 8), which blocks Razorpay's webhook
calls. For webhook testing, use a deployment protection bypass for that path, or test on a separate Vercel project.
**Verify** the current options.

## Acceptance criteria

- [ ] Gate table filled in, and the decision recorded in decisions.md
- [ ] Every prerequisite box ticked, or a dated note on why it's waiting
- [ ] Test-mode variables set for Preview only
