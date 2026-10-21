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

- [ ] **Vercel Pro.** The Hobby plan is for non-commercial use; **check the current terms and price**. Moving to Pro
  also lifts the once-a-day cron limit, but keep the GitHub Actions schedule unless there's a reason to move it
- [ ] **Razorpay account** in test mode (works before activation). Start live activation now: business details,
  website review, bank account. **Check current requirements**
- [ ] **International cards**: decide, and ask Razorpay to enable them if wanted (**check** how)
- [ ] **Policy pages** published on the site: terms of service, privacy policy, refund and cancellation policy, and a
  contact address. Payment providers usually check these during review
- [ ] **Tax and legal advice**: GST, income tax on software subscriptions, DPDP Act for subscriber data
- [ ] **Prices** (monthly, yearly), currency, free trial or not, refund rule: **OWNER INPUT NEEDED**. Then create the
  Razorpay Plan(s) in test mode and note each plan id
- [ ] **Support route**: who answers, where, and how fast

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
