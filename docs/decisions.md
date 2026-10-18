# Decision log

> **Draft for the owner to edit.** Each date is when the decision first appears in this repository. Decisions from the
> July 2026 build are dated 2026-08-01, the day the files were uploaded, so the real dates are earlier. The reasons
> are taken from the case study (`index.html`), the README and commit messages. Where a rejected alternative is not
> recorded anywhere, the entry says so instead of guessing.

| Date | Decision | Why | Alternatives / tradeoff | Source |
|---|---|---|---|---|
| 2026-08-01 | **Use a language model with web search as the data layer.** | Problem signals are spread across news, government notices, outage trackers and review sites worldwide. | Not recorded whether keyword alerts or RSS feeds were tried. | `90f6df4`; case study "What I built" |
| 2026-08-01 | **Four categories, one call each, instead of one big prompt.** | Each response stays small, the calls run in parallel, and one failed category doesn't sink the others. | No single ranked list across categories. The original copy also claimed better quality; that was removed on 2026-10-18 as unmeasured. | `90f6df4`, `a960184`; case study "Decisions" |
| 2026-08-01 | **Store every sweep and compare runs to flag "New".** | It turns a one-off search into a feed you check daily. | Matching is by category and headline, so a reworded headline about the same event shows as New. | `90f6df4`; code `normalize()` |
| 2026-08-01 | **A board to explore and a digest to share.** | "Explore" and "stay informed" are different jobs. | — | `90f6df4`; case study "Decisions" |
| 2026-08-01 | **Daily digest to Slack via a scheduled task in Claude's app.** | Hands-off mornings. | Runs on the owner's machine, which must be awake. The email connector only drafted, so email was dropped from the claims. | Case study; owner-reported |
| 2026-10-18 | **Public demo replays a saved 8-item sample.** | The component only runs live inside Claude's app, which supplies API access. A public live version needs a server. | No live data in the demo; the sample is from July 2026. | `5017080`, `69cef92` |
| 2026-10-18 | **Remove or qualify claims the repo can't back.** | Dead buttons, email delivery and "raised result quality" had no evidence. | Less impressive copy; Slack kept, marked owner-reported. | `a960184`, `5141067` |
| 2026-10-18 | **Offline checks and CI on every push.** | Keep the sample data, links and bundles honest without a key. | — | `d2c6fc9` |
| 2026-10-18 | **Daily page on Vercel: one server sweep a day, visitors read only.** | Cost stays at one sweep a day whatever the traffic; the key stays on the server. | Visitors can't refresh; results are up to a day old. | `5cb9004`, `15d2233`, `8a65502`, PR #2 |
| 2026-10-18 | **Sweep guardrails:** secret required, skip if a sweep ran in the last 20 hours, keep 60 sweeps, save partial results, save nothing if all fail, max 1000 tokens and 3 searches per call. | Limit cost and abuse; keep failures visible. | A day with every category failing leaves the page on the previous sweep. | `5cb9004`; `scripts/test-sweep.mjs` |
| 2026-10-18 | **Keep the component a single file and copy the prompt to the server, with a drift check.** | The file can still be pasted into Claude's app. | Two copies of the prompt; `npm run check` fails if they differ. | `5cb9004`, `8a65502` |
| 2026-10-18 | **Serve committed bundles instead of building on Vercel.** | GitHub Pages and Vercel serve the same files, and CI fails if a bundle is stale. | Bundles must be rebuilt and committed by hand. | `236fe73`, `e40c0b2` |
| 2026-10-19 | **No `evals/` until real sweeps exist; publish a draft scoring rubric instead.** | Results must come from runs, not estimates. | Quality claims wait for the first 20+ real items. | This change |

> **OWNER INPUT NEEDED:** add decisions made outside the code, such as why travel, why these four categories, why
> Slack, and anything you tried and dropped.
