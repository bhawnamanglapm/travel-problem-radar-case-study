# TS15 results · Security testing

| | |
|---|---|
| Task | [TS15](../TS15-security-testing.md) |
| Run | 2026-10-30, 09:00 to 09:50 UTC |
| Commit | `d2b9639` (main), deployed to production |
| Environment | Offline (code, `npm audit`, git history) and production, read-only (curl) |
| Run by | Claude Code. No key, token or address is written here; the history scan reports found or not found only |

## Checklist (TS15 step 1)

| Area | Check | Result | Evidence |
|---|---|---|---|
| Access control | Every endpoint refuses the wrong person | Pass (signed out) | Signed out: `/api/data` 401, `/api/sweep` 401, `/api/admin` 401, `/api/account` 401 ([TS11](TS11-api-testing-results.md)). Free on Pro data, another member's account and not-admin are covered offline (`test-subscriptions`, `test-admin`); on production they need test accounts |
| Crypto | Constant-time secret comparison; signed values expire | Pass | `timingSafeEqual` is used in 8 `api/_lib` modules (admin, google, http, password, razorpay, session, subscribers, subscription-handlers). Expiry of links and sessions is tested offline |
| Injection | Request and AI values reach HTML only through `esc()` or React | Pass | The board is React; its one `dangerouslySetInnerHTML` is the static CSS. `admin/index.html` builds tables with `innerHTML` but passes every text value through `esc()`; the unescaped values are server-computed numbers. Note: the admin CSV export quotes cells but doesn't neutralise a leading `=`, `+`, `-` or `@` (spreadsheet formula injection). Owner-only and low risk; worth a line if the CSV is ever opened in Excel |
| Design | Every action that costs money has a cap | Pass | Manual sweeps capped at 3 a day (REQ-32, 429 on the 4th); email has one switch and a cap (REQ-18); delivery stops before the time limit (REQ-16) |
| Misconfiguration | Security headers; `vercel.json` exposes nothing extra | Fail: BUG-010 | On `/`, `/pricing/`, `/signin/` and `/live/` the only security header is `Strict-Transport-Security: max-age=63072000` (Vercel's default). No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` or `frame-ancestors`, or `Referrer-Policy`. The rewrites in `vercel.json` expose nothing extra |
| Components | `npm audit` | Fail: BUG-009 | 4 high, 1 moderate, across 61 dependencies. High: `zod` below 4.6.6 (memory exhaustion), reached through `@vercel/cli-config`, `@vercel/oidc` and `@vercel/blob`, a runtime dependency; npm's suggested fix moves `@vercel/blob` from 2.8.2 to 2.4.0, a major-version change. Moderate: `esbuild` 0.24.2 or older (the dev server only; fixed in 0.28.2). Nothing was upgraded (ask first) |
| Auth | Session, link, password, Google and admin rules each tested | Pass | Offline: `test-password` 56 checks, `test-admin` 49, `test-subscriptions` 1,048, all passing. Live: `/api/session?action=me` gives `signedIn:false` with no cookie |
| Integrity | Webhooks signed and de-duplicated; key mismatch tested | Pass | Unsigned POSTs to both webhooks give 401 on production; de-duplication and key mismatch are tested offline |
| Logging | No addresses, codes or keys in logs or error replies | Pass | 30 Actions logs read: 0 email addresses. Error replies on production carry only an error word |
| SSRF | No endpoint fetches a URL a user gives | Pass | Server fetches go only to Anthropic, Resend, Google, Razorpay and the Slack webhook from env. None takes a URL from a request |

## Other steps

| ID | Check | Result | Evidence |
|---|---|---|---|
| SEC-2 | `npm audit` recorded | Done | See Components above |
| SEC-3 | Headers block proposed and tested on staging | Not run | Needs a code change and staging; its own PR (BUG-010) |
| SEC-4 | Prompt-injection guard (https links only, field caps, show the domain) | Not run | A proposal for the owner; its own PR |
| SEC-5 | Git history scan for key shapes | Pass | `git log -p --all` searched for `sk-ant-`, `rzp_live_`, `whsec_`, Resend `re_` keys and `vercel_blob_rw_`: none found. `rzp_test_` matched 6 lines, all in `test-admin`, `test-password` and `test-subscriptions`, all short placeholders (12, 14 and 22 characters), not real key ids |
| SEC-6 | `/api/sweep` methods | Needs owner | The handler doesn't check the method, so any method reaches the secret check; without the secret, GET and POST both give 401 on production. A decision for the owner |
| SEC-7 | Dashboards: GitHub secret scanning and Dependabot; Vercel env per environment; Razorpay webhook secret | Needs owner | Needs the owner's dashboards |

**Totals:** checklist 8 Pass, 2 Fail (BUG-009, BUG-010). Other steps: 1 Pass, 1 Done, 2 Not run, 2 Needs owner.

## Bugs found

BUG-009 (`npm audit` high findings) and BUG-010 (missing security headers), both proposed S3. See
[TS19 results](TS19-bug-reporting-and-retesting-results.md).

## Left to do

| What | Who |
|---|---|
| Decide how to clear the `zod` finding (wait for a `@vercel/blob` release, or an `overrides` entry) | Owner decides; Claude Code tests it |
| The `headers` block in `vercel.json`, tested on staging first because a wrong CSP breaks checkout (BUG-010) | Claude Code, its own PR |
| The prompt-injection guard (SEC-4) | Owner decides; Claude Code builds |
| SEC-6 and SEC-7 | Owner |
