# T08 · `/subscribe/` page, links, build step and checks

| | |
|---|---|
| Phase | 1b, sign-up flow |
| Who | Developer |
| Size | M |
| Depends on | T05, T06, T07 |
| Unblocks | T12 (launch) |

## Why

Visitors need a page to sign up from, and the board and case study need to link to it. The page must work on
Vercel, where the API is. GitHub Pages serves the case study too but has no `/api/`, so links from there must point
at Vercel.

## What to build

### `subscribe/index.html`

A single self-contained file: no bundle, inline CSS and a short inline script. That avoids the trailing-slash bug
in DEPLOYMENT.md's Known issue 1, where `/live` loads its script from the wrong path.

- Title: "Get the Travel Problem Radar digest"
- What you get, as a small two-column table:
  - **Free:** one email a day, after the first sweep of the UTC day (about 05:47 IST), with everything found in the
    last 24 hours (if D2 keeps the roll-up)
  - **Pro:** an email after every sweep, about 5 a day. "Pro isn't open for sign-up yet." (Phase 2 changes this
    line.)
- An email field (`type="email"`, `autocomplete="email"`, `required`), a **Subscribe** button, and the honeypot:
  an input named `website`, hidden with CSS (off-screen, not `display:none`), `tabindex="-1"`,
  `autocomplete="off"`, with a label telling screen-reader users to leave it empty.
- The script posts JSON to `/api/subscribe` (absolute path) and shows the reply's `message` in an `aria-live`
  region. Without JavaScript, the form posts form-encoded data to the same endpoint, which answers JSON. That's
  acceptable as a fallback; note it.
- Privacy note, near the button: "We store your email address and the dates you subscribed and confirmed. We use it
  only to send this digest. Unsubscribing deletes it." Plus a contact address (**OWNER INPUT NEEDED**).
- The AI notice used on the live page: "Gathered by an AI model with web search. Items are not verified."
- Styling consistent with `live/index.html`, readable at phone width.
- If the endpoint answers `503`, show "Subscriptions aren't open yet."

### Links

| File | Link |
|---|---|
| `live/index.html` | Add `<a href="../subscribe/">Get it by email</a>` to the existing nav (next to "Sample demo") |
| `index.html` (case study, served by GitHub Pages and Vercel) | Absolute: `https://travel-problem-radar.vercel.app/subscribe/`. A relative link would open a page on GitHub Pages whose form can't reach the API |
| `README.md` | A row in the top table, once launched (T12) |

Hold the links back (or keep them on a branch) until launch in T12. The page can be deployed earlier; with
`SUBSCRIPTIONS_ENABLED` off it just says sign-ups aren't open.

### Build and checks

- `vercel.json` `buildCommand`: add `subscribe` to the `cp -r` list:
  `cp -r index.html demo live subscribe public/`
- `scripts/check.mjs`, new checks:
  - `subscribe/index.html` exists, posts to `/api/subscribe`, has a field named `email` and one named `website`,
    and contains the privacy note
  - the page has no external script or stylesheet URLs (self-contained)
  - `vercel.json`'s `buildCommand` copies `subscribe`
  - if `index.html` links to the subscribe page, it uses the absolute Vercel URL

## Acceptance criteria

- [ ] `/subscribe/` and `/subscribe` (no slash) both render and work on a preview deployment
- [ ] The form works with and without JavaScript
- [ ] The honeypot is invisible and skipped by keyboard and screen readers
- [ ] Phone width: no horizontal scroll
- [ ] `npm run check` passes with the new checks

## Tests

- `npm run check` additions above
- By hand on a preview, with `SUBSCRIPTIONS_ENABLED` **off**: the page loads, the form shows "Subscriptions aren't
  open yet", the layout works on a phone.
- **Don't switch subscriptions on for Preview while the production Blob store is connected to Preview** (DEPLOYMENT.md
  4.2 allows that connection). A preview's `/api/subscribe` would then write real records into the production store.
  The full sign-up, confirm and unsubscribe round trip is tested on production in T12's staged launch, with the page
  not yet linked from anywhere. To test on Preview instead, first connect a separate Blob store to Preview only.

## Out of scope

- A shared design system with the board. Match its look by hand.
