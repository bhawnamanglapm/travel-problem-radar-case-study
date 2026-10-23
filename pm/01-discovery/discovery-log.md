# Discovery log

> **Stage 1 of 7.** What was believed, what evidence backs it, and what building the product taught. **No user
> research has been done.** Every assumption below is open unless evidence in this repository says otherwise, and the
> interview plan at the end is a proposal, not a record.

## Problem framing

| | |
|---|---|
| **Who** | A product manager looking for travel problems worth building for. Today, only the owner is recorded ([README](../../README.md#problem)) |
| **Job to be done** | "Before the morning starts, show me what went wrong for travelers and travel companies, and what I could build about it" |
| **Today's workaround** | Reading news wires, government notices, outage trackers, review sites and protest calendars by hand. See [alternatives.md](alternatives.md) |
| **Why now** | A language model with web search can search, read and judge relevance across countries and formats, with no fixed list of sources ([README](../../README.md#why-ai-and-why-not-just-rules)) |
| **How the owner looked for problems before, and how long it took** | **OWNER INPUT NEEDED** (asked in the [v1 PRD](../../docs/PRD.md#problem)) |

## Assumptions and their evidence

| ID | Assumption | Evidence so far | Status |
|---|---|---|---|
| DSC-01 | PMs don't have time to scan problem signals across sources every day | The owner's own experience, from the original case study. No other PM was asked | **Untested** beyond the owner |
| DSC-02 | A model with web search finds real, current travel problems | July 2026 sample: 7 of 8 source links load, but their contents were not re-checked ([README](../../README.md#how-i-measured-quality)). The first production sweep saved 1 of 4 categories; the cause, an output token limit, was fixed in `f200a79` ([TECHNICAL.md](../../docs/TECHNICAL.md)) | **Partly supported.** Link checks only; no real sweep scored |
| DSC-03 | The one-line product opportunity is useful to a PM | None. Goal G3 in the [v1 PRD](../../docs/PRD.md#goals) is "Not measured" | **Untested** |
| DSC-04 | "New" by headline is close enough to "new event" | Known gap: a reworded headline about the same event shows as New ([decisions.md](../../docs/decisions.md), 2026-08-01) | **Known to be weak.** Accepted for now |
| DSC-05 | People other than the owner want the findings by email | Sign-up is live. The repo records no users besides the owner | **Untested** |
| DSC-06 | Someone will pay for the live board | No one has paid. Checkout passed only a test-mode run on staging ([progress.md](../../docs/subscriptions/tasks/progress.md)) | **Untested** |
| DSC-07 | The running cost is almost all fixed, so a flat monthly price fits it | No user can trigger the AI. A sweep costs $0.21, measured over 5 production runs ([costing.md](../../docs/subscriptions/costing.md#summary)) | **Supported** by code and measurement |
| DSC-08 | A cheaper model could do the sweep as well | Haiku 5.5 is estimated at about $0.054 a sweep against Sonnet 5.5's $0.21. The comparison script is written and tested offline, but has not been run ([haiku-test.md](../../docs/subscriptions/haiku-test.md)) | **Untested** |

## What building taught

The build itself produced evidence. Each of these changed the product:

| Date | What happened | What changed | Source |
|---|---|---|---|
| 2026-10-18 | Checking the case study against the repo found claims it couldn't back: two buttons linked nowhere, an email feature that only drafted messages, and an unmeasured "better quality" | Claims removed or qualified. Offline checks now fail if they come back | [README](../../README.md#how-i-measured-quality); [decisions.md](../../docs/decisions.md) |
| Oct 2026 | The first production sweep saved items from only 1 of 4 categories | The output token limit was raised to 16,000, because the model's thinking counts toward it. A test covers a cut-off reply | [CHANGELOG](../../CHANGELOG.md); [TECHNICAL.md](../../docs/TECHNICAL.md) |
| 2026-10-21 | Writing the tasks against the code showed that mail security scanners open links in emails, which would confirm addresses nobody asked to subscribe | The confirm link opens a page with a Confirm button (D9) | [tasks README](../../docs/subscriptions/tasks/README.md) |
| 2026-10-22 | Outlook.com filed the confirmation, the Free digests and the already-subscribed notice in Junk. Gmail delivered them to the inbox | Recorded as open. Delivery to Outlook is still to fix | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| 2026-10-22 | The same inbox could subscribe twice under different spellings (Gmail dots, `+tags`) | One subscription per inbox, keyed on the canonical address (PR #19) | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| 2026-10-23 | Three audits of the cost model changed its figures | The revised [costing.md](../../docs/subscriptions/costing.md#what-the-audits-changed) became the source for the price | [cost audit](../../docs/cost%20audit/) |

## Research gaps

| Gap | Why it matters | Planned evidence |
|---|---|---|
| Nobody besides the owner has been asked about the problem | DSC-01 and DSC-05 rest on one person | Interviews (below) |
| No real sweep has been scored | Quality (DSC-02, DSC-03) is the product | Score 20 or more live items with the draft rubric in the [README](../../README.md#how-i-measured-quality) |
| No willingness-to-pay data | ₹299 is a cost-based test price, not a demand-based one | The first 30 days after payments open ([pricing recommendation](../../docs/cost%20audit/pro_pricing_recommendation.md#what-to-measure-in-the-first-30-days)) |
| No head-to-head with alternatives | Positioning is unproven | Ask interviewees what they use today; compare one week of findings side by side |

## Interview plan (proposed, not done)

> **Not run.** This is the plan that would close DSC-01, DSC-03 and DSC-05. The segments are hypotheses.

- **Who:** 5 to 8 product managers who work on travel products, for example at online travel agencies, airlines,
  hotel software or travel fintech. Plus 2 or 3 people in adjacent roles (strategy, founders) as a contrast.
- **Screener:** works on a travel product now; looks for new problems or opportunities at least monthly.
- **Questions:**
  1. Tell me about the last time you found a travel problem worth building for. Where did it come from?
  2. What do you read or check each week to stay on top of what goes wrong for travelers? How long does it take?
  3. What did you miss, or find late? What did that cost?
  4. *(Shown three real radar items.)* Which, if any, would you act on? What is missing?
  5. How would you want this: email, a board, Slack, something else? How often?
  6. What do you pay for today to stay informed? Who pays: you or your company?
- **What would change the plan:** if fewer than half would act on any item, work on quality before growth. If the
  company would pay rather than the person, consider a team plan rather than ₹299 for an individual.
- **Output:** a synthesis added to this file, with each DSC row's status updated and the source noted.
