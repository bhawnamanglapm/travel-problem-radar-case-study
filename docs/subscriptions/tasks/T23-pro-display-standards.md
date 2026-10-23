# T23 · How Pro is shown: transparency and UI/UX rules, owner inputs

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Owner (inputs) and developer (rules into `npm run check`) |
| Size | S |
| Depends on | — |
| Unblocks | T24, T25, T26 |

## Why

Today the site says Pro is "free while it's being tested". Before anyone can pay, every page that mentions Pro has to
say the same true things: what it costs, what it includes, that it renews, how to cancel and what happens to the
money. This task writes those rules down once, so T24 to T26 build to them and `npm run check` keeps them true later.

It also collects the owner's choices. Claude doesn't pick the price or the refund rule.

## Owner inputs (OWNER INPUT NEEDED)

The 7 inputs in [pricing-and-about-pages.md](../pricing-and-about-pages.md#owner-inputs): price, GST, trial, refund
rule, international cards, brand and about text, domain renewal. Input 1 is answered: ₹299 a month (2026-10-23,
from [costing.md](../costing.md#199-299-and-499-compared-provisional), now in `plan.json`). Two more come from this task:

| # | Question | Default if not answered | Affects |
|---|---|---|---|
| 8 | Offer a yearly plan as well as monthly? | Monthly only. One Razorpay Plan, one price to keep in step | T24, T27 |
| 9 | Contact for billing questions | `hello@pehchanthetraveller.com`, already on `/manage/` | T24, T25, T26 |

Until 1, 2 and 4 are answered, no page shows a price and T27 can't start.

## The rules

Each rule says where it comes from. Legal points are summaries from secondary sources, **not legal advice: verify at
build time** against the primary text, and with a CA or lawyer if the owner wants certainty.

### A. Price and billing (transparency)

| # | Rule | Source |
|---|---|---|
| A1 | The **full price** shows wherever Pro is offered: amount in ₹, the period ("a month"), and whether GST is included or added. Nothing is added later at checkout | CCPA dark-patterns guidelines 2023: "drip pricing" ([JSA](https://www.jsalaw.com/newsletters-and-updates/ccpa-issues-guidelines-for-prevention-and-regulation-of-dark-patterns-2023/), [Mondaq](https://www.mondaq.com/india/dodd-frank-consumer-protection-act/1379670/understanding-dark-patterns-guidelines-for-consumer-protection)) |
| A2 | **"Renews automatically every month until you cancel"** sits next to every button that starts a payment, not only in the terms | CCPA guidelines: "subscription trap" |
| A3 | **Cancel is as easy as buying.** One place (`/manage/`), at most two clicks, no reason asked, no offer screen in between, no email needed. `/pricing/` says how | CCPA guidelines: "subscription trap" |
| A4 | The **refund rule** is the same text on `/pricing/`, `legal/refunds/`, the cancel step on `/manage/` and the unsubscribe page. One source for it (T24's `plan.json`) | Consistency. Consumer Protection (E-Commerce) Rules 2020, **verify** the exact display duties ([SNR](https://www.snrlaw.in/e-commerce-rules-2020/)) |
| A5 | **Automatic renewals are explained:** the first payment is approved by the payer; later ones are charged without a fresh approval, and a notice comes before each charge. **Verify** who sends the notice (bank, card network or Razorpay) and the current limit before writing it | RBI e-mandate framework ([RBI](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12341), [NPCI](https://www.npci.org.in/PDF/npci/rupay/2022/Circular-RuPay-AutoPay-AFA-Limit-enhancement-and-compliance.pdf), [Chargebee on Razorpay](https://chargebee.com/docs/razorpay-rbi-e-mandate.html)) |
| A6 | **Payment methods** listed as they are switched on in Razorpay for subscriptions (cards, UPI AutoPay, others). **Verify** in the dashboard; don't list a method that isn't on | Avoid a false claim |
| A7 | **What happens after paying** is stated: Pro starts in a minute or two, the renewal date shows on `/manage/`, where the receipt comes from (**verify** Razorpay's receipt email for subscriptions) | Fewer support emails |
| A8 | **A failed renewal** is explained: Pro continues while Razorpay retries; if it stops retrying, the account goes back to Free and nothing more is charged | Matches T21's `pending` / `halted` handling |

### B. Honest content

| # | Rule |
|---|---|
| B1 | Free is shown next to Pro in the same table, in the same order, so the difference is plain |
| B2 | Pro's limits are stated: items are gathered by an AI model with web search and **aren't checked by a person**; sweeps are about 5 a day and can run late when GitHub delays them; there's no uptime promise |
| B3 | No invented numbers: no member counts, testimonials, ratings, "most popular" badges or savings claims unless there's a source in the repo |
| B4 | No false urgency: no countdowns, "only N left", or "price goes up soon" unless it's true and dated |
| B5 | No confirm-shaming: a decline button says "Not now" or "Keep Free", never something that mocks the reader |
| B6 | No pre-ticked boxes. The "I'd also like Pro" box on `/signup/` stays unticked unless the person clicked a Pro button to get there (`?pro=1`, today's behaviour) |
| B7 | The same words everywhere: "Free", "Pro", "a month", "renews", "cancel". No "membership" on one page and "subscription" on another |

### C. UI/UX and accessibility

| # | Rule | Source |
|---|---|---|
| C1 | The plans read as two cards or a two-column table: plan name, price, one-line summary, feature list in the same order, one button each. Pro's button is the main one; Free's isn't hidden | Common pricing-page practice |
| C2 | Text contrast at least 4.5:1, large text 3:1, in light and dark | WCAG 2.2 AA, 1.4.3 |
| C3 | Everything works by keyboard; focus is always visible and not hidden behind a sticky header | WCAG 2.2, 2.1.1, 2.4.7, 2.4.11 |
| C4 | Buttons and links at least 24 × 24 CSS px (aim for 44 on phones) | WCAG 2.2, 2.5.8 |
| C5 | The comparison table uses `<th scope>` headers; the price reads as words to a screen reader ("₹N a month", not "₹N/mo") | WCAG 2.2, 1.3.1 |
| C6 | Status changes (payment received, cancelled) are announced, as `/manage/` already does with `aria-live` | WCAG 2.2, 4.1.3 |
| C7 | No meaning by colour alone: "Pro" and "Free" are words, not just colours | WCAG 2.2, 1.4.1 |
| C8 | Works at 360 px wide with no sideways scrolling; the table stacks into cards on phones | WCAG 2.2, 1.4.10 |
| C9 | Pages stay static: no new serverless function (9 of 12 used on Hobby) | `vercel.json` |

WCAG source: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) (**verify** the criterion numbers when building).

## What to build

- This file is the checklist. T24 to T26 each tick the rules they touch in their pull request.
- `scripts/check.mjs` gets the rules a script can check (T24 adds the checks with the page):
  - every shipped page that says "Pro" and a ₹ amount also says "renews" and links `/pricing/` or `/manage/` (A1, A2);
  - no `checked` attribute on the Pro box in `signup/index.html` (B6);
  - none of these words on shipped pages: "only * left", "hurry", "limited time", "most popular" (B3, B4);
  - every `<table>` on the shipped pages has `<th scope=` (C5).
- Contrast, keyboard and phone width are checked by hand and written in the pull request (C2 to C4, C8). No new
  npm package for automated accessibility testing unless the owner agrees.

## Acceptance criteria

- [ ] Owner inputs 1 to 9 answered and recorded in [decisions.md](../../decisions.md), or marked "later" with what
  stays blocked
- [ ] Each legal point in A1 to A5 checked against the primary text, with the date and link in the pull request
- [ ] The script checks above in `npm run check`, with a failing example tried for each

## Tests

- `npm run check` fails on: a ticked Pro box, a table with no `scope`, "hurry" on a page, a ₹ amount with no
  "renews". Each tried once and reverted
