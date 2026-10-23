# What it costs to run

What one sweep, email, live-board view, and payment cost; how that changes with scale; and what the Pro price must cover. **The price is the owner's decision.** This document sets out the cost floor, assumptions, and risks.

- Revised: 2026-10-23, using the owner's latest costing draft.
- Provider prices are the prices recorded in that draft as of 2026-10-23; they have **not been independently re-verified in this rewrite**. Check official pages and account invoices before launch.
- USD conversion assumption: ₹94.50 per USD.
- Month assumption: 30.4 days.
- Calculations should use unrounded USD values. Displayed INR values are approximate; round budget totals up conservatively.

## Confidence labels

| Label | Meaning |
|---|---|
| **Measured** | Observed in production run logs |
| **Price** | Provider price recorded in the source draft; recheck before launch |
| **Code** | Must be confirmed against current repository code |
| **Estimate** | Calculated from code assumptions and listed prices |
| **Assumption** | Illustrative input, not a forecast |
| **Unknown** | Requires an owner input, provider confirmation, or tax adviser |

## Executive summary

- **Baseline service budget:** about **₹6,797/month** at five sweeps/day, using Vercel Pro and Resend Pro, before domain, FX, taxes, support, marketing, owner time, and other business overhead.
- **AI cost is subscriber-independent only at a fixed sweep frequency.** Email costs step up with the number of users and sweep frequency; Vercel usage may also grow.
- **Illustrative fixed-cost break-even:** about 36 paying members at ₹199 or 24 at ₹299 if GST is added on top and the fee assumptions in this document apply; if GST is included in the displayed price, about 42 at ₹199 or 28 at ₹299. These are infrastructure/service-cost counts, not full business break-even.
- **Key unknowns:** actual sweeps/day, production billing, GST treatment, UPI AutoPay/eMandate fees, international-card rate, refund/chargeback fees, domain and other business overhead.
- **Provisional pricing candidate:** test ₹299/month against ₹199 only after confirming costs and tax treatment. There is no customer willingness-to-pay data in this model.

## Provider prices recorded in the source draft

| Provider | Item | Price assumption | Source |
|---|---|---|---|
| Anthropic | `claude-sonnet-5-5` | $2/M input tokens; $10/M output tokens | [Anthropic pricing][anthropic] |
| Anthropic | Web search | $10/1,000 searches; returned pages also consume input tokens | [Anthropic pricing][anthropic] |
| Vercel | Pro | $20/month/seat with $20 usage credit | [Vercel pricing][vercel] |
| Vercel | Usage | $0.60/M function invocations; Blob reads $0.40/M; advanced writes/lists $5/M | [Vercel pricing][vercel] |
| Resend | Free | $0; 3,000/month and 100/day | [Resend pricing][resend] |
| Resend | Pro | $20/50,000 emails; $35/100,000; $0.90/1,000 beyond tier; source draft says no daily limit | [Resend pricing][resend] |
| Razorpay | Domestic platform fee | 2%; source draft states extra 0.9% for card subscriptions | [Razorpay pricing][razorpay] |
| Razorpay | International cards | Up to 3%, as stated in source draft; actual account rate unknown | [Razorpay pricing][razorpay] |
| Razorpay | Fee GST | 18% on gateway fee, as stated in source draft | [Razorpay pricing][razorpay] |

**Do not treat these as a fresh provider-price verification.** Recheck current pricing, payment-method-specific fees, taxes, and the actual settlement report.

## One sweep

The source draft says the code makes four Anthropic calls, one per category, with `max_tokens: 16000` and web search `max_uses: 3` per call. The model is `claude-sonnet-5-5` unless `RADAR_MODEL` overrides it. Verify these details against the current repository before relying on them.

### Measured successful runs

| Run | Started UTC | Input tokens | Output tokens | Searches | Cost stated in source draft |
|---|---|---:|---:|---:|---:|
| 39693246842 | 2026-10-21 23:24 | 56,086 | 4,265 | 4 | $0.1948 |
| 39725220872 | 2026-10-22 04:56 | 63,231 | 4,329 | 5 | $0.2198 |
| 39761812156 | 2026-10-22 10:16 | 62,591 | 4,355 | 5 | $0.2187 |
| 39804347117 | 2026-10-22 15:23 | 62,464 | 4,407 | 5 | $0.2190 |
| 39871786767 | 2026-10-22 23:26 | 56,775 | 4,417 | 4 | $0.1977 |
| **Average** | | **60,229** | **4,355** | **4.6** | **about $0.2100 / ₹19.85** |

Formula using the listed price assumptions:

`cost = input_tokens × $2 / 1,000,000 + output_tokens × $10 / 1,000,000 + searches × $0.01`

The average is about $0.120 input + $0.044 output + $0.046 search. The sample is only five successful runs; the observed spread was about $0.195–$0.220.

### Sweep frequency

The source draft identifies GitHub Actions scheduled five times/day and a Vercel cron backstop at 01:30 UTC. It estimates four to six sweeps/day but does not yet have a complete count from both schedulers. The last GitHub run and Vercel timing make a sixth sweep plausible; this must be measured.

| Sweeps/day | Sweeps/month at 30.4 days | AI spend/month, approx. | INR, approx. |
|---:|---:|---:|---:|
| 4 | 121.6 | $25.54 | ₹2,413 |
| 5 | 152.0 | $31.92 | ₹3,017 conservative budget |
| 6 | 182.4 | $38.30 | ₹3,621 conservative budget |

### High-cost scenario—not a ceiling

The source draft estimates 12 searches, 64,000 output tokens, and about 157,000 input tokens:

| Component | Assumption | Approx. cost |
|---|---:|---:|
| Search | 12 × $0.01 | $0.120 |
| Output | 64,000 × $10/M | $0.640 |
| Input | 157,000 × $2/M | $0.314 |
| **Total per sweep** | | **$1.074 (about ₹101.50)** |
| **152 sweeps** | | **about $163.28 AI spend** |
| **Plus $40 Vercel/Resend base plans** | | **about ₹19,210 total** |

This is an illustrative scenario, not a hard upper bound. Input tokens are not capped by the stated `max_tokens` setting. A longer search result or more context could increase input usage. An Anthropic Console spending control is the external safeguard; verify that it is enabled and understand whether it is a hard cap or an alert.

### Failed runs and cost per success

The source draft reports seven workflow attempts, five successful runs, and two failures before Anthropic was called because `CRON_SECRET` was not set at that time. That implies those two attempts incurred no Anthropic usage, based on the observed logs. It does **not** establish that all future HTTP-error failures are free.

Use this formula:

`cost per successful run = total billed spend across all attempts / number of successful runs`

Include any billed partial failures in total spend. Verify the current failure and retry behaviour in code; the source draft says no retries are implemented.

## One email

The source draft describes these behaviours; verify them against current code and production settings:

- Owner: one email per sweep that runs, including manual runs.
- Pro: one email per saved scheduled sweep with matching items.
- Free: one email/day.
- Authentication: default caps of 10 confirmations/day and 50 sign-in codes/day; the production confirmation cap may differ.
- All emails use the same Resend account.

| Recipient | 5 sweeps/day | 6 sweeps/day |
|---|---:|---:|
| Owner | about 152/month, plus manual runs | about 182.4/month, plus manual runs |
| Each Pro | up to about 152/month | up to about 182.4/month |
| Each Free | about 30.4/month | about 30.4/month |
| Authentication, combined at default caps | up to 1,824/month | up to 1,824/month |

The actual count of delivered messages can be lower than the theoretical maximum because Pro digests depend on matching saved items. Use Resend usage reports to measure real volume.

### Resend Free daily constraint

Free has a 100/day limit and a 3,000/month limit under the source draft's price assumptions. The daily limit may bind first. A rough daily constraint is:

`owner emails + (sweeps/day × eligible Pro recipients) + Free recipients + authentication emails ≤ 100`

The exact Pro capacity depends on the day's authentication traffic and whether each Pro recipient has matching items. Do not promise a fixed number of Pro members on Free. Budget for Resend Pro before the first paid subscriber unless real traffic proves the Free tier is safe.

### Resend scenarios

Monthly counts below use the source draft's assumptions and exclude authentication emails unless stated.

| Users | All Pro emails at 5 / 6 sweeps per day | All Free emails at 5 / 6 sweeps per day |
|---:|---:|---:|
| 10 | 1,672 / 2,006 | 456 / 486 |
| 50 | 7,752 / 9,302 | 1,672 / 1,702 |
| 100 | 15,352 / 18,422 | 3,192 / 3,222 |
| 500 | 76,152 / 91,382 | 15,352 / 15,382 |
| 1,000 | 152,152 / 182,582 | 30,552 / 30,582 |

At 1,000 users with 200 Pro, 600 Free, and 200 inactive accounts:

- Five sweeps/day: 48,792 base emails; with 1,824 authentication emails, **50,616**. Estimated Resend cost: $20 + about $0.55 overage.
- Six sweeps/day: 54,902 base emails; with 1,824 authentication emails, **56,726**. Estimated Resend cost: $20 + about $6.05 overage.
- The $35/100,000 tier is cheaper than $20 + overage until approximately 66,700 emails, under the recorded pricing assumptions.

The actual plan depends on eligible Pro digests, authentication traffic, manual runs, and real billing. Recheck the plan comparison at the provider's current prices.

## One live-board view

The source draft estimates the following for `BOARD_PAYWALL=1`; current code and production usage must be checked:

| View | Function calls | Blob reads |
|---|---:|---:|
| Home, signed-in Pro | 3 | 5 |
| `/live/`, signed-in Pro | 3 | 4 |
| Signed-out page | 2–3 | 0, per source estimate |

For three function invocations and five Blob reads:

- Estimated function/Blob operation cost: `3 × $0.60/M + 5 × $0.40/M ≈ $0.0000038/view`.
- Approximately ₹0.36 per 1,000 views, or ₹1.09/month at 100 views/day.
- At 1,000 subscriber records, one read of every record per 152 sweeps is about $0.061/month in Blob reads.

**This is not total hosting cost.** CPU, bandwidth, static assets, other service usage, and actual Vercel billing are not measured. Verify after moving to Pro.

## One payment: separate the tax cases

The source draft assumes card-subscription fees of 2% + 0.9%, plus 18% GST on the fee. Under that assumption, the effective fee is 3.422% of the amount on which the gateway calculates its fee. Confirm actual account/method rates with Razorpay.

| Case | Customer pays | Formula for net before other business costs |
|---|---|---|
| A. Not GST-registered | Listed price | `price − price × 0.03422` |
| B. GST added on top; fee-GST not recoverable | `price × 1.18` | `price − (price × 1.18 × 0.03422)`; output GST is payable separately |
| B. GST added on top; fee-GST recoverable | `price × 1.18` | `price − (price × 1.18 × 0.029)`; output GST is payable separately |
| C. GST included; fee-GST not recoverable | Listed price | `price / 1.18 − price × 0.03422` |
| C. GST included; fee-GST recoverable | Listed price | `price / 1.18 − price × 0.029` |

Illustrative monthly amounts (rounded to paise; GST/legal treatment must be confirmed by a CA):

| Listed base price | Case A net | Case B customer pays | Case B net, fee-GST not recoverable / recoverable | Case C net, fee-GST not recoverable / recoverable |
|---:|---:|---:|---:|---:|
| ₹99 | ₹95.61 | ₹116.82 | ₹95.00 / ₹95.61 | ₹80.51 / ₹81.03 |
| ₹199 | ₹192.19 | ₹234.82 | ₹190.96 / ₹192.19 | ₹161.83 / ₹162.87 |
| ₹299 | ₹288.77 | ₹352.82 | ₹286.93 / ₹288.77 | ₹243.16 / ₹244.72 |
| ₹499 | ₹481.92 | ₹588.82 | ₹478.85 / ₹481.92 | ₹405.81 / ₹408.41 |

Unknowns to confirm with Razorpay and a CA:

- UPI AutoPay and eMandate subscription fee;
- actual international-card fee;
- chargeback fee;
- whether gateway fees are returned on refunds;
- whether input tax credit can be claimed for GST on gateway fees and imported services;
- applicable GST registration and output-tax obligations.

The source draft reports that Pro is granted by signed Razorpay webhooks, but refund/dispute handling and automated reconciliation are not implemented. Confirm this in code before launch. A paid customer may remain Pro after a refund/dispute, while a paid customer may remain Free if a webhook is missed.

## Fixed monthly budget

At five sweeps/day and with Resend Pro:

| Item | USD/month | Approx. INR/month |
|---|---:|---:|
| Anthropic, 152 average-cost sweeps | $31.92 | ₹3,017 conservative budget |
| Vercel Pro, one seat | $20.00 | ₹1,890 |
| Resend Pro, 50,000 emails | $20.00 | ₹1,890 |
| **Total baseline F** | **$71.92** | **₹6,797 conservative budget** |

Without Resend Pro, the nominal total is $51.92/month, but that is only suitable if actual daily and monthly email volume fits Free. Vercel usage may exceed its credit at higher scale; verify actual usage.

Not included: domain renewal, bank FX markup, taxes on imported services, accounting, marketing, owner time, customer support, acquisition, refunds, chargebacks, and income tax. These must be added for full business break-even.

## Example mix—not a forecast

Assumption: 20% Pro, 60% Free, 20% inactive; price ₹199/month; five sweeps/day; Vercel Pro and Resend Pro. “Net revenue” here must use one explicit payment/tax case. The figures below use the conservative **GST-on-top with fee-GST not recoverable** case, so net per ₹199 base price is about ₹190.96—not ₹192.19.

| Total users | Pro / Free / inactive | Base emails/month | Paying members | Net revenue before other costs | Surplus/(shortfall) vs. F=₹6,797 |
|---:|---:|---:|---:|---:|---:|
| 10 | 2 / 6 / 2 | 638 | 2 | ₹382 | −₹6,415 |
| 50 | 10 / 30 / 10 | 2,584 | 10 | ₹1,910 | −₹4,887 |
| 100 | 20 / 60 / 20 | 5,016 | 20 | ₹3,819 | −₹2,978 |
| 500 | 100 / 300 / 100 | 24,472 | 100 | ₹19,096 | ₹12,299 |
| 1,000 | 200 / 600 / 200 | 48,792 | 200 | ₹38,192 | ₹31,395 |

These figures exclude authentication emails from the volume column; at 1,000 users, those emails can push total volume above the 50,000 tier. They also exclude all business costs listed above. **Surplus is not profit.**

## Fixed-cost break-even

Use F = ₹6,797/month. These counts are rounded up and cover only the baseline service budget.

| Price/month | Not registered, or GST-on-top with fee-GST recoverable | GST included, fee-GST not recoverable |
|---:|---:|---:|
| ₹99 | 72 | 85 |
| ₹199 | 36 | 42 |
| ₹299 | 24 | 28 |
| ₹499 | 15 | 17 |

For GST added on top **with fee-GST not recoverable**, use the Case B net amount in the previous table. At these example prices, the rounded counts remain the same, but the revenue and formulas should not silently use the non-registered case.

Full business break-even is:

`members = (F + other monthly business costs) / net revenue per member`

For every additional ₹1,000/month of fixed costs, plan for roughly six more members at ₹199 or four more at ₹299 in the GST-on-top/no-input-credit case; recompute from the actual net-per-member formula after tax treatment is confirmed.

## Stress tests

The following use the recorded price assumptions, five-sweep baseline, $40/month Vercel/Resend plans, and fixed-cost break-even only. Rupee figures are approximate.

| Scenario | Approx. monthly budget | Notes |
|---|---:|---|
| 4 sweeps/day | ₹6,193–₹6,194 | Depending on rounding convention |
| 5 sweeps/day | ₹6,797 | Baseline |
| 6 sweeps/day | ₹7,401 | Includes a sixth daily sweep and possible sixth Pro digest |
| 1 in 10 attempts fails after being billed | ₹7,132 | Assumes cost per successful run rises by 1/0.9 |
| AI spend +25% | ₹7,551 | Other base plans unchanged |
| AI spend +50% | ₹8,305 | Other base plans unchanged |
| AI spend +100% | ₹9,813 | Other base plans unchanged |
| Every sweep uses the illustrative $1.074 scenario | about ₹19,210 | Scenario, not a hard upper bound |

The above stress tests assume the Resend base plan does not step up. For large user mixes, recompute email volume and the appropriate Resend tier/overage as well.

## Risks and safeguards

| Risk | Potential impact | Required action |
|---|---|---|
| `CRON_SECRET` leaks or sweep endpoint is misused | Extra sweeps and email volume | Verify current code caps and concurrency handling; set Anthropic spend alert/limit; rotate secret if exposed |
| `RADAR_MODEL` changes to a more expensive model | Higher AI cost per sweep | Document model pricing and measure before/after; optionally restrict allowed model names |
| Vercel backstop creates an extra sweep | Higher AI spend and another possible Pro digest | Count sweeps from both schedulers for at least seven days |
| Input tokens grow | Cost can exceed the illustrative $1.074 scenario | Add practical input/context safeguards and monitor usage; confirm provider spend control |
| Resend daily/monthly limit is exceeded | Digests or authentication emails may fail | Monitor daily usage and upgrade before the limit becomes operationally risky |
| Payment webhook fails | Paid user may stay Free | Verify webhook alerting and reconcile active subscriptions with Pro records |
| Refund/dispute occurs | Account may remain Pro | Document manual procedure now; automate refund/dispute handling later |
| Commercial usage remains on Vercel Hobby | Terms/availability risk | Confirm Vercel Pro is active before live payments |

## Pre-launch checklist

### P0 — before the first live payment

- [ ] Confirm the chosen price and GST treatment with an Indian CA.
- [ ] Confirm Vercel Pro is active for commercial usage.
- [ ] Confirm Resend plan fits daily and monthly email volume; budget for Pro before first paid member unless usage evidence supports Free.
- [ ] Set and test Anthropic spend alerts/limits; verify whether the control is a hard ceiling or alert only.
- [ ] Verify the production `RAZORPAY_PLAN_ID` matches the live pricing page; the ₹99 staging/test plan must not be used in production.
- [ ] Verify the live Razorpay webhook is enabled and `RAZORPAY_WEBHOOK_SECRET` is configured without exposing its value.
- [ ] Publish Contact, Terms, and Refunds information; verify Privacy is present.
- [ ] Document the manual refund/dispute process and how to revoke Pro.
- [ ] Verify production `MAX_SUBSCRIBERS`, confirmation caps, sign-in caps, and sweep limits by inspecting actual settings; do not infer values from variable names.

### P1 — first week/month

- [ ] Count all successful and failed sweeps from both schedulers for seven days.
- [ ] Read actual Anthropic spend and compare it with 152 × average measured cost.
- [ ] Read actual Resend daily/monthly usage including owner and authentication emails.
- [ ] Read Vercel invocations, CPU, Blob operations, and bandwidth after moving to Pro.
- [ ] Compare Razorpay settlement fees with the model.
- [ ] Track cost per successful run as total billed spend across all attempts divided by successful runs.

### P2 — after initial launch

- [ ] Automate refund/dispute event handling.
- [ ] Build reconciliation between Razorpay subscriptions/payments and Pro records.
- [ ] Consider annual plan only after monthly conversion and retention data exist.
- [ ] Measure any model/search-tool change with a controlled before/after cost and quality comparison.

## Pricing options

| Option | Cost-model fit | Recommendation |
|---|---|---|
| ₹199/month | Covers baseline infrastructure at about 36–42 Pro members, depending on GST case | Consider if accessible pricing is important; leaves less room for overhead at low scale |
| ₹299/month | Covers baseline infrastructure at about 24–28 Pro members | **Provisional candidate to test**; more buffer for unmodelled costs, but willingness-to-pay is unvalidated |
| ₹499/month | Covers baseline infrastructure at about 15–17 Pro members | Test only if the product's value and target segment justify it; cost alone does not prove demand |
| Annual plan | Can improve upfront cash flow but discounts the effective monthly price | Add only after monthly pricing, retention, cancellation/refund handling, and plan logic are understood |
| Credits/pay-per-run | Poor fit if customers do not trigger the shared sweep | Not recommended under the current cost architecture |
| Free tier | Useful for product discovery but email volume can create stepped costs | Keep bounded; protect against abuse and monitor email tiers |

**Pricing is not validated by the cost model.** There are no paying-user or conversion data in this document. Test price with actual activation, conversion, retention, support burden, and willingness-to-pay—not just infrastructure break-even.

## Measurement checklist

| What to measure | How | Why |
|---|---|---|
| Sweeps/day | Count both GitHub Actions and Vercel cron runs for seven days | Confirms whether baseline is 4, 5, or 6/day |
| Actual Anthropic spend | Provider usage/cost report for a full billing period | Validates run-level estimates and catches unlogged cron work |
| More sweep samples | Collect 20–30+ runs, including billed partial failures | Improves average, p90, and high-cost understanding |
| Emails/day and month | Resend dashboard; include owner, Pro, Free, confirmation, sign-in, and manual runs | Determines Free/Pro tier and overage risk |
| Vercel usage | Pro usage dashboard: invocations, CPU, Blob, bandwidth | Validates the view-cost estimate and $20 credit assumption |
| Razorpay fees | Actual settlement report for each payment method | Confirms gateway fees and settlement deductions |
| UPI AutoPay/refund/chargeback fees | Written confirmation from Razorpay support | Resolves unknown payment costs |
| FX markup and taxes | Bank/card statement and CA review | Converts USD bills into true landed cost |
| Domain and other overhead | Registrar, accountant, support, marketing, owner inputs | Enables full business break-even |

## Audit trail

This version preserves the measured run IDs and main assumptions from the owner's revised draft while clarifying tax cases, failure accounting, hosting-estimate scope, and the difference between service-cost break-even and business profitability. Repository behaviour, production environment values, provider prices, and provider dashboards still need direct verification before launch.

## Re-measure a sweep

1. Open the `sweep` workflow in GitHub Actions and select successful scheduled runs.
2. Find the returned `usage` object in logs, or use a command such as `gh run view <run-id> --log | grep -o '"usage":{[^}]*}'` where supported.
3. Calculate each attempt's billed cost from input tokens, output tokens, searches, and the current official rates.
4. Include any billed failed/partial attempts; divide total billed spend by successful runs to get cost per successful run.
5. Recheck provider pages, account bills, the FX rate, and all break-even tables after one full billing period.

[anthropic]: https://platform.claude.com/docs/en/about-claude/pricing
[vercel]: https://vercel.com/pricing
[resend]: https://resend.com/pricing
[razorpay]: https://razorpay.com/pricing/
