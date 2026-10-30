# Discovery log

> **Stage 1 of 8.** What was believed, what evidence backs it, and what building the product taught. **No user
> research has been done.** Every assumption below is open unless evidence in this repository says otherwise, and the
> interview plan at the end is a proposal, not a record. Updated 2026-10-30: DSC-02, DSC-06 and DSC-08 have new
> evidence, and DSC-09 (India, T42) is added; no interviews have been run.

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
| DSC-02 | A model with web search finds real, current travel problems | July 2026 sample: 7 of 8 source links load, but their contents were not re-checked ([README](../../README.md#how-i-measured-quality)). The first production sweep saved 1 of 4 categories; the cause, an output token limit, was fixed in `f200a79` ([TECHNICAL.md](../../docs/TECHNICAL.md)) | **Partly supported.** Link checks only; no real sweep scored by a person. Since then, of 190 live items (26 to 30 Oct), 1 had a link web search never returned, and the 18 with a source date had a median age of 8.5 days (`node scripts/llm-logs.mjs models`, 2026-10-30) |
| DSC-03 | The one-line product opportunity is useful to a PM | None. Goal G3 in the [v1 PRD](../../docs/PRD.md#goals) is "Not measured" | **Untested** |
| DSC-04 | "New" by headline is close enough to "new event" | Known gap: a reworded headline about the same event shows as New ([decisions.md](../../docs/decisions.md), 2026-08-01) | **Known to be weak.** Accepted for now |
| DSC-05 | People other than the owner want the findings by email | Sign-up is live. The repo records no users besides the owner | **Untested** |
| DSC-06 | Someone will pay for the live board | As written 2026-10-24: no one had paid. Payments opened on 2026-10-28 at ₹1 a month or a year, and Razorpay had captured 3 live ₹1 payments by 2026-10-29 (T27, [progress.md](../../docs/subscriptions/tasks/progress.md)). Who paid isn't recorded here | **Partly tested.** People pay ₹1; whether anyone pays a price that covers the cost is untested (R-12) |
| DSC-07 | The running cost is almost all fixed, so a flat monthly price fits it | No user can trigger the AI. A sweep cost $0.21 on Sonnet, measured over 5 production runs ([costing.md](../../docs/subscriptions/costing.md#summary)); on Haiku, $0.1121 over 10 sweeps (26 to 30 Oct). Since T32 the number of sweeps a day follows the most frequent Pro member's choice, 1 to 5 | **Supported** by code and measurement |
| DSC-08 | A cheaper model could do the sweep as well | Haiku has been the default since 2026-10-25 (CR-19). The 2026-10-30 [model test](../../docs/subscriptions/model-test-2026-10-30.md) kept it: in a blind review marked by ChatGPT, 28 of 55 Haiku items were kept against 15 of 52 Sonnet items; Haiku failed the test's cost and link checks. Measured cost: $0.1121 a sweep over 10 sweeps. Was: estimated, not run ([haiku-test.md](../../docs/subscriptions/haiku-test.md)) | **Partly tested.** No person has scored either model's items |
| DSC-09 | PMs at Indian travel companies find India items more useful than worldwide ones | None. The owner asked for an India focus on 2026-10-30 ([T42](../../docs/subscriptions/tasks/T42-india-focus.md)); no Indian PM has been asked. Before T42, 2 of 190 live items (1.1%) were placed in India, over 10 sweeps 26 to 30 Oct (`node --env-file=.env.local scripts/llm-logs.mjs areas --days 7`, read 2026-10-30) | **Untested** |

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
| 2026-10-28 | Signing in on `travel-problem-radar.vercel.app` and opening the custom domain looked signed out; a Google sign-in from the custom domain came back without its cookie | The site moved to radar.pehchanthetraveller.com and the old address redirects (CR-21) | [CHANGELOG](../../CHANGELOG.md) 2026-10-28 |
| 2026-10-30 | The 26 to 29 Oct scheduled runs started 228 to 418 minutes late (BUG-008) | Vercel's backstop moved from 01:30 to 00:05 UTC; `/manage/` says later emails often arrive a few hours late (CR-22) | [CHANGELOG](../../CHANGELOG.md) 2026-10-30 |
| 2026-10-30 | The first full test run ended not ready to sign off | BUG-001 and BUG-008 to BUG-011 fixed; BUG-002 open (I-10) | [test results](../08-testing/results/README.md) |

## Research gaps

| Gap | Why it matters | Planned evidence |
|---|---|---|
| Nobody besides the owner has been asked about the problem | DSC-01 and DSC-05 rest on one person | Interviews (below) |
| No real sweep has been scored by a person | Quality (DSC-02, DSC-03) is the product | Score 20 or more live items with `scripts/score-items.mjs` and the draft rubric in the [README](../../README.md#how-i-measured-quality) |
| No willingness-to-pay data | Pro costs ₹1 a month or a year since 2026-10-28, below the running cost; ₹299 was the cost-based break-even analysis. The target price is **OWNER INPUT NEEDED** (R-12) | The first 30 days after payments open ([pricing recommendation](../../docs/cost%20audit/pro_pricing_recommendation.md#what-to-measure-in-the-first-30-days)) |
| No head-to-head with alternatives | Positioning is unproven | Ask interviewees what they use today; compare one week of findings side by side |

## Interview plan (proposed, not done)

> **Not run.** This is the plan that would close DSC-01, DSC-03, DSC-05 and DSC-09. The segments are hypotheses.

- **Who:** 5 to 8 product managers who work on travel products, for example at online travel agencies, airlines,
  hotel software or travel fintech. Plus 2 or 3 people in adjacent roles (strategy, founders) as a contrast.
- **India first (T42):** at least 3 of them at Indian travel companies, across online travel agencies, airlines,
  rail, and travel fintech and payments (DSC-09).
- **Screener:** works on a travel product now; looks for new problems or opportunities at least monthly.
- **Questions:**
  1. Tell me about the last time you found a travel problem worth building for. Where did it come from?
  2. What do you read or check each week to stay on top of what goes wrong for travelers? How long does it take?
  3. What did you miss, or find late? What did that cost?
  4. *(Shown three real radar items.)* Which, if any, would you act on? What is missing?
  5. How would you want this: email, a board, Slack, something else? How often?
  6. What do you pay for today to stay informed? Who pays: you or your company?
  7. *(Shown one India item and one worldwide item.)* Which is more useful to you, and why?
- **What would change the plan:** if fewer than half would act on any item, work on quality before growth. If the
  company would pay rather than the person, consider a team plan rather than a price for an individual. If PMs in
  India don't prefer India items, keep the worldwide mix and drop the India extra (RM-38).
- **Output:** a synthesis added to this file, with each DSC row's status updated and the source noted.
