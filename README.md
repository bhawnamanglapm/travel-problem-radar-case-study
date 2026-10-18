# Travel Problem Radar

A prototype that sweeps the web for travel-industry problems (traveler complaints, new visa rules and
taxes, booking-site outages, strikes) and tags each one with a product idea a PM could build.

**Product owner:** Bhawna Mangla · **Built with AI** (Claude) · **Status:** prototype, July 2026

| | |
|---|---|
| **Case study** | https://bhawnamanglapm.github.io/travel-problem-radar-case-study/ |
| **Try the demo** | https://bhawnamanglapm.github.io/travel-problem-radar-case-study/demo/ |
| **Sample digest** | https://bhawnamanglapm.github.io/travel-problem-radar-case-study/demo/#report |
| **Live daily page** | https://travel-problem-radar.vercel.app/live/ (deployed; shows "first sweep hasn't run yet" until the first real sweep is saved) |

![The demo board after a sample sweep: 8 problems in four categories, each with a source link and a product opportunity](docs/demo-board.png)

## What it does

1. **Sweeps four categories at once:** traveler pain, government & policy, website & app failures, and
   industry disruption. Each category is one call to Claude with its web-search tool, up to 5 items each.
2. **Structures every finding:** title, short summary, source and link, region, date, severity, and a
   one-line product opportunity.
3. **Flags what's new:** anything not seen in an earlier sweep gets a "New" badge.
4. **Keeps a dated history** of the last 60 sweeps, so you can open any past one.
5. **Builds a plain-text digest** (new items first, then by category) with a Copy button.
6. **Posts a daily digest to Slack** from a scheduled task in Claude's app. This is set up in Claude
   (Slack connector and scheduled task), not in this repository's code.

## Three ways it runs

| | In Claude's app | Public demo | Live daily page (Vercel) |
|---|---|---|---|
| Where it runs | Inside Claude's app, as an artifact | GitHub Pages, any browser | Vercel, any browser |
| What a sweep does | 4 real web-search calls to Claude | Replays the 8 saved items in `sampleData.json` | A server job makes the 4 web-search calls once a day |
| Who triggers it | You, with a button | You, with a button (replay only) | A daily timer; visitors can't trigger it |
| AI or API calls | Yes, through Claude's app | None | One sweep a day, whatever the traffic |
| History is saved in | Claude's artifact storage | This browser's localStorage | A private Vercel Blob store |
| Daily digest | A scheduled task in Claude posts it to Slack | The "Sample digest" view | The page itself (no Slack or email from Vercel) |
| Status | Owner-reported working | Verified | Deployed; first real sweep not yet run |

All three use the same component, [`travel-problem-radar.jsx`](travel-problem-radar.jsx). With no props it
runs inside Claude's app; with `sample={...}` it replays the sample; with `remote="/api/data"` it shows the
latest saved sweep read-only. It can't run live on a plain website by itself: it calls the Anthropic API
from the browser without a key, which only works inside Claude's app. That is why the daily page uses a server.

## What has been checked

| Check | Result | How |
|---|---|---|
| Demo: replay, filters, search, report, history, "New" flag | Pass (19 checks) | Headless browser on a local copy, 2026-10-18 |
| Demo makes no AI or API calls | Pass | Same test: only Google Fonts load from elsewhere |
| Pages fit a phone screen (375 px) | Pass | Same test |
| Sample data shape, page links, demo bundle | Pass | `npm run check`, also on every push (GitHub Actions) |
| 8 sample source links load | 7 of 8 | isdown.app blocks automated requests; the article contents were not re-checked |
| Daily sweep logic: merge, de-duplicate, "New" flags, 20-hour gap, 60-sweep cap, partial and total failure, auth, read-only data feed | Pass (28 checks) | `npm test` with the Anthropic API and storage stubbed, 2026-10-18; also on every push |
| Live page (`/live/`): cards, filters, history, report, empty state, read-only, phone width | Pass (16 checks) | Headless browser with the data feed stubbed, 2026-10-18 |
| Server prompt matches the one in the component | Pass | `npm run check` fails if the two drift |
| Vercel deployment | Ready | Production build Ready; on the preview build, `/api/sweep` returned 401 without the secret and source files and `package.json` were not served |
| Live mode outside Claude's app | Fails safely: shows "The sweep came back empty", no errors | Headless browser with the API stubbed to refuse, 2026-10-18 |
| Live sweep inside Claude's app | Not re-run | Needs Claude's app; the sweep code is unchanged apart from a storage fallback and the demo switch |

**Owner-reported, not in this repo:** the scheduled daily run and Slack delivery. The owner confirms the
Slack connection and the trigger worked in Claude's app, and has a screenshot of a digest posted to a
Slack channel at 07:00 IST on 1 Aug 2026 ("Sent using Claude"). The schedule and Slack connector live
in Claude, so this repo can't reproduce them. Scheduled runs execute on the owner's machine, so it must
be awake.

**Not verified yet (daily page):** a real sweep has not run. Still open: whether the model name
(`claude-sonnet-5-5`) and the web-search tool setting are accepted, how long a sweep takes against the
300-second limit, token and search counts, and whether Vercel's free plan fires the timer around 07:00 IST
(it may run anywhere in that hour). Until then the live page shows an empty state.

**Not verified:** email delivery, usage numbers, or measured result quality. The sample items are from
one sweep in July 2026 and are now dated.

## Files

| File | What it is |
|---|---|
| `index.html` | The case-study page (served by GitHub Pages) |
| `demo/` | The demo page; `demo/radar.js` is built from the component and the sample |
| `live/` | The daily page; `live/radar-live.js` is built from the component |
| `api/sweep.js` | Daily job: runs the 4 searches and saves the result (needs a secret to call) |
| `api/data.js` | Read-only feed the live page uses (allow-listed keys only) |
| `api/_lib/` | Shared sweep logic, request handlers and storage |
| `vercel.json` | Daily timer (01:30 UTC), 300 s limit, build that publishes `index.html`, `demo/`, `live/` |
| `travel-problem-radar.jsx` | The dashboard component (live in Claude's app, demo on the web) |
| `sampleData.json` | 8 saved items, two per category, each with a source link |
| `scripts/check.mjs` | Offline checks: sample data, page links, bundles, prompt drift |
| `scripts/test-sweep.mjs` | Offline tests for the sweep and the data feed (no network, no key) |

## Rebuild the demo and live page

Needs Node.js 18 or later.

```bash
npm install
npm run build   # rebuilds demo/radar.js and live/radar-live.js from the component
npm run check
npm test        # sweep and data-feed tests, no key needed
```

Commit both bundles after rebuilding; GitHub Pages serves them as is, and CI fails if either is stale.

## Live daily page: how it works and what it needs

```
Vercel timer, once a day (01:30 UTC)
  -> /api/sweep   (refuses calls without the secret; skips if a sweep ran in the last 20 hours)
       4 Claude calls with web search, one per category, same prompts as the component
       merge, de-duplicate, flag "New", keep the last 60 sweeps -> private Vercel Blob store
Visitor -> /live/ -> /api/data (read-only, cached) -> same dashboard, no sweep button
```

- Visitors only read the saved result and never trigger an AI call, so cost is one sweep a day.
- If every category fails, nothing is saved and the run shows as failed. If some fail, the rest are saved.
- The API key is held as a Vercel secret, never in the page or the code.
- Items are AI-gathered and not verified; the page tells visitors to check each source link.

**To run your own copy** (owner steps, not done by this repo):

1. Import the repo into Vercel and connect a Blob store (included on the free plan at the time of setup).
2. Add `CRON_SECRET` (any long random string) and `ANTHROPIC_API_KEY` as secret environment variables.
3. Set a monthly spend limit in the Anthropic Console. That is the real cost cap.
4. Optional: `RADAR_MODEL` to choose the model (default `claude-sonnet-5-5`).

Not part of this page: Slack posting (still the scheduled task in Claude) and email.

## License

MIT. See [LICENSE](LICENSE).
