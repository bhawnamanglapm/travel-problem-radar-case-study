# TS11 · API testing

| | |
|---|---|
| Component | API testing |
| Who | Claude Code (developer, automation) |
| Status | Partial: every endpoint is tested offline; nothing runs against a deployment |
| Depends on | TS05 |
| Size | M |
| Unblocks | TS13, TS15 |

## What it means here

Testing each endpoint on its own: the methods it accepts, who may call it, the replies and status codes for good
and bad input, and its limits. The endpoints are the files in [api/](../../api/). Each is a factory from `api/_lib`
given real storage, so the offline suites test the same code with fakes.

## In place today

Read from the handlers on `c848b94`. "Offline tests" names the suite.

| Endpoint | Methods | Who may call | Replies besides 200 | Offline tests |
|---|---|---|---|---|
| `/api/sweep` | Any; GitHub Actions and Vercel cron send GET | `CRON_SECRET` bearer; the `X-Sweep-Trigger` and `X-Sweep-Slot` headers say scheduled or manual | 401 no secret; 500 no model key; 429 manual cap (3 a UTC day); 503; scheduled slots nobody chose are skipped | test-sweep |
| `/api/data` | GET only | Only the history, search and sweep keys (`ALLOWED_KEY`). With `BOARD_PAYWALL=1`, a Pro session. `?page=item`, the shared problem page, is open to all, with the full text for Pro only | 405; 400 key not allowed; 401 `not_signed_in`; 402 `pro_only`; 404; 502 storage unavailable | test-sweep, test-subscriptions |
| `/api/subscribe` | POST | Anyone | 400 bad input; 413 too large; 500; 503 not open | test-subscriptions |
| `/api/confirm` | GET shows a button; POST confirms | The link holder | 404 invalid link | test-subscriptions |
| `/api/unsubscribe` | GET shows a button; POST unsubscribes (one-click) | The link holder | 200 for an old or invalid link, changing nothing. Free is deleted; Pro keeps the account with email off | test-subscriptions |
| `/api/account` | GET; POST with an action: `cancel`, `checkout`, `checkout-return`, `delete-account`, `email-on`, `request`, `save`, `unsave`, `set-areas`, `set-cats`, `set-freq`, `set-password`, `remove-password`, `set-plan` | A signed-in session or a manage link | 400, 401, 402, 403, 404, 409, 413, 502, 503 | test-subscriptions, test-password |
| `/api/session` | Actions: `me`, `google`, `google-signup`, `password`, `signout` | Anyone; sign-in is rate-limited | 401, 403, 429, 503 | test-subscriptions, test-password |
| `/api/admin` | GET, POST | `ADMIN_USER` and `ADMIN_PASSWORD` (16 characters or more); same origin | 503 when not set; 429 after 5 wrong tries an hour per IP | test-admin |
| `/api/razorpay-webhook` | POST only | Razorpay's signature | 405; 503 not configured or key mismatch; 401 invalid signature; 400 malformed body | test-subscriptions |
| `/api/resend-webhook` | POST only | Resend's signature | 405; 503 not configured; signature checked | test-subscriptions |

**Cookies set**

| Cookie | Attributes |
|---|---|
| `tpr_session` | `Path=/; HttpOnly; Secure; SameSite=Lax` |
| Admin | `Path=/api/admin; HttpOnly; Secure; SameSite=Strict` |
| Google sign-in state | `Path=/api/session; HttpOnly; Secure; SameSite=Lax` |

The client IP for limits is read from `x-vercel-forwarded-for`, then `x-forwarded-for`, then `x-real-ip`.

## Gaps

1. **No contract in one place.** The table above is the first. Replies' JSON shapes aren't written down, so a change
   to a field name is caught only if a test reads that field.
2. **No check against a deployment.** Routing (`vercel.json` rewrites such as `/p/:sweep/:item` to
   `/api/data?page=item`), the custom-domain redirect that skips `/api/`, and real headers are tested only by use.
3. **Method checks** aren't tested for every endpoint (for example, PUT and DELETE everywhere). `/api/sweep` doesn't
   check the method at all; that's harmless behind the secret, but should be a decision, not an accident.
4. **No test that each error reply holds no address, token or key** for every endpoint (REQ-17 is tested for the
   main ones).

## The work

1. **Keep the table above current**, and add each endpoint's reply shape (the JSON keys, not values).
2. **Offline, add a table-driven test** in `test-subscriptions.mjs` or a new `test-api.mjs`. For each endpoint:
   - every method it refuses gets 405 (or what the handler sends);
   - no reply body, on any status, contains an `@`, a token or a key-shaped string.
3. **A read-only check against a deployment**, run by hand after a deploy (TS13 uses it):

| ID | Request | Expected |
|---|---|---|
| API-1 | `GET /api/data?key=radar:history` with no cookie | 401 `not_signed_in` (the paywall is on: REQ-24) |
| API-2 | `GET /api/sweep` with no secret | 401 |
| API-3 | `PUT /api/data` | 405 |
| API-4 | `GET /api/razorpay-webhook` | 405 |
| API-5 | `GET /p/<a real sweep>/<item>` | 200, the shared problem page |
| API-6 | `GET travel-problem-radar.vercel.app/api/data` | Not redirected (API paths skip the domain redirect) |

   These change nothing and cost nothing. Each is one `curl` or a browser address bar.
4. **Later, optional:** script API-1 to API-6 as `scripts/smoke.mjs` (see [TS13](TS13-smoke-testing.md)), as its own
   PR.

## Done when

- The table holds every endpoint with its reply shape.
- The table-driven offline test is in `npm test` and passes.
- API-1 to API-6 have been run once against production, read-only, with results recorded.

## Tools and cost

- `curl` (in Git Bash) or a browser: free.
- No Postman or other API tool is needed. One is free to use but stores requests in its cloud; **ask first** if
  wanted.

## Risks and notes

- API-2 calls the sweep endpoint without a secret. It must stay without one: with the secret it would run a sweep
  and spend.
- Never put a real session cookie or secret in a recorded command. Record the status code and the reply's keys only.
