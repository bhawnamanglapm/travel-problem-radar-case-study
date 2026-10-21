# Changelog

Built from the git history. Dates are commit dates. The project has no version numbers or releases, so entries are
grouped by date.

## 2026-10-21

- Sweep now runs every 5 hours from GitHub Actions, with Vercel's daily cron kept as a backstop (`b691d54`).
- Fixed categories coming back empty: the output token limit is raised to 16,000 because thinking counts toward it
  (`f200a79`). A manual run with the secret always sweeps (`66f25c8`).
- The server sweep can post the digest to Slack (`493ddbd`) and email it through Resend (`bb78fbb`, `64fae00`), or send a
  short failure notice. Both are optional and covered by the offline tests only. Added `DEPLOYMENT.md`.
- README brought up to date with the above (`6889060`).
- Added draft subscription plans under `docs/subscriptions/`: system diagrams, pricing and rollout, free email sign-up
  and paid Pro through Razorpay. Documents only; no code changed.

## 2026-10-19

- Rewrote the README as a product case study; how-it-runs, files and rebuild steps moved to `docs/TECHNICAL.md`.
- Added `docs/PRD.md` (put together after the build), `docs/decisions.md`, this changelog and a screenshot of the
  sample digest.

## 2026-10-18

- Live daily page on Vercel (#2): a server job sweeps once a day and saves to a private Blob store; `/live/` shows
  the latest sweep read-only; `/api/data` serves only allow-listed keys. Offline tests for the sweep and data feed.
  The case study gained a "Live (updated daily)" button, and the README describes the page as not yet swept (#3).
- Working demo and honest claims (#1): the dashboard can replay a saved sample; a GitHub Pages demo; dead buttons
  fixed; unbacked claims removed or qualified; offline checks and CI; a demo screenshot; README rewritten; duplicate
  zip removed (owner approved); text files stored with LF line endings.

## 2026-08-01

- First upload: the case-study page, the dashboard component, sample data and a zip copy.
