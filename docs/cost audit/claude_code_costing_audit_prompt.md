# Claude Code prompt — audit costing.md against the repository

You are auditing the cost model for this product. Work in the current repository and use `docs/subscriptions/costing.md` as the primary document. The purpose is to make the costing document numerically consistent, code-verified, and safe to use for pricing decisions—not to invent provider prices or decide the owner's price.

## Working rules

1. **Inspect before editing.** Read `docs/subscriptions/costing.md`, `api/_lib/radar.js`, `api/_lib/handlers.js`, `api/_lib/subscriber-delivery.js`, `api/_lib/subscription-handlers.js`, the Vercel cron configuration, GitHub Actions sweep workflow, deployment docs, pricing page, payment/webhook code, and any admin scripts relevant to subscription state.
2. Do not assume the pasted costing document is correct merely because it says “Code” or “Measured.” Verify every repository claim from the current code. Cite the exact file path and relevant function/line range in your audit notes.
3. Do not access, print, or expose secret values. You may verify whether environment variable names are referenced, but do not reveal their values. For production variable claims, state clearly whether the value is accessible to you; do not infer the value from the variable name.
4. Do not invent current provider pricing. Treat the document's prices as assumptions pending independent verification from the official provider pricing pages and the actual account/invoice. If web access is unavailable, mark them “not independently re-verified.”
5. **Audit and implement clear, safe repository fixes for priority issues.** You may edit application code and tests for well-scoped P0/P1 issues after identifying the root cause. Do not deploy, alter production environment variables/secrets, change provider account settings, create/change live Razorpay plans, or change the advertised price/pricing page without explicit approval. For risky or ambiguous payment/refund behaviour, first explain the options and ask before implementing.
6. Preserve the document's terminology and useful evidence. Clearly label Measured, Price, Code, Estimate, Assumption, and Unknown. Never convert an estimate into a fact.

## Audit tasks

### A. Reproduce every calculation

Use a small script or spreadsheet-style calculations to verify:
- sweep cost formula: input tokens, output tokens, web searches;
- average and range from the five measured successful runs;
- 4, 5, and 6 sweeps/day monthly totals using a 30.4-day month;
- the illustrative high-cost sweep scenario and monthly total;
- AI +25%, +50%, +100%, billed-failure, 10-sweeps/day, and high-cost stress cases;
- Vercel function/Blob cost per view, 1,000 views, 100 views/day, and subscriber-record reads;
- every email count for all-Pro, all-Free, and 20% Pro / 60% Free / 20% inactive scenarios;
- Resend Free daily limit and 3,000/month limit; $20/50k, $35/100k, and overage thresholds;
- Razorpay fee formulas under each tax treatment;
- fixed monthly totals, user-count totals, net revenue, break-even counts, annual-plan comparisons, and every stress-test subscriber count.

For every discrepancy, show the existing value, corrected value, formula, and impact. Use unrounded values in formulas; define one rounding convention for display values and budgets.

### B. Verify code claims

Verify the current repository's behaviour for:
- number of Anthropic calls per sweep, model selection, `max_tokens`, search `max_uses`, and usage aggregation;
- scheduled GitHub Actions cron and Vercel cron timing;
- the “last scheduled run” interval check, manual-run cap, scheduled-style cap, concurrency/race behaviour, and the stated maximum daily sweep count;
- which triggers count as scheduled and which send emails;
- owner, Pro, Free, sign-up-confirmation, and sign-in-code email paths and caps;
- idempotency/deduplication behaviour and what is logged as sent versus attempted;
- `MAX_SUBSCRIBERS`, `MAX_CONFIRMS_PER_DAY`, `MAX_SIGNINS_PER_DAY`, `CRON_SECRET`, `RADAR_MODEL`, `BOARD_PAYWALL`, `RAZORPAY_PLAN_ID`, and `RAZORPAY_WEBHOOK_SECRET` references;
- Razorpay webhook signature checks, duplicate/late events, cancellation, expiry, refund/dispute handling, and reconciliation gaps;
- the page/function/Blob operations used in the live-board cost estimate.

Do not claim production values were verified unless you have authorized, direct access to the actual deployment settings. If you only see a variable name in code or deployment documentation, mark its production value “not verified.”

### C. Fix the known inconsistencies

At minimum investigate and correct these issues if confirmed:
1. The GST-on-top section calculates gateway fees on the GST-inclusive amount, but later appears to use the non-registered net value for the “GST on top” revenue/break-even tables. Make the three cases consistent: not registered, GST added on top, and GST included in price. State whether input tax credit on GST charged on the gateway fee is assumed.
2. The failure accounting says “billed failures so far: 0 of 5” even though five is the successful sample and two observed failed attempts stopped before Anthropic. Use the correct denominator and define cost per successful run as total billed spend across all attempts divided by successful runs.
3. The claim that costs are the same at one and 1,000 users must be scoped: AI spend is subscriber-independent at a fixed sweep frequency; Resend is stepped and Vercel usage can increase.
4. Label the live-board estimate as function/Blob operation cost only; CPU, bandwidth, static assets, and actual billing are not measured.
5. Ensure the 4/5/6 sweep scenarios, 1,000-user email overages, high-cost scenario, and fixed monthly budget use consistent rounding.
6. Keep the $1.07 sweep figure labelled an illustrative scenario, not a hard maximum, because input tokens are not capped by the stated code settings.
7. Ensure the example-mix revenue table uses the same Razorpay fee/GST assumption as the formulas and break-even table.
8. Clearly distinguish infrastructure break-even from full business profitability; owner time, domain, accounting, acquisition, support, taxes, FX, refunds, and chargebacks are not included unless evidenced.

### D. Deliverables

First, return a concise audit report in your response with:
- confirmed calculations;
- errors and inconsistencies ranked P0/P1/P2;
- claims verified from code and claims not verifiable;
- corrected numbers and formulas;
- risks that must be resolved before the first live payment.

Then update `docs/subscriptions/costing.md` with the verified findings and corrected calculations. Also implement safe, high-priority code fixes that are clearly supported by the audit, and add/update automated tests. For any change that could affect payment entitlement, refunds, cancellations, or customer billing in a non-obvious way, show the proposed approach and ask for approval before coding. The documentation update should:
- preserves measured run IDs and source links;
- corrects inconsistent formulas and tables;
- uses a consistent rounding policy;
- labels all assumptions and unknowns;
- adds a “full business costs excluded” section;
- includes a measurement checklist for actual sweep count, provider usage, and payment settlement fees;
- does not claim profitability or validated willingness-to-pay without evidence.

Do not change the advertised price, pricing page, live Razorpay plan, or production configuration automatically. Give a separate, clearly provisional comparison of ₹199, ₹299, and ₹499 based on verified costs and break-even counts, and state that demand has not been validated. Summarize all code and documentation changes, test commands and results, remaining risks, and any actions requiring owner approval.

## Acceptance criteria

- Every displayed total can be reproduced from a formula.
- GST case labels, formulas, and tables agree.
- Failed attempts and successful runs use correct denominators.
- Provider prices and production settings are not falsely claimed as verified.
- All code-related statements point to current repository evidence.
- No secrets or secret values are printed.
- Safe, well-scoped P0/P1 repository fixes are implemented with tests; high-risk payment logic is gated on approval.
- No deployment, live plan, production secret/environment change, or advertised-price change occurs without explicit approval.
