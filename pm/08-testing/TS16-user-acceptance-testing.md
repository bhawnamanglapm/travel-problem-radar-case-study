# TS16 · User acceptance testing (UAT)

| | |
|---|---|
| Component | User acceptance testing |
| Who | The owner (business user and product owner) signs off; later, a few target users (PMs and founders) |
| Status | Partial: a blind review of model output, marked by ChatGPT, not a person; no sign-off |
| Depends on | TS02, TS08, TS10 |
| Size | M |
| Unblocks | Release sign-off (README exit criteria) |

## What it means here

The product's users decide whether it does their job. Two parts:
1. **Journeys:** can a target user sign up, read the board, buy Pro and get the email they chose, without help?
2. **Content:** is what the radar finds worth reading? This is the product, and no automated test can judge it.

## In place today

- **Model test, 30 Oct 2026**
  ([model-test-2026-10-30.md](../../docs/subscriptions/model-test-2026-10-30.md)): a blind review of 107 items from
  Haiku and Sonnet. **The `keep` marks were filled in by ChatGPT, not by a person.** The doc says so and asks for a
  person to check a sample: the 28 Haiku items kept, or 10 from each model.
- **The draft quality rubric** in the [README](../../README.md#how-i-measured-quality): six checks per item (the link
  loads; the source supports the summary; recent, within 60 days; right category; reasonable severity; the
  opportunity names a user and something buildable). Not run on live items yet.
- **`scripts/score-items.mjs`** picks 20 items from saved sweeps (read-only), checks links and dates itself, and
  writes a CSV for the other four; `--score` reports the shares. Ready, not run (T30 step 10).
- The owner uses the product daily and reported 7 bugs (TS19).

## Gaps

- No person has judged live items against the rubric.
- No sign-off form, so "accepted" isn't defined or recorded.
- No user other than the owner has tried the journeys.

## The work

1. **Content UAT (owner):**
   - Run `score-items.mjs` for 20 live items and mark the four judged checks in the CSV. Report the shares with
     `--score`.
   - Check the ChatGPT review: open the 28 Haiku items kept and mark each yourself. Record how often you agree with
     ChatGPT. Under 80% agreement means the LLM marks can't stand in for a person.
   - Proposed bar, for the owner to set: at least 80% of items pass "the source supports the summary", and none is
     invented.
2. **Journey UAT (owner first, then 3 to 5 target users):** on the `staging` Preview, each user tries, unhelped:
   - find out what the product does from the home page;
   - sign up Free and confirm;
   - buy Pro with a Razorpay test card;
   - choose categories, areas and emails a day;
   - find one problem worth acting on.

   Note where they got stuck. Ask at the end: "Would you pay for this? Why or why not?"
3. **Sign-off form**, one per release:

| Field | |
|---|---|
| Release (commit or tag) | |
| Content UAT result | shares from `--score`; agreement with the LLM marks |
| Journeys tried, by whom (role, not name or address) | |
| Open S1 or S2 bugs | must be none |
| Known issues accepted | |
| Decision | Accepted, or not, and why |
| Signed by, date | the owner |

4. Log every finding in [TS19](TS19-bug-reporting-and-retesting.md). Each "stuck" moment is a UI finding for
   [TS10](TS10-ui-ux-testing.md).

## Done when

- 20 live items scored by a person with the rubric, and the shares recorded.
- The Haiku sample checked by hand, and the agreement recorded in the model-test doc.
- The owner has signed the form for the current release.
- At least 3 target users have tried the journeys (later; not needed for the first sign-off).

## Tools and cost

- `score-items.mjs`: free, read-only; it fetches the item links.
- A spreadsheet for the CSV: free.
- Staging with Razorpay test mode: free.

## Risks and notes

- The owner built the product, so their UAT is biased. Outside users matter more than a perfect score.
- Never share a real subscriber's details with a UAT user. Use test inboxes only (TS05).
- If content fails the bar, that's a product problem (prompt, sources, model), not a test to re-run until it passes.
