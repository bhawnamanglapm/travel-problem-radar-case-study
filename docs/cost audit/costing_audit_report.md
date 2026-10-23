# Detailed audit of `costing.md`

**Audit date:** 2026-10-23  
**Source of truth:** the revised costing document pasted by the owner.  
**Scope limitation:** This is a calculation and internal-consistency audit of the document. It is not an independent verification of provider prices, tax treatment, production environment variables, or repository behaviour. Those require provider pages, code, and production dashboards.

## Executive verdict

The revised document is much stronger than the earlier version. The measured sweep arithmetic is sound, the email-volume arithmetic is largely consistent, and the break-even tables are mostly reproducible. I would still fix several items before treating it as launch-ready:

1. **The GST-on-top net-revenue formula is internally inconsistent.** The document correctly calculates the gateway fee on the full GST-inclusive charge in case B, but later says to use case A's net figure for “GST on top.” If the gateway fee is charged on the full amount and the GST on that fee cannot be claimed back, use case B's net figure instead.
2. **The failure-rate note is ambiguous/wrongly labelled.** It says “Billed failures so far: 0 of 5,” although five is the count of successful measured runs and the two failed workflow attempts stopped before calling Anthropic. It should say “0 of 2 failed attempts incurred Anthropic usage, based on the observed logs.”
3. **The “same cost at 1 or 1,000 users” statement needs a scope qualifier.** Anthropic sweep spend is subscriber-independent at a fixed sweep frequency, but email tiers step up with users and Vercel usage can grow. The fixed-cost claim applies only within the stated usage assumptions and Resend tier.
4. **The ‘heavy reader costs about ₹1/month’ figure is an estimate for measured function/Blob operations, not total hosting cost.** CPU, bandwidth, static assets, and actual Vercel billing are not measured.
5. **A few table labels/rounding conventions should be made consistent.** The 6-sweeps stress row is about ₹7,401 when rounded to the nearest rupee from unrounded inputs (the document says ₹7,400). State whether rupee values are rounded to nearest rupee or rounded up for conservative budgeting.
6. **Break-even means infrastructure/service-cost break-even only.** It excludes the owner’s time, marketing, domain, accounting, tax, foreign-exchange markup, refunds, chargebacks, support, and acquisition cost. Avoid presenting it as business profitability.
7. **The price recommendation is not validated by demand.** No paying customers or conversion data are included. ₹299 is a testable candidate, not a proven optimal price.

## Calculation checks

### 1. Average sweep cost

Using the prices in the document:

- Input: 60,229 × $2 / 1,000,000 = **$0.120458**
- Output: 4,355 × $10 / 1,000,000 = **$0.04355**
- Searches: 4.6 × $0.01 = **$0.046**
- Total: **$0.210008**, approximately **$0.2100**
- At ₹94.50/USD: approximately **₹19.85**

**Result:** arithmetic checks out. Five runs are still a small sample; keep the average labelled “measured from five successful runs,” not a stable forecast.

### 2. Monthly sweep costs

Using $0.210008 per sweep and a 30.4-day month:

| Sweeps/day | Sweeps/month | AI cost/month (approx.) | INR at ₹94.50/USD (approx.) |
|---:|---:|---:|---:|
| 4 | 121.6 | $25.54 | ₹2,413 |
| 5 | 152.0 | $31.92 | ₹3,016–₹3,017 depending on rounding convention |
| 6 | 182.4 | $38.30 | ₹3,620–₹3,621 depending on rounding convention |

The document appears to round some line items upward and some to nearest rupee. Add a note such as: “USD calculations use unrounded values; INR display values are rounded to the nearest rupee, except budget totals which are rounded up.” Then apply it consistently.

### 3. High-cost sweep scenario

The document’s illustrative scenario uses 12 searches, 64,000 output tokens, and an estimated 157,000 input tokens:

- Search cost: $0.120
- Output cost: $0.640
- Input cost: about $0.314
- Total: about **$1.074 per sweep**, or roughly **₹101.50**
- 152 such sweeps: about **$163.28** of AI usage
- Adding Vercel and Resend base plans ($40/month): about **$203.28**, or **₹19,210**

**Result:** the revised document’s ₹19,210 stress-test row is consistent with the unrounded component estimate. Keep it explicitly labelled an **illustrative scenario, not a maximum**. Input tokens are not code-capped, so there is no guaranteed $1.07 ceiling.

### 4. Fixed monthly budget

At five sweeps/day:

- Anthropic: $31.92
- Vercel Pro: $20
- Resend Pro: $20
- Total: **$71.92**, equal to **₹6,796.44** at ₹94.50/USD

The document’s ₹6,797 is a reasonable conservative rounded-up budget. The “without Resend Pro” figure of $51.92 converts to ₹4,906.44, displayed as ₹4,907 if rounded up.

**Important:** Resend Pro is a stepped cost, not an always-fixed $20. It becomes $35 at the 100,000-email tier, and overage can apply. Recalculate the budget for each user mix and schedule.

### 5. Email-volume tables

The main email counts in the revised document are internally consistent with these assumptions:

- Owner: one email per sweep (including manual sweeps)
- Each Pro user: one email per saved scheduled sweep that has matching items
- Each Free user: one email/day
- Authentication: up to 60/day combined at default caps (but the confirmation cap may differ in production)
- Month: 30.4 days

Examples checked:

- 1,000-user mix (200 Pro, 600 Free, 200 inactive), five sweeps/day: 30,400 Pro emails + 18,240 Free emails + 152 owner emails = **48,792**; adding 1,824 authentication emails = **50,616**.
- Same mix, six sweeps/day: 36,480 Pro + 18,240 Free + 182.4 owner = **54,902.4**; adding 1,824 = **56,726.4**.
- 6-sweep overage: 6,726.4 emails above 50,000 × $0.0009 = **about $6.05**. Total Resend cost on the $20 tier plus overage is about $26.05.
- At 1,000 users and the mixed six-sweep scenario, $38.304 AI + $20 Vercel + $26.05 Resend ≈ $84.35, or **about ₹7,971**.

**Result:** the revised email counts and the ₹7,971 mixed-scenario cost check out. Make the “maximum Pro members on Resend Free” table conditional on the assumed daily authentication volume and delivery success; it is not a universal capacity promise.

### 6. Payment fee and GST calculations

The stated card-subscription fee assumption is:

`(2% + 0.9%) × 1.18 = 3.422%`

The arithmetic is correct **if** the stated 2.9% applies to the full payment and 18% GST is charged on the gateway fee. The actual method/account fee still needs confirmation.

The three cases must remain distinct:

- **A. Not GST-registered:** customer pays the listed price; net = price − fee on listed price.
- **B. GST added on top:** customer pays `price × 1.18`; if gateway fees apply to the full amount and fee-GST is not recoverable, net before output GST is `price − (price × 1.18 × 0.03422)`. If fee-GST is recoverable, the effective fee is 2.9% of the full charge, and the net before output GST is `price − (price × 1.18 × 0.029)`.
- **C. GST included in displayed price:** taxable base = `price / 1.18`; output GST = `price − price/1.18`; net before other business costs = taxable base − gateway fee on the full price (with or without recovery of fee-GST as applicable).

**Critical correction:** the revised document says “Below, ‘GST on top’ uses case A’s figure.” That is not the conservative case-B calculation if the gateway fee is charged on the GST-inclusive transaction and fee-GST cannot be claimed back. At ₹199, case B net is approximately **₹190.96** without input tax credit, or **₹192.19** if the fee-GST is recoverable. Case A is ₹192.19. The displayed break-even counts happen to remain the same at the listed price points after rounding, but the net-revenue column and examples must state which assumption they use.

### 7. Break-even table

Using F = ₹6,797 and the document’s current formulas, the displayed fixed-cost break-even counts are broadly correct:

| Price | Not registered / GST on top with fee-GST recovered | GST included, fee-GST not recovered |
|---:|---:|---:|
| ₹99 | 72 / 72 (GST-on-top case depends on fee-GST treatment) | 85 |
| ₹199 | 36 / 36 | 42 |
| ₹299 | 24 / 24 | 28 |
| ₹499 | 15 / 15 | 17 |

For a strict GST-on-top/no-input-credit case, calculate against case B net rather than case A. At the listed prices, rounding does not change the counts shown, but the formula and table labels should be explicit. The ₹99 GST-included break-even becomes 84 if the Razorpay fee-GST is recoverable; otherwise it is 85.

These are **fixed-cost break-even counts**, not full business break-even.

### 8. Stress-test table

The formulas behind the following stress rows are consistent, with small rounding differences:

- 4 sweeps/day: AI $25.54 + $40 base plans ≈ ₹6,193 before chosen rounding convention.
- 6 sweeps/day: AI $38.30 + $40 ≈ ₹7,401 to nearest/conservative rupee; the document lists ₹7,400.
- 1 in 10 attempts billed but unsuccessful: $31.92 / 0.9 + $40 ≈ ₹7,132.
- AI +25%: $31.92 × 1.25 + $40 ≈ ₹7,551.
- AI +50%: $31.92 × 1.5 + $40 ≈ ₹8,305.
- AI +100%: $31.92 × 2 + $40 ≈ ₹9,813.
- Every sweep at the illustrative high-cost scenario: about ₹19,210.

Round consistently and avoid describing the high-cost row as a worst-case ceiling.

### 9. Live-board estimate

The arithmetic is correct for the stated operation assumptions:

- 3 function invocations × $0.60/M + 5 Blob reads × $0.40/M ≈ $0.0000038/view
- At ₹94.50/USD: approximately ₹0.00036/view
- Approximately ₹0.36 per 1,000 views; about ₹1.09/month at 100 views/day in a 30.4-day month

But this is not a full marginal hosting cost. CPU duration, bandwidth, static-file requests, database/auth costs if applicable, and actual Vercel billing are not measured. Label it “estimated function and Blob operation cost,” not “total cost of a view.”

## Other material issues

### Failure accounting

Replace “Billed failures so far: 0 of 5” with wording that matches the observed denominator: **“Of the two failed workflow attempts observed, neither reached Anthropic; five successful runs supplied the usage sample. Billing behaviour for provider HTTP errors remains unknown.”**

Use the formula:

`cost per successful run = total billed spend across all attempts / number of successful runs`

This directly includes billed failed attempts and avoids ambiguity about the success-rate denominator.

### Security and run limits

The revised version claims a maximum of 15 sweeps/day from 3 manual runs plus 12 scheduled-style runs. Claude Code should verify this in the actual handler logic, including whether the two counters are independent, whether concurrent requests can race, and whether the endpoint truly requires the secret. Do not treat a code-level cap as a hard financial ceiling; the Anthropic spend limit is still the external control.

### Email delivery assumptions

“Each Pro member gets one email per saved scheduled sweep that has items in their categories” is not the same as guaranteed delivery of one email. Distinguish attempted/scheduled messages from accepted/sent messages in logs and Resend usage. The monthly table should be called a volume estimate based on the code path, not a guarantee of actual sends.

### Commercial costs omitted

The model should keep a separate “not included / owner input” section for:

- domain and renewal;
- foreign-exchange markup and any applicable taxes on imported services;
- accountant/bookkeeping;
- refunds, chargebacks, failed-payment costs, and customer support;
- marketing and customer acquisition;
- owner time;
- tax obligations and any relevant compliance costs.

Do not invent these amounts. Add input cells/variables or scenarios so the owner can fill them in.

## Pricing recommendation

**Provisional candidate: test ₹299/month**, not because the cost model proves it is optimal, but because the current modeled infrastructure break-even is lower (about 24–28 members) than at ₹199 (about 36–42). That gives more room for unmodelled business overhead. Keep ₹199 as a possible lower-price experiment if the target market is price-sensitive.

Before committing:

1. Confirm the tax/GST case with an Indian CA.
2. Verify Razorpay's actual fee for the payment method and settlement report.
3. Verify the true daily sweep count and email volume.
4. Measure conversion, activation, retention, and willingness to pay.
5. Recompute full business break-even including the owner’s monthly cost inputs.

Do not present either ₹199 or ₹299 as validated willingness-to-pay; the document contains no customer demand data.

## Priority order

**P0 — before the first live payment**
- Correct the case-B GST-on-top net formula and make all tables use the same assumption.
- Confirm production Razorpay plan ID, webhook secret, and webhook enablement.
- Confirm Vercel Pro and Resend plan are active and appropriate for commercial usage.
- Set and test Anthropic spend alert/limit.
- Publish required legal/contact/refund pages and document the manual refund/dispute process.
- Verify `MAX_SUBSCRIBERS`, production confirmation cap, and sweep caps by reading actual values and code.

**P1 — first week/month**
- Count all successful and failed sweeps from both schedulers for at least seven days.
- Read actual Resend daily/monthly usage including auth emails and owner notifications.
- Reconcile provider invoices against the model.
- Track total billed AI spend divided by successful sweeps, including billed failures.

**P2 — after initial launch**
- Automate refund/dispute handling and payment reconciliation.
- Consider annual plans only after monthly demand and retention are understood.
- Test a newer search tool/model only with a measured before/after comparison.
