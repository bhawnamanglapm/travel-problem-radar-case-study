# Haiku 5.5 vs Sonnet 5.5: sweep test plan

**Status:** the script is ready. Nothing has run and nothing in production has changed.

## Why

The sweep runs on `claude-sonnet-5-5` and is most of the monthly costs (`F`). Haiku 5.5 is $0.10 per million input
tokens and $0.50 per million output tokens (for prompts up to 100K tokens). Sonnet 5.5 is $2 and $10. Web searches
cost $0.01 each on both.

Applying those prices to the average measured sweep (60,229 input tokens, 4,355 output tokens, 4.6 searches; see
[costing.md](costing.md)):

| | Sonnet 5.5 (measured) | Haiku 5.5 (estimate) |
|---|---|---|
| Input | $0.120 | $0.006 |
| Output | $0.044 | $0.002 |
| Searches | $0.046 | $0.046 |
| **Sweep** | **$0.210** | **≈ $0.054** |
| `F` at 5 sweeps a day | ₹6,797 | ≈ ₹4,559 |
| Members needed at ₹199 (GST on top) | 36 | ≈ 24 |

The Haiku column assumes Haiku uses the same tokens and searches as Sonnet. **That is the first thing this test
checks.** Three other things are also unknown:
- whether its results are as good;
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

**API key.** The key goes in the shell for that session only. Nothing is saved to a file and nothing is committed.

**Running it** (PowerShell, from the repo folder):

```powershell
node scripts/compare-models.mjs                 # prints the plan and its cost; sends nothing
$env:ANTHROPIC_API_KEY = "sk-ant-..."           # this window only
node scripts/compare-models.mjs --yes           # runs the test; takes a few minutes
Remove-Item Env:ANTHROPIC_API_KEY
```

**Cost of the test** (6 sweeps; the script prints it before running):
- Expected: about **$0.79**. That's 3 × $0.210 for Sonnet and 3 × $0.054 for Haiku.
- Worst case: about **$3.73**. That's 3 × $1.074 for Sonnet at the high-cost scenario, plus about 3 × $0.17 for Haiku
  at the code's caps.
- At the end the script prints what the test actually cost.

## What to compare

**The script measures**

| Check | Pass for Haiku |
|---|---|
| Categories that return items | 4 of 4 in every round |
| Stop reasons | No `refusal` or `max_tokens` |
| Items per category | At least 3 on average (up to 5 allowed) |
| Links | Every item has an `https://` link and none is broken. Sites that refuse scripts (401, 403, 429) are listed for you to open by hand |
| Cost per sweep | At most $0.08, which still saves over 60% |

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

1. Set `RADAR_MODEL=claude-haiku-5-5` in Vercel Production, then redeploy, because env changes apply only to new
   deployments.
2. Watch the logged `usage` and `perCat` from the next 2 days of sweeps (about 10).
3. To undo, delete the variable and redeploy. The code falls back to Sonnet.
4. Update [costing.md](costing.md) with the measured Haiku cost. Then revisit the price.

## If it fails

- Keep Sonnet.
- Look at the other levers: Pro gets one email a day, fewer sweeps a day, and the GST case.

## Not in this plan

- Changing the price or the pricing page.
- Changing the prompt, `max_tokens`, `effort` or the search limit. Changing those as well would mix two tests into
  one.
