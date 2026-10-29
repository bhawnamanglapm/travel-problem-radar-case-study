# T41 · Pro email: choose areas as well as categories

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T37 (`areaOf` and the area list) |
| Unblocks | — |

> Added 2026-10-29, from a comparison with Mindtrip (mindtrip.ai), which tailors results to where you travel. The
> comparison was read from public write-ups; Mindtrip's site didn't render in a headless browser.

## Why

Pro members can already choose categories for their email (T14, T33). A member who builds for travellers in Asia gets
every European and American problem too. T37 gives each item an area, so the email can be narrowed the same way.

## What to build

- **Manage page.** An "Areas" card under Categories: "All areas" (the default) or a choice of T37's areas. It is
  stored as `areas: null | [...]` on the record, checked like `normaliseCats`
  ([subscribers.js:205](../../../api/_lib/subscribers.js#L205)), and saved with a new `/api/account` action
  `set-areas`. Free sees it disabled, as with categories.
- **Delivery.** Pro email keeps an item when its category is chosen and `areaOf(item.region)` is a chosen area.
  Global items are always kept (owner decision O2). `proCatsKey`
  ([subscriber-delivery.js:73](../../../api/_lib/subscriber-delivery.js#L73)) becomes a key over both, so members
  with the same choice still share one send. A member whose choice has nothing in a sweep gets no email, counted in
  the reply as `pro.emptyForCats` is today.
- **Unchanged.**
  - The Free teaser keeps every area.
  - The price doesn't change (owner decision O6).
  - The owner's own digest is unchanged.
- **Wording.** `/pricing/` and the terms page mention that Pro can choose areas.

## Verify at build time

- More groups mean more batch calls per sweep. Count the groups with the current members' choices and check the sweep
  still fits its delivery deadline (`SUBSCRIBER_DEADLINE_MS`) and Resend's rate limit.

## Acceptance criteria

- [ ] A Pro member with Asia chosen gets Asian and Global items only, in the chosen categories
- [ ] "All areas" gives exactly today's email (byte for byte in a test)
- [ ] Members with the same categories and areas share one send
- [ ] Free can't set areas (`402`), and the Free teaser is unchanged
- [ ] Docs: pricing and terms pages, TECHNICAL.md, CHANGELOG.md

## Tests

In `scripts/test-subscriptions.mjs`: `set-areas` validation, the delivery filter with and without areas, Global
always kept, grouping by the combined key, and the unchanged email for "All areas".
