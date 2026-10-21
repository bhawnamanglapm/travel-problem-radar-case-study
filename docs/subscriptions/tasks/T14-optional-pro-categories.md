# T14 · Optional: Pro subscribers choose categories

| | |
|---|---|
| Phase | 1d, after launch, **only if the owner picks it in D6** |
| Who | Developer |
| Size | M |
| Depends on | T12. Easiest after T17 (the manage page); otherwise needs its own small preferences page |
| Status | **Built** on 2026-10-22 (owner's choice). Offline tests pass. It uses the existing `/manage/` page and `/api/account`, so there is no `/api/preferences`. Not yet seen in a real inbox |

## Why

[pricing.md](../pricing.md) lists "choose categories" as a Pro feature. Since the board is public, Pro sells
convenience and personalisation, not access. This is one of the few Pro features besides frequency.

## What to build

- **Record:** `cats` holds `null` (all) or a non-empty subset of the four category keys from `CATS` in
  `api/_lib/radar.js` (`traveler_pain`, `gov_policy`, `web_app`, `industry`). Reject unknown keys.
- **Preferences page:** a form on the manage page (T17), or until then `GET /api/preferences?id&t` showing four
  checkboxes and `POST` to save. Only `effectivePlan === "pro"` can save; Free sees a note that it's a Pro feature.
- **Delivery (T09):** at the single place where a recipient's items are chosen, filter `problems` by `cats`. The
  counts in the subject and heading are recalculated per recipient, so the body is no longer built once for the
  whole group. Build once per distinct `cats` set instead (at most 15 sets).
- **Empty result:** if a Pro subscriber's categories have nothing in this sweep, send nothing to them, and count
  them as `emptyForCats`.
- **Pro lapses to Free:** keep `cats` stored but ignore it, so it comes back if they renew.

## Acceptance criteria

- [x] A Pro subscriber with `cats: ["gov_policy"]` gets only Gov & policy items, with correct counts
- [x] Free subscribers always get every category
- [x] Unknown category keys are refused when saving
- [x] Bodies are built once per distinct set, not once per recipient

## Tests

- Filter, recount, empty-for-cats skip, Free ignores `cats`, lapsed Pro ignores `cats`, unknown key refused, save
  refused for Free

## Docs

- The tiers table in pricing.md (mark it built), DEPLOYMENT.md, and the page copy on `/subscribe/`

## Built

The criteria above are ticked on the offline tests only. None has been seen in a real inbox yet.

- **Saving:** `POST /api/account` with `action: "set-cats"` and a `cats` list. `normaliseCats` (`api/_lib/subscribers.js`)
  puts the keys in `CATS` order and drops repeats, and stores all four as `null`. An empty list, an unknown key or a
  non-list gets `400`, Free or lapsed Pro gets `403 pro_only`, and pending gets `409`. The account view includes
  `cats`.
- **Delivery:** Pro recipients are grouped by category set (`proCatsKey` in `api/_lib/subscriber-delivery.js`). Each
  group gets one body from `buildDigestEmail(..., { cats })`, which shows only those sections and names them. The
  "all" group keeps the old idempotency key `<sweep id>-pro`, so a retry around the deploy can't send twice. Other
  sets use `<sweep id>-pro-<keys>`. After a quota or deadline stop, the remaining groups are deferred, not tried.
- **Page:** a Categories card on `/manage/`. `check.mjs` requires its four checkbox values to match `CATS`, in order.
