# T18 · Free email becomes a teaser

| | |
|---|---|
| Phase | 2a, paid website ([paid-website.md](../paid-website.md)) |
| Who | Developer |
| Size | S |
| Depends on | T17 |
| Unblocks | T22 |
| Status | done (2026-10-23). `BOARD_PAYWALL` is on in production, so Free gets the summary from the first daily email after deploy |

## Why

Once the board is paid, a free email with every finding would give away what Pro sells. The owner chose a teaser:
Free keeps a daily email, with counts and headlines only and a link to sign in. Pro emails don't change.

## What to build

- **`buildDigestEmail()`** (`api/_lib/email.js`) gets `teaser: true`: per category, the number of findings and
  their headlines; no detail and no source links; a "Sign in to see everything" link to `/signin/`. The plain-text
  part matches.
- **Delivery** (`api/_lib/subscriber-delivery.js`): Free recipients get the teaser **only when `BOARD_PAYWALL` is
  on**; otherwise the full daily roll-up as today. Pro unchanged.
- The subject line says it's a summary, so readers aren't surprised by the shorter email.

## Acceptance criteria

- [x] Switch off: the Free email is unchanged
- [x] Switch on: the Free email has counts and headlines, no detail, no source link, and a sign-in link
- [x] Pro emails are the same with the switch on and off

## Tests

- The teaser's HTML and text hold no detail and no URL except the site's own; Free with the switch on and off; Pro
  unchanged

## Docs

- email-signup.md and pricing.md: what Free gets (the draft terms already describe it)
- Decided 2026-10-23 (owner): headlines for all four categories ([paid-website.md](../paid-website.md), open
  question 3)
