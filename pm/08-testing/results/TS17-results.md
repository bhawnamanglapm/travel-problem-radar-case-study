# TS17 results · Accessibility testing

| | |
|---|---|
| Task | [TS17](../TS17-accessibility-testing.md) |
| Run | 2026-10-30, about 09:30 UTC |
| Commit | `d2b9639` (main) |
| Environment | Offline: the 14 built pages in the repo, read by a Node script (no new package). Google PageSpeed API |
| Run by | Claude Code |

## Static scan of the built pages

A script read each page's HTML and counted what can be judged without a browser. The board pages (`/demo/`, `/live/`)
are drawn by React, so their headings and landmarks can't be judged this way.

| Check | Result | Evidence |
|---|---|---|
| `lang` on `<html>` | Pass | 14 of 14 |
| Images have `alt` | Pass | No `<img>` on any page |
| Every input has a label | Pass | 0 unlabelled, across 44 inputs on 5 pages |
| No empty buttons | Pass | 0 |
| One `h1`, no skipped heading levels | Pass | 12 static pages: one `h1` each, no level jumps. `/demo/` and `/live/`: drawn by React, not judged |
| A `<main>` landmark | Pass (static pages) | 12 of 12; `/demo/` and `/live/` get theirs from React, not judged |
| A skip link on every page | Fail: BUG-011 | 1 of 14 (`index.html`). The other 13 have none |
| Colour contrast | Pass | `npm run check`: 42 pairs in each theme |

## Results

| ID | Check | Result | Evidence |
|---|---|---|---|
| A11Y-1 | axe DevTools on every page, both states and themes | Needs owner | Needs a browser. The PageSpeed API (which runs the same rules through Lighthouse) answered 429: quota used up |
| A11Y-2 | Keyboard only | Needs owner | Needs a browser |
| A11Y-3 | NVDA on 7 pages | Needs owner | Needs NVDA and a person |
| A11Y-4 | 200% zoom and 320 px reflow | Needs owner | Needs a browser |
| A11Y-5 | Emails | Needs owner | Needs the inboxes |
| A11Y-6 | Skip link on every page, plus a `check.mjs` rule | Fail: BUG-011 | See the scan above |
| A11Y-7 | The static checks above | Pass | 7 of 8 static checks pass |

**Totals:** 1 Pass (the static scan, 7 of 8 checks), 1 Fail (BUG-011), 5 Needs owner.

## Bugs found

BUG-011: no skip link on 13 of 14 pages. Proposed S3. See [TS19 results](TS19-results.md).

## Left to do

| What | Who |
|---|---|
| Add a skip link to the 13 pages and the `check.mjs` rule (BUG-011) | Claude Code, its own PR |
| axe, keyboard, NVDA, zoom and email checks (A11Y-1 to A11Y-5) | Owner, or Claude Code for axe and keyboard once a browser is connected |
| The accessibility statement on the about page, after the fixes | Owner words it |
