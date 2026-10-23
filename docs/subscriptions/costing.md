# What it costs to run

What one sweep, one email, one live-board view and one payment cost, what that adds up to at different sizes, and
what the Pro price has to cover. **The price itself is the owner's decision**; this doc gives the floor and the risks.

- Written 2026-10-23, then **revised the same day after an audit against the code** (see
  [What the audit changed](#what-the-audit-changed)).
- Every provider price was read from the provider's page on **2026-10-23**, and each one names its source.
- Dollar figures are converted at **₹94.50 to $1**, the rupee's early-trade rate on 22 Oct 2026
  ([Deccan Herald][dh]). Other quotes that day were 94.3 to 94.8.
- A month is **30.4 days**.
- Recheck the prices and the rate before setting or changing the price.

**How sure each figure is.** Every figure carries one of these labels:

| Label | Meaning |
|---|---|
| **Measured** | Read from production run logs |
| **Price** | Read from the provider's pricing page |
| **Code** | Read from this repository's code |
| **Estimate** | Worked out from the code and prices, not observed |
| **Assumption** | A number chosen to illustrate. Not a forecast |
| **Unknown** | No source found. Needs the owner, a provider or a tax adviser |

## Summary

- **The cost is almost all fixed.** About ₹6,797 a month with Vercel Pro and Resend Pro. The AI sweep is ₹3,017 of
  that, and it costs the same for 1 subscriber or 1,000.
- **No user can make the AI run.** Only the holder of `CRON_SECRET` can trigger a sweep. A heavy reader costs about
  ₹1 a month. So a flat subscription fits the cost; credits or pay-per-run would charge for something that costs
  nothing.
- **Break-even at ₹199 a month is 36 Pro members**, or 42 if GST is inside the price. At ₹299 it is 24 or 28.
- **The biggest risks are on the fixed side**: more sweeps than planned, a dearer model, a leaked `CRON_SECRET`, and
  the code's worst-case sweep, which costs 5 times the measured one.
- **Not known yet**: tax treatment, the UPI AutoPay fee, chargeback fees, the domain cost, and how many sweeps
  actually run each day.

## Prices used

| Provider | What | Price | Source |
|---|---|---|---|
| Anthropic | `claude-sonnet-5-5`, the sweep's model | $2 per million input tokens, $10 per million output tokens | [Pricing][anthropic] |
| Anthropic | Web search tool | $10 per 1,000 searches. The pages it returns are billed as input tokens | [Pricing][anthropic] |
| Vercel | Hobby | Free, but for personal, non-commercial use only. Taking payments needs Pro | [Pricing][vercel] |
| Vercel | Pro | $20 a month per seat, with $20 of usage credit included | [Pricing][vercel] |
| Vercel | Usage on Pro | Function invocations $0.60 per million. Blob simple operations (reads) $0.40 per million; advanced operations (writes, lists) $5 per million | [Pricing][vercel] |
| Resend | Free | $0, up to 3,000 emails a month and **100 a day** | [Pricing][resend] |
| Resend | Pro | $20 a month for 50,000 emails, or $35 for 100,000. **No daily limit.** $0.90 per 1,000 beyond the plan | [Pricing][resend] |
| Razorpay | Platform fee | 2% on domestic cards, UPI and netbanking. Up to 3% on international cards | [Pricing][razorpay] |
| Razorpay | Subscriptions | An extra 0.9% on card subscriptions. UPI and eMandate subscriptions: "on request", so **unknown** | [Pricing][razorpay] |
| Razorpay | GST | 18% on Razorpay's fee | [Pricing][razorpay] |

## Fixed and variable costs

| Cost | Fixed or variable | Grows with |
|---|---|---|
| Anthropic (sweeps) | **Fixed** | Sweeps a day, the model and its prices. Not users |
| Vercel Pro seat | **Fixed** | Nothing at this size |
| Resend plan | **Stepped** | Emails a month: $0, then $20, $35, then per 1,000 |
| Vercel usage (functions, Blob) | Variable | Page views and subscriber records. Inside the $20 credit at every size below |
| Razorpay fee | Variable | Each charge: 3.42% |
| Domain | Fixed | **Unknown**: owner input |
| Accountant, marketing, owner's time | Fixed | **Unknown**: owner input |

## One sweep

**Code.** A sweep makes 4 calls to Anthropic, one per category (`api/_lib/radar.js`). Each call has:
- `max_tokens: 16000`;
- web search with `max_uses: 3`.

The model is `claude-sonnet-5-5` unless the `RADAR_MODEL` variable names another (`api/_lib/handlers.js`).

**Measured.** The sweep's reply includes `usage: { input, output, searches }`, summed over its four calls. These are
the last five successful scheduled runs in GitHub Actions:

| Run | Started (UTC) | Input tokens | Output tokens | Searches | Cost |
|---|---|---|---|---|---|
| 39693246842 | 2026-10-21 23:24 | 56,086 | 4,265 | 4 | $0.1948 |
| 39725220872 | 2026-10-22 04:56 | 63,231 | 4,329 | 5 | $0.2198 |
| 39761812156 | 2026-10-22 10:16 | 62,591 | 4,355 | 5 | $0.2187 |
| 39804347117 | 2026-10-22 15:23 | 62,464 | 4,407 | 5 | $0.2190 |
| 39871786767 | 2026-10-22 23:26 | 56,775 | 4,417 | 4 | $0.1977 |
| **Average** | | **60,229** | **4,355** | **4.6** | **$0.2100 (≈ ₹19.85)** |

```
cost of a sweep = input × $2/M + output × $10/M + searches × $0.01
```

- The average splits into $0.120 for input, $0.044 for output and $0.046 for searches.
- Five runs is a small sample. The spread was $0.195 to $0.220.

### Sweeps a month

The scheduled sweep has two triggers:
- **GitHub Actions** at `17 */5 * * *`: 5 times a day.
- **A Vercel cron** at 01:30 UTC as a backstop.

A scheduled sweep is skipped if the last scheduled one is under 2 hours old. Manual runs skip that check.

**Measured.** GitHub's runs start 3 to 5 hours late. GitHub ran 4 sweeps on 22 Oct, and the 00:17 run hadn't
happened by 04:30 UTC on 23 Oct.

**Estimate.** The last GitHub run of the day ends about 23:25 UTC, just over 2 hours before the Vercel cron. So the
Vercel cron probably sweeps every day. Hobby keeps logs under an hour, so this is **not measured**.

Plan for 4 to 6 sweeps a day until it is counted (see the [measurement checklist](#measurement-checklist)):

| Sweeps a day | Sweeps a month | $ a month | ₹ a month |
|---|---|---|---|
| 4 | 122 | 25.54 | 2,413 |
| **5 (used below)** | **152** | **31.92** | **3,017** |
| 6 | 182 | 38.30 | 3,620 |

### Worst case

The code caps one sweep at 12 searches (4 × 3) and 64,000 output tokens (4 × 16,000). Input has no cap in the code.
It grows with the pages searches return.

| Part | Worst case | Label | Cost |
|---|---|---|---|
| Searches | 12 | Code | $0.120 |
| Output | 64,000 tokens | Code | $0.640 |
| Input | ≈ 157,000 tokens: 12 × the measured 13,093 input tokens per search | Estimate | $0.314 |
| **One sweep** | | | **$1.07 (≈ ₹101)** |
| **A month at 152 sweeps** | | | **$163 (≈ ₹15,430)** |

That's 5 times the measured average. None of the 5 measured runs came close.

### Failed runs

- **Measured.** The sweep workflow ran 7 times from 21 Oct. 5 succeeded. The 2 that failed stopped before calling
  Anthropic, because `CRON_SECRET` wasn't set yet, so they cost **$0**.
- **Code.** A category whose call answered but whose reply couldn't be used is billed. The code adds that call's
  usage to the sweep's total, so those costs are already in the measured figures.
- **Code.** A call that gets an HTTP error from Anthropic records no usage. Whether Anthropic bills such a call is
  **unknown**.
- **Code.** There are no retries. A failure costs at most the sweep it happened in.
- **Cost per successful sweep** = cost per sweep ÷ the share that succeed. Billed failures so far: 0 of 5.

## One email

**Code.**
- The owner gets one email on every sweep that ran, scheduled or manual, saved or empty.
- Each Pro member gets one email per saved **scheduled** sweep that has items in their categories. That's at most 5
  a day.
- Each Free member gets one email a day.
- Sign-up confirmations are capped at 10 a day and sign-in codes at 50 a day by default (`api/_lib/subscription-handlers.js`).
- All of these come from the same Resend account.

| Who | Emails a month |
|---|---|
| Owner | 152 |
| Each Pro | up to 152 |
| Each Free | 30 |
| Sign-ins and confirmations, all users together | up to 1,824 at the default caps |

| Situation | Cost of one more email |
|---|---|
| Resend Free | $0, until 100 a day or 3,000 a month |
| Resend Pro, within the plan | $0 extra; the plan price is a fixed cost |
| Resend Pro, past the plan | $0.0009 (≈ ₹0.085) |

**On Resend Free, the 100-a-day cap binds first:**

```
5 (owner) + 5 × Pro + Free + sign-ins and confirmations  <=  100 a day
```

For example, 20 Free accounts leave room for at most 15 Pro. A day with many sign-ins can use up the room the
digests need. **Resend Pro has no daily limit**, so budget for it from the first paying member.

## One live-board view

Estimated from the code. Vercel's usage pages weren't read. With `BOARD_PAYWALL=1`, as in production:

| Page and visitor | Function calls | Blob reads |
|---|---|---|
| Home page, signed-in Pro | 3 (`/api/session?action=me`, then `/api/data` for history and the latest sweep) | 5 (the session's record on each call, plus the two values) |
| `/live/`, signed-in Pro | 3 (`/api/data` for `seenIds`, history and the latest sweep) | 4 (`seenIds` is refused with `400` before any read) |
| Any page, signed out | 2 to 3 | 0 (no cookie means nothing is read) |

- A signed-in view costs about 3 × $0.60/M + 5 × $0.40/M ≈ **$0.0000038 (≈ ₹0.00036)**.
- That's **≈ ₹0.36 per 1,000 views**. A very heavy reader, 100 views a day, costs about **₹1.09 a month**.
- Each sweep also reads every subscriber record once. At 1,000 records that's about $0.06 a month.
- **Not measured:** CPU time, data transfer and static-file requests. At this project's size, all are expected to
  stay inside Vercel Pro's $20 credit. Check that on the usage page after the move to Pro.

## One payment

On a card subscription, Razorpay keeps **(2% + 0.9%) × 1.18 = 3.422% of each charge**.

| Price a month | Razorpay keeps | Net, GST added on top or not registered | Net, GST (18%) inside the price |
|---|---|---|---|
| ₹99 | ₹3.39 | ₹95.61 | ₹80.51 |
| ₹199 | ₹6.81 | ₹192.19 | ₹161.83 |
| ₹299 | ₹10.23 | ₹288.77 | ₹243.16 |
| ₹499 | ₹17.08 | ₹481.92 | ₹405.81 |

```
net, GST on top  = price × (1 − 0.03422)
net, GST inside  = price ÷ 1.18 − price × 0.03422
```

- These are before income tax. The prices only illustrate the formula.
- ₹99 is the price of the test-mode plan on `staging` and must not go live by accident.
- The fee is a percentage, so a yearly plan pays the same share as a monthly one.
- **Unknown:**
  - the fee for UPI AutoPay and eMandate subscriptions ("on request");
  - the rate for international cards in this account ("up to 3%");
  - Razorpay's chargeback fee;
  - whether Razorpay returns its fee when a payment is refunded.

  Instant refunds have a fee and standard refunds are free; recheck both on the [pricing page][razorpay].

**Code: what payments do and don't handle** (`api/_lib/subscription-handlers.js`):
- Pro is granted only by a signed Razorpay webhook. Duplicate and late events change nothing.
- A missed cancellation gives at most one paid period of Pro.
- **No refund or dispute handling.** A refunded or disputed payment leaves the account Pro until `proUntil`. Revoke it
  by hand with the admin script.
- **No reconciliation.** If Razorpay stops delivering webhooks, an account that paid stays Free and nothing checks
  later.
- **One plan only.** A yearly plan, upgrades or proration need new code.
- Pro granted by the owner has no `proUntil` and never expires, by design.

## Fixed monthly cost

| Item | $ a month | ₹ a month |
|---|---|---|
| Anthropic, 152 sweeps | 31.92 | 3,017 |
| Vercel Pro, 1 seat | 20.00 | 1,890 |
| **Without Resend Pro** | **51.92** | **4,907** |
| Resend Pro, 50,000 emails | 20.00 | 1,890 |
| **With Resend Pro (`F`, used below)** | **71.92** | **6,797** |

**$0:**
- GitHub Actions, since the repository is public;
- Slack alerts.

**Not included. Owner inputs, or questions for a tax adviser:**
- domain renewal (yearly price ÷ 12);
- tax, and the bank's forex markup on the dollar invoices from Anthropic, Vercel and Resend;
- an accountant;
- marketing;
- the owner's time;
- income tax.

## Cost by number of users

Free and paying users barely change the cost. Only the Resend plan steps up.

**Emails a month and the Resend plan they need** (excluding sign-ins and confirmations):

| Users | All Pro: emails | Resend | All Free: emails | Resend |
|---|---|---|---|---|
| 10 | 1,672 | Free ($0) | 456 | Free ($0) |
| 50 | 7,752 | Pro $20 | 1,672 | Free ($0) |
| 100 | 15,352 | Pro $20 | 3,192 | Pro $20 |
| 500 | 76,152 | Pro $35 | 15,352 | Pro $20 |
| 1,000 | 152,152 | Pro $35 + overage = $81.94 | 30,552 | Pro $20 |

Past 100,000 emails, each extra Pro adds about ₹12.93 a month and each extra Free about ₹2.59.

**An example mix.** **Assumption**, not a forecast: 20% Pro, 60% Free, 20% inactive (unconfirmed, unsubscribed or
emails stopped). Prices are ₹199 a month, with Vercel Pro and Resend Pro in every row:

| Users | Pro / Free / inactive | Emails a month | Cost a month | Per paying member | Per active user | Net revenue, GST on top | Profit or loss, GST on top / GST inside |
|---|---|---|---|---|---|---|---|
| 10 | 2 / 6 / 2 | 638 | ₹6,797 | ₹3,398 | ₹850 | ₹384 | −₹6,412 / −₹6,473 |
| 50 | 10 / 30 / 10 | 2,584 | ₹6,797 | ₹680 | ₹170 | ₹1,922 | −₹4,875 / −₹5,178 |
| 100 | 20 / 60 / 20 | 5,016 | ₹6,797 | ₹340 | ₹85 | ₹3,844 | −₹2,953 / −₹3,560 |
| 500 | 100 / 300 / 100 | 24,472 | ₹6,797 | ₹68 | ₹17 | ₹19,219 | ₹12,423 / ₹9,387 |
| 1,000 | 200 / 600 / 200 | 48,792 | ₹6,797 | ₹34 | ₹8 | ₹38,438 | ₹31,642 / ₹25,570 |

- "Per paying member" = cost ÷ Pro. "Per active user" = cost ÷ (Pro + Free).
- Inactive records cost about ₹0.006 a month each, from the sweep reading every record.
- 1,000 users at this mix is just under Resend Pro's 50,000 emails.

## Break-even

Three different break-evens:

1. **Fixed-cost break-even.** Enough Pro members to cover `F` (₹6,797 a month):

   | Pro price a month | GST added on top, or not GST-registered | GST (18%) inside the price |
   |---|---|---|
   | ₹99 | 72 | 85 |
   | ₹199 | 36 | 42 |
   | ₹299 | 24 | 28 |
   | ₹499 | 15 | 17 |

   ```
   GST on top:   members = F / (price × (1 − 0.03422))
   GST inside:   members = F / (price / 1.18 − price × 0.03422)
   ```

   Each count is rounded up.

2. **Contribution break-even.** The point where each member's fee covers the cost that member adds.
   - Inside the Resend plan, a member adds about ₹0 a month: an email costs nothing extra, and a view costs about
     ₹0.0004. So every price above clears it from the first member.
   - Past 100,000 emails a month, a Pro adds about ₹12.93. That is still well under any net price above.
   - So in practice break-even equals the fixed-cost count.

3. **Full business break-even.** `F` plus the costs that aren't in this doc yet: domain, accountant, marketing, the
   owner's time and income tax. **Unknown until the owner gives them.**
   - Each extra ₹1,000 a month needs 6 more Pro at ₹199 with GST on top, or 7 with GST inside.
   - Formula: `members = (F + other monthly costs) / net per member`.

Whether GST applies, and whether the price includes it, is for a tax adviser
([questions below](#tax-and-legal-questions-for-a-ca)).

## Stress tests

Members needed at each price, GST on top / GST inside. The AI share of `F` scales; Vercel and Resend stay the same.

| Scenario | `F` a month | ₹99 | ₹199 | ₹299 | ₹499 |
|---|---|---|---|---|---|
| Today, 5 sweeps a day | ₹6,797 | 72 / 85 | 36 / 42 | 24 / 28 | 15 / 17 |
| 4 sweeps a day | ₹6,193 | 65 / 77 | 33 / 39 | 22 / 26 | 13 / 16 |
| 6 sweeps a day | ₹7,400 | 78 / 92 | 39 / 46 | 26 / 31 | 16 / 19 |
| 1 sweep in 10 fails after being billed | ₹7,132 | 75 / 89 | 38 / 45 | 25 / 30 | 15 / 18 |
| AI cost +25% | ₹7,551 | 79 / 94 | 40 / 47 | 27 / 32 | 16 / 19 |
| AI cost +50% | ₹8,305 | 87 / 104 | 44 / 52 | 29 / 35 | 18 / 21 |
| AI cost +100%, or 10 sweeps a day | ₹9,813 | 103 / 122 | 52 / 61 | 34 / 41 | 21 / 25 |
| Every sweep at the worst case | ₹19,210 | 201 / 239 | 100 / 119 | 67 / 80 | 40 / 48 |

**Other stresses:**

- **Heavy users, 3 to 5 times normal use.** No change that matters:
  - views cost about ₹1 a month even at 100 a day;
  - a Pro's emails don't depend on use.
- **Free-user abuse.**
  - Each fake Free account costs 30 emails a month. Inside the Resend plan that is ₹0, until it pushes the plan up a
    step.
  - Email sign-ups are slowed by the 10-confirmations-a-day cap and a per-IP limit.
  - Google sign-ups skip the confirmation cap and are limited only by the per-IP limit and `MAX_SUBSCRIBERS`, which
    applies only if set. **Check whether `MAX_SUBSCRIBERS` is set in production.**
- **Churn.** Churn doesn't change cost; it changes how many new members are needed.
  - To hold N members, about N × monthly churn new members are needed each month.
  - Example, with churn an **assumption**: holding 36 members at 10% monthly churn needs about 4 new ones a month.
- **Outages.**
  - **Anthropic down:** the sweep fails, the owner is told, and the next sweep runs as usual. Whether an errored call
    is billed is unknown (see [Failed runs](#failed-runs)).
  - **Resend quota or outage:** sends stop. Free deliveries are remembered per day, and Pro sends use idempotency
    keys, so nothing is sent twice.
- **Runaway spend.** Anyone holding `CRON_SECRET` can start manual sweeps with no limit in the code. 100 manual sweeps
  cost $21 at the measured average, or up to $107 at the worst case.

## Pricing options compared

| Option | Fits the cost? | Net to the owner | Build work | Verdict |
|---|---|---|---|---|
| **Monthly subscription** (one Razorpay plan) | Yes: cost is fixed a month | ₹192.19 at ₹199; ₹288.77 at ₹299 (GST on top) | None: built (T20, T21) | **Recommended** |
| Yearly plan at 10 × monthly (₹1,990 or ₹2,990) | Yes | ₹1,921.90 or ₹2,887.68 a year, against ₹2,306.28 or ₹3,465.22 for 12 monthly payments: about 17% less a member, paid up front | A second Razorpay plan, a plan choice in checkout, pricing page | Later, only if up-front cash matters |
| Credits or pay-per-run | No: users don't cause the AI cost | Unclear | Large: metering, balances, top-ups | Not recommended |
| Free tier | Costs about ₹0 a member inside the Resend plan | — | Built | Keep it. It shows the product, and the sample demo already exists |

**What the numbers don't say: what people will pay.**
- The repository has no demand data and no paying users yet. These costs set a floor, not the price.
- If 20 to 40 paying members early on is realistic, ₹299 breaks even at 24 to 28, and ₹199 needs 36 to 42.

## Risks and safeguards

| Risk | Effect | Safeguard | Status |
|---|---|---|---|
| `CRON_SECRET` leaks | Unlimited manual sweeps: $21 to $107 per 100 | A monthly spend limit and alert in the Anthropic Console; cap manual sweeps a day in code | Console: **owner to check**. Code: needs approval |
| `RADAR_MODEL` set to a dearer model | Every sweep costs more | Note the cost before changing it; or have the code accept only listed models | Process only |
| More sweeps than planned (cron overlap, retries) | Up to ₹3,620 a month at 6 a day | Count sweeps for a week (measurement checklist) | Not measured |
| A worst-case sweep | Up to $1.07 each | A spend alert in the Console; watch `usage` in the run logs | Not set up |
| Sign-ins use up Resend Free's 100 a day | Digests stop | Resend Pro before the first paying member | Planned |
| Webhooks stop arriving | Paid accounts stay Free | Razorpay disables a failing webhook after a day of failures; check it's Enabled; compare Razorpay's active subscriptions with Pro records weekly by hand | Manual |
| Refund or chargeback | The account stays Pro | Revoke by hand; a webhook handler for refunds and disputes later | Manual |
| Vercel Hobby used commercially | Breach of Vercel's terms | Move to Pro before live payments | Planned |

## Tax and legal questions for a CA

Not answered here. Ask a chartered accountant in India:

1. Does the business need GST registration now, and from what turnover? Should the price include GST or add it?
2. Is GST due on the imported services from Anthropic, Vercel and Resend under reverse charge? Can it be claimed back?
3. Can the 18% GST on Razorpay's fee be claimed back?
4. How is the subscription income taxed, and what records are needed?
5. Do international card payments change anything, such as export of services?
6. Does a refund or a cancellation rule need anything specific on the Terms and Refunds pages?

## Measurement checklist

| # | What | How | Why |
|---|---|---|---|
| 1 | Sweeps a day | For 7 days, count the sweeps in the History tab on `/live/`. Look for one at about 01:30 UTC (07:00 IST). Or use the Anthropic Console usage page | Sets the AI cost: 4, 5 or 6 a day |
| 2 | Real Anthropic spend | Console usage and cost for a full month, against 152 × $0.21 | Confirms the per-sweep figure, including Vercel-cron sweeps, which no log shows |
| 3 | More sweep samples | Read `usage` from 20 or more run logs (see [How to re-measure](#how-to-re-measure)) | 5 runs is a small sample |
| 4 | Emails a day | The Resend dashboard, including sign-ins and confirmations | Shows when the plan steps up |
| 5 | Vercel usage | The usage page after moving to Pro: invocations, CPU, Blob operations | Confirms the $20 credit covers it |
| 6 | Razorpay fee | The settlement report for the first live charges | Confirms 3.42% |
| 7 | UPI AutoPay fee, chargeback fee, refund fee | Ask Razorpay support | **Unknown** today |
| 8 | Forex markup | The card or bank statement for one dollar invoice | Adds to Anthropic, Vercel and Resend |
| 9 | Domain renewal | The registrar | Owner input |

## Pre-launch checklist

**P0: before the first live payment**
- [ ] Price chosen, and the GST question answered by a CA.
- [ ] Vercel Pro (Hobby is non-commercial only).
- [ ] Resend Pro, or keep Pro under about 15 members.
- [ ] A monthly spend limit and an alert set in the Anthropic Console.
- [ ] A live Razorpay plan at the chosen price in `RAZORPAY_PLAN_ID` on Production, the same as `/pricing/`. The ₹99
      test plan is not used.
- [ ] The Razorpay webhook is Enabled for the live account, with `RAZORPAY_WEBHOOK_SECRET` set on Production.
- [ ] Contact, Terms and Refunds published. The build ships only Privacy today
      ([pricing-and-about-pages.md](pricing-and-about-pages.md)).
- [ ] A written manual step for refunds and chargebacks: refund in Razorpay, then revoke Pro with the admin script.

**P1: in the first month**
- [ ] Count sweeps a day (measurement 1) and read real Anthropic spend (measurement 2).
- [ ] Cap manual sweeps a day in code (needs approval).
- [ ] Check whether `MAX_SUBSCRIBERS` is set in production.
- [ ] A weekly manual check: Razorpay's active subscriptions against Pro records.

**P2: later**
- [ ] Revoke Pro automatically on refund and dispute events.
- [ ] A reconciliation job against Razorpay.
- [ ] A yearly plan, if wanted.
- [ ] Measure whether the newer web search tool (`web_search_20260209`, dynamic filtering) lowers input tokens. That
      needs a code change and a measured comparison.

## Next actions

| Action | Who | Effort | Impact |
|---|---|---|---|
| Answer the owner inputs: price, GST, trial, refund rule, international cards, About text, domain | Owner | Low | Unblocks the Pricing page and go-live |
| Book a CA for the tax questions | Owner | Medium | Decides the price column and compliance |
| Set an Anthropic spend limit and alert | Owner | Low | Caps the worst case and a leaked secret |
| Count sweeps for 7 days; read a month of Console spend | Owner | Low | Replaces the 4-to-6-a-day range with a measured figure |
| Upgrade Vercel and Resend before the first live charge | Owner | Low | Needed for commercial use and the email volume |
| Cap manual sweeps in code | Claude, after approval | Low | Closes the runaway-spend gap |
| Refund and dispute handling in the webhook | Claude, after approval | Medium | Removes a manual step |
| Re-measure this doc after the first month | Owner and Claude | Low | Keeps the price honest |

## What the audit changed

Checked against the code, the Actions run history and the providers' pages on 2026-10-23:

| First version said | Finding | Now |
|---|---|---|
| Failed runs are billed but not measured | **Incorrect.** The 2 failed runs never called Anthropic ($0). Billed partial failures are already in the measured usage | [Failed runs](#failed-runs) |
| The Vercel backstop "usually answers skipped" | **Probably incorrect.** It likely sweeps daily | [Sweeps a month](#sweeps-a-month): planned as 4 to 6 a day |
| Resend's 100 a day is the real limit | **Incomplete.** True on Free only; Pro has no daily limit. Sign-ins share it | [One email](#one-email) |
| Break-even | **Incomplete.** It covered running costs only | Three break-evens |
| The ₹1,999 yearly example | **Misleading.** The code supports one plan | Yearly plan under [Pricing options](#pricing-options-compared) |
| Not in the first version | **Missing**: worst-case sweep; manual-sweep runaway; `RADAR_MODEL`; refunds and chargebacks; reconciliation; tax questions; cost by user count | Added |
| Per-sweep cost, prices, fee formula, live-view estimate | **Correct.** Re-checked | Kept |

**Limits of this audit:**
- no access to the Anthropic Console, the Vercel usage pages or the Resend dashboard;
- Vercel Hobby keeps logs under an hour;
- only 5 measured sweeps.

## How to re-measure

1. Open the `sweep` workflow in the repository's Actions tab, and pick a few successful scheduled runs.
2. In each run's log, find `"usage":{"input":…,"output":…,"searches":…}` in the sweep's reply. Or run
   `gh run view <run id> --log | grep -o '"usage":{[^}]*}'`.
3. Cost per run = input × input price + output × output price + searches × search price, at the current
   [Anthropic prices][anthropic].
4. Recheck the Vercel, Resend and Razorpay pages and the exchange rate. Then redo the fixed cost, the break-even and
   the stress tables.

[anthropic]: https://platform.claude.com/docs/en/about-claude/pricing
[vercel]: https://vercel.com/pricing
[resend]: https://resend.com/pricing
[razorpay]: https://razorpay.com/pricing/
[dh]: https://www.deccanherald.com/business/markets/rupee-falls-12-paise-to-9450-against-us-dollar-in-early-trade-4190973
