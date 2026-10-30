# T42 · India focus: India items in every sweep call, and India as its own area

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | T37 (`areaOf` and the area list), T41 (areas in Pro email) |
| Unblocks | RM-38 (decide on a 5th, India-only call) |

> Added 2026-10-30 at the owner's request: "I want that India specific things are also focused much". The owner
> chose to cover both the findings and the audience, and to add India items to each category call rather than run a
> separate India call.

## Why

The radar asks for problems "from sources anywhere in the world". In the last 10 sweeps before this task (26 to 30
Oct), 2 of 190 items shown (1.1%) were placed in India (`node --env-file=.env.local scripts/llm-logs.mjs areas
--days 7`). India was one place name inside Asia, so a member could not choose it, and no PM doc named India as a
market or an audience.

## What to build

- **The prompt.** Keep "up to 5" items from anywhere. Add up to 2 more about India, only where real ones from the
  last 60 days exist, and say to return none rather than stretch. Their `region` is "India". Name the kinds of
  Indian source to search: DGCA, the Ministry of Civil Aviation, IRCTC and Indian Railways, Indian airlines and
  online travel agencies, and Indian news and consumer forums. No new output fields, so `normalize`, `dateSources`
  and the 60-day drop work unchanged. The server prompt and the component's stay the same text.
- **One more search a call.** `scanCategory`'s `maxSearches` goes from 3 to 4.
- **India as an area.** "India" goes in `AREAS` after "Asia", and India's place names move from Asia to India,
  with the big Indian cities and states. Text that names India and elsewhere in Asia is Asia, not Global. The
  admin page's and the manage page's area lists follow.
- **Members who chose areas.** A stored list with Asia was saved when Asia included India, so it is read with India
  too. Nothing in production is rewritten.
- **A way to measure it.** India's share of the items shown, by area, from the LLM logs (KPI-20).

## What was built

- **The prompt** in `buildPrompt` (`api/_lib/radar.js`) and its copy in `travel-problem-radar.jsx`, as above. The
  web search tool gets `max_uses: 4`.
- **The areas block** in both files: `AREAS` has 9 entries, India after Asia. Asia's names lose `india`, `delhi`,
  `new delhi`, `mumbai` and `goa`; India's names add Bharat, the big cities (Bengaluru, Chennai, Kolkata,
  Hyderabad, Pune and others, with their older names) and states and territories such as Kerala, Rajasthan,
  Ladakh and the Andamans. `areaOf` drops India when Asia is also found, so "India and Nepal" and "South Asia" are
  Asia, and "Mumbai" and "Bengaluru, India" are India.
- **Stored areas.** `readAreas(record)` in `api/_lib/subscribers.js`: a list without `areasV` that has Asia and not
  India reads with India added. `set-areas` and `set-plan` now store `areasV: 2` (`AREAS_V`), so a list saved
  since is read as it is. The account view, delivery (the filter and the idempotency key) and `/admin/` read
  through `readAreas`. A member who chose Asia before this keeps getting Indian items, keyed as Asia and India.
- **The pages.** An India checkbox after Asia on `/manage/`; India in `/admin/`'s area names. `npm run check`
  compares both lists with `AREAS`. Bundles rebuilt.
- **The measure.** `node --env-file=.env.local scripts/llm-logs.mjs areas [--days 7]`: the items each sweep showed
  (a failed call's items and a dropped item left out), placed by `areaOf` as on the board, one line per area, then
  India's share and India items a sweep. Read-only.

### Changes from the plan

- **`llm-logs.mjs areas`, not a new `scripts/india-share.mjs`.** It reuses the log reading `models` already has.
- **The baseline is 1.1%, not 2.6%.** The plan's count matched any region that mentioned India (5 of 190). Placed
  by `areaOf`, two of those ("India/Europe", "Saudi Arabia / India") name two areas and count as Global, and one
  ("South Korea (Indian passport holders)") is Asia. The command's count is the one the board and emails use.
- **`compare-models.mjs` follows production.** It has no search setting of its own, so it now runs 4 searches;
  its test was updated.

## Cost

Each call may now run 4 searches instead of 3. A search costs $0.01, and the pages it returns are billed as input
tokens ([costing.md](../costing.md)); up to 8 more items a sweep also add output. That is up to 4 more searches a
sweep plus their pages. The real change is **not measured**: a week after this is live, `llm-logs.mjs models`
gives the cost per sweep to compare with the $0.1121 baseline (10 Haiku sweeps, 26 to 30 Oct).

## Acceptance criteria

- [x] The prompt asks for up to 2 India items only where real ones exist, with region "India", and both copies match
- [x] Each call allows 4 searches
- [x] India is its own area; "Mumbai" is India, "India and Nepal" is Asia, "Japan" is still Asia
- [x] A Pro member's Asia choice from before T42 gets Indian items; one saved since doesn't
- [x] India alone gets the Indian items and the worldwide ones
- [x] `/manage/` and `/admin/` list India after Asia, checked by `npm run check`
- [x] `llm-logs.mjs areas` gives India's share (KPI-20)
- [ ] A week of live sweeps read with `llm-logs.mjs areas` and `models` (RM-38)

## Tests

In `scripts/test-sweep.mjs`: the India cases in "T37: areaOf", the 9 areas, `max_uses: 4`, the prompt's India
request, and `llm-logs areas` (shown items, counts and shares, reading the store). In
`scripts/test-subscriptions.mjs`: `readAreas`, `set-areas` storing `areasV: 2`, eight areas stored as `null`, and
the India delivery cases. In `scripts/test-admin.mjs`: an Asia list from before T42 reads with India. In
`scripts/test-compare.mjs`: production settings with 4 searches.
