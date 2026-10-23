# Pro pricing recommendation — based on `costing.md`

**Recommendation to test: ₹299/month.** This is a provisional commercial hypothesis, not a validated willingness-to-pay conclusion.

## Why ₹299 is the strongest first test

The costing draft's baseline service budget is approximately ₹6,797/month, assuming five sweeps/day, Vercel Pro, and Resend Pro. Under the draft's card-fee and tax assumptions:

| Price | Approx. net per member: GST on top, fee-GST not recoverable | Members to cover ₹6,797 | Approx. net per member: GST included, fee-GST not recoverable | Members to cover ₹6,797 |
|---:|---:|---:|---:|---:|
| ₹199 | ₹190.96 | 36 | ₹161.83 | 42 |
| ₹299 | ₹286.93 | 24 | ₹243.16 | 28 |
| ₹499 | ₹478.85 | 15 | ₹405.81 | 17 |

These are service-cost break-even counts only. They exclude domain, forex, tax/accounting, support, marketing, customer acquisition, refunds/chargebacks, and owner time.

At 20 paying members, ₹299 produces about ₹5,739/month net under the GST-on-top/no-input-credit assumption, still below the ₹6,797 service budget. At 30 members it produces about ₹8,608, leaving about ₹1,811 before other business costs. At ₹199, 36 members only just cover the modeled service budget, leaving virtually no buffer for other overhead.

## Suggested launch approach

1. **Do not lock the price until GST treatment and payment-method fees are confirmed.** Use an Indian CA for tax questions and a real Razorpay settlement report for fee verification.
2. If the product's perceived value supports it, test **₹299/month** as the primary paid plan. Keep the free tier bounded and monitor email volume.
3. Consider **₹199/month** only if user research suggests price sensitivity is a meaningful barrier, or as a clearly scoped launch offer. Measure whether the lower price improves conversion enough to compensate for lower contribution per customer.
4. Consider **₹499/month** only if the product delivers differentiated value to a customer segment that will pay more. The cost model alone does not justify this price.
5. Do not build an annual plan until monthly activation, retention, cancellation/refund handling, and customer demand are understood. A 10× monthly annual price gives a 16.7% discount against twelve monthly payments.

## What to measure in the first 30 days

- Visitor-to-sign-up conversion.
- Free-to-paid conversion by price/offer.
- Activation: whether new users reach the product's core value in the first session/day.
- Weekly active users and digest engagement.
- Month-one cancellations/refunds and reasons.
- Cost per successful sweep including billed failures.
- Actual email volume, Vercel usage, and provider invoices.
- Support minutes per paying member.
- Customer interviews: what outcome they value and what alternative they use today.

## Decision rule

Choose the price that balances customer value, conversion, retention, and sustainable contribution—not the lowest infrastructure break-even. Until demand data exists, **₹299/month is the best candidate to test, not a proven optimal price**.
