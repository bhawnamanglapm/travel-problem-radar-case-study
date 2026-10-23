# What it costs to run

What one sweep, one email, one live-board view and one payment actually cost, so the Pro price covers them.

- Every price below was read from the provider's page on **2026-10-23**. Each one names its source.
- Sweep usage is **measured** from production runs.
- Anything else is marked **estimated from the code** or **not measured**.
- Dollar figures are converted at **₹94.50 to $1**. That was the rupee's early-trade rate on 22 Oct 2026
  ([Deccan Herald][dh]); other quotes that day were 94.3 to 94.8.
- Recheck the prices and the rate before setting or changing the price.

## Prices used

| Provider | What | Price | Source |
|---|---|---|---|
| Anthropic | `claude-sonnet-5-5`, the sweep's model | $2 per million input tokens, $10 per million output tokens | [Pricing][anthropic] |
| Anthropic | Web search tool | $10 per 1,000 searches. The pages it returns are billed as input tokens, and a search that errors isn't billed | [Pricing][anthropic] |
| Vercel | Hobby | Free, but for personal, non-commercial use only. Taking payments needs Pro | [Pricing][vercel] |
| Vercel | Pro | $20 a month per seat, with $20 of usage credit included | [Pricing][vercel] |
| Vercel | Usage on Pro | Function invocations $0.60 per million. Blob simple operations (reads) $0.40 per million; advanced operations (writes, lists) $5 per million | [Pricing][vercel] |
| Resend | Free | $0, up to 3,000 emails a month and **100 a day** | [Pricing][resend] |
| Resend | Pro | $20 a month for 50,000 emails, then $0.90 per 1,000 | [Pricing][resend] |
| Razorpay | Platform fee | 2% on domestic cards, UPI and netbanking. Up to 3% on international cards | [Pricing][razorpay] |
| Razorpay | Subscriptions | An extra 0.9% on card subscriptions. UPI and eMandate subscriptions: "on request", so **not known** | [Pricing][razorpay] |
| Razorpay | GST | 18% on Razorpay's fee | [Pricing][razorpay] |

## One sweep

The sweep's reply includes `usage: { input, output, searches }`, summed over its four category calls. These are
the last five successful scheduled runs in GitHub Actions:

| Run | Started (UTC) | Input tokens | Output tokens | Searches | Cost |
|---|---|---|---|---|---|
| 39693246842 | 2026-10-21 23:24 | 56,086 | 4,265 | 4 | $0.1948 |
| 39725220872 | 2026-10-22 04:56 | 63,231 | 4,329 | 5 | $0.2198 |
| 39761812156 | 2026-10-22 10:16 | 62,591 | 4,355 | 5 | $0.2187 |
| 39804347117 | 2026-10-22 15:23 | 62,464 | 4,407 | 5 | $0.2190 |
| 39871786767 | 2026-10-22 23:26 | 56,775 | 4,417 | 4 | $0.1977 |
| **Average** | | **60,229** | **4,355** | **4.6** | **$0.2100 (≈ ₹19.85)** |

- The average splits into $0.120 for input, $0.044 for output and $0.046 for searches.
- Cost per run = input × $2/M + output × $10/M + searches × $0.01.

**Per month:**
- GitHub Actions runs the sweep 5 times a day, about 152 times a month.
- That's **≈ $31.92 (≈ ₹3,016) a month**.
- The cost doesn't change with the number of subscribers. The sweep runs the same for 1 subscriber or 1,000.

**Not measured:**
- **Failed runs.** Anthropic bills the tokens a failed run used, but the logs don't show a failed run's usage.
- **The Vercel daily backstop cron.** It usually answers "skipped" and costs nothing at Anthropic. When it does
  sweep, that's one more run at the price above.

## One email

| Situation | Cost of one more email |
|---|---|
| Resend Free | $0, until the 100-a-day cap |
| Resend Pro, within 50,000 a month | $0 extra (the $20 is a fixed cost) |
| Resend Pro, past 50,000 | $0.0009 (≈ ₹0.085) |

**Emails per subscriber:**
- A Pro subscriber gets up to 5 a day, about 152 a month.
- A Free subscriber gets 1 a day, about 30 a month.
- With 50,000 emails a month, Resend Pro covers about 328 Pro subscribers before overage starts.
- Past that, each extra Pro costs about 152 × $0.0009 ≈ $0.137 (≈ ₹13) a month.

**The 100-a-day cap is the real limit on Resend Free**, not the cost:

```
5 (owner) + free + (5 × pro) + sign-in and confirm emails  <=  100 a day
```

- For example, with 20 Free accounts there's room for at most 15 Pro.
- That is far below break-even at any price in the table below. So budget for Resend Pro from the start of paid Pro.

## One live-board view

Estimated from the code; Vercel's usage pages weren't read. With `BOARD_PAYWALL=1`, as in production:

| Page and visitor | Function calls | Blob reads |
|---|---|---|
| Home page, signed-in Pro | 3 (`/api/session?action=me`, then `/api/data` for history and the latest sweep) | 5 (the session's record on each call, plus the two values) |
| `/live/`, signed-in Pro | 3 (`/api/data` for `seenIds`, history and the latest sweep) | 4 (`seenIds` is refused with `400` before any read) |
| Any page, signed out | 2 to 3 | 0 (no cookie means nothing is read) |

- A signed-in view costs about 3 × $0.60/M + 5 × $0.40/M ≈ **$0.0000038 (≈ ₹0.00036)**.
- That's **≈ ₹0.36 per 1,000 views**, well inside the $20 credit that comes with Vercel Pro.
- **Not measured:** CPU time, data transfer and static-file requests. All three are also inside that credit at this
  project's size.
- The sweep's own Blob writes and lists happen 5 times a day. They are also a rounding error at these rates.

## One payment

On a card subscription, Razorpay keeps **(2% + 0.9%) × 1.18 = 3.42% of each charge**.

| Plan | Charge | Razorpay keeps | You receive (before GST and income tax) |
|---|---|---|---|
| ₹199 a month | ₹199 | ₹6.81 | ₹192.19 |
| ₹1,999 a year | ₹1,999 | ₹68.41 | ₹1,930.59 |

- The amounts above only illustrate the formula. **The price is the owner's choice.**
- The fee is a percentage, so a yearly plan pays the same share as a monthly one. It doesn't save fees.
- **Not known:**
  - the fee for UPI AutoPay and eMandate subscriptions ("on request");
  - the rate for international cards in this account ("up to 3%").

## Fixed monthly cost

| Item | $ a month | ₹ a month |
|---|---|---|
| Anthropic, 152 sweeps | 31.92 | 3,016 |
| Vercel Pro, 1 seat | 20.00 | 1,890 |
| **Without Resend Pro** | **51.92** | **4,906** |
| Resend Pro | 20.00 | 1,890 |
| **With Resend Pro** | **71.92** | **6,797** |

**$0:**
- GitHub Actions, since the repository is public.
- Slack alerts.

**Not included:**
- **Domain renewal.** The repo has no figure. Owner input: add the yearly price ÷ 12.
- **Tax or forex markup on the dollar invoices** (Anthropic, Vercel, Resend). Not checked; it depends on the card
  and on GST rules for imported services.
- **Owner time and income tax.**

## Break-even

These are the Pro subscribers needed to cover **₹6,797 a month** (with Resend Pro), after Razorpay's 3.42%:

| Pro price a month | GST added on top, or not GST-registered | GST (18%) inside the price |
|---|---|---|
| ₹99 | 72 | 85 |
| ₹199 | 36 | 42 |
| ₹299 | 24 | 28 |
| ₹499 | 15 | 17 |

```
GST on top:      subscribers = 6,797 / (price × (1 − 0.0342))
GST inside:      subscribers = 6,797 / (price / 1.18 − price × 0.0342)
```

- Each count is rounded up.
- ₹99 is only the price of the test-mode plan used on `staging`. It is not a suggestion.
- Whether GST applies, and whether the price includes it, is a question for a tax adviser (T15 Step 2, row 5).
- Free accounts add email and no income. They don't change these counts while the email total stays within
  Resend Pro's 50,000 a month.

## How to re-measure

1. Open the `sweep` workflow in the repository's Actions tab and pick a few successful scheduled runs.
2. In each run's log, find `"usage":{"input":…,"output":…,"searches":…}` in the sweep's reply, or run
   `gh run view <run id> --log | grep -o '"usage":{[^}]*}'`.
3. Cost per run = input × input price + output × output price + searches × search price, using the current
   [Anthropic prices][anthropic].
4. Recheck the Vercel, Resend and Razorpay pages and the exchange rate. Then redo the fixed cost and the break-even
   table.

[anthropic]: https://platform.claude.com/docs/en/about-claude/pricing
[vercel]: https://vercel.com/pricing
[resend]: https://resend.com/pricing
[razorpay]: https://razorpay.com/pricing/
[dh]: https://www.deccanherald.com/business/markets/rupee-falls-12-paise-to-9450-against-us-dollar-in-early-trade-4190973
