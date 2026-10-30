# TS17 · Accessibility testing

| | |
|---|---|
| Component | Accessibility testing |
| Who | Claude Code adds automatic checks and fixes; the owner tests by keyboard and screen reader |
| Status | Partial: colour contrast is checked automatically; nothing else is |
| Depends on | TS10 |
| Size | M |
| Unblocks | TS18 |

## What it means here

Checking that people who use a keyboard, a screen reader, zoom, or who see colour differently can use every page
and email. The target is **WCAG 2.2 level AA**. The PRD's accessibility NFR asks for a skip link, visible focus,
small text at AA contrast and a labelled dialog
([prd.md](../02-product-definition/prd.md), from [homepage-review.md](../../docs/site/homepage-review.md)).

## In place today

Read from the repo on `c848b94`:

| Check | How | Where |
|---|---|---|
| Text contrast | Every text colour on every surface passes 4.5:1, in light and dark: 42 pairs each | `check.mjs`, from `brand.css` |
| Labelled dialog | The home page's dialog has `aria-labelledby` | `check.mjs` |
| Filter and save buttons | Built with `aria-pressed` | `check.mjs`, on both bundles |
| Footer nav | `aria-label="Site"` on every page | `check.mjs` |
| Page language | Every page has `<html lang=…>` | Counted: 14 of 14 pages |
| Skip link | **Home page only** (1 of 14 pages) | Counted |

## Gaps

1. **Skip link on 1 page of 14.** The NFR asks for one; the other 13 pages have none.
2. No keyboard-only or screen-reader test on record.
3. No automatic check beyond contrast and a few attributes: names on buttons and inputs, heading order, `alt` text,
   focus order in the dialogs and the Razorpay checkout.
4. Emails aren't checked: their contrast, reading order, and whether they make sense with images off.
5. The board's state changes (filters, search results, "New") may not be announced to screen readers.

## The work

1. **Automatic scan.** axe DevTools (free browser extension) on every page in the TS10 table, signed out and signed
   in, light and dark. Record each issue in TS19 with its WCAG rule.
2. **Keyboard only.** On each page, unplug the mouse:
   - Tab reaches every link, button and field, in a sensible order.
   - The focus ring is always visible.
   - Esc closes a dialog and focus returns to what opened it.
   - The board's filters, search, save and detail panel all work with Enter and Space.
   - The Razorpay checkout can be completed (on staging, test card).
3. **Screen reader.** NVDA (free) with Chrome or Firefox on Windows, on home, demo, live, sign-up, sign-in, manage and
   pricing. Check that each page's headings make an outline, that buttons say what they do, and that errors and
   results are read out.
4. **Zoom and reflow.** 200% zoom, and 320 px wide: nothing cut off, no sideways scroll for text.
5. **Emails.** For each email in TS10: contrast, real text (not images of text), a sensible order, links with words
   that say where they go, and the unsubscribe link reachable.
6. **Fixes, each its own PR:**
   - a skip link on every page, and a `check.mjs` rule that every page has one (gap 1);
   - `aria-live` for the board's result count, if step 3 shows it isn't read;
   - whatever steps 1 to 5 find.
7. **Statement.** Once the fixes are in, a short accessibility note on the about page: the target (WCAG 2.2 AA), what's
   known not to meet it, and how to report a problem. Its wording is for the owner.

## Done when

- axe shows no serious or critical issue on any page.
- The keyboard and NVDA runs are recorded, with every failure fixed or logged.
- Every page has a skip link, and `check.mjs` checks it.
- The emails pass step 5.

## Tools and cost

- axe DevTools (free extension), NVDA (free), Chrome DevTools and Lighthouse's accessibility audit: free.
- axe DevTools and NVDA are allowed under the test plan's rules (free, nothing added to the repo). **Ask first**
  before adding a package such as `@axe-core/cli` to the repo.

## Risks and notes

- Automatic tools find only some problems (they can't judge, for example, whether a label makes sense). The
  keyboard and screen-reader runs are the real test.
- The counts include `subscribe/index.html`, which visitors don't reach since `/subscribe/` redirects to `/pricing/`.
- Razorpay's checkout is theirs. Log an issue there as a known limit, not a bug of ours.
- Don't claim WCAG conformance anywhere until this task is done.
