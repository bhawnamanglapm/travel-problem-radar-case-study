# T12 · Docs and staged launch of Phase 1

| | |
|---|---|
| Phase | 1d, launch |
| Who | Developer (docs, steps 1–4) and owner (steps 5–9) |
| Size | M |
| Depends on | T00 to T11 |
| Unblocks | T13, T14, and the measuring period before T15 |

## Why

The code can ship switched off. Launch is then a sequence of small, reversible steps, each checked before the next.
The docs must say what is built and what has been seen working, separately, as the README already does for Slack
and email.

## Docs (developer)

1. **DEPLOYMENT.md**, new section "Subscriber email (optional)":
   - What it does (Free once a day, Pro after every scheduled sweep), what it needs (T00's verified domain)
   - Variables: `SUBSCRIPTIONS_ENABLED`, `SITE_URL`, `MAX_SUBSCRIBERS`, `MAX_CONFIRMS_PER_DAY`, plus the existing
     `RESEND_API_KEY` and `EMAIL_FROM`. Add them to the section 7 variables table and to 4.3
   - New Blob keys in section 7's "What is stored" table, each marked "not readable through `/api/data`"
   - How to turn it off: unset `SUBSCRIPTIONS_ENABLED` and redeploy. Sign-up stops, digests stop, unsubscribe keeps
     working
   - Troubleshooting rows: `subscribers: not configured`, `stopped: quota`, `deferred` counts, confirmation emails
     not arriving
   - Quota: the formula from pricing.md, and that the owner's own email is sent first
2. **TECHNICAL.md**: file table (new endpoints, modules, page, scripts); the "Digest" row of the top table.
3. **README.md**: the "Subscriptions" line in "What's next", and the test count in "How I measured quality".
   Status wording: "built and tested offline" until step 7 below, then "first subscriber digest delivered on
   <date>".
4. **Design docs**: update [email-signup.md](../email-signup.md) and [architecture.md](../architecture.md) for the
   changes listed in [README.md](README.md#where-these-tasks-differ-from-the-draft-designs) (status and plan split,
   `id` and `t` in links, the deliveries file, the roll-up, the switch). Remove the "nothing here is built" banner
   from whatever is now built.
5. **decisions.md**: rows for D1–D9 as settled in T00, and for the roll-up and confirm-by-button choices.
6. **CHANGELOG.md**: one entry.

## Staged launch (owner, in order; stop and fix at any failed check)

| Step | Do | Check |
|---|---|---|
| 1 | Deploy with `SUBSCRIPTIONS_ENABLED` unset | `/subscribe/` says sign-ups aren't open; a manual sweep's reply says `subscribers: "not configured"`; the owner's email and Slack unchanged |
| 2 | Check `EMAIL_FROM` is `hello@pehchanthetraveller.com` (D8; not `onboarding@resend.dev`). Set `MAX_SUBSCRIBERS=5000` (D7) and `MAX_CONFIRMS_PER_DAY`; set `SUBSCRIPTIONS_ENABLED=1`; redeploy. The page is still **not linked** from anywhere | — |
| 3 | Subscribe a second address you own (not `EMAIL_TO`) through `/subscribe/` | Confirmation arrives from `EMAIL_FROM`, not in spam; the link opens the confirm page |
| 4 | Confirm. Run `scripts/subscribers.mjs stats` | 1 Free; events `subscribed`, `confirmsent`, `confirmed` |
| 5 | Wait for the next scheduled sweep (or, if Free hasn't been sent today, run one by hand) | The Free daily digest arrives; the reply shows `free.sent: 1`; the GitHub Actions log shows counts only |
| 6 | `grant-pro` that address; wait for the next scheduled sweep | Pro email arrives; reply `pro.sent: 1` |
| 7 | Use the mail app's own Unsubscribe button (Gmail shows it when the headers are right) | Record gone (`stats` → 0); `unsubscribed` event |
| 8 | Ask one or two people to test from different mail providers (Gmail, Outlook) | Confirm, digest, unsubscribe all work; record which providers |
| 9 | Publish: add the links from T08 (`live/index.html`, the case study, the README) | Links work from both GitHub Pages and Vercel |

Record each check's result and the date in the pull request or CHANGELOG. Only then change the README to say it's
working.

## Acceptance criteria

- [ ] All docs above updated; `npm run check` passes
- [ ] Steps 1–9 done, with results recorded
- [ ] The measuring period and the gate threshold for Phase 2 are written down **before** looking at results
  ([pricing.md](../pricing.md), step 3 and 4 of the rollout)

## Roll back

Unset `SUBSCRIPTIONS_ENABLED`, redeploy. Nothing else needs undoing; records stay in the private store until
deleted with the admin script.
