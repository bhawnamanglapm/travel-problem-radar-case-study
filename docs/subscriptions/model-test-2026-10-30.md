# Model test, 30 Oct 2026: Haiku 5.5 vs Sonnet 5.5

**Result: keep Haiku.** It cost half as much a sweep. In the blind review it found more items worth keeping than
Sonnet and none were marked invented, but **the review was marked by ChatGPT, not by a person** (see
[Blind review](#blind-review)). So the cost result is measured; the quality result is one other model's judgement. The
test plan, its pass marks and how to run it again are in [haiku-test.md](haiku-test.md).

## What ran

- `scripts/compare-models.mjs --yes --rounds 3`, from the owner's machine, on 30 Oct 2026.
- 3 rounds. Each round was one Sonnet sweep and one Haiku sweep on the same news, with the model that went first
  alternating. That's 6 sweeps of 4 categories each.
- The production prompt and settings: `max_tokens` 16000, `effort` low, up to 3 searches per category.
- No Blob writes, emails or Slack messages. Production didn't change.
- **Spent: $1.10** (estimate $1.48, worst case $3.73).

## Measured

| | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|
| Categories with items | 12 of 12 | 12 of 12 |
| Refusals or `max_tokens` stops | none | none |
| Items per category | 4.9 | 4.6 |
| Different items over 3 sweeps | 52 | 55 |
| Input tokens a sweep | 71,022 | 111,739 |
| Output tokens a sweep | 4,528 | 7,393 |
| Searches a sweep | 5.7 | 10.7 |
| **Cost a sweep** | **$0.2440** | **$0.1215** |
| Time a sweep | 11 s | 14 s |
| Links: load / blocked / broken | 43 / 8 / 1 | 41 / 9 / 5 |

- The two models picked mostly different stories: only 2 items had the same title.
- Each sweep, round by round:

| Round | Sonnet | Haiku |
|---|---|---|
| 1 | 20 items, $0.2540 | 18 items, $0.1253 |
| 2 | 19 items, $0.2522 | 18 items, $0.1141 |
| 3 | 20 items, $0.2258 | 19 items, $0.1252 |

**Broken links.** The script found these with a request from Node; they weren't opened by hand.
- Both models: a WSB-TV page on a possible Delta website and app outage.
- Haiku only: a mwm.ai page on a Hotels.com app update, a Yahoo Finance page on a popular travel app
  (in 2 items), and an infostourisme.com page on October transport strikes.

## Automatic checks on Haiku

| Check | Result |
|---|---|
| Every category returned items in every sweep | PASS |
| No refusal or `max_tokens` | PASS |
| At least 3 items per category on average | PASS |
| Every item has a link and none is broken | FAIL: 4 broken links (Sonnet had 1, so it would fail too) |
| At most 40% of Sonnet's cost a sweep | FAIL: 50% ($0.1215 against $0.2440) |

Haiku searched almost twice as often as Sonnet (10.7 against 5.7 a sweep). At $0.01 a search that's $0.107 of its
$0.1215, which is why the saving is 50% rather than the 60% the plan aimed for.

## Blind review

All 107 items, each model's once, were shuffled into `review.csv` without the model's name and marked `keep` y, n or
f. **The `keep` column was filled in by ChatGPT**, not by a person. The marks were then matched to the models with
`key.json` (`--score`).

The files are in [model-test-2026-10-30/](model-test-2026-10-30/):
- `modeltesting.csv`: the review file as the script wrote it, `keep` blank.
- `modeltesting_labeled.csv`: the same file with ChatGPT's marks.

Neither says which model found an item. `key.json`, which does, wasn't added.

What an LLM judge means for the result:
- The model names were hidden, so the marks weren't biased by the name. But ChatGPT judges as a language model does,
  and may favour the style one model writes in.
- **0 invented doesn't mean the links were checked.** It's not recorded whether ChatGPT opened the links. An item can
  read well and still not be backed by its source.
- The test plan asks a person to judge, so this doesn't fully meet it. A person checking a sample would make it
  stronger: the 28 Haiku items kept, or 10 from each model.

| | Kept (y) | Dropped (n) | Invented (f) | Keep rate |
|---|---|---|---|---|
| **Haiku 5.5** | 28 | 27 | 0 | **51%** |
| Sonnet 5.5 | 15 | 37 | 0 | 29% |

**PASS on ChatGPT's marks:** no invented Haiku item, and its keep rate is at least 80% of Sonnet's (it is 1.75
times Sonnet's).

By category, items kept of those found:

| Category | Haiku | Sonnet |
|---|---|---|
| Gov & policy | 9 of 15 | 7 of 10 |
| Industry | 9 of 15 | 3 of 13 |
| Traveler pain | 7 of 14 | 2 of 14 |
| Website & app | 3 of 11 | 3 of 15 |

## Decision

1. **Keep `claude-haiku-5-5`** as the production model. Nothing changes in the code or in Vercel.
2. The cost check failed, but the plan says a cost-only failure is decided on the two measured costs. Haiku halves
   the cost of a sweep and did better in ChatGPT's review.
3. The quality result rests on ChatGPT's marks. If a person's check of a sample disagrees, run this decision again.
4. Haiku's broken links are worth watching. `scripts/llm-logs.mjs models` counts links search didn't return, and
   `scripts/score-items.mjs` checks links on saved items.

## What it shows beyond the model

- **Only 40% of all items were kept** (43 of 107, on ChatGPT's marks). Most items are real but not useful enough to show. This is the
  next quality step, not the model.
- **Website & app is the weakest category** for both models: 6 of 26 kept.
- The reasons for each `n` weren't recorded. Recording them (too vague, too old, wrong category, weak opportunity)
  is the way to find what to change in the prompt.

## Limits

- One day's news, 107 items, marked once, by ChatGPT. A different day or a person could give different numbers.
- The broken links weren't checked by hand; some may be sites that refuse scripts.
- The two review files are in the repo. The script's other files (`results.json`, `key.json`, `summary.txt`) are
  kept outside it.
