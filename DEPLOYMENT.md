# Deploying Travel Problem Radar on Vercel

This guide covers deploying and running the **live page** on Vercel: the server sweep that runs every 5 hours, the
read-only data feed and the `/live/` dashboard. It is for the person who owns the Vercel project, or anyone running
their own copy. It assumes you can use a terminal and the Vercel dashboard; no earlier Vercel experience is needed.

The home page and the sample demo are also served by **GitHub Pages** from `main`. Nothing in this guide changes that.
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
           /, /demo/     │  static copies of the home page and demo                 │
                         └──────────────────────────────────────────────────────────┘
```

| Piece | Source in this repo | Served at |
|---|---|---|
| Home page (copy) | `index.html` | `/` |
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

**First full production sweep on Haiku (25 Oct 2026, manual, `claude-haiku-5-5`):** all four categories saved, 18
items; 101,309 input and 9,306 output tokens, 10 searches, 90 pages, about 20 seconds. At the prices in
`scripts/compare-models.mjs` ($0.10 input / $0.50 output per million tokens, $10 per 1,000 searches; not rechecked
against Anthropic's price page) that is about **$0.12**, most of it the searches. Each sweep's tokens, searches and
pages per category are in its LLM log ([Reading the LLM logs](#reading-the-llm-logs)).

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
| `RADAR_MODEL` | A Claude model ID, for example `claude-sonnet-4-6` | Production | No. Defaults to `claude-haiku-5-5`; see [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep) |
| `SLACK_WEBHOOK_URL` | A Slack incoming-webhook URL | **Production only** | No. Posts each sweep to Slack; see [Posting to Slack](#posting-to-slack-optional) |
| `RESEND_API_KEY` | A Resend API key with sending access | **Production only** | No. With `EMAIL_TO`, emails each sweep; see [Sending email](#sending-email-optional) |
| `EMAIL_TO` | The email address your Resend account was created with | **Production only** | Only with `RESEND_API_KEY` |
| `EMAIL_FROM` | A sender on a domain verified in Resend, for example `Travel Problem Radar <hello@yourdomain.com>` | **Production only** | Only for subscribers, or to email anyone but the Resend account's own address |
| `SUBSCRIPTIONS_ENABLED` | `1` | **Production only** | No. Turns subscriber sign-up and delivery on; see [Subscriber email](#subscriber-email-optional) |
| `MAX_SUBSCRIBERS` | A whole number, for example `5000` | **Production only** | Only with `SUBSCRIPTIONS_ENABLED`. Unset, sign-up answers "subscriptions are not open yet" |
| `MAX_CONFIRMS_PER_DAY` | A whole number | **Production only** | No. Defaults to 10 confirmation emails a day |
| `MAX_SIGNUPS_PER_IP_HOUR` | A whole number | **Production only** | No. Defaults to 5 sign-ups per connection per UTC hour |
| `SESSION_SECRET` | A random string of at least 32 characters (see [Signing in](#signing-in-t16)) | **Production and Preview, a different value for each** | Only for sign-in. Without it `/signin/` answers "not set up yet" and Confirm signs nobody in |
| `MAX_SIGNINS_PER_DAY` | A whole number | **Production only** | No. Defaults to 50 sign-in emails a day; `0` stops them |
| `MAX_MANUAL_SWEEPS_PER_DAY` | A whole number | **Production only** | No. Defaults to 3 manual sweeps a UTC day (5.5); `0` stops them. Scheduled sweeps aren't limited by it |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The OAuth client from Google Cloud (see [Google sign-in](#google-sign-in-optional)) | **Production only**, the secret marked Sensitive | No. Both, with `SESSION_SECRET`, show "Continue with Google" |
| `ADMIN_USER`, `ADMIN_PASSWORD` | A user name, and a password of at least 16 characters (see [Admin dashboard](#admin-dashboard)) | **Production and Preview**, the password marked Sensitive; a different password for each is better | No. Without both, `/admin/` says it isn't set up and `/api/admin` answers `503` |
| `BOARD_PAYWALL` | `1` | **Production only**, at go-live | No. Locks the live board to signed-in Pro accounts; see [The locked board](#the-locked-board-t17). Leave it unset until then |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLANS`, `RAZORPAY_TOTAL_COUNT` | Razorpay test-mode keys, a webhook secret, the ₹1 plan for each billing period as JSON (printed by `check-plan.mjs --create`) and how many months a subscription runs (see [Paid Pro checkout](#paid-pro-checkout-t20)) | **Preview only** while testing, the two secrets marked Sensitive. Never test keys on Production; live keys go there at T22 | No. All five turn on **Upgrade to Pro** on `/manage/`; with any of them unset the page keeps Request Pro |
| `RESEND_WEBHOOK_SECRET` | The signing secret (`whsec_…`) of the Resend webhook | **Production only** | No. Turns on `/api/resend-webhook`; see [Subscriber email](#subscriber-email-optional) |
| `SITE_URL` | `https://` plus your production domain, no trailing slash | **Production only** | No. Defaults to the Vercel production domain |
| `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_PHONE` | The name, postal address and phone shown on the policy pages | Production and Preview | Yes for `LEGAL_NAME`: the build ships `legal/privacy` (since 2026-10-22) and fails without it. The address and phone fill the other policy pages once they ship |

Generate the secret with either:

```bash
openssl rand -hex 32
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Tick **Sensitive** for both secrets, and for `SLACK_WEBHOOK_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `SESSION_SECRET` if you add them, so the
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

curl -s -o /dev/null -w '%{http_code}\n' $BASE/            # 200  home page
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

Vercel's daily cron stays as a backstop. It fires at 01:30 UTC, in slot 00, and each slot sweeps once (5.5): if
the 00:17 run already swept, the backstop answers `skipped` and costs nothing; if that run was missed, the backstop
sweeps instead, and a late GitHub run for slot 00 is then skipped.

1. On GitHub, open the repository's **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret**. Name: `CRON_SECRET`. Value: the same value as `CRON_SECRET` in Vercel.
3. Open the **Actions** tab. If GitHub asks, allow workflows to run. Select the **sweep** workflow.
4. To test it now, choose **Run workflow** on `main`. That is a manual run, so it always sweeps and costs a full
   sweep. The job log ends with the JSON answer (5.2).

If you run your own copy, change the URL at the end of `.github/workflows/sweep.yml` to your domain.

What to expect:

- **A failed sweep fails the job.** A `401`, `500` or `502` answer marks the run failed (red X). GitHub notifies the
  person who last edited the `cron` line in the workflow file. A `skipped` answer is a `200` and shows as passed.
- **Runs can start late.** GitHub started runs 2 h 15 m to 4 h 35 m late on 24 and 25 Oct 2026. Each cron line sends
  the slot it was due for (`X-Sweep-Slot`), so a late run still sweeps as its own slot, up to 12 hours late (T35).
  Every reply from a scheduled call carries `slotAt` and `lateMinutes`, to watch the delay.
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
| 200 | `{"trigger":"scheduled","status":"skipped","reason":"slot … already swept"}` | A scheduled sweep for this slot already started, for example Vercel's backstop after the 00:17 run. Manual calls never get this | Nothing; this stops duplicate scheduled calls |
| 200 | `{"trigger":"scheduled","status":"skipped","reason":"slot 05 not needed: 2 a day"}` | No Pro member's choice needs this slot ([Sweeps a day](#sweeps-a-day-t32)) | Nothing |
| 502 | `{"status":"empty","perCat":{…}}` | All four categories failed; nothing was saved. A scheduled one still uses up its slot, so it isn't retried until the next needed slot | Read `perCat` and see [Troubleshooting](#10-troubleshooting) |
| 500 | `{"error":"ANTHROPIC_API_KEY is not set; …"}` | Key missing in this deployment | Add it (4.3) and redeploy (4.5) |
| 500 | `{"error":"sweep failed: …"}` | Storage or another unexpected error | Read the message; usually storage (see Troubleshooting) |
| 401 | `{"error":"unauthorized"}` | Secret missing or wrong, or `CRON_SECRET` not set in this deployment | Check the value; redeploy after changing it |
| 429 | `{"trigger":"manual","status":"limited","error":"manual sweep limit reached: …"}` | The day's manual runs are used up (5.5). Nothing was run | Wait until 00:00 UTC, or raise `MAX_MANUAL_SWEEPS_PER_DAY` and redeploy |
| 503 | `{"trigger":"manual","error":"couldn't record the manual run; …"}` | Storage didn't accept the manual run's record, so it didn't run | Check storage (see Troubleshooting) |

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
`{"pro":{"due":N,"sent":N,"failed":N,"deferred":N,"emptyForCats":N},"free":{"due":N,"sent":N,"failed":N,"deferred":N,"alreadySent":N},"pending":N,"expired":N,"unreadable":N,"stopped":null}`.
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

| Call | One sweep per slot (T35) | Uses up the slot |
|---|---|---|
| **Scheduled:** the GitHub Actions schedule or Vercel's timer | Skipped if a scheduled sweep for the same slot already started, so a duplicate delivery, or the backstop after the 00:17 run, costs nothing. The slot is the one in `X-Sweep-Slot` (GitHub) if it began under 12 hours ago, else the slot of the time the call arrives (00 for the backstop). A scheduled sweep that saved nothing (`502 empty`) uses its slot too, since it may still be billed | Yes |
| **Manual:** any other call with the secret, such as the `curl` in 5.1 or **Run workflow** | Never skipped: it always sweeps | No, so it never cancels a scheduled sweep |

Manual runs are marked `"manual": true` in the history. Keep in mind:

- **Each manual run costs a full sweep, so there are at most 3 a UTC day.** A call past that answers `429` and runs
  nothing. Set `MAX_MANUAL_SWEEPS_PER_DAY` to change the number; `0` stops manual runs. A run counts when it starts,
  so one that fails still uses one up. Two calls at the same moment can both get through, so treat the limit as
  approximate. With a leaked secret, the most it allows is 8 sweeps a day (one per slot, 5, plus the 3
  manual ones), so keep the Anthropic spend limit in place as the final cap.
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
  "buildCommand": "npm run build:site",
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
| `buildCommand` | Runs `npm run build:site` from `package.json`. The steps live there because Vercel allows `buildCommand` only 256 characters (the deploy fails before building if it's longer). `build:site` copies `index.html`, `about/`, `demo/`, `live/`, `pricing/`, `subscribe/`, `manage/`, `signin/`, `signup/` and the policy pages that are ready (`legal/privacy`, `legal/contact` and `legal/refunds` today; terms waits for its liability clause) into `public/`, then removes the JSX sources. Then `scripts/fill-plan.mjs` fills Pro's price and the rest from `plan.json` (below), and `scripts/fill-legal.mjs` fills the owner's details into the policy pages. It does **not** run `npm run build`. A new page folder must be added to `build:site`, or Vercel won't serve it (`npm run check` tests for `subscribe`, `manage`, `signin` and `signup`). `npm run check` fails if `pricing/` ships without every `plan.json` value it uses, or if `about/` has a gap left. Adding a page also changes the footer on every shipped page (Home · About · Pricing · Contact · Terms · Privacy · Refunds, only the pages that ship; `npm run check` prints the links each page should have). To build locally on Windows, run `npm run build:site --script-shell=bash` |
| `outputDirectory` | Serves `public/` as the static site |
| `crons` | The daily backstop: calls `/api/sweep` at 01:30 UTC (07:00 IST), within the hour on Hobby |
| `functions["api/sweep.js"].maxDuration` | Lets the sweep run for up to 300 s, the Hobby maximum |

The functions are found automatically: every `.js` file in `api/` becomes a route, except files in folders that start
with `_` (so `api/_lib/` is shared code, not a route). `package.json` sets `"type": "module"`, so the functions are ES
modules. `@vercel/blob` is the only runtime dependency.

### `.github/workflows/sweep.yml`

| Setting | What it does |
|---|---|
| Five `cron` lines (`"17 0 * * *"` … `"17 20 * * *"`) | Run at 00:17, 05:17, 10:17, 15:17 and 20:17 UTC, one line per slot so each run knows its slot |
| `workflow_dispatch` | Adds **Run workflow** to the Actions tab. Those runs are manual |
| `X-Sweep-Trigger` header | `scheduled` for the timer, `manual` for **Run workflow**. The server uses it for the one-sweep-per-slot rule (5.5) |
| `X-Sweep-Slot` header | The hour of the cron line that fired (`github.event.schedule`), so a run that starts late still sweeps as the slot it was due for (T35). Empty on manual runs |
| `curl --fail-with-body` | A `401`, `500` or `502` answer fails the job and prints the answer |
| `--max-time 320`, `timeout-minutes: 7` | Waits out the function's 300-second limit |
| `permissions: {}` | The job gets no access to the repository |
| `secrets.CRON_SECRET` | Repository secret with the same value as in Vercel. If it is missing, the job stops with a message saying so |

The URL is written into the file; change it for your own copy or a custom domain.

### `.vercelignore`

Keeps `scripts/`, `.github/`, `docs/` and all `*.md` files (including this one) out of the upload. They are not
needed at runtime. The two scripts the build runs, `scripts/fill-legal.mjs` and `scripts/fill-plan.mjs`, are let
back in.

### `plan.json` (Pro's price, T24)

The one place Pro's price, GST line, refund rule, trial and payment methods are written. Pages never type them;
they use slots that `scripts/fill-plan.mjs` fills at build time, so the pages can't drift apart or from Razorpay.
It isn't secret and isn't served (the build reads it from the repository root).

| Field | What it is | Slot on the pages |
|---|---|---|
| `paid` | `false` while Pro is free and switched on by hand; `true` at go-live (T27) | Switches the blocks below |
| `currency` | `"INR"`, the only one the pages are written for | |
| `monthly`, `yearly` | Pro's price for each billing period, whole rupees, or `null` when that period isn't on sale. There is **one Pro plan** (owner, 2026-10-26): categories and emails a day don't change the price. **While testing, both are ₹1** | `{{PRO_PRICE}}` ("₹1 a month or ₹1 a year", Indian digit grouping), `{{PRO_PRICE_SHORT}}` (the monthly price, else the yearly), `{{PRO_PERIODS}}` ("monthly or yearly") |
| `gst` | The exact line, for example "GST included" | `{{PRO_GST}}` |
| `trialDays` | `0` for no trial, or the days | `{{PRO_TRIAL}}` ("No free trial." or "A 7-day free trial.") |
| `refund` | The one or two sentences of the refund rule | `{{PRO_REFUND}}` |
| `refundDays` | Days a refund takes, as a number | `{{PRO_REFUND_DAYS}}` |
| `methods` | The payment methods switched on in Razorpay, as a list | `{{PRO_METHODS}}` ("cards and UPI AutoPay") |
| `contact` | The address for billing questions | `{{PRO_CONTACT}}` |

`pricing/`, `legal/terms/` and `legal/refunds/` use these slots, so the price and the refund rule read the same on
each (T23 A4).

**The switch.** A page puts the paid wording in `<template data-when="paid">…</template>` and today's wording in
`<!-- when:free-test -->…<!-- /when -->`. With `paid: false` the build drops the first and keeps the second; with
`true` it does the opposite. A `<template>` never renders, so GitHub Pages, which serves `index.html` as it is,
still shows today's text.

**What fails the build.** A shipped page using a slot whose value is `null`; `paid: true` with neither `monthly` nor
`yearly`; a `pricing` block (per-category prices were dropped on 2026-10-26); anything malformed. `npm run check` catches the same things before a merge.

**How Razorpay charges the price (T33).** There is one **₹1 plan per billing period** (monthly and yearly), and each
subscription's `quantity` is the price in rupees: ₹299 a month is the monthly plan × 299. So a price change in
`plan.json` needs no new Razorpay plan. `RAZORPAY_PLANS` maps months to the plan ids: `{"1":"plan_…","12":"plan_…"}`.
A period with no plan there isn't offered for payment.

**Making and checking the plans.** Run this in your own shell, with test keys for the staging Preview and live keys
for Production. `--create` makes the ₹1 plan for every period that has none and prints the `RAZORPAY_PLANS` value
to set in Vercel; without it the script only checks each plan is ₹1, INR, and repeats every period. It prints no key.

```bash
RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… node scripts/check-plan.mjs --create
RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_PLANS='{"1":"plan_…",…}' node scripts/check-plan.mjs
```

Exit `0` is a match, `1` a difference or a failed call, `2` something not set up. Amounts are in paise (₹1 is 100).
Monthly is made as monthly, interval 1; yearly as yearly, interval 1. **Verify** on the first test run that Checkout
shows quantity × ₹1 as the amount.

### Environment variables

| Name | Set by | Used by | Notes |
|---|---|---|---|
| `CRON_SECRET` | You | `/api/sweep` | Vercel sends it as `Authorization: Bearer <value>` on cron calls; the GitHub workflow sends the same value from its repository secret. If it is unset, `/api/sweep` always answers 401 |
| `ANTHROPIC_API_KEY` | You | `/api/sweep` | Sent to the Anthropic API in a header; never returned in a response |
| `RADAR_MODEL` | You (optional) | `/api/sweep` | Claude model ID. Default `claude-haiku-5-5` (`api/_lib/handlers.js`). Must support `effort` (Claude 4.6 or later) |
| `SLACK_WEBHOOK_URL` | You (optional) | `/api/sweep` | Slack incoming webhook. Treat it as a secret: anyone who has it can post to the channel |
| `RESEND_API_KEY` | You (optional) | `/api/sweep`, the subscriber endpoints | Resend API key, sent in a header; never returned in a response. Owner email is sent only when it and `EMAIL_TO` are set |
| `EMAIL_TO` | You (optional) | `/api/sweep`, `/api/confirm`, `/api/account` | Recipients, separated by commas, at most 50. With the default sender, only the Resend account's own address works. Also gets the "Pro request" email. Kept out of the repository and out of every reply |
| `EMAIL_FROM` | You (optional; required for subscribers) | `/api/sweep`, the subscriber endpoints | Defaults to `Travel Problem Radar <onboarding@resend.dev>`, Resend's shared sender, which is enough for the owner's own digest. Subscriber email refuses that default and any `@resend.dev` sender: it needs a sender on a domain verified in Resend |
| `SUBSCRIPTIONS_ENABLED` | You (optional) | The subscriber endpoints, `/api/sweep` | `1` turns sign-up and subscriber delivery on together. Anything else, or unset, means off |
| `SWEEPS_PER_DAY_MIN` | You (optional) | `/api/sweep` | The fewest scheduled sweeps a day, 1 to 5. Default 1. With subscriptions off this is the number; with them on, the site sweeps as often as the most frequent Pro member asks, but never fewer than this. Anything other than a whole number from 1 to 5 means the default. See [Sweeps a day](#sweeps-a-day-t32) |
| `SWEEPS_PER_DAY_MAX` | You (optional) | `/api/sweep`, `/api/account` | The most scheduled sweeps a day, 1 to 5, and the most a Pro member may choose. Default 5. A choice above it is treated as this number and `/manage/` stops offering it. A `SWEEPS_PER_DAY_MIN` above it is lowered to it. This is the cost cap: each sweep is about $0.21 |
| `MAX_SUBSCRIBERS` | You (with subscriptions) | `/api/subscribe` | The cap on records (pending and active). Unset or not a positive whole number means **not set up**: sign-up and Google sign-up answer `503` "subscriptions are not open yet", the same for every address, and nothing is stored. A **full** list keeps the usual sign-up reply, so it looks like any other sign-up. The count is the one the last saved sweep wrote |
| `MAX_CONFIRMS_PER_DAY` | You (optional) | `/api/subscribe` | Emails sign-up sends per UTC day, across all addresses: confirmations and "already subscribed" notices together. Default 10; `0` stops both |
| `MAX_SIGNUPS_PER_IP_HOUR` | You (optional) | `/api/subscribe`, `/api/session` | Sign-up and sign-in requests per client IP per UTC hour, counted together. Default 5; unset or not a positive whole number means 5. Over it the reply is the same and nothing is stored or sent |
| `SESSION_SECRET` | You (for sign-in) | `/api/session`, `/api/confirm`, `/api/account` | Signs the login cookie (HMAC-SHA256). At least 32 characters; shorter counts as unset. Unset means sign-in answers `503`, Confirm sets no cookie, and `/manage/` works only from an email link. Use a different value on Preview and Production. Changing it signs everyone out |
| `MAX_SIGNINS_PER_DAY` | You (optional) | `/api/session` | Sign-in emails per UTC day, across all addresses. Default 50; `0` stops them. Once reached, every sign-in request is told so ("Sign-in emails have hit today's limit"), whatever the address. Separate from `MAX_CONFIRMS_PER_DAY`, so a burst of sign-ups can't stop subscribers signing in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | You (optional) | `/api/session` | The Google OAuth client. With both and `SESSION_SECRET`, the pages show "Continue with Google"; with either unset the button stays hidden and `?action=google` answers `503`. The secret never leaves the server |
| `ADMIN_USER`, `ADMIN_PASSWORD` | You (optional) | `/api/admin` | The owner's sign-in for `/admin/`. The password must be at least 16 characters; shorter, or either unset, means `503`. Both are compared in constant time on the server and never sent back. They also make the admin cookie's signing key, so changing either signs the admin out. Read only by a new deployment |
| `BOARD_PAYWALL` | You (at go-live) | `/api/data` | `1` locks the board: not signed in `401`, Free or lapsed Pro `402`, Pro the data, and every reply `private, no-store`. Anything else, or unset, means off: the replies and their public cache header are as before. Needs `SESSION_SECRET`, or nobody can sign in to see it. Read only by a new deployment |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | You (for paid Pro) | `/api/account`; `/api/razorpay-webhook` (the webhook secret only; without it the endpoint answers `503`) | The Razorpay API keys and the webhook's signing secret. The key id is public: Checkout needs it in the browser. The two secrets never leave the server. Test keys start `rzp_test_`, and test and live are separate in Razorpay, so test plans don't work with live keys |
| `RAZORPAY_PLANS` | You (for paid Pro) | `/api/account` | JSON from billing period in months to its ₹1 Razorpay plan, for example `{"1":"plan_…","3":"plan_…"}` (T33). `check-plan.mjs --create` makes the plans and prints it. Only `plan_…` ids for periods in `plan.json` count; a period without one isn't offered for payment. Replaces `RAZORPAY_PLAN_ID` |
| `RAZORPAY_TOTAL_COUNT` | You (for paid Pro) | `/api/account` | How many **months** a subscription runs before it ends; a whole number of 1 or more. Each subscription gets `total_count` = this ÷ its period, rounded up (12 gives 12 monthly cycles, or 1 yearly). Payments count as on only when this, `RAZORPAY_PLANS` with at least one plan, and the three above are all set; otherwise `/manage/` shows Request Pro and the payment actions answer `503` |
| `RESEND_WEBHOOK_SECRET` | You (optional) | `/api/resend-webhook` | The Resend webhook's signing secret. If it is unset, the endpoint answers `503` and does nothing |
| `SITE_URL` | You (optional) | The subscriber endpoints, `/api/sweep` | Base of the links in subscriber emails. If unset, `https://` plus `VERCEL_PROJECT_PRODUCTION_URL`; **on a Preview**, `https://` plus `VERCEL_BRANCH_URL` instead, never the production domain. With neither, subscriber email is off |
| `LEGAL_NAME`, `LEGAL_ADDRESS`, `LEGAL_PHONE` | You (`LEGAL_NAME` now; the rest once their pages ship) | The build (`scripts/fill-legal.mjs`) | Filled into the `{{LEGAL_…}}` slots of the policy pages at build time, HTML-escaped; a newline in the address becomes a line break. Kept out of the repository so they are not in its history. If `legal/` is built and one is unset, the build fails |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel, automatically | `/api/sweep`, the subscriber endpoints | Builds the "Open the live board" link in the Slack message, and the subscriber links when `SITE_URL` is unset. If it is missing, the Slack link is left out |
| `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` | Vercel, when the store is connected | `api/_lib/storage.js` | Do not set by hand unless running outside Vercel |

### What is stored

All objects live under `radar/` in the private store, one folder per kind of key (since 2026-10-26; before that
every file sat directly in `radar/` as `radar/radar-<key>.json`, and nothing reads those any more). The mapping is in
`api/_lib/storage.js`. Files written over time are named by kind and UTC time, `<kind>-YYYY-MM-DD-HH-MM-…`, so the
Blob browser sorts them by time; records that live on (subscribers, the Razorpay index) and the one-off files are
named without a time. Only the file name carries the dashes: the logical keys keep their compact form
(`radar:event:20261021-080910123-…`). In a file name, anything that is not a letter or digit becomes `-`. A key the
mapping doesn't know is stored under `radar/other/`.

| Logical key | Blob path | Contents | Readable through `/api/data` |
|---|---|---|---|
| `radar:history` | `radar/history/index.json` | Index of saved sweeps (id, time, counts), last 60 | Yes |
| `radar:sweep:<id>` | `radar/sweeps/sweep-YYYY-MM-DD-HH-MM-<id>.json` | One sweep's items | Yes |
| `radar:seenIds` | `radar/history/seen-ids.json` | Up to 800 item IDs already seen, used for the New flag | No |
| `radar:lastScheduled` | `radar/state/last-scheduled.json` | When the last scheduled sweep started, saved or not, and its slot (`{ at, slotAt }`; before T35 just the time); the one-sweep-per-slot rule reads it | No |
| `radar:llmlog:<id>` | `radar/logs/llm-log-YYYY-MM-DD-HH-MM-<id>.json` | One sweep's LLM log: each Claude call's request (prompt, model, limits, tools; never the headers or key) and response (thinking, search queries, answer, stop reason, usage), and a summary of input and output tokens, searches, and the pages search found, **as links only** (page contents are encrypted and left out). Written for every sweep that ran: saved, empty, or not saved. `<id>` is the sweep's id. Deleted after 30 days by the day's first sweep. Read with `scripts/llm-logs.mjs` | No |
| `radar:sub:<id>` | `radar/subscribers/<id>.json` | One subscriber: address, status, plan, token, dates, and chosen categories (`cats`, Pro only). Since T16 also `signin` (the SHA-256 of an unused sign-in code, its expiry and when it was sent; `null` once used) and, optionally, `sessionVer` (raising it by hand signs that subscriber out on every browser). Since T17, a Pro record whose emails stopped has `emailOff`: `unsubscribed`, `bounced` or `complained`. `<id>` is the SHA-256 of the canonical address (Gmail without dots or `+tags`, and `+tags` dropped for the big providers; see [email-signup.md](docs/subscriptions/email-signup.md#flow)). Records made before 2026-10-22 keep the SHA-256 of the lowercased address | No |
| `radar:event:<YYYYMMDD>-<time>-<type>-<random>` | `radar/events/event-YYYY-MM-DD-HH-MM-SS-mmm-<type>-<random>.json` | One sign-up, confirmation, sign-in email, unsubscribe, emails-off, account-deleted, Pro, bounce or complaint event: type, time and plan, **no address or id**. Kept until `prune-events` deletes it | No |
| `radar:deliveries:<YYYYMMDD>` | `radar/deliveries/deliveries-YYYY-MM-DD.json` (one a day, no time) | Record ids already sent that day's Free digest. Deleted by the sweep after 7 days | No |
| `radar:subscriberCount` | `radar/state/subscriber-count.json` | Pending plus active records at the last saved sweep; the sign-up cap reads it | No |
| `radar:iphit:<YYYYMMDDHH>-<16 hex>-<6 hex>` | `radar/ip-hits/ip-hit-YYYY-MM-DD-HH-<16 hex>-<6 hex>.json` (the hour is what the limit counts) | One sign-up attempt: its time only. The 16 hex are from a SHA-256 of the client IP; **the IP itself is not stored**. Deleted by the sweep after 2 hours | No |
| `radar:rzpsub:<subscription id>` | `radar/razorpay/subscriptions/sub-….json` | `{ id }`: the subscriber record a Razorpay subscription belongs to, written at checkout (T20) so the webhook finds the record without listing | No |
| `radar:rzp-event:<YYYYMMDD>-<HHMM>-<event id>` | `radar/razorpay/events/razorpay-event-YYYY-MM-DD-HH-MM-<event id>.json` | One Razorpay event already applied (`{ at }`), so a redelivery changes nothing. `<YYYYMMDD>` is the event's day. Deleted by the sweep after 30 days | No |

`/api/data` allows only `radar:history` and `radar:sweep:<id>`; the tests check that every subscriber key is refused.

### Caching

- `/api/data` success responses carry `cache-control: public, s-maxage=300, stale-while-revalidate=3600`. After a
  sweep, the live page can show the previous sweep for about 5 minutes, sometimes a little longer while the CDN
  refreshes. With `BOARD_PAYWALL=1`, every `/api/data` reply is `private, no-store` instead, so no shared cache
  holds the board.
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
JSON. Open previews in a browser where you are signed in to Vercel. To try sign-up or payments on a preview, see
[Testing payments on Preview](#testing-payments-on-preview).

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
  `sweep {"model":"claude-haiku-5-5","perCat":{"traveler_pain":"5 items",…},"usage":{"input":…,"output":…,"searches":…}}`
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
| Skipped (a slot already swept, or not needed) | Nothing |

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
unchanged. Code: `api/subscribe.js`, `api/confirm.js`, `api/unsubscribe.js`, `api/account.js`, `api/resend-webhook.js` and `api/razorpay-webhook.js`, with the logic in
`api/_lib/subscription-handlers.js`, `api/_lib/subscribers.js` and `api/_lib/subscriber-delivery.js`. Design notes:
[docs/subscriptions/email-signup.md](docs/subscriptions/email-signup.md).

**What a subscriber goes through**

1. `/signup/` ("Create your account") posts the address to `POST /api/subscribe`; it is the one sign-up form.
   `/subscribe/`, which the home page, the live board and the README link as "Get it by email", is the plans page
   and links to it. One inbox holds one subscription: `a.b+x@gmail.com` and
   `ab@gmail.com` are the same subscriber. An address that is already confirmed (or a variant of it) is told it
   already has an account, and its inbox gets a sign-in link (see [Signing in](#signing-in-t16)). Without
   `SESSION_SECRET` it is told "This address is already subscribed" and gets one email with its manage and
   unsubscribe links instead, at most once every 24 hours. A pending address whose confirmation went out in the last 24 hours is told so. Every other
   request gets the same reply ("If that address can be subscribed, a confirmation link is on its way"), so a
   full list, the daily cap and the per-IP limit look alike. (With `MAX_SUBSCRIBERS` unset, sign-up answers "subscriptions are not open yet" instead.) A filled-in hidden field (a trap for bots)
   gets that reply and does nothing.
2. A confirmation email links to `/api/confirm?id=…&t=…`. Opening it shows a **Confirm** button; only pressing it
   (a `POST`) confirms, so a mail scanner that opens links can't sign anyone up. An address not confirmed within 7
   days is deleted by the next sweep. A second sign-up for the same pending address within 10 minutes sends nothing
   and says to ask again after 10 minutes; after that the same link is sent again. One pending address gets at most
   5 confirmation emails, then the reply says a link was already sent several times.
3. **Free:** one email a day, after the first saved sweep of the UTC day (normally 00:17 UTC, about 05:47 IST),
   holding everything saved in the last 24 hours. With `BOARD_PAYWALL=1` it is a **summary** instead: per category
   the count and the headlines, and a Sign in button; no detail or source links (T18). **Pro:** an email after every saved **scheduled** sweep (about 5 a
   day); manual runs send Pro nothing. Pro is switched on by hand for now: see "Handling Pro requests" below.
4. Every email has an Unsubscribe link and a "Manage subscription" link (`/manage/`), plus `List-Unsubscribe` headers
   so mail apps can offer one-click unsubscribe. Unsubscribing deletes a Free record; a Pro account stays, with its
   emails off (see [The locked board](#the-locked-board-t17)). It works even while subscriptions are switched off.
5. Confirming also signs that browser in, and a subscriber can sign in on any browser at `/signin/`: see
   [Signing in](#signing-in-t16).

**What it needs**

- A domain verified in Resend (**Domains → Add Domain**, then its DNS records), and `EMAIL_FROM` set to a sender on
  it. The shared `onboarding@resend.dev` sender can't reach other people, so the code refuses it for subscribers.
- `RESEND_API_KEY` (as for the owner's email).
- `MAX_SUBSCRIBERS`. Without it sign-up answers "subscriptions are not open yet".
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
  "pro": { "due": 1, "sent": 1, "failed": 0, "deferred": 0, "emptyForCats": 0 },
  "free": { "due": 1, "sent": 1, "failed": 0, "deferred": 0, "alreadySent": 0 },
  "pending": 0, "expired": 0, "unreadable": 0, "stopped": null
}
```

- `pro` is `{ "skipped": "manual run" }` for a manual run.
- `pro.emptyForCats` counts Pro subscribers who chose categories that had nothing in this sweep. They are sent
  nothing for it.
- `free.alreadySent` counts subscribers who already had today's digest; later sweeps that day send them nothing.
- `deferred` is anyone not reached this time, because the 240-second deadline passed or sending stopped. They are
  tried again at the next sweep, and nobody gets the same day's Free digest twice.
- `stopped` says why sending stopped early: `quota`, `deadline`, or a Resend error such as `http 401`.

**Turning it off.** Remove `SUBSCRIPTIONS_ENABLED` (or set it to anything but `1`) and redeploy. Sign-up then answers
`503`, confirm and manage links show "Subscriptions are paused", and the sweep sends no subscriber email. Records are
kept, and unsubscribe links still work. Set it back to `1` and redeploy to resume.

**Bounces and spam complaints (Resend webhook, T13).** `POST /api/resend-webhook` takes Resend's `email.bounced` and
`email.complained` events. A hard bounce (`bounce.type` is `Permanent`) or a complaint deletes that address's record
if it is Free or a lapsed Pro. A Pro record is kept with `emailOff` set to `bounced` or `complained`: it keeps the
board and gets no more email. Either way a `bounced` or `complained` event is recorded, with no address. Soft bounces (`Transient`, `Undetermined`) and other
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
4. Check a real bounce: sign up `bounced@resend.dev` (Resend's test address) on `/signup/`. Its confirmation
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

  The same from the command line (the rule is staged, then `publish` makes it live):

  ```bash
  vercel --scope <team> firewall rules add "subscribe rate limit" --project <project> \
    --condition '{"type":"path","op":"eq","value":"/api/subscribe"}' \
    --condition '{"type":"method","op":"eq","value":"POST"}' \
    --action rate_limit --rate-limit-algo fixed_window --rate-limit-window 600 \
    --rate-limit-requests 5 --rate-limit-keys ip --rate-limit-action rate_limit --yes
  vercel --scope <team> firewall publish --project <project> --yes
  ```

  Production has had this rule since 2026-10-22. `vercel firewall status` shows it as `Rules 1 active`.

  The sign-up page shows "Too many tries from your connection. Please try again in a few minutes." on a `429`. The
  rule's traffic shows on the Firewall overview.

### Signing in (T16)

A confirmed subscriber can sign in to the site with a link sent to their email; there are no passwords. Code:
`api/session.js` and `api/_lib/session.js`, with the logic in `makeSessionHandler` in
`api/_lib/subscription-handlers.js`. Design: [paid-website.md](docs/subscriptions/paid-website.md). The board is
locked only while `BOARD_PAYWALL` is on: see [The locked board](#the-locked-board-t17).

**How it works**

1. `/signin/` posts the address to `POST /api/session`. Every address gets the same reply ("If that address has an
   account, a sign-in link is on its way"); only a confirmed subscriber is emailed a sign-in link. Once `MAX_SIGNINS_PER_DAY` is reached, every address gets another reply instead: today's limit is hit, try again after 00:00 UTC or use the Manage link in any digest. An address that
   never pressed Confirm gets its confirmation link again instead, on sign-up's limits (10 minutes apart, 5 per
   address, within `MAX_CONFIRMS_PER_DAY`). The reply also says a new link can be asked for once every 5 minutes. Signing up again at `/signup/` with a confirmed address also sends a sign-in link. The link holds a one-time code
   that works for 15 minutes; the record keeps only its SHA-256.
2. Opening the link shows a **Sign in** button (so a mail scanner that opens links signs nobody in). Pressing it uses
   up the code, sets the login cookie and goes to `/live/`.
3. Pressing **Confirm** in the confirmation email also sets the cookie.
4. `/manage/` opened without an email link uses the cookie, and shows **Sign out**. Opened that way it has no
   Unsubscribe link (the page never gets the token): to unsubscribe, use the link in any digest email. It does
   have **Delete my account** (see [The locked board](#the-locked-board-t17)).

**The cookie.** `tpr_session` holds the subscriber id, an expiry and a version, signed with HMAC-SHA256 using
`SESSION_SECRET`. The signature also covers the record's creation time, so after someone unsubscribes and signs up
again, the old cookie stops working. It holds no address and no plan (the plan is read from the record each time).
`HttpOnly; Secure; SameSite=Lax`, with no `Max-Age`, so it ends when the browser closes; the signed expiry is 12 hours.
A cookie-authenticated `POST` whose `Origin` names another site is refused.

**Limits on sign-in emails.** At most one per address every 5 minutes, at most `MAX_SIGNINS_PER_DAY` a day (default
50), and the sign-up limit of `MAX_SIGNUPS_PER_IP_HOUR` per connection, counted together with sign-ups. Over any of
them nothing is sent; over the daily one the reply says so. Each sign-in email, from `/signin/` or from signing up again, records a `signinsent` event; `stats` counts them.
They come out of the same Resend daily quota as everything else.

**Setting `SESSION_SECRET`.** Make it at random and send it straight to Vercel, so it is never shown or saved:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" \
  | vercel env add SESSION_SECRET --environment preview --sensitive --yes
```

Run it again with `--environment production` for a separate production value, then redeploy. Preview and
production must differ, so a cookie from a preview is no good on production. Sign-in also needs everything
subscriber email needs (above). Until the secret is set, `/api/session` answers `503` and the sign-in page says
sign-in isn't open yet; Confirm and the email links work as before.

**Signing everyone out.** Set a new `SESSION_SECRET` and redeploy: every cookie stops working at once.

### Google sign-in (optional)

"Continue with Google" sits beside the emailed link on the home page popup, `/signup/` and `/signin/`. It stays
hidden until the two variables below are set. Code: `api/_lib/google.js`, with the routes in `makeSessionHandler`;
no new function and no new package. It needs `SESSION_SECRET` and subscriber email set up as above.

**What it does.** The button goes to `/api/session?action=google`, which sends the person to Google (OpenID Connect,
`scope=openid email`, PKCE, and Google asks which account every time). Google sends them back to `/api/session`.
The address Google verified signs in its account or activates a pending one. A new address first sees "Create
your account" (its address, the daily email, the Pro box); pressing Create account makes a Free account that is
active at once, with no confirmation email, under `MAX_SUBSCRIBERS` and `MAX_SIGNUPS_PER_IP_HOUR`, and Cancel
creates nothing. A ticked Pro box records a Pro request for a new or pending account. Then the login cookie is set, as for the emailed link. Only the
address is kept; no Google id, name or token is stored.

**Setting it up** (Google Cloud Console, free). The console's menu names change from time to time, so these are
the settings to look for rather than exact clicks:

1. Create a project, then its OAuth consent screen (the console may call it "Google Auth Platform"): user type
   **External**, app name **Travel Problem Radar**, your support email, authorised domain
   `travel-problem-radar.vercel.app` (or your own domain), and only the `openid` and `email` scopes.
2. Create an **OAuth client ID** of type **Web application**. Authorised redirect URI, exactly:
   `https://travel-problem-radar.vercel.app/api/session` (it is `SITE_URL` plus `/api/session`; change it if you
   move to your own domain).
3. Add the two values in Vercel → Settings → Environment Variables, **Production** only: `GOOGLE_CLIENT_ID`, and
   `GOOGLE_CLIENT_SECRET` with **Sensitive** ticked. Don't paste the secret anywhere else. Redeploy.
4. Publish the consent screen (**In production**). While it is in "Testing", only the test users listed there can
   sign in.

Not confirmed: whether Google asks to verify the app or the domain before it can be published. The site's existing
Search Console verification may cover the domain.

**Checking it.** `GET /api/session?action=me` should include `"google":true`, and the button should show on
`/signin/`. Sign in with a Google address that has no account: you see "Create your account"; press Create account and
you land on `/live/` signed in, and the address is on the list (`node scripts/subscribers.mjs list`). Cancelling at Google shows "Google sign-in was cancelled".

**Turning it off.** Remove either variable and redeploy: the button disappears and the routes answer `503`.

### The locked board (T17)

`BOARD_PAYWALL=1` makes the live board Pro-only. It is **on** in production since 2026-10-23, before checkout
exists, so only accounts given Pro with `grant-pro` read the board. While it is off, `/api/data` and `/live/` behave
as before. Code: `makeDataHandler` in `api/_lib/handlers.js`, and the panels in
`travel-problem-radar.jsx` (rebuilt into `live/radar-live.js`). `/demo/` is never locked.

| Visitor | `/api/data` | `/live/` shows |
|---|---|---|
| Not signed in | `401` | "The board is for Pro members", with **Sign in**, **Create account** and a link to the sample demo |
| Signed in, Free or lapsed Pro | `402` | "The live board is part of Pro", with **Request Pro** (to `/manage/`) and the demo link |
| Signed in, Pro | `200` and the data | The board |

Every reply then carries `cache-control: private, no-store`. The cookie is checked against the record on every
request, read without Blob's CDN cache, so a revoked or deleted account loses the board at once.

**Turning it on**

1. Give your own account Pro first, or the board locks you out too: `grant-pro <your email> --yes` (see
   [Managing subscribers](#managing-subscribers)).
2. Add `BOARD_PAYWALL` = `1` to Production and redeploy. Only a new deployment reads the variable, and a new
   deployment starts with an empty CDN cache, so no public copy of the board outlives the switch.
3. Open `/live/` in a private window: it shows the sign-in panel. Sign in as yourself: the board loads.

To turn it off, delete the variable (or set anything but `1`) and redeploy. `SESSION_SECRET` must be set, or nobody
can sign in. It is set on Production only, so a Preview with the switch on shows every visitor the sign-in panel.

**A Pro account outlives its emails** (live now, whatever the switch says):

- The Unsubscribe link asks a Pro to confirm "You'll stop getting emails. Your Pro account stays". Pressing it sets
  `emailOff: "unsubscribed"` and records an `emailoff` event. A Free account, or a lapsed Pro, is deleted as before.
- A hard bounce or a spam complaint sets `emailOff` to `bounced` or `complained` on a Pro record (see Bounces above).
- Delivery skips every record with `emailOff`. Sign-in emails still go, because the person asked for them.
- `/manage/` shows "Email: off" and why. After an unsubscribe, **Turn emails back on** clears it. After a bounce or a
  complaint the page says to write to pehchanthetraveller19@gmail.com instead, because sending again to an address
  that refused mail hurts the domain. No admin command clears it yet.
- **Delete my account** on `/manage/` (from an email link or signed in) asks once more, then deletes the record,
  records a `deleted` event holding only the plan, and signs that browser out. A paying Razorpay Pro is told to
  cancel first (`409`); there are none until T22.

### Paid Pro checkout (T20)

**Off in production**: none of the `RAZORPAY_*` variables are set there, so `/manage/` shows Request Pro as before.
Payments count as on only when `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`RAZORPAY_PLANS` (at least one plan) and `RAZORPAY_TOTAL_COUNT` are all set (`paymentsReady` in
`api/_lib/subscription-handlers.js`).
No new function: the actions below are on `/api/account`.

With payments on:

- **A confirmed Free account** sees **Upgrade to Pro** on `/manage/`, from an email link or signed in. It opens the
  plan card (T33): categories (all four, just one, or several), emails a day (1 to the cap) and monthly or
  yearly, each with its price from `plan.json`, which `/api/account` sends. Categories and emails don't change it.
  **Pay with Razorpay** loads Razorpay's `https://checkout.razorpay.com/v1/checkout.js` (only then), and
  `action: "checkout"` with `cats`, `sweepsPerDay` and `months` creates a subscription on that period's ₹1 plan
  with `quantity` = the price, the choice in its notes, and the choice stored as `rzp.choice`. Checkout opens;
  Razorpay shows the amount. No email address is sent to Checkout.
- **With payments off**, Free sees **Request Pro**, which opens the same card; **Send my request** stores the choice
  as `proRequest` with the request, and `grant-pro` applies its categories and emails a day. Asking again with
  another choice updates it without emailing the owner again.
- **The first payment** (the webhook's first grant for a subscription) applies `rzp.choice` to the record and
  stores `paidFor` (`sub`, `months`, `price`). After that the member changes categories and emails a day freely
  with **Save changes** (`action: "set-plan"`): the price doesn't depend on them.
- **After paying**, the page sends Checkout's result to `action: "checkout-return"`. The signature is checked with the
  key secret against the subscription id we saved, and the record's `rzp.status` becomes `authenticated`. The page
  **starts Pro at once** (2026-10-26): the signature proves the payment, and a plan that starts now is charged when
  it is approved. First it asks Razorpay for the subscription (`GET /subscriptions/:id`): if its notes name another
  account, or its state is `halted`, `cancelled`, `completed`, `expired`, `paused` or `pending`, Pro waits for the
  webhook as before ("Payment received; Pro starts in a minute or two", and the page checks every 5 seconds for 2
  minutes). If Razorpay can't be reached, the signature is enough. Pro runs to the period end Razorpay reports, or,
  without one, for the months paid for (31 days a month) until the webhook (T21, `/api/razorpay-webhook`) brings the
  real end. The plan chosen at checkout is applied, `paidFor` stored, a `progranted` event recorded, and the page
  says "Payment received. Pro is on". `rzp.lastEventAt` isn't touched, so none of the webhook's events is taken for
  stale; they apply on top as usual.
- **Signing up for Pro** (2026-10-26): pick the plan, confirm the email, pay, and Pro starts. On `/signup/` (paid
  build), ticking "I'd like Pro" shows **Monthly** or **Yearly**; the period goes with the sign-up and is kept as
  `proRequest` (a period not on sale is dropped). Pressing **Confirm** in the email then redirects (`303`) to
  `/manage/?id…&t…&pay=1`, which opens the plan card and, with a period picked that is on sale, **Razorpay's
  Checkout at once**; paying starts Pro there and then (below). Closing Checkout leaves the card open. Without a
  period the card asks for one. Google sign-up with the box ticked goes to `/manage/?pay=1` too (the card asks for
  the period). Without the box, the confirm page offers **Upgrade to Pro** linking there. The email still has to be
  confirmed before paying. The Pro request is counted (`prorequested`), but the owner gets no "Pro request" email
  while payments are on. With payments off all of this is as before (Request Pro, the owner email).
- **A paid Pro** sees "Renews on DATE" and **Cancel at the end of this period** (asked twice).
  `action: "cancel"` asks Razorpay to cancel at the end of the cycle; the account stays Pro until then and the page
  says "Pro until DATE; it won't renew". A Pro given by `grant-pro` has no billing buttons.

| Reply | When |
|---|---|
| `503 payments_off` | Any of the three actions while payments are off |
| `409 not_confirmed`, `already_pro`, `payment_pending` | Checkout for a pending record, a Pro, or one that has paid and is waiting for the webhook |
| `409 not_paid_pro` | Cancel on anything but a Razorpay Pro |
| `409 already_renewed` | Checkout from a cancelled Pro that has already approved a renewal (T34) |
| `400 bad_signature` | Checkout-return with a wrong signature, a different subscription id, or no open checkout |
| `502 payment_provider` | Razorpay refused or didn't answer. The log line holds the error code only |

A second Pay click within an hour, for the same choice, reopens the same subscription instead of making another; a
different choice gets its own. Each new one writes
`radar:rzpsub:<subscription id>` → `{ id }`, which the webhook uses to find the record, and a
`checkoutstarted` event.

**Renewing (T34).** A paid Pro who has cancelled, while the paid period still runs, sees **Keep renewing**. It opens
the plan card; Pay with Razorpay creates a new subscription that starts at `proUntil` (`start_at`), kept as
`rzp.next` until its first charge, which makes it the plan. If the old plan's `cancelled` event arrives first, Pro
holds for 6 hours (`RENEW_GRACE_HOURS`). Cancelling again cancels the renewal at once. A Free member who paid
before sees **Renew Pro** with their last plan filled in (`lastPlan`). A Pro that won't renew (cancelled with no
renewal, its last billing cycle, or owner-granted with an end date) gets one email 7 days before it ends, from
the sweep's delivery step; `endWarning` in the sweep reply counts them, and `endWarnedFor` on the record stops a
repeat. **Verify** on the first test run that Razorpay accepts `start_at` from Checkout and charges then.

**Known gap:** an account that paid, whose Checkout return didn't start Pro (Razorpay's answer named another
account or a stopped state, or the page was closed before it returned) and whose webhook never arrives, stays
`authenticated` and gets `payment_pending` on every Upgrade. See "Paid but still Free" below; there is no admin command for it yet.

**Setting up a test (owner).** Test and live mode are separate in Razorpay: what you make in test mode doesn't
appear in live mode, and each has its own keys ([test and live modes][rzp-modes]). So this plan is only for testing.

1. In the Razorpay dashboard, in **Test Mode**, generate a test key pair. Then make the ₹1 plans with
   `check-plan.mjs --create` and keep the `RAZORPAY_PLANS` value it prints; the full commands are in
   [Creating the Razorpay plans](#creating-the-razorpay-plans).
2. Make a random webhook secret and keep it in your password manager. T21 uses the same one when the webhook is
   added in Razorpay; T20 only needs it set.
3. Choose `RAZORPAY_TOTAL_COUNT` (how many months a subscription runs, for example 12).
4. Add the five variables to **Preview only**, branch `staging` (the key secret and webhook secret marked
   Sensitive), never to Production. The whole Preview setup is in the next section.

To turn payments off again, remove any one of the five variables and redeploy.

[rzp-modes]: https://razorpay.com/docs/payments/dashboard/test-live-modes/
[rzp-subs]: https://razorpay.com/docs/payments/subscriptions/integration-guide/

### Creating the Razorpay plans

`scripts/check-plan.mjs` reads the billing periods from `plan.json` (`monthly`, `yearly`), makes one **₹1** Razorpay
plan for each period that has none yet, checks them, and prints the `RAZORPAY_PLANS` value for Vercel. The plans are
always ₹1 because the price is the subscription's quantity (T33), so changing a price in `plan.json` never needs new
plans. Test and live plans are separate: make each set once, with that mode's keys.

Run it on your own machine from the repository root, with Node 22 or later (no packages needed). The keys are typed
into the shell, never saved in a file, the repository, a chat or a commit. Every value below in `<…>` is a placeholder.

**Test mode (Preview, branch `staging`).** Keys: Razorpay Dashboard → **Test Mode** → **Account & Settings** →
**API Keys** → **Generate Test Key**.

```bash
# Type the keys in: -s hides the secret, and neither goes into shell history or a file
read -r  -p "Razorpay TEST key id (rzp_test_…): " RAZORPAY_KEY_ID
read -rs -p "Razorpay TEST key secret: " RAZORPAY_KEY_SECRET; echo
export RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET

# Create the ₹1 monthly and yearly plans
node scripts/check-plan.mjs --create
```

It prints:

```
check-plan: created the test 1-month plan
check-plan: created the test 12-month plan
check-plan: match (test plans, ₹1 each, for 1, 12 months)
Set this in Vercel as RAZORPAY_PLANS (Preview, branch staging):
{"1":"plan_<monthly id>","12":"plan_<yearly id>"}
```

Check them again with the printed value:

```bash
export RAZORPAY_PLANS='{"1":"plan_<monthly id>","12":"plan_<yearly id>"}'
node scripts/check-plan.mjs
# check-plan: match (test plans, ₹1 each, for 1, 12 months)
```

Set the five variables for Preview, branch `staging` only (each command asks for the value):

```bash
vercel env add RAZORPAY_KEY_ID preview staging
vercel env add RAZORPAY_KEY_SECRET preview staging --sensitive
vercel env add RAZORPAY_WEBHOOK_SECRET preview staging --sensitive   # the secret the Razorpay webhook uses too
vercel env add RAZORPAY_PLANS preview staging                        # the {"1":…,"12":…} line
vercel env add RAZORPAY_TOTAL_COUNT preview staging                  # months a subscription runs, e.g. 120

unset RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_PLANS
```

A webhook secret can be made with `openssl rand -hex 32`. Redeploy `staging` afterwards: variables reach only new
deployments.

**Live mode (Production, at go-live, T27).** After Razorpay approves live activation, the same steps with the live
keys (Razorpay Dashboard → **Live Mode** → **API Keys**). Test plans don't exist in live mode, so the live ones are
made too.

```bash
read -r  -p "Razorpay LIVE key id (rzp_live_…): " RAZORPAY_KEY_ID
read -rs -p "Razorpay LIVE key secret: " RAZORPAY_KEY_SECRET; echo
export RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET
node scripts/check-plan.mjs --create
# Set this in Vercel as RAZORPAY_PLANS (Production): {"1":"plan_<monthly id>","12":"plan_<yearly id>"}

export RAZORPAY_PLANS='{"1":"plan_<monthly id>","12":"plan_<yearly id>"}'
node scripts/check-plan.mjs        # must say: match (live plans, ₹1 each, for 1, 12 months)

vercel env add RAZORPAY_KEY_ID production
vercel env add RAZORPAY_KEY_SECRET production --sensitive
vercel env add RAZORPAY_WEBHOOK_SECRET production --sensitive        # a new secret, not the test one
vercel env add RAZORPAY_PLANS production
vercel env add RAZORPAY_TOTAL_COUNT production

unset RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_PLANS
```

Notes:

- **Run `--create` again** only with `RAZORPAY_PLANS` exported: then it makes plans just for the periods missing.
  Without it, it makes a second set (harmless, but clutter in the dashboard).
- **Without the Vercel CLI**, add the same five in **Vercel → Settings → Environment Variables**, choosing Preview
  with branch `staging`, or Production, and ticking **Sensitive** for the two secrets.
- **Exit codes**: `0` the plans match; `1` a plan differs or Razorpay refused ("Razorpay said 401" means the keys
  weren't accepted); `2` not set up (keys not in the shell, `plan.json` invalid, or no plan id for a period without
  `--create`).

### Testing payments on Preview

A test checkout needs a deployment that can sign people up, send email and take test payments without touching
production's subscribers. Out of the box a Preview can't: it has no subscription, email or session variables, and if
the Blob store is connected to Preview as well as Production, a test sign-up lands in the real list. The setup below
gives Preview its own empty store and turns subscriptions on for **one branch, `staging`**, so other branches'
previews stay inert.

| # | Who | Step |
|---|---|---|
| 1 | Owner, dashboard | **Storage → the production store → its project connection**: untick **Preview** (keep Production and Development), so production's token leaves Preview |
| 2 | CLI | `vercel blob create-store radar-preview --access private -e preview --yes`: a new, empty private store whose token is on Preview only. Then `vercel env ls production` should be unchanged |
| 3 | CLI | Create branch `staging` from `main` and push it. Its preview keeps the same branch URL across deploys, which the webhook needs |
| 4 | CLI | Preview variables for branch `staging` only (`vercel env add NAME preview staging`): `SUBSCRIPTIONS_ENABLED=1`, `MAX_SUBSCRIBERS=5`, `MAX_CONFIRMS_PER_DAY=5`, and a fresh random `SESSION_SECRET` (Sensitive), different from production's |
| 5 | Owner, dashboard | Same scope: `RESEND_API_KEY` (a separate Resend key, Sensitive), `EMAIL_FROM` (the production sender), and the five `RAZORPAY_*` test-mode values |
| 6 | Owner, dashboard | **Settings → Deployment Protection → Protection Bypass for Automation**: generate a secret for Razorpay's webhook (below) and keep it in your password manager |
| 7 | CLI | Redeploy `staging`. Then run `recount --yes` against the preview store (see [Managing subscribers](#managing-subscribers), with the preview store's token in a gitignored env file): a new store has no `radar:subscriberCount`, and sign-up treats a missing count as a full list |

Notes:

- **Links in emails** sent from Preview point at the branch's own URL (`VERCEL_BRANCH_URL`), never production,
  unless `SITE_URL` is set for Preview.
- **Vercel Authentication** still guards the preview, so open it in a browser signed in to Vercel. Email links work
  in that same browser.
- **Google sign-in** stays off on Preview: its variables are Production only and its redirect URI is production's.
  Use the emailed sign-in link.
- **Cron jobs don't run on previews**, so no sweep or daily email goes out from `staging`.

**The test checkout.** On the `staging` URL, sign up at `/signup/` with your own address, tick "I'd like Pro"
and pick Monthly or Yearly; the confirm link must open `staging`. Press Confirm: Razorpay's Checkout opens on
`/manage/` for that plan. (Or, signed up without the box, open `/manage/` and press **Upgrade to Pro**.) Pay with Razorpay's **domestic** subscription
test card 4718 6091 0820 4366, any CVV and a future expiry, and an OTP of 4 to 10 digits ([test cards][rzp-cards]).
The international test card 5104 0600 0000 0008 is refused with "International cards are not supported" unless the
account accepts international cards. The page should say "Payment received. Pro is on" and show **Pro** straight away; the
webhook (see [Razorpay ↔ Vercel](#razorpay--vercel) for its URL and the protection bypass) then sets the real
period end. `show <your email>` against the preview store should then give `plan: "pro"` and `proSource:
"razorpay"`. The payment up to "authenticated" was done this way on 2026-10-23; the whole path, sign-up to Pro, is
still to run. For the pages to show the price instead of "free while it's being tested", set `"paid": true` in
`plan.json` **on `staging` only**, and don't merge that into `main` until go-live (T27).

### Razorpay ↔ Vercel

Three connections, each in its own direction:

1. **Server → Razorpay.** `/api/account` calls `https://api.razorpay.com` over HTTPS to create and cancel
   subscriptions, signing in with `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from that deployment's variables.
   Nothing to allow-list on either side.
2. **Browser ↔ Razorpay Checkout.** `/manage/` loads `https://checkout.razorpay.com/v1/checkout.js` with the public
   key id and the subscription id. After payment, Checkout gives the browser a signature, which the page sends to
   `/api/account` (`checkout-return`) to check with the key secret.
3. **Razorpay → Vercel (the webhook, T21).** Razorpay posts subscription events to a URL on the site. In the Razorpay
   dashboard (**Test Mode** first): **Accounts & Settings → Webhooks → + Add New Webhook**.
   - **URL**, for `staging`:
     `https://<staging branch URL>/api/razorpay-webhook?x-vercel-protection-bypass=<bypass secret>`.
     Vercel Authentication would otherwise answer Razorpay with a login page; the query parameter is Vercel's
     documented way through for services that can't send headers ([protection bypass][vercel-bypass]).
   - **Secret**: the same value as `RAZORPAY_WEBHOOK_SECRET`.
   - **Active events**: under Subscriptions, tick `subscription.authenticated`, `activated`, `charged`, `pending`,
     `halted`, `cancelled`, `completed`, `paused` and `resumed`. Others are answered `200` and ignored.
   - Test mode asks for an OTP when saving; Razorpay documents `754081` for test mode ([webhooks][rzp-webhooks]).
   - Test and live webhooks are separate, like the keys and plans.
   - Razorpay retries any answer that isn't `2xx` for 24 hours, and then **disables the webhook** until you
     re-enable it in the dashboard ([best practices][rzp-webhook-bp]). A changed bypass secret or webhook secret
     does that within a day, so update the URL or the variable at once.
   - A changed variable only reaches the site with a new deployment, so redeploy `staging` after changing
     `RAZORPAY_WEBHOOK_SECRET`.

**What the webhook does.** `POST /api/razorpay-webhook` checks `x-razorpay-signature` (HMAC-SHA256 of the raw body
with `RAZORPAY_WEBHOOK_SECRET`; `401` if wrong, nothing written), finds the record through
`radar:rzpsub:<subscription id>` or the `sid` that checkout put in the subscription's notes, and applies:

| Event | Plan |
|---|---|
| `activated`, `charged`, `resumed` | Pro from Razorpay until the subscription's `current_end`. An owner-granted Pro becomes a paid one |
| `halted`, `paused` | Free at once, for a paid Pro only; an owner-granted Pro is left alone |
| `cancelled`, `completed` | Pro until `current_end`, then Free on its own (Free at once if that is past) |
| `authenticated`, `pending`, others | No change |

Each applied event leaves a `radar:rzp-event:` marker, so a redelivery is a no-op. An event older than the last
one applied is ignored, since Razorpay doesn't promise order. An unknown subscription gets `200` and the log line
`rzp-webhook <event>: unknown subscription`. Only a storage failure answers `500`, so Razorpay retries it. The next
scheduled sweep sends the new Pro its Pro email. Production has no `RAZORPAY_*` variables until T22, so there the
endpoint answers `503`.

**Paid but still Free.** In order:
1. Razorpay dashboard → **Webhooks** → the webhook → its delivery log. No attempts: the event isn't ticked, or the
   webhook is disabled (re-enable it). Attempts with `401` from Vercel's login page: the bypass parameter is wrong
   or was regenerated. `401` `invalid signature`: the webhook's secret and `RAZORPAY_WEBHOOK_SECRET` differ.
   `503`: `RAZORPAY_WEBHOOK_SECRET` isn't set on that deployment. To tell the two `401`s apart from the CLI:
   `vercel logs requests --since 1h --json --query 'requestPath:"/api/razorpay-webhook"'`. A request that reached
   the function has `pathType: streaming_func`; one stopped by Vercel Authentication has none.
2. The function's logs in Vercel: `rzp-webhook activated: plan free -> pro` is a success. `unknown subscription`
   means no record has that subscription as its own (for example, a second checkout replaced it). `stale` means a
   newer event was already applied.
3. `show <address>` with the admin script: `rzp.status`, `rzp.lastEventAt` and `proUntil`.

**Going live (T22).** Live keys, a live plan and a live webhook secret go on **Production only**. The production
domain isn't behind Vercel Authentication, so the live webhook URL needs no bypass parameter.

[rzp-cards]: https://razorpay.com/docs/payments/payments/test-card-details/
[vercel-bypass]: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
[rzp-webhooks]: https://razorpay.com/docs/webhooks/
[rzp-webhook-bp]: https://razorpay.com/docs/webhooks/best-practices/

### Reading the LLM logs

Vercel's Hobby plan keeps function logs for an hour, so each sweep that runs also saves its LLM log in the Blob store
(`radar:llmlog:<id>` in [What is stored](#what-is-stored)), kept for 30 days. The sweep's reply, printed in the
public Actions log, carries only the log's id (`llmLog`) and the page count (`usage.pages`), never the log itself.
Each log costs one Blob write (an advanced operation); old logs are listed for deletion once a UTC day, not every sweep.

`scripts/llm-logs.mjs` reads them on your own machine, with the same `.env.local` token as the subscriber script
below. It is read-only and not deployed.

```
node --env-file=.env.local scripts/llm-logs.mjs list [--days 7]
node --env-file=.env.local scripts/llm-logs.mjs summary <id|latest>
node --env-file=.env.local scripts/llm-logs.mjs show <id|latest>
```

| Command | What it does |
|---|---|
| `list` | One line per sweep that ran, newest first: id, time, outcome, calls that worked, input and output tokens, searches, pages |
| `summary` | One sweep's totals, each category's outcome, tokens, pages and time, then the links of every page search found |
| `show` | The whole log as JSON: every request and response |

The Blob store's browser in the Vercel dashboard (**Storage**, then the store, under `radar/`) lists the log files
too; whether it opens a private file is **not confirmed**.

### Admin dashboard

`/admin/` shows every subscriber with their address, status, plan, type (monthly, yearly or granted by the owner),
price paid, categories, emails a day, sign-up and confirmation dates, Pro end date and billing state (renews,
cancelled, payment retrying or failed). Above the list: counts (Free, Pro, monthly, yearly, renewing, asked for Pro,
emails off), Pro's categories and emails a day, the paid Pro value per month (a yearly price counted as a twelfth),
and a day-by-day table of sign-ups, confirmations, unsubscribes, Pro requests, bounces and Free digests sent (7, 30 or
90 days, UTC). The list can be searched and filtered, and **Download CSV** saves the rows shown. The page isn't
linked from anywhere and isn't indexed.

**Setting it up.** Add `ADMIN_USER` and `ADMIN_PASSWORD` (16 characters or more; a password manager's random one is
best) in Vercel → Settings → Environment Variables, tick **Sensitive** for the password, and redeploy. Nothing goes
in the repository.

**How it signs in.** The page posts the user and password to `/api/admin`, which checks them in constant time and
sets an admin cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, sent only to `/api/admin`, ending when the browser
closes and at most 8 hours later. The cookie is signed with a key made from the user and password, so changing the
password signs every admin browser out. A wrong try waits a second and is counted; after 5 wrong tries from one IP in
a UTC hour the endpoint refuses that IP until the next hour (the counts are kept beside the sign-up counts in
`radar/ip-hits/` and the sweep deletes them). Logs say only "admin login refused" or "admin signed in": no user name,
password, IP or address. A POST from another site is refused (`403`).

**What a load costs.** Each load or Refresh reads every subscriber record and lists the events and delivery files:
3 Blob advanced operations (Hobby allows 2,000 a month) and one simple read per subscriber, plus one per
unsubscribe event in the period. Wrong logins add a list each.

`scripts/subscribers.mjs stats` prints the same day-by-day counts in the terminal; `grant-pro`, `revoke-pro` and
`delete` are still done with the script, not the page.

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
node --env-file=.env.local scripts/subscribers.mjs recount [--yes]
```

| Command | What it does |
|---|---|
| `stats` | Counts now (pending, Free, Pro, Pro ending within 7 days, waiting for Pro) and per UTC day: sign-ups, confirmation emails, already-subscribed notices, confirmations, unsubscribes (Free deleted; Pro only turns emails off), expired, bounced and complained (from the Resend webhook), Pro requests, Free digests sent. Ends with the confirm rate, `confirmed / subscribed`. No addresses |
| `list` | Address, status, plan, `proUntil`, confirmed date, the date they asked for Pro, and `emailOff` (why a Pro's emails are off, or `-`). `--plan requested` lists the active Free subscribers who asked for Pro (the waiting list). A Pro record past its end date shows as `pro (lapsed)`: the sweep treats it as Free |
| `show` | One record without its token |
| `grant-pro` | Only for an active (confirmed) subscriber. Pro with `proSource: owner`, and the Pro request is cleared (the `prorequested` event keeps the history). `--until 2027-01-31` makes Pro run through the end of that UTC day; leave it out for no end date. A past date is accepted and acts as Free. Refuses a paid Razorpay record |
| `revoke-pro` | Back to Free, clearing the end date. Refuses a Razorpay record |
| `delete` | Deletes the record. This is the answer to a deletion request. Event records hold no address or id. The one place the record's hashed id (not the address) can remain is a `radar:deliveries:<date>` file, which the sweep deletes after 7 days |
| `prune-events` | Deletes event records older than N days |
| `recount` | Counts pending and active records and writes `radar:subscriberCount`, as the sweep does. For a store that has never swept (sign-up treats a missing count as full), or after deleting records. Unlike the sweep it doesn't expire old pending sign-ups, so it may count a few more |

Every write only describes what it would change until you add `--yes` (and then exits 0). Exit codes: `0` done,
`1` not found, refused or not applied, `2` bad usage. A granted Pro starts at the next scheduled sweep, because Pro
email goes only with scheduled sweeps. `stats` is where the Phase 2 numbers in
[`docs/subscriptions/pricing.md`](docs/subscriptions/pricing.md) come from.

**Handling Pro requests.** Until payments exist (T19 to T22), Pro is free and switched on by hand. A subscriber asks
for it in one of two places: the "I'd also like Pro" box on `/signup/` (counted only once they press Confirm), or
the "Request Pro" button on `/manage/`, which every digest links to as "Manage subscription" (the link carries their
id and token; `/api/account` answers it and never returns the address). Each request sends one email to `EMAIL_TO`,
subject "Travel Problem Radar: Pro request". It names nobody, so run `list --plan requested` to see who is waiting,
then `grant-pro <email> --yes`. A repeat click sends nothing more, and a failed owner email still records the request.
The subscriber is not emailed when Pro is switched on: their next email after a scheduled sweep is the Pro update.

**Pro categories (T14, T33).** On `/manage/`, a Pro subscriber picks all four, just one, or several categories on the
plan card, with their emails a day, and presses Save changes. The page posts `action: "set-plan"` to `/api/account`
(`set-cats` still works on its own), and the choice is stored on their record as `cats`: `null` means all
four, otherwise a list of category keys. Their Pro emails then hold only those categories, with the counts in the
subject and heading worked out for them. If none of their categories has anything in a sweep, they get no email for
it (`pro.emptyForCats` in the sweep reply). Free subscribers see the plan card only when they ask for or buy Pro,
and always get every category in the daily digest. If Pro ends, the choice stays stored but is ignored, so it applies again if Pro is granted again.
`show <email>` prints it.

### Sweeps a day (T32)

Each Pro member chooses 1 to 5 emails a day on `/manage/` (no choice counts as 2). The GitHub schedule still fires at
all five slots, 00, 05, 10, 15 and 20 UTC, but a scheduled call only sweeps when its slot is needed:

| Sweeps a day | UTC slots |
|---|---|
| 1 | 00 |
| 2 | 00, 10 |
| 3 | 00, 10, 15 |
| 4 | 00, 05, 10, 15 |
| 5 | 00, 05, 10, 15, 20 |

- The site's number is the highest choice among active Pro members with email on, or 1 with none, kept between
  `SWEEPS_PER_DAY_MIN` and `SWEEPS_PER_DAY_MAX`. With `SUBSCRIPTIONS_ENABLED` off it is `SWEEPS_PER_DAY_MIN`.
- A slot that isn't needed answers `200 {"status":"skipped","reason":"slot 05 not needed: 2 a day"}` before any
  Anthropic call. Nothing is saved and nothing is sent.
- If the subscriber list can't be read, the slot runs as if the number were `SWEEPS_PER_DAY_MAX`, and the log says why.
- Slot 00 always runs. The Vercel backstop at 01:30 UTC falls in it.
- Manual runs are not affected.
- Each Pro member gets one email at each of their slots, with every scheduled sweep since their previous slot.

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
very busy times. A second scheduled call for a slot that already swept answers `skipped`, so duplicates cost
nothing, and a late GitHub run still counts as the slot it was due for (T35). A missed run is made up at the next needed slot ([Sweeps a day](#sweeps-a-day-t32)): at most about 5 hours later at 5 a day, up to a day at 1 a day. Around midnight, Vercel's backstop
covers a missed 00:17 run.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/live` or `/demo` (no trailing slash) shows a blank page | Fixed on 22 Oct 2026 and confirmed on production: the page adds the slash itself. If it still happens, the deployment predates the fix, or a cached copy of the old page was served | Use `/live/` and `/demo/`; redeploy. See [Known issues](#known-issues-to-fix-before-or-after-the-first-sweep) |
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
| `/signup/` says "Sign-up isn't open yet" (`503`) | `SUBSCRIPTIONS_ENABLED` isn't `1`, or `RESEND_API_KEY`, a verified-domain `EMAIL_FROM` or a site URL is missing for this deployment | Set them for Production; redeploy (see [Subscriber email](#subscriber-email-optional)) |
| `"subscribers": "not configured"` in the sweep reply | Same as the row above | Same fix |
| Sign-up says the link is on its way, but no confirmation email comes | In order: the spam folder; `MAX_SUBSCRIBERS` reached; `MAX_CONFIRMS_PER_DAY` used up today; more than `MAX_SIGNUPS_PER_IP_HOUR` sign-ups from the same connection this hour. The reply is the same in every case on purpose. (An address already confirmed, or with a link sent in the last 24 hours, gets a reply that says so instead) | Check spam first. Then the `subscribe confirm-email` log line in Vercel (kept about 30 minutes), `stats` for today's confirmation emails, and Resend's **Logs** |
| `/signup/` says "Too many tries from your connection" (`429`) | The Vercel Firewall rule: more than 5 sign-up requests from one IP in 10 minutes | Wait 10 minutes. Many people behind one office or mobile network share an IP; raise the rule's limit if that matters |
| Unsubscribe says "This link is no longer active", but emails keep coming | The link is from an email sent before that address unsubscribed and signed up again. The new record has the same id but a new token, so older links (and Gmail's Unsubscribe button on older emails) change nothing | Use the Unsubscribe link in the most recent email, or `delete <email> --yes` with the admin script |
| Resend's webhook log shows `401` | `RESEND_WEBHOOK_SECRET` isn't this webhook's signing secret (for example after re-creating the webhook), or the server clock and the event's timestamp differ by more than 5 minutes | Copy the secret again from Resend's webhook page; redeploy. Resend retries failed deliveries |
| Resend's webhook log shows `503` | `RESEND_WEBHOOK_SECRET` isn't set for this deployment, or was added without a redeploy | Set it for Production; redeploy |
| Subscriber emails land in spam | A new sending domain has no reputation yet. SPF, DKIM and DMARC are set for `pehchanthetraveller.com` | Mark the emails "not spam"; it usually improves with time. Nothing to change in the code |
| `subscribers.stopped: "quota"`, with `deferred` counts | Resend's daily quota ran out. The owner's email went first | The rest go at the next sweep. If it happens often, see the quota formula in [Subscriber email](#subscriber-email-optional) |
| `subscribers.stopped: "deadline"`, with `deferred` counts | The sweep reached 240 seconds before sending finished | The rest go at the next sweep; nothing is sent twice |
| `free.due: 0` with `alreadySent` above 0 | Today's Free digest has already gone to those subscribers | Expected; the next one goes after the first sweep of the next UTC day |
| `pro: { "skipped": "manual run" }` | Pro email goes only with scheduled sweeps (decision D4) | Expected |
| A Pro subscriber got no Pro email | Pro was granted after the last scheduled sweep; `proUntil` has passed (`list` shows `pro (lapsed)`); or the categories they chose had nothing in that sweep (`pro.emptyForCats` above 0) | Wait for the next scheduled sweep, or grant again. For categories, `show <email>` prints `cats`; they can tick more on `/manage/` |
| A confirm or manage link says "This link isn't valid" | The record was deleted (a Free account unsubscribed, someone pressed Delete my account, or it was pending for more than 7 days), or the mail app cut the link short | Sign up again, or use the links in the most recent email |
| `/subscribe/`, `/signin/`, `/manage/` or `/live/` opened on GitHub Pages | Pages has no `/api/`, so these pages send the visit on to the Vercel copy | Nothing to fix; link to `https://travel-problem-radar.vercel.app/subscribe/` |

---

## Known issues to fix before or after the first sweep

Found while writing this guide (21 Oct 2026). Issue 1 is fixed and confirmed on production; it stays here, under
its number, for the warning at its end. Issue 2 has a fix that still needs one look on production; remove it from
this list once that is done.

### 1. `/live` and `/demo` without a trailing slash rendered a blank page: fixed, confirmed on production

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
GitHub Pages redirect. `scripts/check.mjs` checks both pages have it. **Confirmed on production (22 Oct 2026):**
`/live` and `/demo` opened in a browser end up on `/live/` and `/demo/` and show the board.

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
