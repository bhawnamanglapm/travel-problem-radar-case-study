# TS11 results · API testing

| | |
|---|---|
| Task | [TS11](../TS11-api-testing.md) |
| Run | 2026-10-30, 09:10 UTC; repeated at about 09:50 UTC with the same codes |
| Commit | `d2b9639` (main), deployed to production |
| Environment | Production, read-only: curl with no cookie, no secret and no signature |
| Run by | Claude Code. Only status codes and reply keys are recorded (TS11 rule) |

## Results

| ID | Request | Expected | Result | Evidence |
|---|---|---|---|---|
| API-1 | `GET /api/data?key=radar:history`, no cookie | 401 `not_signed_in` | Pass | 401 `{"error":"not_signed_in"}` |
| API-2 | `GET /api/sweep`, no secret | 401 | Pass | 401 `{"error":"unauthorized"}`. No sweep ran |
| API-3 | `PUT /api/data` | 405 | Pass | 405 `{"error":"read-only"}` |
| API-4 | `GET /api/razorpay-webhook` | 405 | Pass | 405 |
| API-5 | `GET /p/<a real sweep>/<item>` | 200, the shared problem page | Pass | 200 for an item from the 30 Oct 02:27 UTC sweep: the title, its `og:title`, and the signed-out teaser ("Sign in · See Pro", no source link). `/p/123/x` gives 400; a well-formed id that doesn't exist gives 404 |
| API-6 | `GET travel-problem-radar.vercel.app/api/data` | Not redirected | Pass | 401 `{"error":"not_signed_in"}` straight from the vercel.app host, no 3xx. The site root there redirects (307) to the custom domain, as it should (SM-10) |

### Extra probes

| Request | Result | Evidence |
|---|---|---|
| `GET /api/session?action=me`, no cookie | Pass | 200 `{"signedIn":false,"plan":null,"google":true}` |
| `GET /api/admin` and `/api/account`, no cookie | Pass | 401 `not_signed_in` |
| `POST /api/razorpay-webhook` and `/api/resend-webhook`, unsigned `{}` | Pass | 401 (`invalid signature` from Razorpay's) |
| `GET /api/data` with a private key name | Pass | 400 |
| `HEAD` on an API path | Note | 405, as the handlers only allow their methods. Not a defect |
| Any reply body containing an `@` or a key-shaped string | Pass | None in the replies above |
| `Cache-Control` on the data API | Pass | `private, no-store` (the paywall is on) |

**Totals:** API-1 to API-6: 6 Pass. Extra probes: 6 Pass, 1 note.

## Bugs found

None.

## Left to do

| What | Who |
|---|---|
| The offline table-driven test of refused methods and reply bodies (TS11 step 2) | Claude Code |
| Signed-in replies and cookie flags (`HttpOnly; Secure; SameSite`) on production, read from the browser's dev tools | Owner (no real cookie goes in a recorded command) |
| `scripts/smoke.mjs` for API-1 to API-6 (TS11 step 4, optional) | Claude Code, its own PR |
