# Travel Problem Radar PRD

> **A newer version exists:** [PRD v2](../pm/02-product-definition/prd.md) (23 Oct 2026) adds email, accounts and
> payments. This v1 still describes the radar alone; its R1 to R11 are `REQ-01` to `REQ-11` in v2.

> **Draft for the owner to edit.** No PRD was written before the build. This one was put together on 19 Oct 2026 from
> the case study (`index.html`), the README and the code. It describes what was built and why, in PRD form. Anything
> not found in those sources is marked **OWNER INPUT NEEDED**. **Success measures below are proposals; none has been
> measured.**

## Summary

A feed of travel-industry problems found on the web, sorted into four categories, with a product opportunity attached
to each. It is for a product manager who wants a daily view of what is going wrong for travelers and travel companies,
without reading news, government notices and outage trackers by hand.

## Problem

Signals about travel problems are scattered across news wires, government notices, outage trackers, review sites and
protest calendars. A PM cannot read all of them every day across the world, so problems worth building for are
found late or not at all. *(From the case study.)*

> **OWNER INPUT NEEDED:** how you looked for problems before (and how long it took), and whether other PMs have the same
> need.

## Users

- **Primary:** a product manager scouting for travel problems to solve (the owner).
- **Secondary:** recruiters and hiring managers viewing the public demo and the daily page.

## Goals

| # | Goal | Proposed measure | Status |
|---|---|---|---|
| G1 | Findings are real and sourced | Share of items whose link loads and supports the summary | Not measured. 7 of 8 sample links load; contents not checked. |
| G2 | Findings are current | Share of items whose source was published within the last 60 days (the window the site promises) | Not measured. The first 20-item score (`scripts/score-items.mjs`) is waiting for review. |
| G3 | Opportunities are useful | Share of items a PM would act on, as judged by a PM | Not measured |
| G4 | "New" means new | Share of items flagged New that are new events, not reworded repeats | Not measured. Known gap: matching is by headline. |
| G5 | Cost stays flat | AI calls per day, regardless of traffic | Built in: 1 sweep a day, 4 calls, up to 3 searches each. Real token counts not recorded yet. |

## Non-goals

- Verifying that findings are true. The radar points to sources; the reader checks them.
- Letting visitors trigger searches.
- Email delivery. The original email connector only drafted messages.
- Market sizing or prioritising the opportunities.

## Requirements (as built)

| ID | Requirement | Where |
|---|---|---|
| R1 | Sweep four categories (traveler pain, government and policy, website and app failures, industry disruption), one model call with web search per category, up to 5 items each | Component; `api/_lib/radar.js` |
| R2 | Each item has title, summary, source, link, region, date, severity (Low / Medium / High) and a one-line opportunity | `normalize()` |
| R3 | Flag items not seen in any earlier sweep as New | Component; `runDailySweep()` |
| R4 | Keep a dated history of the last 60 sweeps; any past sweep can be opened | Component; `runDailySweep()` |
| R5 | Build a plain-text digest, new items first, with a Copy button | Component (Report tab) |
| R6 | One failed category must not stop the others; if all fail, save nothing and report the failure | `runDailySweep()`; tests |
| R7 | Public demo replays a saved sample with no AI or API calls | `demo/` |
| R8 | Daily page: a server job sweeps once a day; visitors read the saved result only; the sweep needs a secret and is skipped if one ran in the last 20 hours | `api/`, `live/`, `vercel.json` |
| R9 | The API key lives only on the server, never in the page or the code | `api/_lib/handlers.js`; tests |
| R10 | Every page that shows AI findings tells the reader to check the source | `live/index.html`; demo banner |
| R11 | Daily Slack digest | Set up in Claude's app (scheduled task and Slack connector), not in this repo. Owner-reported. |

## Risks

| Risk | Mitigation today | Open |
|---|---|---|
| The model invents or misreads a source | Links must be web addresses; the reader is told to check | No check that the source supports the summary |
| Old news resurfaces as New | History of seen headlines | Same event with a new headline is flagged New |
| Spend | One sweep a day, capped searches, secret-protected trigger | Owner's Anthropic spend limit, not verified here |
| The free hosting plan fires the timer at an unpredictable time within the hour | Page shows the time of the last sweep | — |

## Open questions

1. Is the radar for you alone, or for a team? This decides whether Slack, email or the web page is the main channel.
2. What makes an opportunity "useful": a named user, a buildable feature, a market size?
3. Should "New" track events rather than headlines?

> **OWNER INPUT NEEDED:** answers to the open questions, and the target numbers you would hold the radar to.
