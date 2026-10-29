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

## What was built

- **Route.** `vercel.json` rewrites `/p/:sweep/:item` to `/api/data?page=item&sweep=:sweep&item=:item`.
  `makeDataHandler` (`api/_lib/handlers.js`) sends `page=item` to `itemPage()` before its `key` check; the JSON
  feed is unchanged. No new function, so `api/` stays at 10 of the Hobby plan's 12.
- **Ids.** The sweep id must match `/^\d{10,16}$/` and the item id `/^[a-z0-9_-]{1,40}:[a-z0-9-]{0,60}$/`
  (`cat.key + ":" + slug(title)`; the category keys have `_`, as in `gov_policy`). Either one wrong gives `400`
  "This link isn't valid", with nothing read.
- **One read.** `radar:sweep:<sweepId>`, through the cached store `/api/data` already uses for sweeps. A missing
  sweep, or an item not in it, gives `404` "This problem is no longer on the board", with a link to `/live/`. A
  storage failure gives `502`. Only after the item is found is the session read (`readSession`, fresh accounts
  store) and the plan checked (`effectivePlan`).
- **The page.** `sendPage` with a new optional `meta` list for head tags; the other server pages are unchanged.
  - Everyone: the headline, then a card with category, severity, source name, region and date.
  - A signed-in Pro: also the summary, "Opportunity:", "Read the source" (`rel="noopener noreferrer"`) and "Open on
    the board" (`/live/?all=1#p=<id>`).
  - Everyone else: "The full problem is part of Pro: the summary, the opportunity and the source", with Sign in
    (`/signin/`) and See Pro (`/pricing/`).
  - Every page ends with one line on what the site is, linking home.
  - `noindex` (header and meta tag) and `no-store`, as on every `sendPage` page. Nothing from another site, and
    nothing about the visitor on the page or in the logs.
- **Head tags.** `og:type` article, `og:site_name`, `og:title` (the headline), `og:description` (category · region ·
  date), `og:url`, `og:image` (`/og.png`, with width, height and alt), `twitter:card` `summary_large_image`,
  `twitter:title` and `twitter:description`. They're built from the teaser fields only, so they're the same for every
  visitor and a link preview never shows the summary. Without a site URL (`SITE_URL` or Vercel's), `og:url` and
  `og:image` are left out and the card is `summary`.
- **The preview image.** `og.png` (1200×630, 59 KB): the brand green, the radar mark, the name, a tagline and the
  domain. It's rendered once with headless Chrome from `scripts/og-card.html` (the command is in the file), copied by
  `build:site`, and also named as `og:image` on the home page.
- **The board.** "Share" in the T36 panel's top row, before the Save star (on the live board only).
  - The link is `<origin>/p/<sweepId>/<encodeURIComponent(id)>`, with the problem's own sweep: the shown sweep, the
    item's sweep on All saved sweeps (T38), or the saved entry's sweep on the Saved tab (T39).
  - On a phone (`navigator.share` and a coarse pointer) it opens the share sheet with the title and the link;
    cancelling says nothing. Elsewhere it copies the link and shows "Link copied" for 4 seconds (`role=status`). If
    copying is refused, the note shows the link as selectable text.
  - The button says "Share: <title>" to screen readers.

### Changes from the task as written

- **No `api/item.js`.** The task asked to check the function count first and route through an existing function if
  it was close. It was 10 of 12, so the page goes through `/api/data`, which already has both stores it needs.
- **A new image.** "The site's image" didn't exist: the home page had no `og:image`, and the only icon is an inline
  SVG, which WhatsApp and LinkedIn don't show. So `og.png` was made. To use another image, replace the file.
- **"Open on the board" adds `?all=1`.** `/live/#p=<id>` only opens items in the latest sweep. All saved sweeps
  opens it from any kept sweep.
- **Share is in the panel only,** not on every card, and isn't shown in the demo, which has no share pages.

### Blob cost

Counted from the code. A view is one simple read for the sweep (through the cached store) and, when the visitor
sends a session cookie, one more for the account. No writes or lists, so no advanced operations. A bad id reads
nothing. Each link-preview crawler fetch is a view too.

## Acceptance criteria

- [ ] A shared link shows a preview in WhatsApp and LinkedIn (checked by hand, noted in the PR). Not checked yet:
  owner step, paste a link in each after deploy. The tags are checked by the tests and on the Preview
- [x] Signed out and Free: only the fields listed above are in the HTML, including the meta tags
- [x] Pro: the full fields and "Open on the board"
- [x] A bad id gives `400`, a missing one `404`, and neither reads more than one sweep
- [x] The page has `noindex` and loads nothing from another site
- [x] Docs: DEPLOYMENT.md (the route), TECHNICAL.md, CHANGELOG.md

## Tests

In `scripts/test-subscriptions.mjs`: the page for signed out, Free and Pro (the summary and opportunity absent unless
Pro), the Open Graph tags, bad and missing ids, and no `@` in the HTML (the server-page rule).
