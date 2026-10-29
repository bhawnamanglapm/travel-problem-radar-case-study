# T40 · Share one problem, with a preview card

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T36 (Share sits in the detail panel) |
| Unblocks | — |

> Added 2026-10-29, from a comparison with Mindtrip (mindtrip.ai), where trips and places can be shared with a link.
> The comparison was read from public write-ups; Mindtrip's site didn't render in a headless browser.

## Why

Sharing a problem today means sharing the board's address, which a non-Pro friend can't open. A link to one problem,
with a preview that WhatsApp or LinkedIn can show, lets members pass on what they found and brings the site visitors
who see what Pro holds.

## What to build

- **Link.** "Share" in the T36 panel. On phones it uses `navigator.share`; elsewhere it copies the link and says
  "Link copied". The link is `/p/<sweepId>/<itemId>`.
- **Page.** `vercel.json` rewrites `/p/:sweep/:item` to a new `api/item.js`, which renders the page on the server with
  `sendPage` ([http.js:111](../../../api/_lib/http.js#L111)). Check the function count against the plan's limit before
  adding it. If it's too close, route it through an existing function instead.
  - Open Graph and Twitter card tags: title (the headline), description (category · region · date), the site's image.
  - `noindex` by default (owner decision O4).
  - Ids are checked against the same patterns as `/api/data` before anything is read.
- **What each visitor sees (owner decision O3).**
  - Everyone: the headline, category, source name, region, date and severity. That matches what the free teaser
    email already gives away (T18, `buildDigestEmail` with `teaser`).
  - A signed-in Pro member also sees the summary, the opportunity and the source link, plus "Open on the board"
    (`/live/#p=<id>`).
  - Everyone else sees "The full problem is part of Pro", with Sign in and the pricing link.
- **Missing items.** A sweep older than the 60 kept shows "This problem is no longer on the board", with `404`.
- **Pages.** The page loads nothing from another site, like the other server pages, and uses the brand colors
  through `light-dark()`.

## Acceptance criteria

- [ ] A shared link shows a preview in WhatsApp and LinkedIn (checked by hand, noted in the PR)
- [ ] Signed out and Free: only the fields listed above are in the HTML, including the meta tags
- [ ] Pro: the full fields and "Open on the board"
- [ ] A bad id gives `400`, a missing one `404`, and neither reads more than one sweep
- [ ] The page has `noindex` and loads nothing from another site
- [ ] Docs: DEPLOYMENT.md (the route), TECHNICAL.md, CHANGELOG.md

## Tests

In `scripts/test-subscriptions.mjs`: the page for signed out, Free and Pro (the summary and opportunity absent unless
Pro), the Open Graph tags, bad and missing ids, and no `@` in the HTML (the server-page rule).
