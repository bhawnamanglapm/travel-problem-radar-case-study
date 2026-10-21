# Deploying Travel Problem Radar on Vercel

This guide covers deploying and running the **live daily page** on Vercel: the once-a-day server sweep, the read-only
data feed and the `/live/` dashboard. It is for the person who owns the Vercel project, or anyone running their own
copy. It assumes you can use a terminal and the Vercel dashboard; no earlier Vercel experience is needed.

The case study and the sample demo are also served by **GitHub Pages** from `main`. Nothing in this guide changes that.

> **Status (checked 21 Oct 2026).** The project is deployed at https://travel-problem-radar.vercel.app. The Blob store
> is connected in production, and `/api/sweep` refuses calls without the secret (`401`). **The first real sweep was
> run by hand on 20 Oct 2026 at 22:53 UTC** and saved 8 items. Two of the four categories failed; see
> [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep), issue 2.

---

## Contents

1. [What gets deployed](#1-what-gets-deployed)
2. [Before you start](#2-before-you-start)
3. [Costs and plan limits](#3-costs-and-plan-limits)
4. [Deploy step by step (dashboard)](#4-deploy-step-by-step-dashboard)
5. [Run the first sweep](#5-run-the-first-sweep)
6. [Deploy from the command line (optional)](#6-deploy-from-the-command-line-optional)
7. [Configuration reference](#7-configuration-reference)
8. [Day-to-day: changes, previews and rollbacks](#8-day-to-day-changes-previews-and-rollbacks)
9. [Operating the daily sweep](#9-operating-the-daily-sweep)
10. [Troubleshooting](#10-troubleshooting)
11. [Known issues to fix before or after the first sweep](#known-issues-to-fix-before-or-after-the-first-sweep)

---

## 1. What gets deployed

```
                         ┌──────────────────── Vercel project ─────────────────────┐
Vercel Cron, daily       │                                                          │
01:30 UTC (07:00 IST) ──▶│  /api/sweep  (api/sweep.js, up to 300 s)                 │
  Authorization:         │     checks CRON_SECRET; timer skips if swept < 20 h ago  │
  Bearer $CRON_SECRET    │     4 × Anthropic Messages API + web search ─────────────┼──▶ api.anthropic.com
                         │     merge, de-duplicate, flag New, keep 60 sweeps        │
                         │     after saving: digest to Slack (optional) ────────────┼──▶ hooks.slack.com
                         │     writes ─────────────────────────────┐                │
                         │                                         ▼                │
                         │                              Private Vercel Blob store    │
                         │                                         ▲                │
Visitor ──▶ /live/  ──▶  │  /api/data?key=…  (api/data.js, read-only, allow-listed) │
           (static)      │     CDN-cached for 5 minutes                             │
                         │                                                          │
           /, /demo/     │  static copies of the case study and demo                │
                         └──────────────────────────────────────────────────────────┘
```

| Piece | Source in this repo | Served at |
|---|---|---|
| Case study (copy) | `index.html` | `/` |
| Sample demo (copy) | `demo/index.html`, `demo/radar.js` | `/demo/` |
| Live daily page | `live/index.html`, `live/radar-live.js` | `/live/` |
| Daily sweep function | `api/sweep.js` → `api/_lib/` | `/api/sweep` (secret required) |
| Data feed function | `api/data.js` → `api/_lib/` | `/api/data?key=radar:history` and `?key=radar:sweep:<id>` |
| Daily timer | `crons` in `vercel.json` | Calls `/api/sweep` once a day |
| Storage | Vercel Blob (private store), via `api/_lib/storage.js` | Not public; read only through `/api/data` |
| Slack digest (optional) | `api/_lib/slack.js`, called by the sweep | Posted to one Slack channel when `SLACK_WEBHOOK_URL` is set |

Two things that are easy to miss:

- **Vercel does not build the JavaScript bundles.** `demo/radar.js` and `live/radar-live.js` are built locally with
  `npm run build` and committed. The Vercel build step only copies files into `public/`. CI fails if a committed
  bundle is out of date.
- **Visitors never trigger an AI call.** Only the timer (or you, with the secret) can run a sweep, so cost is one sweep
  a day whatever the traffic, plus any sweeps you run by hand.

---

## 2. Before you start

| You need | Why | Notes |
|---|---|---|
| A Vercel account (Hobby is enough) | Hosts the page, functions, cron and Blob store | Hobby limits are in [section 3](#3-costs-and-plan-limits) |
| Access to the GitHub repo | Vercel deploys from it | Owner, or a fork for your own copy |
| An Anthropic Console account with billing set up | The sweep calls the Claude API | https://platform.claude.com |
| An Anthropic API key | Stored as a Vercel secret | Create one just for this project, so it can be revoked on its own |
| Web search allowed for your Anthropic organization | Every sweep call uses the web-search tool | On by default. If an admin turned it off in Console settings (Settings → Capabilities), every call fails with a 400 |
| Node.js 18 or later on your machine | To rebuild bundles and run the offline checks | CI uses Node 22 |

Before any deploy, run the offline checks locally. They need no network and no API key:

```bash
npm ci
npm run build                                    # rebuilds demo/radar.js and live/radar-live.js
git diff --exit-code demo/radar.js live/radar-live.js   # no output = committed bundles are current
npm run check                                    # sample data, links, bundles, prompt drift
npm test                                         # sweep and data-feed tests (APIs stubbed)
```

If `git diff` shows changes, commit the rebuilt bundles before deploying.

---

## 3. Costs and plan limits

### Vercel (Hobby plan, as documented in October 2026)

| Limit | Hobby | What it means here |
|---|---|---|
| Cron frequency | Once per day at most | The schedule `30 1 * * *` is allowed. A schedule that runs more often fails the deploy |
| Cron timing | Within the hour (±59 min) | The 01:30 UTC job can fire any time from **01:00 to 01:59 UTC** (06:30–07:29 IST) |
| Function duration | 300 s default and maximum (Fluid compute, on by default) | `vercel.json` sets `maxDuration: 300` for the sweep. Pro allows up to 800 s |
| Cron retries | None | A failed sweep is not retried. The next attempt is the next day |
| Blob storage | Included on all plans, within usage limits | This app stores a few small JSON files (at most 60 sweeps plus 2 index files) |

### Anthropic API (per sweep, from the code)

| Item | Per sweep | Per 30 days |
|---|---|---|
| API calls | 4 (one per category) | 120, plus 4 for each manual run |
| Web searches | At most 12 (3 per call), billed at $10 per 1,000 | At most 360, about **$3.60** |
| Output tokens | At most 4,000 (1,000 per call) | At most 120,000 |
| Input tokens | Search results count as input, so this varies | Logged by every sweep (see [section 9](#9-operating-the-daily-sweep)) |

**First real sweep (20 Oct 2026, default model `claude-sonnet-5-5`):** 56,223 input tokens, 2,361 output tokens and
6 searches, in 12.7 seconds. At $2 input / $10 output per million tokens plus $10 per 1,000 searches, that is about
**$0.20**. Two of the four categories failed, so a sweep where all four succeed will cost more. Until more runs are
logged, $0.30–0.40 a sweep (about $10–12 a month) is a reasonable guess, not a measurement.

**Set a monthly spend limit in the Anthropic Console.** That is the real cost cap. A limit around $20 a month leaves
room above the illustration; adjust it once real usage is known.

---

## 4. Deploy step by step (dashboard)

The production project already exists. Use these steps to set up your own copy, or as a checklist to confirm the
existing project is configured correctly.

### 4.1 Import the repository

1. In the Vercel dashboard choose **Add New… → Project** and import the GitHub repository.
2. **Project name:** this becomes the default domain, `<name>.vercel.app`. The existing project is
   `travel-problem-radar`.
3. **Framework Preset:** *Other*. `vercel.json` sets `"framework": null`, so nothing is auto-detected.
4. **Root Directory:** the repository root (`./`).
5. **Build and Output Settings:** leave them alone. `vercel.json` sets the build command and the output directory
   (`public`), and those settings take precedence over the dashboard.
6. **Environment Variables:** skip for now; they are added in 4.3.
7. Click **Deploy**.

This first deploy should succeed. `/`, `/demo/` and `/live/` load. `/live/` shows its empty state, and the API
routes return errors until storage and secrets are set up. That is expected.

After it finishes, open **Settings → Build and Deployment → Node.js Version** and pick 22.x or newer, to match CI.

### 4.2 Create and connect a private Blob store

The code reads and writes with `access: "private"`, so **the store must be private**. A store's access is chosen
when it is created; a public store will not work.

1. Open the project's **Storage** tab and choose **Create Storage → Blob**.
2. Choose **Continue**, then set the access to **Private**. Name it, for example, `travel-problem-radar`.
3. Connect it to the project. Choose the environments:
   - **Production:** required.
   - **Preview:** optional. With it, preview deployments can show the production data read-only on their `/live/`
     page. Without it, `/api/data` on previews answers `502 storage unavailable`, which is harmless.
   - **Development:** not needed.

Connecting the store adds its credentials to the project's environment variables. Depending on the project, that is
`BLOB_STORE_ID` (used with Vercel's built-in OIDC token) or `BLOB_READ_WRITE_TOKEN`. The installed `@vercel/blob`
(2.8.2) accepts either, so there is nothing to configure in code.

### 4.3 Add the secrets

Open **Settings → Environment Variables** and add:

| Name | Value | Environments | Required |
|---|---|---|---|
| `CRON_SECRET` | A long random string (see below) | **Production only** | Yes |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | **Production only** | Yes |
| `RADAR_MODEL` | A Claude model ID, for example `claude-sonnet-4-6` | Production | No. Defaults to `claude-sonnet-5-5`; see [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep) |
| `SLACK_WEBHOOK_URL` | A Slack incoming-webhook URL | **Production only** | No. Posts each sweep to Slack; see [Posting to Slack](#posting-to-slack-optional) |

Generate the secret with either:

```bash
openssl rand -hex 32
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Tick **Sensitive** for both secrets, so the dashboard never shows them again. Save a copy of `CRON_SECRET` in your
password manager: you need it to run a sweep by hand.

Why production only: Vercel sends `CRON_SECRET` to the cron job automatically, and cron jobs run only on the
production deployment. Leaving both secrets off previews means a preview's `/api/sweep` always answers `401`, so a
preview can never spend API credit or write to the production store.

### 4.4 Set up the Anthropic side

1. **Spend limit:** in the Anthropic Console, set a monthly limit (see [section 3](#3-costs-and-plan-limits)).
2. **Web search:** confirm it is allowed for the organization (Console → Settings → Capabilities). It is on unless an
   admin disabled it.
3. **Model access:** the key's organization must be able to use the model in `RADAR_MODEL` (or the default).

### 4.5 Redeploy

Environment variables only reach **new** deployments. Open **Deployments**, find the latest production deployment,
choose **⋯ → Redeploy**, and wait for it to finish. (Pushing a commit to `main` also works.)

### 4.6 Check the deployment

Run these against your domain. None of them calls the Anthropic API.

```bash
BASE=https://travel-problem-radar.vercel.app

curl -s -o /dev/null -w '%{http_code}\n' $BASE/            # 200  case study
curl -s -o /dev/null -w '%{http_code}\n' $BASE/demo/       # 200  demo
curl -s -o /dev/null -w '%{http_code}\n' $BASE/live/       # 200  live page
curl -s -o /dev/null -w '%{http_code}\n' $BASE/live/radar-live.js   # 200  live bundle
curl -s "$BASE/api/data?key=radar:history"                 # {"error":"not found"} before the first sweep
curl -s "$BASE/api/data?key=radar:seenIds"                 # {"error":"key not allowed"}  (400)
curl -s $BASE/api/sweep                                    # {"error":"unauthorized"}     (401)
```

What the `/api/data?key=radar:history` answer tells you:

| Answer | Meaning |
|---|---|
| `404 {"error":"not found"}` | Storage is connected; no sweep has been saved yet. Ready for the first sweep |
| `200 {"value":"[…]"}` | Storage is connected and at least one sweep is saved |
| `502 {"error":"storage unavailable"}` | The Blob store is not connected to this environment, or the deploy predates the connection. Fix this **before** running a sweep (see the note in 5.1) |

Finally, open **Settings → Cron Jobs** and confirm one job is listed: `/api/sweep`, schedule `30 1 * * *`.

---

## 5. Run the first sweep

The timer will run the first sweep on its own at the next 01:00–01:59 UTC window. To run it now and see the result,
call the endpoint with the secret.

### 5.1 Run it

```bash
read -rs CRON_SECRET && export CRON_SECRET     # paste the secret; it is not echoed or saved in history
curl -sS --max-time 320 \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://travel-problem-radar.vercel.app/api/sweep
```

The call usually takes from several seconds to a few minutes (four searches run in parallel). `--max-time 320`
gives it a little more than the function's 300-second limit.

Vercel also has two ways to start the job, but neither prints the response. Read the result in the runtime logs
(section 9) or check `/api/data?key=radar:history` afterwards:

- **Dashboard:** open the production deployment under **Deployments**. Its summary lists the cron jobs, with an
  option to run each one.
- **CLI (beta):** `vercel crons run /api/sweep`. This runs the job on the current production deployment, so deploy
  first.

Vercel's docs don't say whether these manual runs send `CRON_SECRET` the way scheduled runs do. If the logs show a
`401`, use the `curl` command above.

There is no way to run the sweep *during* a deploy: the function only exists once the deployment is Ready. To run it
automatically after every production deploy, call the same URL from a GitHub Actions job triggered by
`deployment_status`. That call counts as a manual run (5.5), so every production deploy would cost a full sweep.

> **Check storage first.** The sweep makes its four API calls before it writes anything. If the Blob store is not
> connected, those calls are paid for and the run then fails at the save step. Make sure
> `/api/data?key=radar:history` answers `404` (not `502`) before you run it.

### 5.2 Read the answer

| HTTP | Body | Meaning | What to do |
|---|---|---|---|
| 200 | `{"model":…,"trigger":"manual","status":"saved","id":…,"total":N,"newCount":N,"perCat":{…},"usage":{…}}` | Saved. `perCat` shows items per category, `usage` the real token and search counts | Open `/live/` |
| 200 | `{"trigger":"scheduled","status":"skipped","reason":"last scheduled sweep … is under 20 h old"}` | The timer called again within 20 hours of its last sweep. Manual calls never get this | Nothing; this stops duplicate timer calls |
| 502 | `{"status":"empty","perCat":{…}}` | All four categories failed; nothing was saved | Read `perCat` and see [Troubleshooting](#10-troubleshooting) |
| 500 | `{"error":"ANTHROPIC_API_KEY is not set; …"}` | Key missing in this deployment | Add it (4.3) and redeploy (4.5) |
| 500 | `{"error":"sweep failed: …"}` | Storage or another unexpected error | Read the message; usually storage (see Troubleshooting) |
| 401 | `{"error":"unauthorized"}` | Secret missing or wrong, or `CRON_SECRET` not set in this deployment | Check the value; redeploy after changing it |

If some categories fail and others succeed, the run still saves (status `saved`), and `perCat` marks the failed
ones as `failed: …`.

`trigger` says how the server classed the call: `scheduled` for Vercel's timer, `manual` for anything else. Every
run that is not skipped also returns a `slack` field. It is `not configured` when `SLACK_WEBHOOK_URL` is unset,
and otherwise `sent` or `failed: …`. A run you start by hand posts to Slack too, titled "digest (manual run)".

### 5.3 Check the page

Open `/live/`. The board should show the saved items and the history should list one sweep.

### 5.4 Record the results

The README's "What's next" asks for the time taken against the 300-second limit and the token and search counts.
`usage` in the response gives the counts; the function's duration is in the runtime logs (section 9).

### 5.5 Manual runs and the daily timer

The server tells the two kinds of call apart by the headers Vercel's timer sends (a `vercel-cron/1.0` user agent and
an `x-vercel-cron-schedule` header):

| Call | 20-hour rule | Counts toward the timer's 20 hours |
|---|---|---|
| **Scheduled:** Vercel's timer | Skipped if the timer swept less than 20 hours ago, so a duplicate delivery costs nothing | Yes |
| **Manual:** any other call with the secret, such as the `curl` in 5.1 | Never skipped: it always sweeps | No, so it never cancels the next scheduled sweep |

Manual runs are marked `"manual": true` in the history. Keep in mind:

- **Each manual run costs a full sweep.** Anyone who has `CRON_SECRET` can run as many as they like, so keep the
  secret private and keep the Anthropic spend limit in place: that limit is the cap.
- **A manual run uses up New flags.** Items it finds are no longer flagged New in the next scheduled digest.
- **Vercel's own run options may count as scheduled.** `vercel crons run` and the dashboard's run option may send
  the timer's headers. If one answers `skipped`, use the `curl` command in 5.1 instead.

---

## 6. Deploy from the command line (optional)

Everything above can also be done with the Vercel CLI. These are the commands for a fresh copy:

```bash
npm i -g vercel
vercel login
vercel link                                   # create or pick the project for this folder

# Private Blob store, connected to the project in all environments
vercel blob create-store travel-problem-radar --access private --yes

# Secrets (each command prompts for the value)
vercel env add CRON_SECRET production
vercel env add ANTHROPIC_API_KEY production
vercel env add RADAR_MODEL production         # optional
vercel env add SLACK_WEBHOOK_URL production   # optional, see "Posting to Slack"

vercel --prod                                 # deploy to production
```

`vercel blob create-store … --yes` connects the store to every environment, including Preview and Development. That
is fine for this app because previews have no secrets and can only read.

Do not commit the `.vercel/` folder that `vercel link` creates. It is already in `.gitignore`.

---

## 7. Configuration reference

### `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "rm -rf public && mkdir public && cp -r index.html demo live public/ && rm -rf public/demo/src public/live/src",
  "outputDirectory": "public",
  "crons": [{ "path": "/api/sweep", "schedule": "30 1 * * *" }],
  "functions": {
    "api/sweep.js": { "maxDuration": 300 }
  }
}
```

| Key | What it does |
|---|---|
| `framework: null` | No framework preset; Vercel treats this as a plain static site plus functions |
| `buildCommand` | Copies `index.html`, `demo/` and `live/` into `public/`, then removes the JSX sources. It does **not** run `npm run build` |
| `outputDirectory` | Serves `public/` as the static site |
| `crons` | Calls `/api/sweep` daily at 01:30 UTC (07:00 IST); within the hour on Hobby |
| `functions["api/sweep.js"].maxDuration` | Lets the sweep run for up to 300 s, the Hobby maximum |

The functions are found automatically: every `.js` file in `api/` becomes a route, except files in folders that start
with `_` (so `api/_lib/` is shared code, not a route). `package.json` sets `"type": "module"`, so the functions are ES
modules. `@vercel/blob` is the only runtime dependency.

### `.vercelignore`

Keeps `scripts/`, `.github/`, `docs/` and all `*.md` files (including this one) out of the upload. They are not
needed at runtime.

### Environment variables

| Name | Set by | Used by | Notes |
|---|---|---|---|
| `CRON_SECRET` | You | `/api/sweep` | Vercel sends it as `Authorization: Bearer <value>` on cron calls. If it is unset, `/api/sweep` always answers 401 |
| `ANTHROPIC_API_KEY` | You | `/api/sweep` | Sent to the Anthropic API in a header; never returned in a response |
| `RADAR_MODEL` | You (optional) | `/api/sweep` | Claude model ID. Default `claude-sonnet-5-5` (`api/_lib/handlers.js`) |
| `SLACK_WEBHOOK_URL` | You (optional) | `/api/sweep` | Slack incoming webhook. Treat it as a secret: anyone who has it can post to the channel |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel, automatically | `/api/sweep` | Builds the "Open the live board" link in the Slack message. If it is missing, the link is left out |
| `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` | Vercel, when the store is connected | `api/_lib/storage.js` | Do not set by hand unless running outside Vercel |

### What is stored

All objects live under `radar/` in the private store. Keys are turned into file names by replacing anything that is
not a letter or digit with `-`.

| Logical key | Blob path | Contents | Readable through `/api/data` |
|---|---|---|---|
| `radar:history` | `radar/radar-history.json` | Index of saved sweeps (id, time, counts), last 60 | Yes |
| `radar:sweep:<id>` | `radar/radar-sweep-<id>.json` | One sweep's items | Yes |
| `radar:seenIds` | `radar/radar-seenIds.json` | Up to 800 item IDs already seen, used for the New flag | No |

### Caching

- `/api/data` success responses carry `cache-control: public, s-maxage=300, stale-while-revalidate=3600`. After a
  sweep, the live page can show the previous sweep for about 5 minutes, sometimes a little longer while the CDN
  refreshes.
- Error responses and `/api/sweep` use `no-store`.
- Vercel Blob itself can take up to 60 seconds to serve a new version of an overwritten file. With one sweep a day
  this does not matter.

---

## 8. Day-to-day: changes, previews and rollbacks

**Production deploys.** Every push to `main` deploys to production. Before pushing a change that touches
`travel-problem-radar.jsx`, `sampleData.json`, `demo/src/` or `live/src/`:

```bash
npm run build && npm run check && npm test
git add demo/radar.js live/radar-live.js     # commit the rebuilt bundles with the change
```

GitHub Actions (`.github/workflows/check.yml`) runs the same steps on every push and pull request and fails if a
committed bundle is stale.

**Prompt changes.** The sweep prompt lives in two places: `travel-problem-radar.jsx` (for Claude's app) and
`api/_lib/radar.js` (for the server). Change both; `npm run check` fails if they differ.

**Preview deploys.** Each pull request gets a preview URL. Cron jobs do not run on previews, and with the secrets set
to Production only, a preview's `/api/sweep` always answers 401. By default Vercel also puts previews behind
**Vercel Authentication**: a `curl` to a preview URL gets Vercel's own login page (HTML, status 401), not this app's
JSON. Open previews in a browser where you are signed in to Vercel.

**Rollbacks.** **Deployments → ⋯ → Instant Rollback** (or *Promote* an older deployment) restores the previous
static files, functions and cron definition. Stored sweeps are not touched.

**Custom domain.** Add it under **Settings → Domains**. Then update the hard-coded live link in `index.html`
(`https://travel-problem-radar.vercel.app/live/`) and the "Live daily page" row in `README.md`.

---

## 9. Operating the daily sweep

### Watching runs

- **Settings → Cron Jobs → View Logs** opens the runtime logs filtered to `requestPath:/api/sweep`.
- Each run logs one line starting with `sweep`, with the model, the per-category result and the API usage, for example:
  `sweep {"model":"claude-sonnet-5-5","perCat":{"traveler_pain":"5 items",…},"usage":{"input":…,"output":…,"searches":…}}`
- Hobby keeps runtime logs only for a short time, so check on the day if you are tracking cost or duration.
- A failed run (`502` or `500`) shows as an error in the logs. Vercel does not retry it.

The quickest health check needs no logs:

```bash
curl -s "https://travel-problem-radar.vercel.app/api/data?key=radar:history" | head -c 400
```

The last entry's `at` should be from the last day.

### Costs

Compare `usage.searches`, `usage.input` and `usage.output` from the logs with the Anthropic Console's usage page.
Adjust the spend limit once a week or two of real data exists.

### Posting to Slack (optional)

After each sweep, the server can post to one Slack channel through an incoming webhook (`api/_lib/slack.js`):

| Sweep result | Slack message |
|---|---|
| Saved | The digest: counts, any failed categories, a link to the live board, then every item by category, with severity, a NEW tag, the title linked to its source, summary, source, region, date and opportunity |
| Every category failed, or an error stopped the run | A short notice that nothing was saved, with the reason for each category or the error |
| Skipped (a repeat timer call within 20 hours) | Nothing |

To turn it on:

1. Create a Slack app at https://api.slack.com/apps (**Create New App → From scratch**), open **Incoming Webhooks**,
   switch it on, choose **Add New Webhook to Workspace**, and pick the channel. Copy the URL
   (`https://hooks.slack.com/services/…`).
2. Check the webhook on its own. This posts a test line to the channel and should print `ok`:
   ```bash
   read -rs SLACK_WEBHOOK_URL
   curl -sS -X POST -H 'content-type: application/json' -d '{"text":"Travel Problem Radar: test"}' "$SLACK_WEBHOOK_URL"
   ```
3. Add it in Vercel as `SLACK_WEBHOOK_URL`, for **Production only**, marked **Sensitive**, then redeploy.
4. To see it straight away, run a sweep by hand (5.1). It posts a digest titled "digest (manual run)". Scheduled
   sweeps post the "daily digest".

How it behaves:

- The sweep is saved before anything is posted, and a Slack problem never fails the sweep. The outcome shows in the
  `slack` field of the reply and as a `slack` line in the runtime logs.
- The Slack call gives up after 10 seconds. Link previews are turned off to keep the message compact.
- The webhook URL never appears in a reply or a log line.
- Status: covered by the offline tests (`npm test`); **not yet tried against a real Slack workspace**. The Slack
  digest in Claude's app is a separate setup and is not affected.

### Changing the schedule

Edit `schedule` in `vercel.json` and push. On Hobby it must run at most once a day. The cron expression is in UTC.

### Pausing the sweep

**Settings → Cron Jobs → Disable Cron Jobs.** This stays in effect across deploys and rollbacks until you enable the
jobs again. The live page keeps showing the last saved sweep.

### Rotating secrets

- **`CRON_SECRET`:** change the value in Settings → Environment Variables, then redeploy. Vercel sends the new value
  to the cron automatically.
- **`ANTHROPIC_API_KEY`:** create a new key in the Anthropic Console, update the variable, redeploy, then revoke the
  old key.

### Starting the history over

Delete the objects under `radar/` from the store's browser in the **Storage** tab. The next sweep starts a fresh
history, and every item is flagged New again. This cannot be undone.

### Duplicate or missed cron calls

Vercel's cron delivery is best effort: a run can occasionally be missed or delivered twice. A duplicate within 20 hours
answers `skipped`, so it costs nothing. A missed run is picked up the next day.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/live` or `/demo` (no trailing slash) shows a blank page | The page loads its script by a relative path, which resolves to `/radar-live.js` and 404s | Use `/live/` and `/demo/`. Permanent fix under [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep) |
| `/live/` shows the empty state | No sweep saved yet, or every sweep so far failed | Check `/api/data?key=radar:history`; run the first sweep (section 5) |
| `/live/` shows yesterday's items right after a sweep | CDN cache on `/api/data` (5 minutes) | Wait a few minutes |
| `/api/sweep` answers JSON `401 unauthorized` | Wrong secret, `CRON_SECRET` not set for this environment, or set but not redeployed | Check the value; redeploy |
| `/api/sweep` answers an HTML 401 page | You called a **preview** URL protected by Vercel Authentication | Use the production URL |
| `500 ANTHROPIC_API_KEY is not set` | Key missing in this deployment | Add it for Production; redeploy |
| `500 sweep failed: Vercel Blob: No blob credentials found…` | Store not connected to this environment | Connect it (4.2); redeploy |
| `500 sweep failed: …` mentioning access, or `403` from Blob | The store is public, or the credentials belong to another store | Create a **private** store and connect it |
| `/api/data` answers `502 storage unavailable` | Same as the two rows above, for reads | Same fix |
| `502` with every `perCat` entry `failed: http 400` | Web search disabled for the organization, an unknown model ID in `RADAR_MODEL`, or a request the model rejects | Check Console → Settings → Capabilities, the model ID, and the Anthropic Console logs |
| `perCat` entries `failed: http 401` | Invalid or revoked API key | Replace the key; redeploy |
| `perCat` entries `failed: http 429` or `http 529` | Rate limit or API overload | Usually temporary; the next day's run will try again |
| `perCat` entries `failed: empty` or `failed: no json` | The model's reply had no JSON array: the output may have run out of tokens, or the turn paused before the answer | See Known issue 2 below |
| `200 skipped` when you expected a run | The call carried the timer's headers (`trigger: scheduled`) and the timer swept less than 20 hours ago. This can happen with `vercel crons run` or the dashboard | Run it with the `curl` command in 5.1, which always sweeps (see 5.5) |
| Function times out (`FUNCTION_INVOCATION_TIMEOUT`) | The run took more than 300 s | Rare with 3 searches per call. On Pro, raise `maxDuration` (up to 800) |
| Deploy fails: "Hobby accounts are limited to daily cron jobs" | The schedule runs more than once a day | Use a daily schedule, or move to Pro |
| CI fails: "A bundle is stale" | Bundles not rebuilt after a source change | `npm run build`, commit `demo/radar.js` and `live/radar-live.js` |
| No Slack message after a sweep | Check `slack` in the reply or the `slack` log line. `not configured` means the variable is missing for Production or the deploy predates it. Skipped runs never post | Add `SLACK_WEBHOOK_URL` for Production; redeploy |
| `slack: failed: http 403`, `404` or `410` | The webhook was revoked, its channel was deleted or archived, or the Slack app was removed | Create a new webhook; update the variable; redeploy |
| `slack: failed: timeout` or `network error` | Slack was slow or unreachable. The sweep itself was saved | Nothing to fix; the next sweep posts as usual |

---

## Known issues to fix before or after the first sweep

Found while writing this guide (21 Oct 2026). None of them is fixed in this commit. Remove each one from this list
once it is fixed.

### 1. `/live` and `/demo` without a trailing slash render a blank page

**Confirmed on production.** `https://travel-problem-radar.vercel.app/live` answers 200 with the page, but the page
loads `radar-live.js` by a relative path. Without the trailing slash that becomes `/radar-live.js`, which is a 404,
so nothing renders. `/demo` behaves the same way with `radar.js`. GitHub Pages is not affected because it redirects
`/demo` to `/demo/` itself. The case study links use the trailing slash, so only typed or shared URLs hit this.

**Suggested fix:** add a one-line redirect as the first thing in the `<head>` of `live/index.html` and
`demo/index.html`. It works on both Vercel and GitHub Pages, and needs no change to `scripts/check.mjs`:

```html
<script>if (!/(\/|\.html)$/.test(location.pathname)) location.replace(location.pathname + "/" + location.search + location.hash);</script>
```

It leaves `/live/` and `/live/index.html` alone and sends `/live` to `/live/`.

Do **not** fix this with `"trailingSlash": true` in `vercel.json`. That also redirects `/api/sweep` to
`/api/sweep/`, and Vercel cron jobs do not follow redirects, so the daily sweep would stop running.

### 2. The default model may run out of output tokens

**Seen on the first real sweep (20 Oct 2026, 22:53 UTC).** With the default model, `gov_policy` and `industry`
failed with `empty`, and the other two categories returned 4 items each. The code doesn't log the API's stop
reason, so the cause below is not confirmed, but it fits what happened. The server defaults to `claude-sonnet-5-5`
with `max_tokens: 1000` and does not set `thinking`. On Claude Sonnet 5.5, thinking is on unless the request turns it off, and thinking
tokens count against `max_tokens`. If thinking uses most of the 1,000 tokens, the JSON answer is cut short or
missing, and that category fails with `empty` or `no json`. The version that worked in Claude's app used
`claude-sonnet-4-6`, which does not think unless asked.

**Options, from least to most change:**

- **No code change:** set `RADAR_MODEL=claude-sonnet-4-6` for the first sweeps. That is the setup that worked in
  Claude's app.
- **Small code change in `api/_lib/radar.js` (`scanCategory`):** raise `max_tokens` (for example to 4000), or turn
  thinking off for this call with `thinking: { type: "between_tools" }`, or both. `scripts/test-sweep.mjs` asserts
  `max_tokens === 1000`, so update that test as well.

Whichever you choose, check `perCat` and `usage.output` after the first run.

### 3. Smaller improvements (optional)

- **Newer web-search tool version.** The sweep uses `web_search_20250305` (basic search). It is still supported.
  On Claude 4.6 and later models, `web_search_20260209` or later filters search results before they reach the
  model, which can cut input tokens. Worth trying once the first real usage numbers exist.
- **Fail fast when storage is down.** `runDailySweep` treats a storage read error as "no history yet". The four API
  calls run, and the failure only appears at the save step. Checking storage before calling the API would avoid
  paying for a sweep that cannot be saved. Until then, use the pre-check in 5.1.
- **`pause_turn` is not handled.** If the API pauses a long search turn, the reply has no final answer and that
  category fails for the day. With at most 3 searches per call this should be rare.
- **Pin the Node.js version.** `package.json` has no `engines` field, so Vercel uses the project's Node.js setting.
  Adding `"engines": { "node": ">=20" }` would make the requirement explicit.
