# Travel Problem Radar: the product management case study

> **A real, live product, not a simulation.** Travel Problem Radar runs at
> https://radar.pehchanthetraveller.com/ (the old travel-problem-radar.vercel.app address redirects there since
> 2026-10-28). One product owner, Bhawna Mangla, built it and runs it with AI (Claude).
> Each figure in this section comes from a file in this repository, and the file is named next to it. Where no
> source exists, the gap is marked **OWNER INPUT NEEDED** or **Not measured**. No figures were made up to fill a
> template.

This folder presents the project as a product manager would: discovery, product definition, design, planning and
governance, business case and launch, executive communication, data, and testing. Each stage summarises the engineering
documents in [`docs/`](../docs/) and links to them, so every fact keeps one home.

## At a glance

| | |
|---|---|
| **Role** | Product owner. Built with AI (Claude): the first version in Claude's app, everything since October 2026 with Claude Code ([README](../README.md#how-i-built-it)) |
| **Domain** | Travel industry: traveler pain, government and policy changes, website and app failures, industry disruption |
| **Timeline** | First built in July 2026 in Claude's app. Repository started 2026-08-01. Public demo, live page, subscriptions and payments built from 18 to 23 Oct 2026; payments live on 2026-10-28; board features (details, areas, search, saved, share) on 29 and 30 Oct; first full test run on 2026-10-30 ([CHANGELOG](../CHANGELOG.md)) |
| **Status (2026-10-31)** | Live and charging. Razorpay has been in live mode since 2026-10-28, and Pro is paid monthly or yearly at ₹1. Sweeps run again since 2026-10-25 (I-01 closed), on `claude-haiku-5-5`. Since 2026-10-30 the board and Pro email have India as an area (T42). On 2026-10-31 Useful / Not useful votes went live for Pro, Ask the board was built but stays off until the owner's Preview test (T43), a public `/trends/` page with counts only went live (T44), and every email got the brand header (T45). The first test run (TS01 to TS20, 2026-10-30) ended **not ready to sign off**. After it, BUG-001 and BUG-008 to BUG-011 were fixed and the owner closed every bug but BUG-002 (an account that can't see the board), which is open. Still open on the [launch checklist](05-business-case-and-launch/launch-plan.md): Vercel Pro, the test-mode run's record, an adviser's check of the terms ([progress](../docs/subscriptions/tasks/progress.md), [TS19](08-testing/TS19-bug-reporting-and-retesting.md)) |
| **Build record** | 525 commits and 144 merged pull requests. 1,719 offline tests and 256 offline checks pass (`npm test`, `npm run check`), counted on `main` at `fa4f8e6` on 2026-10-31. Earlier on 2026-10-31 (`293d333`) it was 514 commits, 140 PRs, 1,709 tests and 254 checks; on 2026-10-30 it was 473 commits, 129 PRs, 1,582 tests and 249 checks; on 2026-10-23, 256 commits, 74 PRs, 952 tests and 199 checks |
| **Users** | **None recorded in the repo besides the owner.** 3 live ₹1 payments were captured by 2026-10-29 ([progress](../docs/subscriptions/tasks/progress.md), T27); the repo doesn't record who made them. No interviews, surveys or usage data exist yet ([README](../README.md#problem)) |
| **Price** | ₹1 a month or ₹1 a year for Pro, no GST charged: the owner's real price for now (2026-10-29). It was ₹299 a month until 2026-10-25, and the [business case](05-business-case-and-launch/business-case.md) still uses ₹299 for break-even. The target price is **OWNER INPUT NEEDED** ([decisions](../docs/decisions.md), [costing](../docs/subscriptions/costing.md)) |

## The problem

> *"The best product ideas in travel start as someone's bad day: a refund that never came, a visa fee that quietly
> quadrupled, a booking that vanished after payment. But those signals live everywhere: news wires, government
> notices, outage trackers, review sites, protest calendars. No PM has time to read all of it, every day, across the
> world."* (the original case study, quoted in the [README](../README.md#problem))

The user is a product manager looking for travel problems worth solving, starting with the owner.

## The solution

1 to 5 times a day (as often as the Pro member who asked for the most emails a day; once a day with no Pro), a
server job asks Claude, with web search, for recent problems in four categories. It saves up to 5 items per
category, plus up to 2 from India (T42), each with a source link, severity, region and a one-line product opportunity, and drops an item whose
source is over 60 days old. Items not seen in an earlier sweep are flagged New. Readers get the results in four
ways:
- **a public demo** that replays a saved July 2026 sample;
- **a live board** for Pro members, with a details panel and history for each problem, area filters, search across
  every saved sweep, saved problems, a share link for one problem, Useful / Not useful votes, and "Ask the board"
  (answers only from saved items, each claim citing one; off until the owner's test, T43);
- **a public trends page** with counts only: new problems each week and in the last 30 days by area (India first)
  and category, and what's rising (T44; the counts start with the next scheduled sweep);
- **email digests**: a daily teaser for Free, and for Pro 1 to 5 digests a day, for the categories and areas they
  choose. Every email carries the site's brand header (T45).

Source: [TECHNICAL.md](../docs/TECHNICAL.md), [paid-website.md](../docs/subscriptions/paid-website.md),
[CHANGELOG](../CHANGELOG.md) 2026-10-29 to 2026-10-31.

## How I approached it

| Stage | What it holds | Files |
|---|---|---|
| 1. Discovery | Problem framing, assumptions with their evidence, what building taught, research gaps, an interview plan (not run), and the alternatives a PM uses today | [discovery-log.md](01-discovery/discovery-log.md), [alternatives.md](01-discovery/alternatives.md) |
| 2. Product definition | PRD v2 for the product as it is today, backlog by epic, requirement-to-test traceability, KPI catalogue | [prd.md](02-product-definition/prd.md), [backlog.md](02-product-definition/backlog.md), [traceability.md](02-product-definition/traceability.md), [kpis.md](02-product-definition/kpis.md) |
| 3. Design | Live screens, the journey end to end, display rules, design trade-offs and gaps | [flows-and-screens.md](03-design/flows-and-screens.md) |
| 4. Planning and governance | Roadmap, RAID log, revised decisions as change requests, stakeholders and RACI | [roadmap.md](04-planning-and-governance/roadmap.md), [raid-log.md](04-planning-and-governance/raid-log.md), [change-log.md](04-planning-and-governance/change-log.md), [stakeholders.md](04-planning-and-governance/stakeholders.md) |
| 5. Business case and launch | **Plans, not results:** cost-floor business case, go-to-market with gates, launch readiness with go/no-go and rollback, post-launch plan | [business-case.md](05-business-case-and-launch/business-case.md), [go-to-market.md](05-business-case-and-launch/go-to-market.md), [launch-plan.md](05-business-case-and-launch/launch-plan.md), [post-launch-plan.md](05-business-case-and-launch/post-launch-plan.md) |
| 6. Executive communication | One-page review that ends in the owner's decisions | [executive-review.md](06-executive-communication/executive-review.md) |
| 7. Data and metrics | The stored data, how each KPI is computed, what isn't measured | [data-and-metrics.md](07-data-and-metrics/data-and-metrics.md) |
| 8. Testing | A test plan (environments, roles, status, order, entry and exit criteria, bug severity) and one task for each of 20 testing components, from requirements validation to production validation; the owner's 7 bug notes logged. The first run (2026-10-30) found 4 more bugs; its verdict was not ready to sign off. 5 bugs were then fixed, 10 closed by the owner, and BUG-002 is open | [README.md](08-testing/README.md), TS01 to TS20 in [08-testing/](08-testing/), [results/](08-testing/results/README.md) |

The portfolio summary of all eight stages is [CASE_STUDY.md](CASE_STUDY.md).

## Decisions worth discussing

> **OWNER INPUT NEEDED:** confirm these six, or swap any of them for others from the
> [decision log](../docs/decisions.md) (65 dated rows on 2026-10-30).

| # | Decision | Why | What it gave up | Source |
|---|---|---|---|---|
| 1 | **A language model with web search finds the problems; plain code does everything that must be predictable** (merging, New flags, history, limits, cleaning output) | Signals are spread across news, government notices, outage trackers and review sites worldwide, with no fixed list of sources | It isn't recorded whether keyword alerts or RSS feeds were tried first. Quality depends on the model, and has not been scored | [decisions.md](../docs/decisions.md) 2026-08-01; [README](../README.md#why-ai-and-why-not-just-rules) |
| 2 | **Four category calls instead of one prompt**, and the claim that this "raised quality" was removed | Calls run in parallel, and one failed category doesn't sink the rest | No single ranked list. The quality claim was dropped on 2026-10-18 because it had never been measured | [decisions.md](../docs/decisions.md) 2026-08-01, 2026-10-18 |
| 3 | **Visitors never trigger an AI call** | Keeps the cost fixed at about 5 sweeps a day, whatever the traffic, and keeps the API key on the server | Results are up to 5 hours old | [README](../README.md#key-decisions-and-tradeoffs); [costing.md](../docs/subscriptions/costing.md#summary) |
| 4 | **Plan payments in documents first, and charge only if sign-ups show demand.** The owner later chose to start payment work before that gate | No users were recorded, and charging needs a paid hosting plan | Payment work started before demand was measured. No thresholds or measuring period were set | [decisions.md](../docs/decisions.md) 2026-10-21, 2026-10-22 (T15) |
| 5 | **Sell access to the live board, not extra email** | Owner's choice | Reversed the earlier design, in which the board was public and Pro could not sell access. Needed accounts, a locked data feed, and a Pro account that survives unsubscribing | [decisions.md](../docs/decisions.md) 2026-10-22; [paid-website.md](../docs/subscriptions/paid-website.md) |
| 6 | **Price Pro at ₹299 a month, from the cost floor.** Revised: one ₹1 price, monthly or yearly, is the real price for now (2026-10-29) | 24 to 28 members at ₹299 cover the running costs (about ₹6,797 a month). The reason for ₹1 isn't recorded beyond the owner's decision | At ₹1, no number of members covers the running cost. Demand is untested at any price | [decisions.md](../docs/decisions.md) 2026-10-23, 2026-10-26, 2026-10-29; [costing.md](../docs/subscriptions/costing.md#break-even); CR rows in [change-log.md](04-planning-and-governance/change-log.md) |

## Traceability IDs

The IDs link the stages, as in a larger programme:

| Prefix | Meaning | Defined in |
|---|---|---|
| `DSC-` | Discovery assumption | [discovery-log.md](01-discovery/discovery-log.md) |
| `ALT-` | Alternative a user has today | [alternatives.md](01-discovery/alternatives.md) |
| `REQ-` | Requirement. `REQ-01` to `REQ-11` are R1 to R11 of the [v1 PRD](../docs/PRD.md) | [prd.md](02-product-definition/prd.md) |
| `EP-` | Epic, grouping the build tasks `T00` to `T45` | [backlog.md](02-product-definition/backlog.md) |
| `KPI-` | Measure of success | [kpis.md](02-product-definition/kpis.md) |
| `R-` `A-` `I-` `D-` | Risk, assumption, issue, dependency | [raid-log.md](04-planning-and-governance/raid-log.md) |
| `CR-` | Change request: a decision later revised | [change-log.md](04-planning-and-governance/change-log.md) |
| `RM-` | Roadmap item | [roadmap.md](04-planning-and-governance/roadmap.md) |
| `LR-` | Launch-readiness check | [launch-plan.md](05-business-case-and-launch/launch-plan.md) |

## Known gaps

These are stated plainly rather than filled in:
- **No user research.** No interviews, surveys or usability tests. [discovery-log.md](01-discovery/discovery-log.md)
  has a plan for them, marked as not done.
- **Product quality not scored by a person.** The 30 Oct model test's blind review was marked by ChatGPT, not a
  person, and no live sweep has been scored against the rubric; `scripts/score-items.mjs` is built for it
  ([README](../README.md#how-i-measured-quality), [model test](../docs/subscriptions/model-test-2026-10-30.md)).
- **No usage or revenue data worth the name.** 3 live ₹1 payments were captured by 2026-10-29. KPI targets are
  **OWNER INPUT NEEDED** and most current values are **Not measured**.
- **No release sign-off.** The test run's verdict was not ready to sign off; UAT sign-off (UAT-3) isn't done and
  BUG-002 is open ([results](08-testing/results/README.md)).
- **No head-to-head comparison with alternatives.** [alternatives.md](01-discovery/alternatives.md) compares
  published descriptions only.

## How this section was built

Written on 2026-10-23 (stages 1 to 4) and 2026-10-24 (stages 5 to 7), and stage 8 on 2026-10-30; every stage
brought up to date on 2026-10-30. Written with Claude Code, from this repository's
documents, code, tests and git history. The web
research in [alternatives.md](01-discovery/alternatives.md) names its sources and the date they were read. The
layout follows the owner's earlier case study,
[merchant-dispute-hub](https://github.com/bhawnamanglapm/merchant-dispute-hub). That one is a simulation; this one
describes a live product.
