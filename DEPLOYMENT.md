# Deploying Travel Problem Radar on Vercel

This guide covers deploying and running the **live page** on Vercel: the server sweep that runs every 5 hours, the
read-only data feed and the `/live/` dashboard. It is for the person who owns the Vercel project, or anyone running
their own copy. It assumes you can use a terminal and the Vercel dashboard; no earlier Vercel experience is needed.

The case study and the sample demo are also served by **GitHub Pages** from `main`. Nothing in this guide changes that.
The 5-hour schedule runs on **GitHub Actions**, because Vercel's Hobby plan allows a cron job at most once a day
(see 4.7).

> **Status (checked 21 Oct 2026).** The project is deployed at https://travel-problem-radar.vercel.app. The Blob store
> is connected in production, and `/api/sweep` refuses calls without the secret (`401`). **The first real sweep was
> run by hand on 20 Oct 2026 at 22:53 UTC** and saved 8 items. Two of the four categories failed; see
> [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep), issue 2.
>
> **Schedule (changed 21 Oct 2026):** every 5 hours from GitHub Actions, with Vercel's daily cron kept as a backstop.
> The GitHub schedule starts once the `CRON_SECRET` repository secret is added (4.7).
>
> **Subscriber email (switched on 21 Oct 2026):** `/subscribe/` is open in production, sending from
> `hello@pehchanthetraveller.com` (a domain verified in Resend). The list holds the owner's own test addresses. The
> launch checks in [T12](docs/subscriptions/tasks/T12-docs-and-launch.md) are not all done; see
> [Subscriber email](#subscriber-email-optional).

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
9. [Operating the scheduled sweep](#9-operating-the-scheduled-sweep)
10. [Troubleshooting](#10-troubleshooting)
11. [Known issues to fix before or after the first sweep](#known-issues-to-fix-before-or-after-the-first-sweep)

---

## 1. What gets deployed

```
                         ┌──────────────────── Vercel project ─────────────────────┐
GitHub Actions: every    │                                                          │
5 h from 00:17 UTC       │                                                          │
Vercel Cron: daily,      │                                                          │
01:30 UTC (backstop)  ──▶│  /api/sweep  (api/sweep.js, up to 300 s)                 │
  Authorization:         │     checks CRON_SECRET; a scheduled call skips if a      │
  Bearer $CRON_SECRET    │     scheduled sweep ran < 2 h ago                        │
                         │     4 × Anthropic Messages API + web search ─────────────┼──▶ api.anthropic.com
                         │     merge, de-duplicate, flag New, keep 60 sweeps        │
                         │     after saving: digest to Slack (optional) ────────────┼──▶ hooks.slack.com
                         │     and by email via Resend (optional) ──────────────────┼──▶ api.resend.com
                         │     then: digests to subscribers (optional) ─────────────┼──▶ api.resend.com
                         │     writes ─────────────────────────────┐                │
                         │                                         ▼                │
                         │                              Private Vercel Blob store   │
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
| Live page | `live/index.html`, `live/radar-live.js` | `/live/` |
| Sweep function | `api/sweep.js` → `api/_lib/` | `/api/sweep` (secret required) |
| Data feed function | `api/data.js` → `api/_lib/` | `/api/data?key=radar:history` and `?key=radar:sweep:<id>` |
| 5-hour schedule | `.github/workflows/sweep.yml` (runs on GitHub Actions, not Vercel) | Calls `/api/sweep` every 5 hours |
| Backstop timer | `crons` in `vercel.json` | Calls `/api/sweep` once a day; usually skipped (5.5) |
| Storage | Vercel Blob (private store), via `api/_lib/storage.js` | Not public; read only through `/api/data` |
| Slack digest (optional) | `api/_lib/slack.js`, called by the sweep | Posted to one Slack channel when `SLACK_WEBHOOK_URL` is set |
| Email digest (optional) | `api/_lib/email.js`, called by the sweep | Sent through Resend when `RESEND_API_KEY` and `EMAIL_TO` are set |

Two things that are easy to miss:

- **Vercel does not build the JavaScript bundles.** `demo/radar.js` and `live/radar-live.js` are built locally with
  `npm run build` and committed. The Vercel build step only copies files into `public/`. CI fails if a committed
  bundle is out of date.
- **Visitors never trigger an AI call.** Only the schedule (or you, with the secret) can run a sweep, so cost is about
  five sweeps a day whatever the traffic, plus any sweeps you run by hand.

---

## 2. Before you start

| You need | Why | Notes |
|---|---|---|
| A Vercel account (Hobby is enough) | Hosts the page, functions, cron and Blob store | Hobby limits are in [section 3](#3-costs-and-plan-limits) |
| Access to the GitHub repo | Vercel deploys from it, and GitHub Actions runs the 5-hour schedule from it | Owner, or a fork for your own copy. Adding the Actions secret (4.7) needs owner or admin access |
| An Anthropic Console account with billing set up | The sweep calls the Claude API | https://platform.claude.com |
| An Anthropic API key | Stored as a Vercel secret | Create one just for this project, so it can be revoked on its own |
| Web search allowed for your Anthropic organization | Every sweep call uses the web-search tool | On by default. If an admin turned it off in Console settings (Settings → Capabilities), every call fails with a 400 |
| A Resend account (optional) | To email each sweep. No domain of your own is needed | See [Sending email](#sending-email-optional) |
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
| Cron frequency | Once per day at most | The backstop `30 1 * * *` is allowed. A Vercel schedule that runs more often fails the deploy, which is why the 5-hour schedule runs on GitHub Actions |
| Cron timing | Within the hour (±59 min) | The 01:30 UTC backstop can fire any time from **01:00 to 01:59 UTC** (06:30–07:29 IST) |
| Function duration | 300 s default and maximum (Fluid compute, on by default) | `vercel.json` sets `maxDuration: 300` for the sweep. Pro allows up to 800 s |
| Cron retries | None | A failed sweep is not retried. The next attempt is the next scheduled run |
| Blob storage | Included on all plans, within usage limits. Hobby includes 2,000 advanced operations a month (uploads and lists; deletes are free) and 10,000 simple operations. Going over locks Blob for 30 days | A few small JSON files per sweep, plus one per subscriber and event. Each sign-up that reaches the storage code costs a few advanced operations, which is why the Vercel Firewall rule in [Limiting sign-ups](#subscriber-email-optional) stops floods first. Usage: **Usage** tab in the dashboard (not measured here) |

### GitHub Actions (the 5-hour schedule, as documented in October 2026)

| Limit | What it means here |
|---|---|
| Cost | Free on GitHub-hosted runners for a public repository. Each run only waits for the sweep (at most about 5 minutes) |
| Timing | Scheduled runs can start late, especially near the top of the hour, and at very busy times a queued run can be dropped. The workflow runs at minute 17 to reduce this |
| Inactivity | In a public repository, GitHub turns scheduled workflows off after 60 days with no repository activity. The Vercel backstop keeps sweeping once a day until you turn the GitHub schedule back on (section 9) |
| Branch | Only the copy of the workflow on the default branch (`main`) is scheduled |

### Anthropic API (per sweep, from the code)

| Item | Per sweep | Per 30 days (5 scheduled sweeps a day = 150) |
|---|---|---|
| API calls | 4 (one per category) | 600, plus 4 for each manual run |
| Web searches | At most 12 (3 per call), billed at $10 per 1,000 | At most 1,800, about **$18**. The local test used 5 a sweep, which is about $7.50 |
| Output tokens, thinking included | At most 64,000 (16,000 per call); the local test used about 4,000 | At most 9.6 million; about 600,000 at the local test's rate |
| Input tokens | Search results count as input, so this varies | Logged by every sweep (see [section 9](#9-operating-the-scheduled-sweep)) |

**The first two real sweeps (20–21 Oct 2026, default model `claude-sonnet-5-5`)** logged 56,223 input / 2,361
output tokens and 6 searches, then 29,107 / 1,270 and 3. At $2 input / $10 output per million tokens plus $10 per
1,000 searches, that is about $0.20 and $0.09. **Both figures are too low.** The categories that failed (2, then 3)
were billed, but the code at the time did not count their tokens. It does now, so the `usage` of the next sweep is
the first complete figure. The Anthropic Console's usage page has the real totals for those two runs.

**With the token fix (local test, 21 Oct 2026, all four categories succeeded):** 62,513 input tokens, 4,001 output
tokens and 5 searches, about **$0.21 a sweep**. Each category took 7–10 seconds. At five scheduled sweeps a day that
is about **$1.05 a day, or roughly $32 a month**, plus $0.21 for each manual run.

**Set a monthly spend limit in the Anthropic Console.** That is the real cost cap. A limit around $50 a month leaves
room above that figure; adjust it once real usage is known. When the limit is reached the API refuses the calls:
nothing is saved, the live page keeps showing the last sweep, and Slack (if set up) gets a failure notice.

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
| `RESEND_API_KEY` | A Resend API key with sending access | **Production only** | No. With `EMAIL_TO`, emails each sweep; see [Sending email](#sending-email-optional) |
| `EMAIL_TO` | The email address your Resend account was created with | **Production only** | Only with `RESEND_API_KEY` |
| `EMAIL_FROM` | A sender on a domain verified in Resend, for example `Travel Problem Radar <hello@yourdomain.com>` | **Production only** | Only for subscribers, or to email anyone but the Resend account's own address |
| `SUBSCRIPTIONS_ENABLED` | `1` | **Production only** | No. Turns subscriber sign-up and delivery on; see [Subscriber email](#subscriber-email-optional) |
| `MAX_SUBSCRIBERS` | A whole number, for example `5000` | **Production only** | Only with `SUBSCRIPTIONS_ENABLED`. Unset means the list takes nobody new |
| `MAX_CONFIRMS_PER_DAY` | A whole number | **Production only** | No. Defaults to 10 confirmation emails a day |
| `MAX_SIGNUPS_PER_IP_HOUR` | A whole number | **Production only** | No. Defaults to 5 sign-ups per connection per UTC hour |
| `RESEND_WEBHOOK_SECRET` | The signing secret (`whsec_…`) of the Resend webhook | **Production only** | No. Turns on `/api/resend-webhook`; see [Subscriber email](#subscriber-email-optional) |
| `SITE_URL` | `https://` plus your production domain, no trailing slash | **Production only** | No. Defaults to the Vercel production domain |

Generate the secret with either:

```bash
openssl rand -hex 32
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Tick **Sensitive** for both secrets, and for `SLACK_WEBHOOK_URL`, `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` if you add them, so the
dashboard never shows them again. Save a copy of `CRON_SECRET` in your
password manager: you need it for the GitHub Actions schedule (4.7) and to run a sweep by hand.

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

Finally, open **Settings → Cron Jobs** and confirm one job is listed: `/api/sweep`, schedule `30 1 * * *`. That is
the daily backstop; the 5-hour schedule is set up next.

### 4.7 Turn on the 5-hour schedule (GitHub Actions)

Vercel's Hobby plan runs a cron job at most once a day, so the 5-hour schedule runs from GitHub instead.
`.github/workflows/sweep.yml` calls `/api/sweep` with the same secret at **00:17, 05:17, 10:17, 15:17 and 20:17 UTC**
(05:47, 10:47, 15:47, 20:47 and 01:47 IST). The gap over midnight is 4 hours, because 24 isn't divisible by 5.

Vercel's daily cron stays as a backstop. On a normal day it fires within 2 hours of the 00:17 run, so it answers
`skipped` and costs nothing (5.5). If the 00:17 run was missed or failed, the backstop sweeps instead.

1. On GitHub, open the repository's **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret**. Name: `CRON_SECRET`. Value: the same value as `CRON_SECRET` in Vercel.
3. Open the **Actions** tab. If GitHub asks, allow workflows to run. Select the **sweep** workflow.
4. To test it now, choose **Run workflow** on `main`. That is a manual run, so it always sweeps and costs a full
   sweep. The job log ends with the JSON answer (5.2).

If you run your own copy, change the URL at the end of `.github/workflows/sweep.yml` to your domain.

What to expect:

- **A failed sweep fails the job.** A `401`, `500` or `502` answer marks the run failed (red X). GitHub notifies the
  person who last edited the `cron` line in the workflow file. A `skipped` answer is a `200` and shows as passed.
- **Runs can start late.** GitHub may delay scheduled runs at busy times. The 2-hour rule (5.5) leaves room for that.
- **It stops after 60 quiet days.** In a public repository, GitHub turns scheduled workflows off after 60 days with no
  repository activity. See [Keeping the GitHub schedule on](#keeping-the-github-schedule-on).
- **The secret stays secret.** GitHub masks it in logs, and the job has no access to the repository
  (`permissions: {}`). The Anthropic key is never given to GitHub; only Vercel holds it.

---

## 5. Run the first sweep

Once 4.7 is done, the schedule runs the first sweep at the next 5-hour slot. To run it now and see the result, call
the endpoint with the secret, or use **Run workflow** on GitHub (4.7).

### 5.1 Run it

```bash
read -rs CRON_SECRET && export CRON_SECRET     # paste the secret; it is not echoed or saved in history
curl -sS --max-time 320 \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://travel-problem-radar.vercel.app/api/sweep
```

The call usually takes from several seconds to a few minutes (four searches run in parallel). `--max-time 320`
gives it a little more than the function's 300-second limit.

**GitHub:** **Actions → sweep → Run workflow** sends the same request as the `curl` above, and the job log shows the
answer. It counts as a manual run.

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
| 200 | `{"trigger":"scheduled","status":"skipped","reason":"last scheduled sweep … is under 2 h old"}` | A scheduled call came within 2 hours of the last scheduled sweep, for example Vercel's backstop after the 00:17 run. Manual calls never get this | Nothing; this stops duplicate scheduled calls |
| 502 | `{"status":"empty","perCat":{…}}` | All four categories failed; nothing was saved | Read `perCat` and see [Troubleshooting](#10-troubleshooting) |
| 500 | `{"error":"ANTHROPIC_API_KEY is not set; …"}` | Key missing in this deployment | Add it (4.3) and redeploy (4.5) |
| 500 | `{"error":"sweep failed: …"}` | Storage or another unexpected error | Read the message; usually storage (see Troubleshooting) |
| 401 | `{"error":"unauthorized"}` | Secret missing or wrong, or `CRON_SECRET` not set in this deployment | Check the value; redeploy after changing it |

If some categories fail and others succeed, the run still saves (status `saved`), and `perCat` marks the failed
ones as `failed: …`.

`trigger` says how the server classed the call: `scheduled` for the GitHub Actions schedule or Vercel's timer,
`manual` for anything else, including **Run workflow**.

Every run that is not skipped also returns `slack` and `email` fields. Each is `not configured` when its variables
are unset, and otherwise `sent` or `failed: …` (see [Posting to Slack](#posting-to-slack-optional) and
[Sending email](#sending-email-optional)). A run you start by hand is sent too, marked "manual run".

A **saved** run also returns a `subscribers` field, after the owner's `slack` and `email` (so if the Resend quota runs
out, it is the subscribers' send that stops, not yours). It is `not configured` while `SUBSCRIPTIONS_ENABLED` is not
`1` or the Resend sender is not set up, and otherwise an object of counts only, never an address:
`{"pro":{"due":N,"sent":N,"failed":N,"deferred":N},"free":{"due":N,"sent":N,"failed":N,"deferred":N,"alreadySent":N},"pending":N,"expired":N,"unreadable":N,"stopped":null}`.
`deferred` means not attempted this run (the 240-second subscriber deadline, or a quota stop); a later sweep picks
those up. `stopped` is `quota`, `deadline` or an `http …` reason. A manual run reports `"pro":{"skipped":"manual run"}`.
A failure while delivering shows as `{"error":"…"}`; it never changes the 200 answer or what was saved. Skipped,
`empty` and error answers have no `subscribers` field.

### 5.3 Check the page

Open `/live/`. The board should show the saved items and the history should list one sweep.

### 5.4 Record the results

The README's "What's next" asks for the time taken against the 300-second limit and the token and search counts.
`usage` in the response gives the counts; the function's duration is in the runtime logs (section 9).

### 5.5 Manual runs and the schedule

The server tells the two kinds of call apart by their headers. Vercel's timer sends a `vercel-cron/1.0` user agent
and an `x-vercel-cron-schedule` header. The GitHub Actions schedule sends `X-Sweep-Trigger: scheduled`, and its
**Run workflow** button sends `X-Sweep-Trigger: manual`.

| Call | 2-hour rule | Counts toward the 2 hours |
|---|---|---|
| **Scheduled:** the GitHub Actions schedule or Vercel's timer | Skipped if a scheduled sweep ran less than 2 hours ago, so a duplicate delivery, or the backstop firing soon after the 00:17 run, costs nothing | Yes |
| **Manual:** any other call with the secret, such as the `curl` in 5.1 or **Run workflow** | Never skipped: it always sweeps | No, so it never cancels the next scheduled sweep |

Manual runs are marked `"manual": true` in the history. Keep in mind:

- **Each manual run costs a full sweep.** Anyone who has `CRON_SECRET` can run as many as they like, so keep the
  secret private and keep the Anthropic spend limit in place: that limit is the cap.
- **A manual run uses up New flags.** Items it finds are no longer flagged New in the next scheduled digest.
- **Vercel's own run options may count as scheduled.** `vercel crons run` and the dashboard's run option may send
  the timer's headers. If one answers `skipped`, use the `curl` command in 5.1 instead.
- **The headers grant nothing.** Every call still needs the secret. Sending `X-Sweep-Trigger: scheduled` by hand only
  makes a call skippable.

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
vercel env add RESEND_API_KEY production      # optional, with EMAIL_TO; see "Sending email"
vercel env add EMAIL_TO production

gh secret set CRON_SECRET                     # same value, for the 5-hour schedule (GitHub CLI; prompts for it)

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
  "buildCommand": "rm -rf public && mkdir public && cp -r index.html demo live subscribe manage public/ && rm -rf public/demo/src public/live/src",
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
| `buildCommand` | Copies `index.html`, `demo/`, `live/`, `subscribe/` and `manage/` into `public/`, then removes the JSX sources. It does **not** run `npm run build`. A new page folder must be added here, or Vercel won't serve it (`npm run check` tests for `subscribe` and `manage`) |
| `outputDirectory` | Serves `public/` as the static site |
| `crons` | The daily backstop: calls `/api/sweep` at 01:30 UTC (07:00 IST), within the hour on Hobby |
| `functions["api/sweep.js"].maxDuration` | Lets the sweep run for up to 300 s, the Hobby maximum |

The functions are found automatically: every `.js` file in `api/` becomes a route, except files in folders that start
with `_` (so `api/_lib/` is shared code, not a route). `package.json` sets `"type": "module"`, so the functions are ES
modules. `@vercel/blob` is the only runtime dependency.

### `.github/workflows/sweep.yml`

| Setting | What it does |
|---|---|
| `cron: "17 */5 * * *"` | Runs at 00:17, 05:17, 10:17, 15:17 and 20:17 UTC |
| `workflow_dispatch` | Adds **Run workflow** to the Actions tab. Those runs are manual |
| `X-Sweep-Trigger` header | `scheduled` for the timer, `manual` for **Run workflow**. The server uses it for the 2-hour rule (5.5) |
| `curl --fail-with-body` | A `401`, `500` or `502` answer fails the job and prints the answer |
| `--max-time 320`, `timeout-minutes: 7` | Waits out the function's 300-second limit |
| `permissions: {}` | The job gets no access to the repository |
| `secrets.CRON_SECRET` | Repository secret with the same value as in Vercel. If it is missing, the job stops with a message saying so |

The URL is written into the file; change it for your own copy or a custom domain.

### `.vercelignore`

Keeps `scripts/`, `.github/`, `docs/` and all `*.md` files (including this one) out of the upload. They are not
needed at runtime.

### Environment variables

| Name | Set by | Used by | Notes |
|---|---|---|---|
| `CRON_SECRET` | You | `/api/sweep` | Vercel sends it as `Authorization: Bearer <value>` on cron calls; the GitHub workflow sends the same value from its repository secret. If it is unset, `/api/sweep` always answers 401 |
| `ANTHROPIC_API_KEY` | You | `/api/sweep` | Sent to the Anthropic API in a header; never returned in a response |
| `RADAR_MODEL` | You (optional) | `/api/sweep` | Claude model ID. Default `claude-sonnet-5-5` (`api/_lib/handlers.js`). Must support `effort` (Claude 4.6 or later) |
| `SLACK_WEBHOOK_URL` | You (optional) | `/api/sweep` | Slack incoming webhook. Treat it as a secret: anyone who has it can post to the channel |
| `RESEND_API_KEY` | You (optional) | `/api/sweep`, the subscriber endpoints | Resend API key, sent in a header; never returned in a response. Owner email is sent only when it and `EMAIL_TO` are set |
| `EMAIL_TO` | You (optional) | `/api/sweep`, `/api/confirm`, `/api/account` | Recipients, separated by commas, at most 50. With the default sender, only the Resend account's own address works. Also gets the "Pro request" email. Kept out of the repository and out of every reply |
| `EMAIL_FROM` | You (optional; required for subscribers) | `/api/sweep`, the subscriber endpoints | Defaults to `Travel Problem Radar <onboarding@resend.dev>`, Resend's shared sender, which is enough for the owner's own digest. Subscriber email refuses that default and any `@resend.dev` sender: it needs a sender on a domain verified in Resend |
| `SUBSCRIPTIONS_ENABLED` | You (optional) | The subscriber endpoints, `/api/sweep` | `1` turns sign-up and subscriber delivery on together. Anything else, or unset, means off |
| `MAX_SUBSCRIBERS` | You (with subscriptions) | `/api/subscribe` | The cap on records (pending and active). Unset or not a positive whole number means **closed**: the sign-up reply looks the same but nothing is stored. The count is the one the last saved sweep wrote |
| `MAX_CONFIRMS_PER_DAY` | You (optional) | `/api/subscribe` | Confirmation emails per UTC day, across all addresses. Default 10; `0` stops confirmation emails |
| `MAX_SIGNUPS_PER_IP_HOUR` | You (optional) | `/api/subscribe` | Sign-up attempts per client IP per UTC hour. Default 5; unset or not a positive whole number means 5. Over it the reply is the same and nothing is stored or sent |
| `RESEND_WEBHOOK_SECRET` | You (optional) | `/api/resend-webhook` | The Resend webhook's signing secret. If it is unset, the endpoint answers `503` and does nothing |
| `SITE_URL` | You (optional) | The subscriber endpoints, `/api/sweep` | Base of the links in subscriber emails. If unset, `https://` plus `VERCEL_PROJECT_PRODUCTION_URL`. With neither, subscriber email is off |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel, automatically | `/api/sweep`, the subscriber endpoints | Builds the "Open the live board" link in the Slack message, and the subscriber links when `SITE_URL` is unset. If it is missing, the Slack link is left out |
| `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` | Vercel, when the store is connected | `api/_lib/storage.js` | Do not set by hand unless running outside Vercel |

### What is stored

All objects live under `radar/` in the private store. Keys are turned into file names by replacing anything that is
not a letter or digit with `-`.

| Logical key | Blob path | Contents | Readable through `/api/data` |
|---|---|---|---|
| `radar:history` | `radar/radar-history.json` | Index of saved sweeps (id, time, counts), last 60 | Yes |
| `radar:sweep:<id>` | `radar/radar-sweep-<id>.json` | One sweep's items | Yes |
| `radar:seenIds` | `radar/radar-seenIds.json` | Up to 800 item IDs already seen, used for the New flag | No |
| `radar:sub:<id>` | `radar/radar-sub-<id>.json` | One subscriber: address, status, plan, token, dates. `<id>` is the SHA-256 of the lowercased address | No |
| `radar:event:<YYYYMMDD>-<time>-<type>-<random>` | `radar/radar-event-….json` | One sign-up, confirmation, unsubscribe, Pro, bounce or complaint event: type, time and plan, **no address or id**. Kept until `prune-events` deletes it | No |
| `radar:deliveries:<YYYYMMDD>` | `radar/radar-deliveries-<YYYYMMDD>.json` | Record ids already sent that day's Free digest. Deleted by the sweep after 7 days | No |
| `radar:subscriberCount` | `radar/radar-subscriberCount.json` | Pending plus active records at the last saved sweep; the sign-up cap reads it | No |
| `radar:iphit:<YYYYMMDDHH>-<16 hex>-<6 hex>` | `radar/radar-iphit-….json` | One sign-up attempt: its time only. The 16 hex are from a SHA-256 of the client IP; **the IP itself is not stored**. Deleted by the sweep after 2 hours | No |

`/api/data` allows only `radar:history` and `radar:sweep:<id>`; the tests check that every subscriber key is refused.

### Caching

- `/api/data` success responses carry `cache-control: public, s-maxage=300, stale-while-revalidate=3600`. After a
  sweep, the live page can show the previous sweep for about 5 minutes, sometimes a little longer while the CDN
  refreshes.
- Error responses and `/api/sweep` use `no-store`.
- Vercel Blob itself can take up to 60 seconds to serve a new version of an overwritten file from its CDN cache.
  So every read skips that cache (`useCache: false`) except `/api/data`'s, which is read-only. Before this, a
  record read back within a minute of a change could show the old version, and a read-change-write in that minute
  (for example a "Request Pro" click just after `grant-pro`) could undo the change. Seen on 2026-10-21: `list` showed
  Free for about a minute after `grant-pro` had written Pro.

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
(`https://travel-problem-radar.vercel.app/live/`), the "Live page" row in `README.md`, and the URL in
`.github/workflows/sweep.yml`.

---

## 9. Operating the scheduled sweep

### Watching runs

- **Settings → Cron Jobs → View Logs** opens the runtime logs filtered to `requestPath:/api/sweep`. That covers
  every call, whichever scheduler made it.
- **GitHub → Actions → sweep** lists each GitHub run, scheduled or manual. Each job log ends with the JSON answer.
- Each run logs one line starting with `sweep`, with the model, the per-category result and the API usage, for example:
  `sweep {"model":"claude-sonnet-5-5","perCat":{"traveler_pain":"5 items",…},"usage":{"input":…,"output":…,"searches":…}}`
- Hobby keeps runtime logs only for a short time, so check on the day if you are tracking cost or duration.
- A failed run (`502` or `500`) shows as an error in the logs, and as a failed job on GitHub. Neither retries it;
  the next scheduled run is 5 hours later (4 over midnight).

The quickest health check needs no logs:

```bash
curl -s "https://travel-problem-radar.vercel.app/api/data?key=radar:history" | head -c 400
```

The last entry's `at` should be less than about 5 hours old; allow some extra time for GitHub's delays.

### Costs

Compare `usage.searches`, `usage.input` and `usage.output` from the logs with the Anthropic Console's usage page.
Adjust the spend limit once a week or two of real data exists.

### Posting to Slack (optional)

After each sweep, the server can post to one Slack channel through an incoming webhook (`api/_lib/slack.js`):

| Sweep result | Slack message |
|---|---|
| Saved | The digest: counts, any failed categories, a link to the live board, then every item by category, with severity, a NEW tag, the title linked to its source, summary, source, region, date and opportunity |
| Every category failed, or an error stopped the run | A short notice that nothing was saved, with the reason for each category or the error |
| Skipped (a repeat scheduled call within 2 hours) | Nothing |

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
   sweeps post one titled "digest".

How it behaves:

- The sweep is saved before anything is posted, and a Slack problem never fails the sweep. The outcome shows in the
  `slack` field of the reply and as a `slack` line in the runtime logs.
- Every saved sweep posts, so the channel gets about five digests a day. Each lists every item in that sweep, with
  the ones not seen before tagged NEW.
- The Slack call gives up after 10 seconds. Link previews are turned off to keep the message compact.
- The webhook URL never appears in a reply or a log line.
- Status: covered by the offline tests (`npm test`); **not yet tried against a real Slack workspace**. The Slack
  digest in Claude's app is a separate setup and is not affected.

### Sending email (optional)

The same messages can also go by email through [Resend](https://resend.com) (`api/_lib/email.js`): the digest after
every saved sweep, a short notice when nothing was saved, and nothing for a skipped call. Each email has an HTML part
and a plain-text part. The subject carries the sweep time and counts, for example
`Travel Problem Radar · 2026-10-21 05:17 UTC · 18 problems, 4 new`, so mail apps don't thread a day's digests
together.

**No domain is needed.** Mail is sent from Resend's shared address, `Travel Problem Radar <onboarding@resend.dev>`.
The catch: Resend delivers mail from that address **only to the email the Resend account was created with**. Any
other recipient is refused with `403 validation_error`. So create the Resend account with the inbox that should get
the digest.

To turn it on:

1. Create a Resend account at https://resend.com, signing up with the address that should receive the digest.
2. Create an API key under **API Keys** with **Sending access**. Such a key can send email and do nothing else in the
   account.
3. Add two variables in Vercel, for **Production only**, with `RESEND_API_KEY` marked **Sensitive**:
   - `RESEND_API_KEY`: the key.
   - `EMAIL_TO`: the address you signed up to Resend with.
4. Redeploy, then run a sweep by hand (5.1). The reply's `email` field should say `sent`. If the email doesn't show
   up in the inbox, check the spam folder.

To send to other people later, verify a domain in Resend (**Domains → Add Domain**, plus its DNS records), set
`EMAIL_FROM` to a sender on it, for example `Travel Problem Radar <radar@yourdomain.com>`, and list the recipients
in `EMAIL_TO`, separated by commas (at most 50).

**Free-plan limits** (Resend, October 2026): 100 emails a day and 3,000 a month, and each recipient counts as one
email. One recipient at five sweeps a day is 5 a day and about 150 a month, well inside both.

How it behaves:

- Slack and email are sent at the same time, after the sweep is saved. Either can fail without affecting the other
  or the sweep.
- The call to Resend gives up after 10 seconds.
- With more than one recipient (only possible with your own domain), everyone is on the To line and sees the other
  addresses.
- The reply's `email` field gives only the outcome: `sent`, `not configured` (or which variables are missing),
  `failed: http <status> <Resend error name>`, `failed: timeout` or `failed: network error`. It never includes the
  key, the addresses or Resend's error message, because the GitHub Actions job prints the reply in a log that anyone
  can read in a public repository. Resend's dashboard shows the full error under **Logs**.
- Status: in use with a real Resend account since 21 Oct 2026, sending from the verified domain
  `pehchanthetraveller.com`. Subscriber confirmation emails have arrived, at first in the spam folder.

### Subscriber email (optional)

Anyone can sign up for the digest by email at `/subscribe/`. This is separate from the owner's email above, which is
unchanged. Code: `api/subscribe.js`, `api/confirm.js`, `api/unsubscribe.js`, `api/account.js` and `api/resend-webhook.js`, with the logic in
`api/_lib/subscription-handlers.js`, `api/_lib/subscribers.js` and `api/_lib/subscriber-delivery.js`. Design notes:
[docs/subscriptions/email-signup.md](docs/subscriptions/email-signup.md).

**What a subscriber goes through**

1. `/subscribe/` posts the address to `POST /api/subscribe`. Every accepted request gets the same reply ("If that
   address can be subscribed, a confirmation link is on its way"), so the endpoint never tells anyone whether an
   address is on the list. A filled-in hidden field (a trap for bots) gets the same reply and does nothing.
2. A confirmation email links to `/api/confirm?id=…&t=…`. Opening it shows a **Confirm** button; only pressing it
   (a `POST`) confirms, so a mail scanner that opens links can't sign anyone up. An address not confirmed within 7
   days is deleted by the next sweep. A second sign-up for the same pending address within 24 hours sends nothing.
3. **Free:** one email a day, after the first saved sweep of the UTC day (normally 00:17 UTC, about 05:47 IST),
   holding everything saved in the last 24 hours. **Pro:** an email after every saved **scheduled** sweep (about 5 a
   day); manual runs send Pro nothing. Pro is switched on by hand for now: see "Handling Pro requests" below.
4. Every email has an Unsubscribe link and a "Manage subscription" link (`/manage/`), plus `List-Unsubscribe` headers
   so mail apps can offer one-click unsubscribe. Unsubscribing deletes the record, and works even while subscriptions
   are switched off.

**What it needs**

- A domain verified in Resend (**Domains → Add Domain**, then its DNS records), and `EMAIL_FROM` set to a sender on
  it. The shared `onboarding@resend.dev` sender can't reach other people, so the code refuses it for subscribers.
- `RESEND_API_KEY` (as for the owner's email).
- `MAX_SUBSCRIBERS`. Without it the list is closed.
- `SUBSCRIPTIONS_ENABLED=1`.
- Optional: `SITE_URL`, `MAX_CONFIRMS_PER_DAY`, `MAX_SIGNUPS_PER_IP_HOUR` and `RESEND_WEBHOOK_SECRET` (see the
  [environment variables](#environment-variables)).

All for **Production only**. Redeploy after adding them. If any is missing, `/api/subscribe` answers
`503 subscriptions are not open yet` and the sweep reply says `"subscribers": "not configured"`.

**The daily quota.** On Resend's free plan (100 emails a day, October 2026), each recipient counts as one email. The
budget, from [pricing.md](docs/subscriptions/pricing.md), is

```
5 (owner) + Free subscribers + 5 × Pro subscribers + confirmation emails ≤ 100 a day
```

so about 90 Free subscribers fit. `MAX_SUBSCRIBERS` is 5000 in production (decision D7), well above that: past about
90, the sweep stops at the quota and the rest are deferred to the next sweep, so a paid Resend plan is needed before
then. The owner's digest is always sent first, so a used-up quota stops subscriber mail, not the owner's.

**How it shows in the sweep reply.** After a saved sweep the reply (and the `subscribers` log line) has a
`subscribers` field with counts only, never an address, because GitHub Actions prints it in a public log:

```json
"subscribers": {
  "pro": { "due": 1, "sent": 1, "failed": 0, "deferred": 0 },
  "free": { "due": 1, "sent": 1, "failed": 0, "deferred": 0, "alreadySent": 0 },
  "pending": 0, "expired": 0, "unreadable": 0, "stopped": null
}
```

- `pro` is `{ "skipped": "manual run" }` for a manual run.
- `free.alreadySent` counts subscribers who already had today's digest; later sweeps that day send them nothing.
- `deferred` is anyone not reached this time, because the 240-second deadline passed or sending stopped. They are
  tried again at the next sweep, and nobody gets the same day's Free digest twice.
- `stopped` says why sending stopped early: `quota`, `deadline`, or a Resend error such as `http 401`.

**Turning it off.** Remove `SUBSCRIPTIONS_ENABLED` (or set it to anything but `1`) and redeploy. Sign-up then answers
`503`, confirm and manage links show "Subscriptions are paused", and the sweep sends no subscriber email. Records are
kept, and unsubscribe links still work. Set it back to `1` and redeploy to resume.

**Bounces and spam complaints (Resend webhook, T13).** `POST /api/resend-webhook` takes Resend's `email.bounced` and
`email.complained` events. A hard bounce (`bounce.type` is `Permanent`) or a complaint deletes that address's record
and records a `bounced` or `complained` event, with no address. Soft bounces (`Transient`, `Undetermined`) and other
event types are ignored, and so is an address that isn't a subscriber, such as `EMAIL_TO`. Every request's signature
(Resend signs the Svix way) is checked against the raw body before anything is read, and a timestamp more than 5
minutes off is refused. Like unsubscribe, it works while `SUBSCRIPTIONS_ENABLED` is off. Setup:

1. In Resend, open **Webhooks** and add an endpoint: `https://travel-problem-radar.vercel.app/api/resend-webhook`,
   with the events `email.bounced` and `email.complained`.
2. Copy its signing secret (it starts with `whsec_`) into `RESEND_WEBHOOK_SECRET`, **Production only**, Sensitive.
   Redeploy.
3. Check that an unsigned call is refused:
   `curl -i -X POST https://travel-problem-radar.vercel.app/api/resend-webhook` should answer `401`. A `503` means
   the secret doesn't reach this deployment.
4. Check a real bounce: sign up `bounced@resend.dev` (Resend's test address) on `/subscribe/`. Its confirmation
   bounces; afterwards `list` no longer shows it and `stats` shows a `bounced` event. `complained@resend.dev` does
   the same with a `complained` event. Each uses one of the day's `MAX_CONFIRMS_PER_DAY` confirmation emails.
   Resend's webhook log should show `200` replies.

Replies: `200` (handled or ignored), `401` (bad or old signature), `400` (not JSON), `413` (over 64 KB), `503` (no
secret), `500` (a storage error, so Resend tries again). No reply or log line contains an address.

**Limiting sign-ups per connection (T13).** Two guards, so one sender can't use up the day's confirmation emails:

- **In the code:** at most `MAX_SIGNUPS_PER_IP_HOUR` (default 5) sign-ups per client IP per UTC hour. Over it the
  reply is the usual one and nothing is stored or sent. The IP comes from `x-vercel-forwarded-for` (or
  `x-forwarded-for`), which Vercel sets itself so a client can't choose it. Each allowed attempt stores a
  `radar:iphit:` file holding a hash of the IP, never the IP; the sweep deletes them after 2 hours. A count that
  can't be read counts as reached. Without an IP header (local runs) there is no limit.
- **In front, a Vercel Firewall rule:** a flood is answered `429` before the function runs, so it costs no Blob
  operations (see the Blob row in [section 3](#3-costs-and-plan-limits)). Hobby allows one rate-limit rule per
  project. In the dashboard: the project → **Firewall** → **Configure** → **New Rule**, then:
  - Name: `subscribe rate limit`.
  - If **Request Path** equals `/api/subscribe` **and** **Method** equals `POST`.
  - Then **Rate Limit**: fixed window, **10 minutes**, **5 requests**, keyed by **IP**, action **Default (429)**.
  - Save the rule, then review and publish the change.

  The sign-up page shows "Too many tries from your connection. Please try again in a few minutes." on a `429`. The
  rule's traffic shows on the Firewall overview.

### Managing subscribers

`scripts/subscribers.mjs` runs on your own machine against the Blob store. It is not deployed (`.vercelignore` skips
`scripts/`) and adds no public endpoint. It prints addresses only for `list` and `show`, and never a token.

**One-time setup.** Create a read-write token for the Blob store in the Vercel dashboard, and
put it in a file called `.env.local` in the repository root as `BLOB_READ_WRITE_TOKEN=…`. `.gitignore` ignores `.env*`
and `npm run check` fails if one is tracked. `vercel env pull .env.local` may also bring a usable token; **not
confirmed**: the store may only expose `BLOB_STORE_ID` with an OIDC token that does not work off Vercel. With no
usable credentials the script prints the `@vercel/blob` error and exits 1.

```
node --env-file=.env.local scripts/subscribers.mjs stats [--days 30]
node --env-file=.env.local scripts/subscribers.mjs list [--plan pro|free|pending|requested]
node --env-file=.env.local scripts/subscribers.mjs show <email>
node --env-file=.env.local scripts/subscribers.mjs grant-pro <email> [--until 2027-01-31] [--yes]
node --env-file=.env.local scripts/subscribers.mjs revoke-pro <email> [--yes]
node --env-file=.env.local scripts/subscribers.mjs delete <email> [--yes]
node --env-file=.env.local scripts/subscribers.mjs prune-events --older-than 400 [--yes]
```

| Command | What it does |
|---|---|
| `stats` | Counts now (pending, Free, Pro, Pro ending within 7 days, waiting for Pro) and per UTC day: sign-ups, confirmation emails, confirmations, unsubscribes (Free and Pro), expired, Pro requests, Free digests sent. Ends with the confirm rate, `confirmed / subscribed`. No addresses |
| `list` | Address, status, plan, `proUntil`, confirmed date and the date they asked for Pro. `--plan requested` lists the active Free subscribers who asked for Pro (the waiting list). A Pro record past its end date shows as `pro (lapsed)`: the sweep treats it as Free |
| `show` | One record without its token |
| `grant-pro` | Only for an active (confirmed) subscriber. Pro with `proSource: owner`, and the Pro request is cleared (the `prorequested` event keeps the history). `--until 2027-01-31` makes Pro run through the end of that UTC day; leave it out for no end date. A past date is accepted and acts as Free. Refuses a paid Razorpay record |
| `revoke-pro` | Back to Free, clearing the end date. Refuses a Razorpay record |
| `delete` | Deletes the record. This is the answer to a deletion request. Event records hold no address or id. The one place the record's hashed id (not the address) can remain is a `radar:deliveries:<date>` file, which the sweep deletes after 7 days |
| `prune-events` | Deletes event records older than N days |

Every write only describes what it would change until you add `--yes` (and then exits 0). Exit codes: `0` done,
`1` not found, refused or not applied, `2` bad usage. A granted Pro starts at the next scheduled sweep, because Pro
email goes only with scheduled sweeps. `stats` is where the Phase 2 numbers in
[`docs/subscriptions/pricing.md`](docs/subscriptions/pricing.md) come from.

**Handling Pro requests.** Until payments exist (T16 to T19), Pro is free and switched on by hand. A subscriber asks
for it in one of two places: the "I'd also like Pro" box on `/subscribe/` (counted only once they press Confirm), or
the "Request Pro" button on `/manage/`, which every digest links to as "Manage subscription" (the link carries their
id and token; `/api/account` answers it and never returns the address). Each request sends one email to `EMAIL_TO`,
subject "Travel Problem Radar: Pro request". It names nobody, so run `list --plan requested` to see who is waiting,
then `grant-pro <email> --yes`. A repeat click sends nothing more, and a failed owner email still records the request.
The subscriber is not emailed when Pro is switched on: their next email after a scheduled sweep is the Pro update.

### Changing the schedule

The 5-hour schedule is the `cron` line in `.github/workflows/sweep.yml`, in UTC. Edit it and push to `main`. If you
make runs closer together, keep `minGapHours` in `runDailySweep` (`api/_lib/radar.js`, now 2) well below the new
interval, or late runs will be skipped. Each extra sweep a day adds about $0.21 a day, roughly $6 a month.

Vercel's backstop is `schedule` in `vercel.json`. On Hobby it must run at most once a day.

### Pausing the sweep

There are two schedules to pause:

- **GitHub:** **Actions → sweep → ⋯ → Disable workflow.**
- **Vercel:** **Settings → Cron Jobs → Disable Cron Jobs.** This stays in effect across deploys and rollbacks.

Each stays off until you enable it again. The live page keeps showing the last saved sweep.

### Keeping the GitHub schedule on

In a public repository, GitHub turns scheduled workflows off after 60 days with no repository activity, such as a
commit. The Vercel backstop then still sweeps once a day. To turn the 5-hour schedule back on, open **Actions →
sweep** and choose **Enable workflow**.

### Rotating secrets

- **`CRON_SECRET`:** change the value in Vercel's Settings → Environment Variables and redeploy, then update the
  GitHub repository secret (**Settings → Secrets and variables → Actions → `CRON_SECRET` → Update**). Vercel sends the
  new value to its cron automatically. Until both match, GitHub runs answer `401` and fail.
- **`ANTHROPIC_API_KEY`:** create a new key in the Anthropic Console, update the variable, redeploy, then revoke the
  old key.
- **`RESEND_API_KEY`:** create a new key in Resend, update the variable, redeploy, then delete the old key.
  Subscriber digests and confirmation emails use the same key.

### Starting the history over

Delete the objects under `radar/` from the store's browser in the **Storage** tab. The next sweep starts a fresh
history, and every item is flagged New again. This cannot be undone.

### Duplicate, late or missed scheduled calls

Both schedulers are best effort. Vercel can miss a run or deliver it twice. GitHub can start a run late, or drop it at
very busy times. A scheduled call within 2 hours of the last scheduled sweep answers `skipped`, so duplicates cost
nothing. A missed run is made up at the next slot, at most about 5 hours later. Around midnight, Vercel's backstop
covers a missed 00:17 run.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/live` or `/demo` (no trailing slash) shows a blank page | Fixed on 22 Oct 2026: the page adds the slash itself. If it still happens, the deployment predates the fix, or a cached copy of the old page was served | Use `/live/` and `/demo/`; redeploy. See [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep) |
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
| `perCat` entries `failed: http 429` or `http 529` | Rate limit or API overload | Usually temporary; the next scheduled run will try again |
| `perCat` entries `failed: empty (stop_reason: …)` or `failed: no json (…)` | The model's reply had no JSON array. The stop reason says why: `max_tokens` (ran out of output tokens, thinking included), `refusal` (a safety classifier declined), `pause_turn` (a long search turn paused before the answer) | `max_tokens`: see Known issue 2. `refusal`: try a different model in `RADAR_MODEL`. `pause_turn`: rare with 3 searches; the next run usually succeeds |
| `200 skipped` when you expected a run | The call counted as scheduled (`trigger: scheduled`) and a scheduled sweep ran less than 2 hours ago. This can happen with `vercel crons run`, the dashboard, or a GitHub run that started late | Run it with the `curl` command in 5.1 or **Run workflow**, which always sweep (see 5.5) |
| Function times out (`FUNCTION_INVOCATION_TIMEOUT`) | The run took more than 300 s | Rare with 3 searches per call. On Pro, raise `maxDuration` (up to 800) |
| Deploy fails: "Hobby accounts are limited to daily cron jobs" | The schedule in `vercel.json` runs more than once a day | Keep `vercel.json` daily; the 5-hour schedule belongs in `.github/workflows/sweep.yml` |
| GitHub **sweep** job fails: "Add CRON_SECRET under Settings > Secrets and variables > Actions" | The repository secret is missing | Add it (4.7) |
| GitHub **sweep** job fails with `{"error":"unauthorized"}` | The GitHub secret and Vercel's `CRON_SECRET` differ | Make them match; redeploy if you changed Vercel's |
| No GitHub runs for a while | GitHub turned the schedule off after 60 days without repository activity, or Actions are disabled for the repository | **Actions → sweep → Enable workflow** |
| CI fails: "A bundle is stale" | Bundles not rebuilt after a source change | `npm run build`, commit `demo/radar.js` and `live/radar-live.js` |
| No Slack message after a sweep | Check `slack` in the reply or the `slack` log line. `not configured` means the variable is missing for Production or the deploy predates it. Skipped runs never post | Add `SLACK_WEBHOOK_URL` for Production; redeploy |
| `slack: failed: http 403`, `404` or `410` | The webhook was revoked, its channel was deleted or archived, or the Slack app was removed | Create a new webhook; update the variable; redeploy |
| `slack: failed: timeout` or `network error` | Slack was slow or unreachable. The sweep itself was saved | Nothing to fix; the next sweep posts as usual |
| No email after a sweep | Check `email` in the reply or the `email` log line. `not configured` means none of the email variables reach this deployment; `not configured: … missing` names the ones that don't | Add them for Production; redeploy |
| `email: failed: http 403 validation_error` | With the default sender: `EMAIL_TO` holds an address other than the one the Resend account was created with. With your own `EMAIL_FROM`: its domain isn't verified | Set `EMAIL_TO` to the account's own address, or verify a domain (see [Sending email](#sending-email-optional)). Resend's **Logs** give the exact reason |
| `email: failed: http 401 …`, or `http 403` with `restricted_api_key` or `suspended_api_key` | The key is wrong, deleted or disabled | Create a new key; update the variable; redeploy |
| `email: failed: http 422 …` or `http 400 validation_error` | `EMAIL_TO` (or `EMAIL_FROM`, if set) is malformed | Recipients as plain addresses separated by commas; a sender as `Name <address@domain>` |
| `email: failed: http 429 daily_quota_exceeded` (or `monthly_quota_exceeded`) | The plan's sending quota is used up; each recipient counts. Unlikely with one recipient | Fewer recipients or a paid plan. The daily quota resets at midnight UTC |
| `/subscribe/` says "Subscriptions aren't open yet" (`503`) | `SUBSCRIPTIONS_ENABLED` isn't `1`, or `RESEND_API_KEY`, a verified-domain `EMAIL_FROM` or a site URL is missing for this deployment | Set them for Production; redeploy (see [Subscriber email](#subscriber-email-optional)) |
| `"subscribers": "not configured"` in the sweep reply | Same as the row above | Same fix |
| Sign-up says the link is on its way, but no confirmation email comes | In order: the spam folder; `MAX_SUBSCRIBERS` unset (the list is closed) or reached; `MAX_CONFIRMS_PER_DAY` used up today; more than `MAX_SIGNUPS_PER_IP_HOUR` sign-ups from the same connection this hour; a second sign-up within 24 hours of the first; the address is already confirmed. The reply is the same in every case on purpose | Check spam first. Then the `subscribe confirm-email` log line in Vercel (kept about 30 minutes), `stats` for today's confirmation emails, and Resend's **Logs** |
| `/subscribe/` says "Too many tries from your connection" (`429`) | The Vercel Firewall rule: more than 5 sign-up requests from one IP in 10 minutes | Wait 10 minutes. Many people behind one office or mobile network share an IP; raise the rule's limit if that matters |
| Resend's webhook log shows `401` | `RESEND_WEBHOOK_SECRET` isn't this webhook's signing secret (for example after re-creating the webhook), or the server clock and the event's timestamp differ by more than 5 minutes | Copy the secret again from Resend's webhook page; redeploy. Resend retries failed deliveries |
| Resend's webhook log shows `503` | `RESEND_WEBHOOK_SECRET` isn't set for this deployment, or was added without a redeploy | Set it for Production; redeploy |
| Subscriber emails land in spam | A new sending domain has no reputation yet. SPF, DKIM and DMARC are set for `pehchanthetraveller.com` | Mark the emails "not spam"; it usually improves with time. Nothing to change in the code |
| `subscribers.stopped: "quota"`, with `deferred` counts | Resend's daily quota ran out. The owner's email went first | The rest go at the next sweep. If it happens often, see the quota formula in [Subscriber email](#subscriber-email-optional) |
| `subscribers.stopped: "deadline"`, with `deferred` counts | The sweep reached 240 seconds before sending finished | The rest go at the next sweep; nothing is sent twice |
| `free.due: 0` with `alreadySent` above 0 | Today's Free digest has already gone to those subscribers | Expected; the next one goes after the first sweep of the next UTC day |
| `pro: { "skipped": "manual run" }` | Pro email goes only with scheduled sweeps (decision D4) | Expected |
| A Pro subscriber got no Pro email | Pro was granted after the last scheduled sweep, or `proUntil` has passed (`list` shows `pro (lapsed)`) | Wait for the next scheduled sweep, or grant again |
| A confirm or manage link says "This link isn't valid" | The record was deleted (unsubscribed, or pending for more than 7 days), or the mail app cut the link short | Sign up again, or use the links in the most recent email |
| `/subscribe/`, `/manage/` or `/live/` opened on GitHub Pages | Pages has no `/api/`, so these pages send the visit on to the Vercel copy | Nothing to fix; link to `https://travel-problem-radar.vercel.app/subscribe/` |

---

## Known issues to fix before or after the first sweep

Found while writing this guide (21 Oct 2026). Issues 1 and 2 have fixes; each still needs one look on production.
Remove each one from this list once that is done.

### 1. `/live` and `/demo` without a trailing slash render a blank page: fixed, to check on production

**Was confirmed on production.** `https://travel-problem-radar.vercel.app/live` answered 200 with the page, but the
page loads `radar-live.js` by a relative path. Without the trailing slash that becomes `/radar-live.js`, which is a
404, so nothing rendered. `/demo` behaved the same way with `radar.js`. GitHub Pages is not affected because it
redirects `/demo` to `/demo/` itself.

**Fix (22 Oct 2026):** the first script in the `<head>` of `live/index.html` and `demo/index.html` now sends a path
without the trailing slash to the same path with it, keeping the query and hash:

```html
<script>if (!/(\/|\.html)$/.test(location.pathname)) location.replace(location.pathname + "/" + location.search + location.hash);</script>
```

It leaves `/live/` and `/live/index.html` alone and sends `/live` to `/live/`. In `live/index.html` it runs after the
GitHub Pages redirect. `scripts/check.mjs` checks both pages have it. **To check after deploy:** open `/live` and
`/demo` on the Vercel URL; each should end up on the slash URL and render.

Do **not** fix this with `"trailingSlash": true` in `vercel.json`. That also redirects `/api/sweep` to
`/api/sweep/`. Vercel cron jobs do not follow redirects, and neither does the GitHub workflow's `curl`, so scheduled
sweeps would stop running.

### 2. Categories failing with `empty`: fix applied, not yet confirmed by a real run

**What happened.** The first two real sweeps lost categories to `empty`: 2 of 4 on 20 Oct (22:53 UTC) and 3 of 4 on
21 Oct (00:13 UTC). The default model, `claude-sonnet-5-5`, thinks by default, and thinking counts toward
`max_tokens`, which was 1,000. That most likely used up the budget before any answer was written. The code didn't
record the stop reason then, so this is the likely cause, not a confirmed one. The version that worked in Claude's
app used `claude-sonnet-4-6`, which does not think unless asked.

**What changed** (`scanCategory` in `api/_lib/radar.js`):

- Each call now sends `output_config: { effort: "low" }`, which keeps thinking short. This is the setting
  Anthropic's docs recommend first for a request like this.
- `max_tokens` is now 16,000, leaving room for thinking plus the answer. Only tokens actually produced are billed.
- A failed category now says why the model stopped, for example `failed: empty (stop_reason: max_tokens)`.
- The `usage` totals now include failed categories.

**Tested locally (21 Oct 2026)** with the same code and model, calling each category separately: all four returned
4–5 items with `stop_reason: end_turn` and 0 thinking tokens, using 813–1,148 output tokens each. The answers alone
were about 1,000 tokens, so the old 1,000 limit was too tight even without thinking.

**Still to confirm on production:** after deploying, every category in the next sweep should report `N items`. If
one still fails, its stop reason says what to change next. If you set `RADAR_MODEL`, pick a model that supports `effort` (Claude 4.6 or later); older models
reject the request with a 400.

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
