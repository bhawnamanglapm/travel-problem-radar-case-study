# Travel Problem Radar

*Real product · live MVP, not yet charging · full product-owner lifecycle: discovery → PRD → design → governance →
business case → launch plan → data*

> **Not a simulation.** The product runs at https://travel-problem-radar.vercel.app/. Every figure below comes from a
> file in this repository, linked from the stage pages. Stages 5 to 7 are **plans**: payments haven't opened, so
> there are no revenue, conversion or retention results to report. Written 2026-10-24.

- 17 documents across 7 stages, each linking the engineering docs it summarises
- 32 requirements in 9 epics, each traced to its tests; 952 offline tests and 199 offline checks pass (at `662bded`)
- A cost-floor business case: about ₹6,797 a month to run with payments; 24 to 28 members at ₹299 to cover it
- No users recorded besides the owner, and no finding scored yet. Both are stated, not filled in

**Tools used:** Claude (the first version in Claude's app), Claude Code, JavaScript on Vercel, Vercel Blob, GitHub
Actions, Resend, Razorpay (test mode), Markdown.

### The problem

Signals about travel problems (a refund that never came, a visa fee that quadrupled, a booking that vanished) are
spread across news wires, government notices, outage trackers and review sites worldwide. No PM has time to read all
of it every day. The user is a product manager looking for travel problems worth solving, starting with the owner.
[Discovery log](01-discovery/discovery-log.md)

### The solution

About 5 times a day, a server job asks Claude, with web search, for recent problems in four categories, and saves up
to 5 per category with a source, severity and a one-line product opportunity. New items are flagged. Readers get a
public demo, a daily teaser email (Free), or the live board and a digest after every sweep (Pro, ₹299 a month, given
by hand until payments open). [PRD v2](02-product-definition/prd.md)

### How I approached it: 7 stages

| Stage | What I did |
|---|---|
| **1. Discover** | Framed the problem; logged 8 assumptions with their evidence; compared 7 alternatives from published descriptions; wrote an interview plan, marked as not run |
| **2. Define** | PRD v2 with 32 requirements; backlog of tasks T00 to T27 in 9 epics; traced requirements to tests; 19 KPIs with targets left to the owner |
| **3. Design** | Documented the live screens, the journey end to end, the display rules and the design trade-offs |
| **4. Plan and govern** | Roadmap of 24 items, RAID log, 14 revised decisions recorded as change requests, stakeholders and a RACI for a one-person product |
| **5. Justify and launch** | Cost-floor business case with break-even and stress tests; go-to-market with gates; 22 launch-readiness checks, go/no-go and rollback; a post-launch plan with hypercare, playbooks and KPI triggers |
| **6. Communicate** | One-page executive review ending in six decisions for the owner |
| **7. Measure** | The stored data, how each KPI is computed from it, what isn't measured, and a measurement plan |

### Decisions worth discussing

- **Removing claims that had no evidence.** The case study once claimed email delivery, working buttons and "raised
  result quality". They were removed on 2026-10-18, and offline checks fail if they come back (CR-01).
- **Pricing from the cost floor, and showing the case that loses money.** ₹299 covers the running cost at 24 to 28
  members. With none, the product loses about ₹6,797 a month. The price is recorded as one to test, not a proven one.
- **Putting a gate back in front of payments.** The original demand gate was skipped (CR-03). The launch plan keeps
  pricing.md's rule not to charge before a scored sweep, and leaves keeping it as the owner's first decision.
- **Tracing one failure end to end.** Sweeps failing with HTTP 400 (I-01) → one AI vendor (R-03) → an error message
  that drops the reason (I-02, RM-02) → launch blocked (LR-01) → the complete-sweeps KPI (KPI-09) → a playbook.
- **Fixing a metric before reporting it.** The KPI catalogue and the `stats` command compute the confirm rate
  differently. The data page flags it for the owner instead of picking one quietly.
- **Exiting hypercare on evidence, not a date.** Proposed criteria include 7 days of complete sweeps, no open
  severity 1 or 2 incident, and Razorpay matching the Pro records twice in a row.

The product decisions behind these (AI with web search, four calls, no AI call per visitor, selling the board) are
in the [pm README](README.md#decisions-worth-discussing).

### Business case (a cost floor, not a forecast)

| Measure | Value |
|---|---|
| Cost of one sweep | $0.21, measured over 5 production runs |
| Monthly running cost today, before payments | About ₹3,017 (Anthropic only) |
| Monthly running cost with payments (`F`) | About ₹6,797 (Anthropic, Vercel Pro, Resend Pro) |
| Members to cover `F` at ₹299 | 24, or 28 if GST is inside the price |
| At ₹199 / ₹499 | 36 to 42 / 15 to 17 |
| Monthly result with no paying members | −₹6,797, plus costs not yet known |
| Revenue forecast | None: there is no demand data |

Source: [business case](05-business-case-and-launch/business-case.md), from
[costing.md](../docs/subscriptions/costing.md).

### Known gaps and next steps

- **Sweeps have failed since 2026-10-23** with HTTP 400; restoring them is the owner's step (LR-01).
- **No user research and no scored findings.** The interview plan and the scoring rubric exist; neither has been run.
- **No usage or revenue data.** KPI targets and gate thresholds are **OWNER INPUT NEEDED**.
- **Business costs outside `F`** (domain, accountant, support time, marketing) are unknown, so the full break-even
  is too.
- Next: restore sweeps, score 20 live items, set the KPI targets, then decide on Vercel Pro and Resend Pro.

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
