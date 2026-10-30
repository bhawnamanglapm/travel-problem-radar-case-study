# T43 · Ask the board (RAG) and Useful / Not useful buttons

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | L |
| Depends on | T38 (the search file, `radar:search`), T39 (the account actions and saved problems), T42 (India as an area) |
| Unblocks | The owner's Preview test of Ask; a reader-scored quality figure for KPI-21 and KPI-20's stretch |

> Added 2026-10-31 at the owner's request: "wat all ai things shld be there tto make this website more interactive"
> and "also any RAG process thing tht can be added". The plan was approved the same day.
>
> **Built, not live.** Asking is off until `ASK_ENABLED=1` is set in Vercel. No live model call has been made: the
> first ones are the owner's test in Preview (below).

## Why

The board is a list to read. A member who wants to know "what is going wrong with rail refunds in India?" has to
search and read every card. Ask the board answers that in a few sentences, built only from items the radar has
already saved, with every claim citing one. That is retrieval-augmented generation (RAG) over the search file the
board already keeps.

No item has been scored by a person yet (R-01). The Useful / Not useful buttons give the radar its first quality
signal from readers, and a way to read KPI-20's stretch (7 of 10 India items useful) from members as well as from
the owner's scoring.

## What was built

- **`api/_lib/ask.js`** (new).
  - `retrieve(items, question, { cat, max = 25 })`: keyword search in plain JavaScript, no embeddings and no new
    package. Words are lowercased, stop words dropped and a plural "s" taken off; items are scored BM25-style over
    the title (counted twice), summary, product angle and region.
  - **Area first.** `questionArea` places the question with `areaOf`, plus a list of people's names ("Indian" is
    India, "Japanese" is Asia). A question placed in an area other than Global searches only that area's items, and
    the words that only named the place are dropped. With only a filter left, the newest items in it come back.
  - `askPrompt`: the items numbered [1] to [n]; the rules (answer only from these items, cite each claim, say so
    when they don't answer it, 150 words at most); JSON out. The question sits in a `<question>` block with any
    `<question>` tags in it removed, so text in it is read as a question, not as instructions.
  - `askModel`: the Messages API with no tools, `max_tokens` 800 and `effort: "low"`.
  - `checkAnswer`, the main guard: every `[n]` in the answer and in `cites` must be one of the numbers sent, and an
    answer that says it found something must cite at least one. Otherwise the status is `unchecked` and the model's
    text is not shown.
  - `answerQuestion` returns `{ status, area, answer, items, usage, called }`. Each item's title, link, source,
    region and sweep come from the store, never from the model. No match means no model call.
- **`/api/account`** (`api/_lib/subscription-handlers.js`): two more actions, signed in, POST and same origin only.
  - `ask` `{ question, cat? }`: `503 ask_off` unless `ASK_ENABLED=1` and an API key is set; `402 pro_only`;
    `400 bad_question` outside 3 to 300 characters; `400 bad_cat`. `ASK_PER_DAY` questions a member a UTC day
    (default 20, 1 to 200), counted on the record as `ask: { day, n }` **before** the model call, so a failed or
    slow call can't be retried past the limit (`429 ask_limit`). A model error is `502 model_error`. An `asked`
    event is counted with the plan only. The log line has the status, area, category, item count and token usage,
    never the question.
  - `vote` `{ sweepId, itemId, vote: 1 | -1 | 0 }`: Pro only, except 0 (remove), which anyone can send. The item
    must be in its sweep's file. Stored as `votes: [{ id, v, at }]`, newest first, at most 500 (`MAX_VOTES`).
  - The saved list's GET also returns the member's votes (`{ itemId: 1 | -1 }`), whether asking is on, and the
    questions left today. `accountView` has `ask` and `askLeft`.
- **The board** (`travel-problem-radar.jsx`, live board only): an "Ask the board" box above the area tiles, with a
  category choice and the questions left today. The answer is plain text, never HTML, with each [n] marked; under
  it the numbered sources, each with its link and a Details button, and a line saying it was written by AI from the
  items listed. 👍 Useful / 👎 Not useful under each board card for Pro (pressing the same one again removes the
  vote). Bundles rebuilt.
- **`scripts/item-votes.mjs`** (new, read-only): adds up the votes across members, joins them to the search file
  for titles and areas, and prints the share of voted items found useful, overall and in India (`--area NAME` adds
  another area, `--top N` lists the most voted). An item is useful when it has more Useful than Not useful votes; a
  tie is split. It refuses to run without the Blob token and writes nothing.
- **`DEFAULT_MODEL`** moved from `handlers.js` to `radar.js`, so the sweep and Ask share it.
- **Privacy page and the DPDP checklist**: votes, the daily count, questions not stored, and Anthropic named as the
  provider that receives a question.

### Changes from the plan

- **A vote checks its own sweep file**, as `save` does, not the whole search file: a smaller read, and an item can
  be voted on as long as its sweep is kept.
- **Votes are a list `[{ id, v, at }]`, not a map**, so the oldest can be dropped at 500.
- **No extra request on the board.** The saved list's GET, which the board already makes, carries the `ask` flag
  and the questions left.
- **Words that name the area are dropped** once the area filter is on ("Indian rail" searches India items for
  "rail"), and a people's name ("Indian", "Japanese") places a question as well as a place name.

## Cost

Each question is one Haiku call with no web search. The output is capped at 800 tokens, which at Haiku 5.5's
$0.50 per million output tokens ([haiku-test.md](../haiku-test.md)) is at most $0.0004. The input (the rules and
up to 25 items) is **not measured**: it is read from the `usage` in the `ask` log lines during the owner's Preview
test, at $0.10 per million input tokens. A member can ask at most `ASK_PER_DAY` (20) questions a day.

## Owner steps (not done)

1. Set `ASK_ENABLED=1` in Vercel for **Preview** only, and deploy this branch's Preview.
2. Sign in as Pro and ask 20 to 30 prepared questions whose answers are on the board, some about India, and a few
   that aren't (to see "nothing on the board"). For each, note whether the right items came back and whether each
   citation supports its sentence.
3. Read the `ask` log lines in Vercel for each question's tokens, for the cost per question (R-18).
4. Production only after that, and only on the owner's yes.

## Acceptance criteria

- [x] A question about India searches only India items; one with nothing matching makes no model call
- [x] A citation to an item not sent, or an answer that cites nothing, is never shown
- [x] Links and titles come from the store, never from the model
- [x] Off by default; Pro only; 3 to 300 characters; the daily limit counted before the call
- [x] The question is not stored or logged
- [x] Votes: Pro only, only on items the radar saved, at most 500, deleted with the account
- [x] `item-votes.mjs` gives the useful share overall and in India, and writes nothing
- [x] The privacy page and the DPDP checklist cover votes and questions
- [ ] The owner's Preview test: right items and citations, and the cost per question
- [ ] On in Production (owner's yes)

## Tests

In `scripts/test-ask.mjs` (new, in `npm test`), 76: words and places, retrieval (area and category filters, area
words dropped, the newest when only a filter is left), the prompt (numbering, the question block), the citation
check, the model call with a stubbed fetch, and `answerQuestion`; the `ask` and `vote` actions through
`makeAccountHandler` (sign-in, origin, POST, Pro, the switch, the limits, a forged citation, links from the store,
the 500 cap, deletion with the account, no address logged); and `item-votes.mjs` (totals, the India share, an item
gone from the search file, options, the token guard, nothing written). Checked in headless Chrome against a local
stand-in server with made-up items, at 1280 and 390 px: the box, an answer with its sources, and the buttons, with
no sideways scroll.
