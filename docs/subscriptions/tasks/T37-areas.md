# T37 · Areas: filter the board by part of the world

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | M |
| Depends on | — (start any time) |
| Unblocks | T38 (`?area=` in the URL), T41 (areas in Pro email) |

> Added 2026-10-29, from a comparison with Mindtrip (mindtrip.ai), which browses by place and map. The comparison was
> read from public write-ups; Mindtrip's site didn't render in a headless browser.

## Why

Readers care about problems where they travel or build, but the board can only filter by category, severity and
search. Each item has a `region`, but it is free text from the AI: the sample sweep has "Global" four times,
"Europe", "Spain", "Japan" and "United States" (`sampleData.json`). Filtering on that text directly would give one
chip per spelling. A fixed list of areas, with a mapping from the AI's text, gives a short, stable filter.

## What to build

- **Areas.** A fixed list (owner decision O1, default):
  Global, Asia, Europe, North America, Latin America, Middle East & Africa, Oceania, Other.
- **`areaOf(region)`.** Maps the region text to one area: exact names first (countries, continents, common short
  forms such as "US", "UK", "EU"), then words inside the text ("Southeast Asia" → Asia). Empty or "Global" →
  Global. Anything it can't place → Other.
  - It lives in the jsx and has a copy on the server (for T41). check.mjs §5 fails if the two copies differ, as it
    already does for the prompt and the categories.
  - The AI prompt is unchanged: the mapping works on what the AI already writes.
- **Board.**
  - An Areas filter row under the category chips: only the areas present in the sweep, each with its count. It
    combines with the category, severity and search filters, and with "New only".
  - An area overview strip of tiles with counts, above the category cards. Clicking a tile sets the area filter.
    This replaces the map idea: no map library, no tile server and no API key.
  - Each problem card's region tag stays the AI's own text; the area is used only for filtering.

## Acceptance criteria

- [ ] `areaOf` places every region in `sampleData.json` and in the last 10 production sweeps; the ones it puts in
  Other are listed in the PR, so the owner can decide whether to add them
- [ ] check.mjs §5 fails if the jsx and server area lists or mappings differ
- [ ] The area row and tiles show only areas present, with counts that match the cards shown
- [ ] Area plus category plus search filter together, and clearing one keeps the others
- [ ] Chips and tiles work by keyboard (`aria-pressed`), meet the 4.5:1 contrast check, and fit at 375px
- [ ] Docs: TECHNICAL.md, CHANGELOG.md

## Tests

`areaOf` on country names, continents, short forms, mixed text ("Spain and Portugal"), empty, "Global" and
nonsense. If the owner picks other areas (O1), only the list and these tests change.
