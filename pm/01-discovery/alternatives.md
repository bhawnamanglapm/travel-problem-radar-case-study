# Alternatives: how someone tracks travel problems today

> **Desk research, read on 2026-10-23.** This compares what each alternative says it does. It is not a test of any
> of them, and no user was asked which they use. Each row names its source. Where only third-party pages were
> found, or sources disagree, the row says **verify**. Prices are left out unless the provider's own page states
> them, because the third-party prices found disagreed with each other.

## The job

A PM wants a short daily view of what went wrong for travelers and travel companies, across countries, with a hint
of what could be built. Today that means combining several kinds of sources by hand.

## The alternatives

| ID | Alternative | What it does, per its source | Fit for the job | Source |
|---|---|---|---|---|
| ALT-01 | **Keyword alerts** (Google Alerts) | Emails you when new Google Search results match a topic. You choose how often, which kinds of sites, the language, the region and how many results | Free and simple, but you must know the keywords in advance. It returns links, not a judgement of severity or an opportunity | [Google Alerts help](https://support.google.com/alerts/answer/175925?hl=en) |
| ALT-02 | **Feed reader with AI** (Feedly with its Leo assistant) | Reviews describe Leo as prioritising topics and keywords, removing duplicate stories, muting noise and summarising articles. Most say Leo is only in the paid tiers | Strong for following known sources. You still pick the sources, and turning news into a product angle is left to you. **Verify** features and prices on feedly.com: the page could not be loaded, and review sites disagree | [Liliputing](https://liliputing.com/feedly-launches-pro-plans-with-ai-assistant-features/); [Readless](https://www.readless.app/blog/feedly-pro-pricing-vs-readless-2026) |
| ALT-03 | **Travel trade press** (Skift) | Skift Pro gives unlimited access to its daily news and analysis, an AI chatbot (Ask Skift) over its archive and company filings, an index of nearly 200 listed travel companies, and two subscriber-only newsletters | Expert, edited coverage of the industry. Its focus is the business of travel; it doesn't sort problems for a PM or suggest what to build. **Verify** whether the daily newsletter is still free: the only source found is a 2021 announcement | [Skift help centre](https://info.skift.com/knowledge/besides-daily-news-what-else-does-my-skift-pro-subscription-include); [Skift, 2021](https://skift.com/?p=397505) |
| ALT-04 | **Crowd-reported outage trackers** (Downdetector) | Collects problem reports from users and other sources, and reports an outage when reports rise well above a usual baseline for that company | Fast for website and app failures, one of the radar's four categories. It doesn't cover policy, strikes or traveler complaints. **Verify** the method: Downdetector's own page couldn't be fetched, and the baseline wording comes from a quote on a forum | [Telecom Hall forum, quoting Ookla](https://www.telecomhall.net/t/how-to-identify-if-networks-and-services-are-down/20822) |
| ALT-05 | **Government travel advice** (UK FCDO; US STEP) | The UK's foreign travel advice covers entry rules, safety and security and health, with email alerts per country or for all countries | Official and reliable for the policy category, but one government's view per service, written for travelers rather than for product teams. **Verify** what US STEP sends: its page refused automated requests | [GOV.UK foreign travel advice](https://www.gov.uk/foreign-travel-advice) |
| ALT-06 | **Travel risk intelligence** (Crisis24 Horizon) | Real-time alerts on threats and disruptions worldwide, filtered by severity, category and location. A daily briefing gathers the last 24 hours of alerts. Built for companies' duty of care to their travelling staff | The closest in shape (sorted alerts, severity, daily briefing), but built for keeping employees safe, sold to organisations, and silent on product opportunities. The capability claims come from the vendor and its customers | [University of Michigan guide](https://global.umich.edu/crisis24/); [Crisis24 case study](https://www.crisis24.com/case-studies/use-case-from-early-warning-to-duty-of-care) |
| ALT-07 | **General AI assistant on a schedule** (ChatGPT scheduled tasks) | Runs a saved prompt at set times, for example a morning news briefing, and can browse the web when it runs | The nearest do-it-yourself version of the radar. It keeps no structured history, so it has no "New" flag, no severity and no shared board unless you build them. **Verify** limits and plans with OpenAI: only secondary sources were found, and they disagree | [Analytics Vidhya, Jan 2025](https://www.analyticsvidhya.com/blog/2025/01/schedule-tasks-with-chatgpt/); [Pulse 2.0](https://pulse2.com/openai-chatgpt-launches-new-scheduled-tasks-page/) |

The radar itself began as ALT-07's kind of tool: a scheduled task in Claude's app that posted a digest to Slack
([README](../../README.md#users-and-iteration)).

## Where the radar differs (claims to test, not findings)

| What the radar does | Alternatives that do it too | Evidence that it matters to users |
|---|---|---|
| Covers four kinds of problem at once: traveler pain, policy, outages, industry disruption | None found that covers all four in one feed; each covers one or two | None. **Not tested** |
| Adds a one-line product opportunity to each item | None found | None. Goal G3, "opportunities are useful", is **Not measured** |
| Needs no keyword or source list from the reader | ALT-06 and ALT-07, in part | None |
| Keeps a history and flags New | ALT-01 sends only results new since the last email; ALT-06 has a daily roll-up | None |
| Costs ₹1 a month or ₹1 a year for Pro since 2026-10-28, with a Free teaser (₹299 a month when this was written) | Prices of others not verified here | 3 live ₹1 payments by 2026-10-29 (T27, [progress.md](../../docs/subscriptions/tasks/progress.md)); none at a price that covers cost |

"None found" means none was found in this search. It doesn't mean none exists.

## Not done

- No user was asked which of these they use, or what they pay.
- No alternative was tried side by side with the radar for a week.
- Prices are missing for ALT-02, ALT-03, ALT-06 and ALT-07. Check them on each provider's own page before quoting
  any.
