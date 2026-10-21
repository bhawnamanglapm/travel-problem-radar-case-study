# T03 · HTTP helpers: body reader, HTML pages, method checks

| | |
|---|---|
| Phase | 1a, foundations |
| Who | Developer |
| Size | S |
| Depends on | — |
| Unblocks | T05, T06, T07, T17, T18 |

## Why

The two existing endpoints only answer `GET` with JSON. The new ones read form or JSON bodies, and the confirm and
unsubscribe links answer with a small HTML page. Shared helpers keep these consistent and testable.

## What to build: `api/_lib/http.js`

| Export | What it does |
|---|---|
| `sendJson(res, code, body)` | Move `send()` from `handlers.js` here unchanged (`no-store`), and import it back into `handlers.js` |
| `bearerOk(header, secret)` | Move from `handlers.js`, unchanged; the webhook and admin code may reuse the constant-time pattern |
| `readBody(req, { limit = 8192 })` | Return the raw body as a string. Use `req.body` if the platform already parsed it (string, Buffer or object; see Verify), otherwise read the stream. Refuse more than `limit` bytes with a typed error so the caller answers `413` |
| `parseForm(raw, contentType)` | `application/json` → object; `application/x-www-form-urlencoded` → object from `URLSearchParams`; anything else → `{}` |
| `sendPage(res, code, { title, body })` | A minimal HTML page: `<!doctype html>`, charset and viewport metas, inline styles matching `live/index.html`, `content-type: text/html; charset=utf-8`, `cache-control: no-store`, `x-robots-tag: noindex`, `referrer-policy: no-referrer` (links carry tokens; this stops them leaking to other sites through the Referer header) |
| `esc(s)` | HTML escape, the same as in `email.js` (move it here and import it there) |
| `allowMethods(req, res, list)` | Answer `405` with an `allow` header and return `false` if the method isn't listed |

Pages never echo back anything from the request except through `esc()`.

## Acceptance criteria

- [ ] `handlers.js` and `email.js` import `sendJson`, `bearerOk` and `esc` from `http.js`; their behaviour and the
  68 existing tests are unchanged
- [ ] `readBody` handles a pre-parsed object, a string, a Buffer and a stream, and stops at `limit`
- [ ] `sendPage` sets all four headers above

## Tests (in `test-subscriptions.mjs`)

- `parseForm` for JSON, form-encoded, an unknown type and malformed JSON (→ `{}`, no throw)
- `readBody` on a fake stream of 9,000 bytes with the default limit raises the "too large" error
- `sendPage` with a title of `<script>` returns escaped HTML and the four headers

## Verify at build time

- How Vercel's Node.js runtime exposes the body for a plain `(req, res)` function: whether `req.body` is parsed
  automatically, and whether the raw stream can still be read afterwards. The Razorpay webhook (T18) needs the
  **exact raw bytes**; if the platform only gives a parsed body, T18 must find another way (see that task)

## Out of scope

- CORS. Every caller is a same-origin page; send no CORS headers, so other sites can't post from a browser.
