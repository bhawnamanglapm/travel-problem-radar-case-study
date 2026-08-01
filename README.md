# Travel Problem Radar

A live global-signals tool that surfaces travel-industry problems daily, each tagged with a
product-opportunity angle. Built by Bhawna Mangla.

## What's in this folder

- **index.html** — the portfolio case-study page. Self-contained (no build step). This is
  what GitHub Pages will serve.
- **travel-problem-radar.jsx** — the interactive dashboard component. Built for Claude's
  artifact runtime; needs conversion before it runs on a public site (see below).
- **sampleData.json** — 8 real, on-brand problems across the 4 categories. Use as the
  fallback / first-render data for the deployed dashboard.

## Deploy the case study (GitHub Pages)

1. Push this folder to your repo.
2. Repo → Settings → Pages → Source: Deploy from branch → `main` → Save.
3. Your live URL appears in a minute or two.

## Deploy the live dashboard (separate — Netlify or Vercel)

GitHub Pages is static-only, so it can't run the backend that hides your API key. Deploy the
dashboard to Netlify or Vercel instead, then link `index.html`'s "Live dashboard" button to it.

The dashboard's live scan calls the Anthropic API. To keep it live for visitors without
exposing your key:
- Move the scan into a serverless function that reads `ANTHROPIC_API_KEY` from an env secret.
- Cache the daily result (one scan/day shared by all visitors) for near-zero cost.
- Fall back to `sampleData.json` if the API errors.
- Swap `window.storage` for `localStorage` (keep the same keys + dated-history behaviour).

## Style

Dark background · hot pink `#FF2E88` · electric lime `#C6FF3D` · Bebas Neue display type.
