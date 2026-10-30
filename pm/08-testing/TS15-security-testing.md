# TS15 · Security testing

| | |
|---|---|
| Component | Security testing |
| Who | Claude Code reviews the code and adds tests; the owner checks the dashboards (Vercel, Razorpay, GitHub) |
| Status | Partial: strong offline tests of auth and signatures; no review written down, no headers, no dependency audit recorded |
| Depends on | TS11 |
| Size | L |
| Unblocks | TS20 |

## What it means here

Checking that nobody can read what isn't theirs, act as someone else, spend the owner's money, or change records
without the right key. For this product that means:
- **Secrets:** the Anthropic, Resend, Razorpay, Blob and session keys never reach the browser or the repo (REQ-09,
  REQ-17).
- **Who can do what:** the sweep, the admin page, Pro data, and each member's own account.
- **Money:** only Razorpay's signed webhooks can turn Pro on.
- **Our own app only.** Vercel, Razorpay, Resend, Google and Anthropic are out of scope, apart from how we use them.

The GitHub repo is public, so every line of code is readable by anyone. Security can't rely on the code being
hidden.

## In place today

Read from `api/_lib` on `c848b94`:

| Control | How | Where |
|---|---|---|
| Sweep needs the secret | `Authorization: Bearer` compared in constant time; 401 without | `http.js` |
| Manual sweeps capped | 429 after `MAX_MANUAL_SWEEPS_PER_DAY` (default 3) a UTC day | `handlers.js` |
| Data feed reads only radar keys | `ALLOWED_KEY`; with `BOARD_PAYWALL=1`, 401 signed out and 402 for Free | `makeDataHandler()` |
| Session cookie | `HttpOnly; Secure; SameSite=Lax`, signed (HMAC), 12 hours (`SESSION_HOURS`), no `Max-Age` so it ends with the browser; `MIN_SECRET_LENGTH` 32 | `session.js` |
| Cross-site requests | `originOk()`: a cookie-authenticated POST with an `Origin` header must come from the same host | `session.js` |
| Emailed sign-in | Link valid 15 minutes (`SIGNIN_MINUTES`), stored only as a hash, compared in constant time; one every 5 minutes; 50 a day across all addresses; the same reply whether or not the address has an account | `subscription-handlers.js` |
| Passwords | scrypt; 10 wrong tries an hour per IP and per account, then 429 | `password.js`, `subscription-handlers.js` |
| Google sign-in | Signed state cookie, 10 minutes, `Path=/api/session` | `google.js` |
| Admin | Off unless a user and a password of 16+ characters are set; 5 wrong tries an hour per IP, then 429; a one-second wait on each failure; cookie `SameSite=Strict`, `Path=/api/admin` | `admin.js` |
| Razorpay webhook | HMAC-SHA256 signature checked in constant time; 401 if wrong; duplicate events ignored for 30 days | `razorpay.js`, `subscription-handlers.js` |
| Resend webhook | Svix-style signature, a timestamp within 300 s, 64 KB body cap | `subscription-handlers.js` |
| Key mismatch | A test key on Production or a live key on a Preview turns payments off (T22) | `keyMismatch()` |
| Sign-up abuse | 5 sign-ups an hour per IP (default); sign-up emails capped at 10 a day for the whole site (default `MAX_CONFIRMS_PER_DAY`); at most 5 confirm emails to one pending address in its 7 days | `subscription-handlers.js`, `subscribers.js` |
| Escaping | Server pages and emails go through `esc()`; the board renders through React, whose only raw HTML is its own CSS | `http.js`, `travel-problem-radar.jsx` |
| Secrets in the repo | `npm run check` fails on a committed key | `check.mjs` |

Most rows have offline tests in `test-subscriptions.mjs`, `test-admin.mjs`, `test-password.mjs` and
`test-sweep.mjs`.

## Gaps

1. **No security headers.** `vercel.json` sets none. The code sets `referrer-policy` on two kinds of page only. There's
   no `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` (or `frame-ancestors`), or
   `Strict-Transport-Security` set by us.
2. **Dependency audit not recorded.** There are 4 packages (`@vercel/blob` at run time; `esbuild`, `react`,
   `react-dom` at build time), but no `npm audit` result is on record.
3. **The AI's output is trusted as data.** The sweep reads web pages through the model. A page could carry text
   aimed at the model (prompt injection), so a title, summary or link could be wrong or hostile. Escaping stops
   script injection, but not a misleading link or text.
4. **`/api/sweep` doesn't check the method** (TS11). A GET with the secret runs a sweep. Low risk, since the secret is
   needed, but worth a decision.
5. **No written review**, so nobody can see what was checked and when.
6. **Repo history.** No record of a scan of the whole git history for secrets.
7. **Test data in production.** Two test-mode subscriptions count as paid Pro in production until they lapse (T27).
   Not a breach, but a sign the key checks came after the first payments.

## The work

1. **Checklist review** (OWASP Top 10, made concrete). Write the result in a table at the end of this file:

| Area | Check |
|---|---|
| Access control | Every endpoint in TS11 refuses the wrong person: signed out, Free on Pro data, another member's account, not admin |
| Crypto | Every secret comparison is constant time; every signed value has an expiry |
| Injection | Every value from a request or the AI that reaches HTML goes through `esc()` or React; no `innerHTML` with data |
| Design | Every action that costs money (sweep, email, payment) has a cap |
| Misconfiguration | Headers (gap 1); `vercel.json` redirects and rewrites expose nothing extra |
| Components | `npm audit` (step 2) |
| Auth | Session, sign-in link, password, Google and admin rules as in the table above, each with a test |
| Integrity | Webhooks signed and de-duplicated; key mismatch tested |
| Logging | No addresses, codes or keys in logs (tested) or error replies |
| SSRF | No endpoint fetches a URL a user gives |

2. **`npm audit`** (read-only, free). Record the result and fix anything high or critical. **Ask first** before
   upgrading a package.
3. **Headers.** Propose a `headers` block in `vercel.json`: `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, and a `Content-Security-Policy` that
   allows the Razorpay checkout and Google sign-in. Test on the `staging` Preview first, since a wrong CSP breaks
   checkout. Add a `check.mjs` rule that the block is present. Its own PR.
4. **Prompt-injection guard.** Proposal, for the owner: check each item's link is `https:` and drop any other scheme;
   cap the length of each field; show the source's domain next to each link. A code change, its own PR, with offline
   tests using a hostile fake response.
5. **History scan.** Run `git log -p` through a pattern search for key shapes (`sk-ant-`, `rzp_live_`, `re_`,
   `whsec_`), locally. Report only whether anything was found, never the value. If something is found, rotate the key
   first.
6. **Decide on `/api/sweep` methods** (gap 4): allow POST and GET only, or POST only. If it changes, the GitHub
   Actions curl and the Vercel cron must still work.
7. **Dashboards** (owner): GitHub secret scanning and Dependabot alerts on; Vercel env vars set per environment (test
   keys on Preview only); Razorpay webhook secret set.

## Done when

- The checklist table is filled in with a date, and every "no" has a fix or a decision.
- `npm audit` shows no high or critical issue, or each is decided.
- Headers are live on production and checkout still works.
- The history scan is done and the result recorded.

## Tools and cost

- `npm audit`, `git log`, browser DevTools: free.
- GitHub secret scanning and Dependabot on a public repo: free.
- Scanners such as OWASP ZAP are free but a new install. **Ask first.** Never scan production without the owner's
  yes, and never scan anything we don't own.

## Risks and notes

- Never put a key, code or address in this file, a PR or a bug, even a test one.
- A CSP that's too strict breaks Razorpay or Google sign-in in production. Always test on staging first.
- The prompt-injection guard reduces risk; it doesn't remove it. TS16's human check of items is part of the defence.
