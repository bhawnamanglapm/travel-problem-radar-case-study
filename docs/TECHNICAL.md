# Travel Problem Radar: technical reference

How the three versions run, how the live page works, what each file is, and how to rebuild. The product story is
in the [README](../README.md).

## Three ways it runs

| | In Claude's app | Public demo | Live page (Vercel) |
|---|---|---|---|
| Where it runs | Inside Claude's app, as an artifact | GitHub Pages, any browser | Vercel, any browser |
| What a sweep does | 4 real web-search calls to Claude | Replays the 8 saved items in `sampleData.json` | A server job makes the 4 web-search calls every 5 hours |
| Who triggers it | You, with a button | You, with a button (replay only) | A GitHub Actions schedule (plus Vercel's daily cron as a backstop); visitors can't trigger it |
| AI or API calls | Yes, through Claude's app | None | About 5 sweeps a day, whatever the traffic |
| History is saved in | Claude's artifact storage | This browser's localStorage | A private Vercel Blob store |
| Digest | A scheduled task in Claude posts it to Slack | The "Sample digest" view | The page itself; optionally posted to Slack and emailed through Resend after each sweep |
| Status | Owner-reported working | Verified | Deployed; first production sweep saved 1 of 4 categories (token limit, since fixed and tested locally) |

All three use the same component, [`travel-problem-radar.jsx`](../travel-problem-radar.jsx). With no props it
runs inside Claude's app; with `sample={...}` it replays the sample; with `remote="/api/data"` it shows the
latest saved sweep read-only. It can't run live on a plain website by itself: it calls the Anthropic API
from the browser without a key, which only works inside Claude's app. That is why the live page uses a server.

## Live page: how it works and what it needs

```
GitHub Actions, every 5 hours (00:17, 05:17, 10:17, 15:17, 20:17 UTC)
  + Vercel cron, once a day (01:30 UTC), as a backstop
  -> /api/sweep   (refuses calls without the secret; a scheduled call skips if a scheduled sweep ran in
                   the last 2 hours; a manual call with the secret always runs)
       4 Claude calls with web search, one per category, same prompts as the component
       merge, de-duplicate, flag "New", keep the last 60 sweeps -> private Vercel Blob store
       then post the digest (or a failure notice) to Slack and by email, for each one that is set up
Visitor -> /live/ -> /api/data (read-only, cached) -> same dashboard, no sweep button
```

- Visitors only read the saved result and never trigger an AI call, so cost is about 5 sweeps a day (roughly $1 a day at the measured ~$0.21 a sweep).
- If every category fails, nothing is saved and the run shows as failed. If some fail, the rest are saved.
- The API key is held as a Vercel secret, never in the page or the code.
- Items are AI-gathered and not verified; the page tells visitors to check each source link.

**To run your own copy** (owner steps, not done by this repo):

1. Import the repo into Vercel and connect a Blob store (included on the free plan at the time of setup).
2. Add `CRON_SECRET` (any long random string) and `ANTHROPIC_API_KEY` as secret environment variables.
   Add the same `CRON_SECRET` as a GitHub Actions repository secret, for the 5-hour schedule.
3. Set a monthly spend limit in the Anthropic Console. That is the real cost cap.
4. Optional: `RADAR_MODEL` to choose the model (default `claude-sonnet-5-5`).
5. Optional: `SLACK_WEBHOOK_URL` (a Slack incoming webhook) to post each sweep's digest to a channel.
6. Optional: `RESEND_API_KEY` and `EMAIL_TO` to email each sweep's digest through Resend. No domain is needed:
   it sends from Resend's shared address, which delivers only to the Resend account's own email.

Full deployment steps are in [DEPLOYMENT.md](../DEPLOYMENT.md).

Slack posting and email from Vercel are covered by the offline tests but have not yet been tried against a real
Slack workspace or Resend account. They are separate from the Slack digest set up in Claude's app.

## Files

| File | What it is |
|---|---|
| `index.html` | The case-study page (served by GitHub Pages) |
| `demo/` | The demo page; `demo/radar.js` is built from the component and the sample |
| `live/` | The live page; `live/radar-live.js` is built from the component |
| `api/sweep.js` | Scheduled job: runs the 4 searches and saves the result (needs a secret to call) |
| `api/data.js` | Read-only feed the live page uses (allow-listed keys only) |
| `api/_lib/` | Shared sweep logic, request handlers, storage, and the optional Slack post and email |
| `vercel.json` | Daily backstop cron (01:30 UTC), 300 s limit, build that publishes `index.html`, `demo/`, `live/` |
| `travel-problem-radar.jsx` | The dashboard component (live in Claude's app, demo on the web) |
| `sampleData.json` | 8 saved items, two per category, each with a source link |
| `scripts/check.mjs` | Offline checks: sample data, page links, bundles, prompt drift |
| `.github/workflows/sweep.yml` | Calls `/api/sweep` every 5 hours, and on demand from the Actions tab |
| `scripts/test-sweep.mjs` | Offline tests for the sweep, the Slack post, the email and the data feed (no network, no key) |

## Rebuild the demo and live page

Needs Node.js 18 or later.

```bash
npm install
npm run build   # rebuilds demo/radar.js and live/radar-live.js from the component
npm run check
npm test        # sweep and data-feed tests, no key needed
```

Commit both bundles after rebuilding; GitHub Pages serves them as is, and CI fails if either is stale.
