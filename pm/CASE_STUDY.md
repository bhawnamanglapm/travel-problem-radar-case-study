# Travel Problem Radar

*Real product · live and taking payments since 2026-10-28 · full product-owner lifecycle: discovery → PRD → design →
governance → business case → launch plan → data → testing*

> **Not a simulation.** The product runs at https://radar.pehchanthetraveller.com/ (it was on
> travel-problem-radar.vercel.app until 2026-10-28, which now redirects). Every figure below comes from a file in this
> repository, linked from the stage pages. Payments opened on 2026-10-28 at ₹1 a month or a year, so there are no
> revenue, conversion or retention results to report yet. Written 2026-10-24; updated 2026-10-30.

- 38 documents across 8 stages, plus 21 test-result files from the first test run (2026-10-30), each linking the
  engineering docs it summarises
- 46 requirements in 12 epics, traced to their tests; 1,582 offline tests and 249 offline checks pass (at `e339d32`,
  2026-10-30)
- A cost-floor business case: about ₹6,797 a month to run with payments; 24 to 28 members would cover it at ₹299. Pro
  costs ₹1 for now, which no number of members covers; the target price is the owner's open decision
- 3 live ₹1 payments by 2026-10-29; no user research, and no finding scored by a person. Both are stated, not filled in

**Tools used:** Claude (the first version in Claude's app), Claude Code, JavaScript on Vercel, Vercel Blob, GitHub
Actions, Resend, Razorpay (live since 2026-10-28), Markdown.

### The problem

Signals about travel problems (a refund that never came, a visa fee that quadrupled, a booking that vanished) are
spread across news wires, government notices, outage trackers and review sites worldwide. No PM has time to read all
of it every day. The user is a product manager looking for travel problems worth solving, starting with the owner.
[Discovery log](01-discovery/discovery-log.md)

### The solution

One to five times a day, as often as the most frequent Pro member chooses, a server job asks Claude (Haiku 5.5),
with web search, for recent problems in four categories, and saves up to 5 per category with a source, severity and a
one-line product opportunity. Sources over 60 days old are dropped, and new items are flagged. Readers get a public
demo, a daily teaser email (Free), or the live board with details, areas, search across sweeps, saved problems and
share pages, plus 1 to 5 emails a day (Pro, ₹1 a month or ₹1 a year since 2026-10-28; it was ₹299 a month in the
plan). [PRD v2](02-product-definition/prd.md)

### How I approached it: 8 stages

| Stage | What I did |
|---|---|
| **1. Discover** | Framed the problem; logged 8 assumptions with their evidence; compared 7 alternatives from published descriptions; wrote an interview plan, marked as not run |
| **2. Define** | PRD v2 with 46 requirements; backlog of tasks T00 to T41 in 12 epics; traced requirements to tests, with the gaps listed; 19 KPIs with targets left to the owner |
| **3. Design** | Documented the live screens, the journey end to end, the display rules and the design trade-offs |
| **4. Plan and govern** | Roadmap of 37 items, RAID log, 22 revised decisions recorded as change requests, stakeholders and a RACI for a one-person product |
| **5. Justify and launch** | Cost-floor business case with break-even and stress tests; go-to-market with gates; 22 launch-readiness checks, go/no-go and rollback; a post-launch plan with hypercare, playbooks and KPI triggers |
| **6. Communicate** | One-page executive review ending in seven decisions for the owner, with those since taken marked |
| **7. Measure** | The stored data, how each KPI is computed from it, what isn't measured, and a measurement plan |
| **8. Test** | A test plan and 20 testing tasks, from requirements validation to production validation; the first run (2026-10-30) ended **not ready to sign off**. 11 bugs logged with no addresses: the owner closed 10 (6 fixed but not retested, 2 not bugs), and BUG-002 (S1) is open |

### Decisions worth discussing

- **Removing claims that had no evidence.** The case study once claimed email delivery, working buttons and "raised
  result quality". They were removed on 2026-10-18, and offline checks fail if they come back (CR-01).
- **Pricing from the cost floor, and showing the case that loses money.** ₹299 would cover the running cost at 24 to
  28 members. The owner then set ₹1 as the real price for now (CR-18), which no number of members covers; the docs
  keep the ₹299 maths and record the target price as open (R-12), rather than drop the analysis.
- **Putting a gate back in front of payments, and recording that it wasn't kept.** The original demand gate was
  skipped (CR-03). The launch plan kept pricing.md's rule not to charge before a scored sweep; payments opened on
  2026-10-28 without it, and the executive review says so.
- **Tracing one failure end to end.** Sweeps failing with HTTP 400 (I-01, 23 to 25 Oct) → one AI vendor (R-03) → an
  error message that drops the reason (I-02, RM-02) → launch blocked (LR-01) → the complete-sweeps KPI (KPI-09) → a
  playbook.
- **Fixing a metric before reporting it.** The KPI catalogue and the `stats` command compute the confirm rate
  differently. The data page flags it for the owner instead of picking one quietly.
- **Exiting hypercare on evidence, not a date.** Proposed criteria include 7 days of complete sweeps, no open
  severity 1 or 2 incident, and Razorpay matching the Pro records twice in a row.

The product decisions behind these (AI with web search, four calls, no AI call per visitor, selling the board) are
in the [pm README](README.md#decisions-worth-discussing).

### Business case (a cost floor, not a forecast)

| Measure | Value |
|---|---|
| Cost of one sweep | $0.21 on Sonnet, measured over 5 production runs (the figure the model uses); $0.1121 on Haiku, the default since 2026-10-25, over 10 sweeps |
| Monthly running cost before payments | About ₹3,017 (Anthropic only) |
| Monthly running cost with payments (`F`) | About ₹6,797 (Anthropic, Vercel Pro, Resend Pro) |
| Members to cover `F` at ₹299 | 24, or 28 if GST is inside the price |
| At ₹199 / ₹499 | 36 to 42 / 15 to 17 |
| At ₹1, the price since 2026-10-28 | No number of members covers `F`; target price **OWNER INPUT NEEDED** |
| Monthly result with no paying members | −₹6,797, plus costs not yet known |
| Revenue forecast | None: there is no demand data |

Source: [business case](05-business-case-and-launch/business-case.md), from
[costing.md](../docs/subscriptions/costing.md).

### Known gaps and next steps

- **The price is below the cost.** At ₹1 the running cost is the owner's (R-12); the target price is open.
- **No user research and no findings scored by a person.** The interview plan, the rubric and `score-items.mjs`
  exist; none has been run. The 2026-10-30 model test's blind review was marked by ChatGPT.
- **The first test run isn't signed off.** BUG-002 (S1: an account doesn't see the live board) is open; IT-1 to
  IT-8 wait on `staging`, which is 121 commits behind `main`; UAT-3 isn't done.
- **Charging on Vercel Hobby and Resend Free.** Vercel Pro, Resend Pro and a confirmed Anthropic spend limit are
  still open launch items (LR-05, LR-15, LR-17).
- **No usage or revenue data.** KPI targets and gate thresholds are **OWNER INPUT NEEDED**.
- **Business costs outside `F`** (domain, accountant, support time, marketing) are unknown, so the full break-even
  is too.
- Next: fix BUG-002, decide on Vercel Pro and Resend Pro, set the target price and the KPI targets, update
  `staging` and finish the test run, then score 20 live items. (Sweeps failed 23 to 25 Oct and run again since.)

### The documents

| Stage | Files |
|---|---|
| Overview | [README](README.md) |
| 1. Discovery | [Discovery log](01-discovery/discovery-log.md) · [Alternatives](01-discovery/alternatives.md) |
| 2. Product definition | [PRD v2](02-product-definition/prd.md) · [Backlog](02-product-definition/backlog.md) · [Traceability](02-product-definition/traceability.md) · [KPIs](02-product-definition/kpis.md) |
| 3. Design | [Flows and screens](03-design/flows-and-screens.md) |
| 4. Planning and governance | [Roadmap](04-planning-and-governance/roadmap.md) · [RAID log](04-planning-and-governance/raid-log.md) · [Change log](04-planning-and-governance/change-log.md) · [Stakeholders](04-planning-and-governance/stakeholders.md) |
| 5. Business case and launch | [Business case](05-business-case-and-launch/business-case.md) · [Go-to-market](05-business-case-and-launch/go-to-market.md) · [Launch plan](05-business-case-and-launch/launch-plan.md) · [Post-launch plan](05-business-case-and-launch/post-launch-plan.md) |
| 6. Executive communication | [Executive review](06-executive-communication/executive-review.md) |
| 7. Data and metrics | [Data and metrics](07-data-and-metrics/data-and-metrics.md) |
| 8. Testing | [Test plan](08-testing/README.md) · TS01 to TS20 in [08-testing/](08-testing/) · [Results](08-testing/results/README.md) |
