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

## What was built

- **The record.** `normaliseAreas` in `api/_lib/subscribers.js`, beside `normaliseCats`. The choices are T37's
  `AREAS` without Global: Asia, Europe, North America, Latin America, Middle East & Africa, Oceania and Other. It
  needs a non-empty list of known names with no repeats, keeps `AREAS` order, and stores all seven as `null`.
  `newPending` sets `areas: null`; an older record without the field reads as `null` (all areas). The choices come
  from a function, `areaChoices()`, because `radar.js` and `subscribers.js` import each other.
- **The account API.** `set-areas` on `/api/account`, a copy of `set-cats`: `409` before confirmation, `403
  pro_only` for Free or a lapsed Pro (who keeps what they chose), `400 unknown area`, then a save with the Pro
  re-check. `set-plan`, the card's one Save, takes an optional `areas`: missing keeps the stored value (so an older
  page can't wipe it), `null` means all. The account view returns `areas`.
- **Delivery.** Pro members are grouped by categories, areas and emails a day (`cats|areas|f`), so members with the
  same three choices share one email and one `sendBatch` call. A problem is kept when its category is chosen and
  `areaOf(region)` is Global or a chosen area. A choice with nothing in a sweep sends nothing and counts in
  `pro.emptyForCats`. `proAreasKey` gives `all` or the chosen areas' slugs joined with `+`
  (`asia+middle-east-africa`); with areas the idempotency key gets `-a-<key>` before `-f<n>`, and with all areas
  it's unchanged. The longest areas part is 67 characters.
- **The email.** `buildDigestEmail` takes `areas`. When some are chosen, a line under "Your categories" reads
  "Your areas: Asia, Europe, plus worldwide problems", in the text and the HTML (escaped). With all areas there's
  no line.
- **The manage page.** An Areas section in the plan card, between Categories and Emails a day: All areas, or Choose
  areas with seven boxes, and the note "Worldwide problems always come." It's editable only on a Pro member's own
  card; when paying, renewing or asking for Pro it's shown disabled with "You can choose areas once Pro is on."
  Nothing ticked blocks Save with "Pick at least one area." The summary and the Saved message name the areas
  ("all four categories in Asia and Europe (plus worldwide), 2 emails a day").
- **Unchanged.** The Free teaser, the owner's digest, the price, checkout and the Razorpay webhook.

### Changes from the task as written

- **Free gets `403 pro_only`, not `402`.** `set-cats`, `set-freq` and `set-plan` already answer `403 pro_only`, and
  the manage page handles that code. Same refusal, same code.
- **Other is a box you tick.** It holds problems whose place wasn't recognised. Only Global is always kept (O2);
  choosing Asia alone drops Other.
- **Areas aren't carried through checkout or a Pro request.** A new Pro starts on all areas and chooses on the
  account page once Pro is on.
- **Saved with `set-plan`** as well as the new `set-areas`, because the card has one Save button.
- **Not in this task, done after:** the admin page shows areas (a card, a column and a CSV field). `scripts/subscribers.mjs show` prints them too (it prints
  the whole record but the token).

### Groups and the deadline

The number of Pro groups can't be more than the number of Pro members, and no one has areas when this deploys, so
the first sweeps send exactly as before. Each new group is one more `sendBatch` call, which already handles a `429`
and stops at `SUBSCRIBER_DEADLINE_MS` (240 s), deferring the rest.

## Acceptance criteria

- [x] A Pro member with Asia chosen gets Asian and Global items only, in the chosen categories
- [x] "All areas" gives exactly today's email (byte for byte in a test)
- [x] Members with the same categories and areas share one send
- [x] Free can't set areas (`403 pro_only`, see the changes above), and the Free teaser is unchanged
- [x] Docs: pricing and terms pages, TECHNICAL.md, CHANGELOG.md (and the privacy page and DEPLOYMENT.md)

## Tests

In `scripts/test-subscriptions.mjs`: `set-areas` validation, the delivery filter with and without areas, Global
always kept, grouping by the combined key, and the unchanged email for "All areas".
