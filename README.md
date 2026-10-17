# Travel Problem Radar

A prototype that sweeps the web for travel-industry problems (traveler complaints, new visa rules and
taxes, booking-site outages, strikes) and tags each one with a product idea a PM could build.

**Product owner:** Bhawna Mangla · **Built with AI** (Claude) · **Status:** prototype, July 2026

| | |
|---|---|
| **Case study** | https://bhawnamanglapm.github.io/travel-problem-radar-case-study/ |
| **Try the demo** | https://bhawnamanglapm.github.io/travel-problem-radar-case-study/demo/ |
| **Sample digest** | https://bhawnamanglapm.github.io/travel-problem-radar-case-study/demo/#report |

![The demo board after a sample sweep: 8 problems in four categories, each with a source link and a product opportunity](docs/demo-board.png)

## What it does

1. **Sweeps four categories at once:** traveler pain, government & policy, website & app failures, and
   industry disruption. Each category is one call to Claude with its web-search tool, up to 5 items each.
2. **Structures every finding:** title, short summary, source and link, region, date, severity, and a
   one-line product opportunity.
3. **Flags what's new:** anything not seen in an earlier sweep gets a "New" badge.
4. **Keeps a dated history** of the last 60 sweeps, so you can open any past one.
5. **Builds a plain-text digest** (new items first, then by category) with a Copy button.

## The demo vs. the live version

| | Live version | Public demo |
|---|---|---|
| Where it runs | Inside Claude's app, as an artifact | GitHub Pages, any browser |
| What a sweep does | 4 real web-search calls to Claude | Replays the 8 saved items in `sampleData.json` |
| AI or API calls | Yes, through Claude's app | None |
| History is saved in | Claude's artifact storage | This browser's localStorage |

Both use the same component, [`travel-problem-radar.jsx`](travel-problem-radar.jsx). Given no props it
runs live; given `sample={...}` it replays the sample. The live version can't run on a plain website as
is: it calls the Anthropic API from the browser without a key, which only works inside Claude's app.

## What has been checked

| Check | Result | How |
|---|---|---|
| Demo: replay, filters, search, report, history, "New" flag | Pass (19 checks) | Headless browser on a local copy, 2026-10-18 |
| Demo makes no AI or API calls | Pass | Same test: only Google Fonts load from elsewhere |
| Pages fit a phone screen (375 px) | Pass | Same test |
| Sample data shape, page links, demo bundle | Pass | `npm run check`, also on every push (GitHub Actions) |
| 8 sample source links load | 7 of 8 | isdown.app blocks automated requests; the article contents were not re-checked |
| Live mode outside Claude's app | Fails safely: shows "The sweep came back empty", no errors | Headless browser with the API stubbed to refuse, 2026-10-18 |
| Live sweep inside Claude's app | Not re-run | Needs Claude's app; the sweep code is unchanged apart from a storage fallback and the demo switch |

**Not in this repo and not verified:** any scheduled daily run, Slack or email delivery, usage numbers,
or measured result quality. The sample items are from one sweep in July 2026 and are now dated.

## Files

| File | What it is |
|---|---|
| `index.html` | The case-study page (served by GitHub Pages) |
| `demo/` | The demo page; `demo/radar.js` is built from the component and the sample |
| `travel-problem-radar.jsx` | The dashboard component (live in Claude's app, demo on the web) |
| `sampleData.json` | 8 saved items, two per category, each with a source link |
| `scripts/check.mjs` | Offline checks: sample data, page links, demo bundle |

## Rebuild the demo

Needs Node.js 18 or later.

```bash
npm install
npm run build   # rebuilds demo/radar.js from the component + sampleData.json
npm run check
```

Commit `demo/radar.js` after rebuilding; GitHub Pages serves it as is, and CI fails if it is stale.

## Making live sweeps public (not built)

A public live version would need a small server, for example on Vercel or Netlify, that:

- holds `ANTHROPIC_API_KEY` as a secret, never in the page;
- runs at most one sweep a day and serves that cached result to every visitor;
- caps spend, and falls back to `sampleData.json` if a sweep fails.

## License

MIT. See [LICENSE](LICENSE).
