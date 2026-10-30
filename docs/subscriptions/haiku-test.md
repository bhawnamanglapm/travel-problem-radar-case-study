# Haiku 5.5 vs Sonnet 5.5: sweep test plan

**Status:** run on 30 Oct 2026 (3 rounds, $1.10). **Haiku passed the blind review and stays.** Kept items: Haiku
28 of 55 (51%), Sonnet 15 of 52 (29%); invented: none from either. Haiku cost $0.1215 a sweep against Sonnet's
$0.2440 (50%, so the 40% cost check failed), and 4 of its links were broken against Sonnet's 1. Full results and the
decision: [model-test-2026-10-30.md](model-test-2026-10-30.md).

Production runs Haiku: the code's default model is `claude-haiku-5-5` (`api/_lib/handlers.js`). The plan below is
kept as written before the test ran, to run it again.

## Why

Haiku 5.5 is $0.10 per million input tokens and $0.50 per million output tokens (for prompts up to 100K tokens).
Sonnet 5.5 is $2 and $10. Web searches cost $0.01 each on both.

Measured usage per sweep:
- **Haiku:** the LLM logs (`node --env-file=.env.local scripts/llm-logs.mjs models`), 10 sweeps from 26 to 30 Oct 2026:
  101,740 input tokens, 7,824 output tokens and 9.8 searches.
- **Sonnet:** the earlier average in [costing.md](costing.md): 60,229 input tokens, 4,355 output tokens and 4.6
  searches.

| | Haiku 5.5 (measured) | Sonnet 5.5 (its own measured usage) | Sonnet 5.5 (at Haiku's usage) |
|---|---|---|---|
| Input | $0.010 | $0.120 | $0.203 |
| Output | $0.004 | $0.044 | $0.078 |
| Searches | $0.098 | $0.046 | $0.098 |
| **Sweep** | **$0.112** | **$0.210** | **$0.380** |

Haiku used more tokens and more than twice the searches of the Sonnet sweeps measured earlier. Searches are now most
of Haiku's cost, and they cost the same on both models. So the saving is smaller than the price list suggests. Only
running both models on the same news shows the real difference.

The test also checks:
- whether Haiku's results are as good;
- whether it works with the web search tool the code uses (`web_search_20250305`);
- whether it works with `effort: "low"` (Haiku 5.5 supports `low` through `max`).

## How

A local script, [`scripts/compare-models.mjs`](../../scripts/compare-models.mjs). Its offline tests are in
`scripts/test-compare.mjs` and run with `npm test`.

**What it does**
- It imports `scanCategory` from `api/_lib/radar.js`, so both models get exactly the production prompt and settings:
  - `max_tokens` 16000;
  - `effort` low;
  - up to 3 searches per category.
- It runs **3 rounds**. Each round is one Sonnet sweep and one Haiku sweep, 4 categories each, back to back, so both
  models see the same news. The model that goes first alternates between rounds.
- It writes to a new folder in the system temp folder, outside the repo. It prints the folder's path.
  - `results.json`: for each run, every item, token counts and searches, the cost in $, the stop reason and how long
    the run took.
  - `summary.txt`: the automatic checks below.
  - `review.csv`: for the blind review.
  - `key.json`: which model found which item. Don't open it before you finish the review.

**What it doesn't do**
- No writes to Blob storage, so the live board doesn't change.
- No emails and no Slack messages.
- No production settings change.

**API key.** The script reads `ANTHROPIC_API_KEY` from `.env.local` through Node's `--env-file`. The key is never
printed, saved elsewhere or committed.

**Running it** (from the repo folder):

```powershell
node scripts/compare-models.mjs                                 # prints the plan and its cost; sends nothing
node --env-file=.env.local scripts/compare-models.mjs --yes     # runs the test; takes a few minutes
```

**Cost of the test** (6 sweeps; the script prints it before running):
- Expected: about **$1.48**. That's 3 × $0.380 for Sonnet and 3 × $0.112 for Haiku, both at Haiku's measured usage.
  If Sonnet uses what it used before, the total is nearer **$0.97** (3 × $0.210 + 3 × $0.112).
- Worst case: about **$3.73**. That's 3 × $1.074 for Sonnet at the high-cost scenario, plus about 3 × $0.17 for Haiku
  at the code's caps.
- At the end the script prints what the test actually cost.
- `--rounds 1` costs about a third, with about a third of the items to review, but the result is weaker.

## What to compare

**The script measures**

| Check | Pass for Haiku |
|---|---|
| Categories that return items | 4 of 4 in every round |
| Stop reasons | No `refusal` or `max_tokens` |
| Items per category | At least 3 on average (up to 5 allowed) |
| Links | Every item has an `https://` link and none is broken. Sites that refuse scripts (401, 403, 429) are listed for you to open by hand |
| Cost per sweep | At most 40% of Sonnet's in the same test, a saving of over 60% |

The cost mark used to be a fixed $0.08 a sweep, based on Sonnet's earlier usage. Haiku's measured $0.112 is already
over it, mostly because of searches. It now compares the two models on the same news. It was changed before the
test ran.

**You judge.** Open `review.csv` in Excel. The items are shuffled, each model's item appears once, and the file
doesn't say which model found what. In the `keep` column, put one of:
- **y** (keep). All of these hold:
  - it's real;
  - the link supports it;
  - it's from roughly the last 60 days;
  - the severity is sensible;
  - the opportunity is useful.
- **n** (drop): real, but fails one of those.
- **f** (invented): not real, or the link doesn't say what the item says.

Save the file as CSV, then run `node scripts/compare-models.mjs --score "<folder>"`.

**Pass:** every item is marked, no Haiku item is invented, and Haiku's keep rate is at least 80% of Sonnet's.

These thresholds are suggestions. Change them before the test runs, not after.

## If Haiku passes

1. Keep Haiku. Nothing to change.
2. Update [costing.md](costing.md) with the measured Haiku cost. Then revisit the price.

## If it fails

- **On quality** (an invented item, a low keep rate, missing categories or broken links): switch back to Sonnet.
  1. Set `RADAR_MODEL=claude-sonnet-5-5` in Vercel Production.
  2. Redeploy, because env changes apply only to new deployments.
  3. Check the next day's sweeps with `scripts/llm-logs.mjs models`.
- **On cost only:** Haiku still costs less than Sonnet. Decide on the two measured costs; quality is what matters.
- Look at the other cost levers too: Pro gets one email a day, fewer sweeps a day, and the GST case.

## Not in this plan

- Changing the price or the pricing page.
- Changing the prompt, `max_tokens`, `effort` or the search limit. Changing those as well would mix two tests into
  one.
