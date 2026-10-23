# Stakeholders and responsibilities

> **Stage 4 of 7.** A one-person product: the owner, Bhawna Mangla, builds and runs it with Claude (Claude Code).
> So this page lists who is really involved, and a RACI that fits that size, instead of a programme's org chart.
> State on 2026-10-24.

## Who is involved

| Stakeholder | Role | What they need | How they hear from the product | Source |
|---|---|---|---|---|
| The owner | Product, build, operations, money and legal choices; grants Pro by hand today | Sweeps that run, costs inside the model, a clear go-live path | The failure notice by email and Slack; GitHub Actions; the admin script | [decisions.md](../../docs/decisions.md); [CHANGELOG](../../CHANGELOG.md) 2026-10-21 |
| Claude (Claude Code) | Writes code, tests and docs to the owner's approved plans; doesn't pick prices, rules or legal text | Clear owner inputs | This repository | [T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md) ("Claude doesn't pick the price or the refund rule") |
| Visitors | Read the home page and the demo | To see what it finds before signing up | Home page, `/demo/`, popup | [flows-and-screens.md](../03-design/flows-and-screens.md) |
| Free members | Get the daily teaser | Headlines worth opening | Teaser email | [paid-website.md](../../docs/subscriptions/paid-website.md) |
| Pro members | Use the live board and the full digest | Accurate, current findings; fair billing; an easy way out | Live board; email after every saved sweep; `/manage/` | [paid-website.md](../../docs/subscriptions/paid-website.md) |
| Razorpay | Payment provider | A website that passes its review, including the policy pages | Live activation; webhooks | [payments-razorpay.md](../../docs/subscriptions/payments-razorpay.md#prerequisites) |
| Anthropic, Vercel, Resend, GitHub, Google | Suppliers | Their terms and limits kept | Dashboards, consoles, bills | D-01 to D-06 in the [RAID log](raid-log.md#dependencies) |
| An adviser and a CA | The liability clause; GST and tax | Questions, prepared in advance | Not engaged yet, as far as the repo records | [costing.md](../../docs/subscriptions/costing.md#tax-and-legal-questions-for-a-ca) |

How many people are Free or Pro members besides the owner isn't recorded in the repository. **OWNER INPUT NEEDED**
if it should be stated; `scripts/subscribers.mjs stats` prints the counts (pending, Free, Pro) without any address.

## RACI

R = does the work, A = decides and answers for it, C = consulted, I = informed.

| Activity | Owner | Claude | Adviser or CA | Razorpay | Members |
|---|---|---|---|---|---|
| Product decisions (scope, plans, what Pro includes) | A, R | C | | | I |
| Price, refund rule, GST, payment methods | A, R | C (options and sources) | C | | I (on `/pricing/`) |
| Code, tests and docs | A | R | | | |
| Keys, environment variables, deploys | A, R | C (steps; never sees keys) | | | |
| Policy pages (privacy, refunds, contact, terms) | A, R | R (drafts) | C (liability) | C (website review) | I |
| Live activation and go-live (T27) | A, R | R (test-mode run) | | R (review) | I |
| Granting Pro by hand, until payments go live | A, R | | | | I |
| Watching sweeps and spend | A, R | C | | | |
| Support through the contact address | A, R | | | | C |

## How decisions are made and recorded

- The owner decides; [decisions.md](../../docs/decisions.md) records each decision with its reason, the trade-off
  and the source. Where the owner gave no reason, the log says so.
- Non-trivial work starts as a written plan the owner approves before code is written, and lands as a pull request
  that `npm run check` and `npm test` must pass.
- Revised decisions are listed in the [change log](change-log.md).
