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
>
> **Built 2026-10-29** on `feat/t37-areas`. See "What was built" below; progress.md has the commits and checks.

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
    combines with the category, severity and search filters. (The first draft also said "New only", but the board
    has no such filter.)
  - An area overview strip of tiles with counts, above the category cards. Clicking a tile sets the area filter.
    This replaces the map idea: no map library, no tile server and no API key.
  - Each problem card's region tag stays the AI's own text; the area is used only for filtering.

## What was built

- **The areas block.** `AREAS`, a name table (`AREA_NAMES`: countries, regions, short forms, big cities and US
  states) and `areaOf`, between the comments `// Areas (T37):` and `// End of areas.`. The text is the same in
  `travel-problem-radar.jsx` and `api/_lib/radar.js`, which exports `AREAS` and `areaOf` for T41. "Georgia" is left
  out, because it is both a US state and a country.
- **How `areaOf` places a region:**
  1. Accents, case, full stops and apostrophes are ignored ("Côte d’Ivoire", "São Paulo", "U.S.").
  2. Text with no letters or digits is Global.
  3. The text is split on `, ; / & + ( )`, "and" and "or". Each part is looked up whole, and otherwise its words are
     scanned for names of three, two and one words ("southern Spain", "New South Wales", "rural Japan").
  4. Text in brackets only qualifies the rest ("Mali (US citizens affected)"), so it counts only when the rest
     names nothing.
  5. One area found gives that area. Two or more ("US and Europe", "Spain / Global") give Global, because the
     problem spans areas. None gives Other.
- **Not stored.** The area is worked out when needed. The prompt, the saved sweeps, `/api/data` and each card's
  region tag are unchanged.
- **Board.**
  - An "All areas" chip row under the category chips, with a count on each area.
  - Area tiles above the category cards, shown when the sweep has two or more areas. Clicking a tile picks it;
    clicking it again clears it.
  - A count is the number of cards picking that area would show, with the other filters as they are. Areas with no
    cards are hidden, except the one that's picked, so it can be cleared.
  - Every category, area and severity chip, and every tile, has `aria-pressed`.
- **Production regions** (read-only, 2026-10-29): all 9 saved sweeps (there are not yet 10), 151 items, 42
  distinct regions. None lands in Other. Examples: "Niger, Burkina Faso, Mali (US citizens affected)" → Middle
  East & Africa, "United States (50 origin countries incl. Bangladesh, Nigeria, Nepal)" → North America,
  "India/Europe" → Global, "Taiwan / East Asia" → Asia.

## Acceptance criteria

- [x] `areaOf` places every region in `sampleData.json` and in the last 10 production sweeps; the ones it puts in
  Other are listed in the PR, so the owner can decide whether to add them. Only 9 sweeps exist; none of their
  regions is in Other
- [x] check.mjs §5 fails if the jsx and server area lists or mappings differ
- [x] The area row and tiles show only areas present, with counts that match the cards shown
- [x] Area plus category plus search filter together, and clearing one keeps the others
- [x] Chips and tiles work by keyboard (`aria-pressed`), meet the 4.5:1 contrast check, and fit at 375px
- [x] Docs: TECHNICAL.md, CHANGELOG.md

## Tests

`areaOf` on country names, continents, short forms, mixed text ("Spain and Portugal"), empty, "Global" and
nonsense. If the owner picks other areas (O1), only the list and these tests change.
