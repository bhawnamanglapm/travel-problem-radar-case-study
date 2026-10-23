# Travel Problem Radar: the product management case study

> **A real, live product, not a simulation.** Travel Problem Radar runs at
> https://travel-problem-radar.vercel.app/. One product owner, Bhawna Mangla, built it and runs it with AI (Claude).
> Each figure in this section comes from a file in this repository, and the file is named next to it. Where no
> source exists, the gap is marked **OWNER INPUT NEEDED** or **Not measured**. No figures were made up to fill a
> template.

This folder presents the project as a product manager would: discovery, product definition, design, planning and
governance, business case and launch, executive communication, and data. Each stage summarises the engineering
documents in [`docs/`](../docs/) and links to them, so every fact keeps one home.

## At a glance

| | |
|---|---|
| **Role** | Product owner. Built with AI (Claude): the first version in Claude's app, everything since October 2026 with Claude Code ([README](../README.md#how-i-built-it)) |
| **Domain** | Travel industry: traveler pain, government and policy changes, website and app failures, industry disruption |
| **Timeline** | First built in July 2026 in Claude's app. Repository started 2026-08-01. Public demo, live page, subscriptions and payments built from 18 to 23 Oct 2026 ([CHANGELOG](../CHANGELOG.md)) |
| **Status (2026-10-23)** | Live. Free email digest and Pro live board. Pro is granted by hand for now. Checkout is built and passed a test-mode run on staging. Taking real payments waits on Razorpay activation, an adviser's liability clause and Vercel Pro ([progress](../docs/subscriptions/tasks/progress.md)) |
| **Build record** | 256 commits and 74 merged pull requests. 952 offline tests and 199 offline checks pass (`npm test`, `npm run check`), counted on `main` at `662bded` on 2026-10-23 |
| **Users** | **None recorded besides the owner.** No interviews, surveys or usage data exist yet ([README](../README.md#problem)) |
| **Price** | ₹299 a month for Pro, no GST charged. Chosen as a price to test, not a proven one ([decisions](../docs/decisions.md), [costing](../docs/subscriptions/costing.md)) |

## The problem

> *"The best product ideas in travel start as someone's bad day: a refund that never came, a visa fee that quietly
> quadrupled, a booking that vanished after payment. But those signals live everywhere: news wires, government
> notices, outage trackers, review sites, protest calendars. No PM has time to read all of it, every day, across the
> world."* (the original case study, quoted in the [README](../README.md#problem))

The user is a product manager looking for travel problems worth solving, starting with the owner.

## The solution

About 5 times a day, a server job asks Claude, with web search, for recent problems in four categories. It saves
up to 5 items per category, each with a source link, severity and a one-line product opportunity. Items not seen in
an earlier sweep are flagged New. Readers get the results in three ways:
- **a public demo** that replays a saved July 2026 sample;
- **a live board** for Pro members;
- **email digests**: a daily teaser for Free, and the full digest after every sweep for Pro.

Source: [TECHNICAL.md](../docs/TECHNICAL.md), [paid-website.md](../docs/subscriptions/paid-website.md).

## How I approached it

| Stage | What it holds | Files |
|---|---|---|
| 1. Discovery | Problem framing, assumptions with their evidence, what building taught, research gaps, an interview plan (not run), and the alternatives a PM uses today | [discovery-log.md](01-discovery/discovery-log.md), [alternatives.md](01-discovery/alternatives.md) |
| 2. Product definition | PRD v2 for the product as it is today, backlog by epic, requirement-to-test traceability, KPI catalogue | [prd.md](02-product-definition/prd.md), [backlog.md](02-product-definition/backlog.md), [traceability.md](02-product-definition/traceability.md), [kpis.md](02-product-definition/kpis.md) |
| 3. Design | Live screens, user flows, display rules | Next pull request |
| 4. Planning and governance | Roadmap, RAID log, change requests, stakeholders | Next pull request |
| 5. Business case and launch | Cost model, break-even, launch and rollback plan | Later pull request |
| 6. Executive communication | One-page review that ends in the owner's decisions | Later pull request |
| 7. Data and metrics | Data model and how each KPI is computed | Later pull request |

## Decisions worth discussing

> **OWNER INPUT NEEDED:** confirm these six, or swap any of them for others from the
> [decision log](../docs/decisions.md) (52 dated rows).

| # | Decision | Why | What it gave up | Source |
|---|---|---|---|---|
| 1 | **A language model with web search finds the problems; plain code does everything that must be predictable** (merging, New flags, history, limits, cleaning output) | Signals are spread across news, government notices, outage trackers and review sites worldwide, with no fixed list of sources | It isn't recorded whether keyword alerts or RSS feeds were tried first. Quality depends on the model, and has not been scored | [decisions.md](../docs/decisions.md) 2026-08-01; [README](../README.md#why-ai-and-why-not-just-rules) |
| 2 | **Four category calls instead of one prompt**, and the claim that this "raised quality" was removed | Calls run in parallel, and one failed category doesn't sink the rest | No single ranked list. The quality claim was dropped on 2026-10-18 because it had never been measured | [decisions.md](../docs/decisions.md) 2026-08-01, 2026-10-18 |
| 3 | **Visitors never trigger an AI call** | Keeps the cost fixed at about 5 sweeps a day, whatever the traffic, and keeps the API key on the server | Results are up to 5 hours old | [README](../README.md#key-decisions-and-tradeoffs); [costing.md](../docs/subscriptions/costing.md#summary) |
| 4 | **Plan payments in documents first, and charge only if sign-ups show demand.** The owner later chose to start payment work before that gate | No users were recorded, and charging needs a paid hosting plan | Payment work started before demand was measured. No thresholds or measuring period were set | [decisions.md](../docs/decisions.md) 2026-10-21, 2026-10-22 (T15) |
| 5 | **Sell access to the live board, not extra email** | Owner's choice | Reversed the earlier design, in which the board was public and Pro could not sell access. Needed accounts, a locked data feed, and a Pro account that survives unsubscribing | [decisions.md](../docs/decisions.md) 2026-10-22; [paid-website.md](../docs/subscriptions/paid-website.md) |
| 6 | **Price Pro at ₹299 a month, from the cost floor** | 24 to 28 members cover the running costs (about ₹6,797 a month) | Demand is untested at ₹199, ₹299 and ₹499 alike | [decisions.md](../docs/decisions.md) 2026-10-23; [costing.md](../docs/subscriptions/costing.md#break-even) |

## Traceability IDs

The IDs link the stages, as in a larger programme:

| Prefix | Meaning | Defined in |
|---|---|---|
| `DSC-` | Discovery assumption | [discovery-log.md](01-discovery/discovery-log.md) |
| `ALT-` | Alternative a user has today | [alternatives.md](01-discovery/alternatives.md) |
| `REQ-` | Requirement. `REQ-01` to `REQ-11` are R1 to R11 of the [v1 PRD](../docs/PRD.md) | [prd.md](02-product-definition/prd.md) |
| `EP-` | Epic, grouping the build tasks `T00` to `T27` | [backlog.md](02-product-definition/backlog.md) |
| `KPI-` | Measure of success | [kpis.md](02-product-definition/kpis.md) |
| `R-` `A-` `I-` `D-` | Risk, assumption, issue, dependency | Stage 4 (next pull request) |
| `CR-` | Change request: a decision later revised | Stage 4 (next pull request) |
| `RM-`, `LR-` | Roadmap item, launch-readiness check | Stages 4 and 5 |

## Known gaps

These are stated plainly rather than filled in:
- **No user research.** No interviews, surveys or usability tests. [discovery-log.md](01-discovery/discovery-log.md)
  has a plan for them, marked as not done.
- **No measured product quality.** No real sweep has been scored against the draft rubric
  ([README](../README.md#how-i-measured-quality)).
- **No usage or revenue data.** No one has paid. KPI targets are **OWNER INPUT NEEDED** and current values are
  **Not measured**.
- **No head-to-head comparison with alternatives.** [alternatives.md](01-discovery/alternatives.md) compares
  published descriptions only.

## How this section was built

Written on 2026-10-23 with Claude Code, from this repository's documents, code, tests and git history. The web
research in [alternatives.md](01-discovery/alternatives.md) names its sources and the date they were read. The
layout follows the owner's earlier case study,
[merchant-dispute-hub](https://github.com/bhawnamanglapm/merchant-dispute-hub). That one is a simulation; this one
describes a live product.
