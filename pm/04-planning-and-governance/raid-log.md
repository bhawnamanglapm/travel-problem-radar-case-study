# RAID log: risks, assumptions, issues, dependencies

> **Stage 4 of 7.** State on 2026-10-24. Each row cites where it comes from; the cost and safeguard rows summarise
> [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards), which stays the detailed source. "Owner"
> means a step only the owner can take. Links to the [roadmap](roadmap.md) are by `RM-` ID.

## Risks

| ID | Risk | Effect | Safeguard today | Still open | Source |
|---|---|---|---|---|---|
| R-01 | The findings are wrong or stale, and a paying member relies on them | The product's main claim fails | Every item links its source; every page tells the reader to check it (REQ-10) | No real sweep has been scored. pricing.md says not to charge before one is (RM-13) | [pricing.md](../../docs/subscriptions/pricing.md); [v1 PRD](../../docs/PRD.md#risks) |
| R-02 | Spend runs away: a leaked `CRON_SECRET`, a dearer `RADAR_MODEL`, more sweeps than planned, or a costly sweep | Costs above the model; extra emails to Pro | Manual sweeps capped at 3 a day in code (PR #60) | Whether a spend limit is set in the Anthropic Console is **not verified** (RM-08) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards) |
| R-03 | One AI vendor does all the finding | When Anthropic refuses calls, nothing new is saved. This happened on 2026-10-23 (I-01) | Partial results are saved; if every category fails, nothing is saved and the board keeps the last sweep; a failure notice is sent | No second model or provider. A cheaper model is untested (DSC-08) | [decisions.md](../../docs/decisions.md) 2026-10-18 (sweep guardrails); [CHANGELOG](../../CHANGELOG.md) 2026-10-21 |
| R-04 | Sign-ins use up Resend Free's 100 emails a day | Digests stop | — | Resend Pro before the first paying member (RM-08) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards); D7 in [decisions.md](../../docs/decisions.md) |
| R-05 | Emails land in Junk or spam | Members never see the confirm link or the digest | The sign-up reply says to check spam | I-03 | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| R-06 | Razorpay webhooks stop arriving | A paid account stays Free | Check the webhook is Enabled; compare Razorpay's active subscriptions with Pro records weekly by hand | Manual | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards) |
| R-07 | A refund or chargeback | The account stays Pro | Revoke by hand | A webhook handler later (RM-21) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards) |
| R-08 | Vercel Hobby used commercially | Breach of Vercel's terms (**verify** the current fair-use terms) | `paid` is `false`; nothing is charged | Move to Pro before live payments (RM-05) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards); [T27](../../docs/subscriptions/tasks/T27-razorpay-test-run-and-go-live.md) |
| R-09 | Hobby locks Blob for 30 days after 2,000 advanced operations in a month | Subscriber records and sweeps live in Blob, so the site can't save either while it's locked | A Vercel Firewall rate-limit rule in front of `/api/subscribe` | On Vercel Pro, Blob operations are billed by use instead (RM-05) | [decisions.md](../../docs/decisions.md) 2026-10-22 (T13 part B) |
| R-10 | The policy pages haven't been reviewed by a lawyer | A promise or a gap in them could be wrong | The owner chose to publish and update them later | Terms waits for an adviser's liability clause (I-05) | [decisions.md](../../docs/decisions.md) 2026-10-22, 2026-10-23 |
| R-11 | "Continue with Google" trusts the `id_token` because it comes straight from Google over TLS, not by checking its signature | Recorded as a trade-off of the hand-written sign-in | Off until the owner adds the Google client to Vercel | — | [decisions.md](../../docs/decisions.md) 2026-10-22 |

## Assumptions

The product assumptions are `DSC-01` to `DSC-08` in the [discovery log](../01-discovery/discovery-log.md#assumptions-and-their-evidence).
The ones below are planning assumptions: the numbers and outside rules the plan rests on.

| ID | Assumption | Status | Source |
|---|---|---|---|
| A-01 | About 5 scheduled sweeps a day, at about $0.21 each | The schedule is in `sweep.yml`; the cost was measured over 5 production runs. A week of real sweep counts and a month of real spend haven't been read (RM-14) | [costing.md](../../docs/subscriptions/costing.md#measurement-checklist); [TECHNICAL.md](../../docs/TECHNICAL.md) |
| A-02 | 24 to 28 members at ₹299 a month cover the running costs | Follows from A-01 and the cost model. No one has paid | [costing.md](../../docs/subscriptions/costing.md#break-even) |
| A-03 | For card mandates, the bank sends the notice before each automatic payment | From the RBI e-mandate framework and Razorpay's FAQ; **verify** before go-live | [decisions.md](../../docs/decisions.md) 2026-10-23 (terms) |
| A-04 | Razorpay keeps about ₹10 of a refunded ₹299 payment; a standard refund takes 5–7 working days, cards up to 10 | **Verify** before go-live | [decisions.md](../../docs/decisions.md) 2026-10-23 (refund rule) |
| A-05 | The payment methods are cards and UPI AutoPay | Must match what Razorpay switches on after activation (**verify**) | [decisions.md](../../docs/decisions.md) 2026-10-23 (GST and methods) |

## Issues

Open on 2026-10-24:

| ID | Issue | Effect | Next step | Source |
|---|---|---|---|---|
| I-01 | Every scheduled sweep since 2026-10-23 15:09 UTC failed: Anthropic answered HTTP 400 for all four categories | Nothing new saved; Pro members get no new findings. The last good sweep was at 10:09 UTC that day | Owner: put a key from the owner's own Anthropic account, with credit, in Vercel Production and redeploy (RM-01). The exact reason is unknown; the next failure notice will give it (I-02, closed) | GitHub Actions run logs; the failure email |
| I-03 | Outlook.com files the emails in Junk; Gmail filed the first confirmation as spam | See R-05 | Recheck as the domain ages; perhaps the owner's own domain for the site (RM-16) | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| I-04 | Chrome showed a "Dangerous site" warning on the confirm link (2026-10-22) | New visitors may stop there. The cause is unknown | Parked by the owner: move to the owner's own domain, then ask Google for a review | [account-flows.md](../../docs/subscriptions/account-flows.md#what-should-change) #1 |
| I-05 | The terms page waits for an adviser's liability clause | Razorpay's website review may not pass until terms ships (**verify** the required pages), so live payments wait too | Owner, with an adviser (RM-04) | [decisions.md](../../docs/decisions.md) 2026-10-23 |

Closed, kept for the record:

| ID | Issue | Fix | Source |
|---|---|---|---|
| I-06 | The first production sweep saved items from only 1 of 4 categories | The output token limit was raised to 16,000, because thinking counts toward it; a test covers a cut-off reply | `f200a79`; [CHANGELOG](../../CHANGELOG.md) 2026-10-21 |
| I-07 | One inbox could subscribe several times under different spellings (Gmail dots, `+tags`) | One subscription per inbox, keyed on the canonical address | `33d1ef1`; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| I-02 | The failure notice said only `http 400`: the code dropped Anthropic's error message, so the cause of I-01 had to be guessed | The notice gives the error's type and message on one line, capped at 200 characters, with the key blanked if it appears (RM-02) | `1ff7825`, PR #79; [CHANGELOG](../../CHANGELOG.md) 2026-10-24 |
| I-08 | An already-confirmed address was told "a confirmation link is on its way" and then got no email | The reply says the address is subscribed and emails its manage link, at most once a day | `3af6403`; [decisions.md](../../docs/decisions.md) 2026-10-22 |

## Dependencies

| ID | Depends on | For | Limit or condition that matters | Source |
|---|---|---|---|---|
| D-01 | Anthropic API | Every sweep: `claude-sonnet-5-5` with web search | Needs a key with credit; see R-03 and I-01 | `api/_lib/handlers.js`, `api/_lib/radar.js` |
| D-02 | Vercel | Pages, the 9 functions, Blob storage, environment variables | Hobby: 12 functions (9 used), 2,000 Blob advanced operations a month, one rate-limit rule, no commercial use | [T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md) C9; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| D-03 | GitHub Actions | Calls the sweep every 5 hours | Runs can start late when GitHub delays them; Vercel's daily cron is the backstop | `.github/workflows/sweep.yml`; T23 B2 |
| D-04 | Resend | Confirmation, sign-in and digest emails | Free plan: 100 emails a day. The sending domain is verified with DMARC (D8) | [decisions.md](../../docs/decisions.md) D7, D8 |
| D-05 | Razorpay | Checkout, subscriptions, the webhook | Live activation, which includes a review of the website | [payments-razorpay.md](../../docs/subscriptions/payments-razorpay.md#prerequisites) |
| D-06 | Google | "Continue with Google" | Google won't publish the app without a privacy policy link (now live); the client keys aren't set yet | [decisions.md](../../docs/decisions.md) 2026-10-22 |
| D-07 | The sending domain | Email from `hello@pehchanthetraveller.com` | Renewal is an open owner input (RM-09) | D8; [T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md) |
| D-08 | An adviser and a CA | The liability clause; GST and tax questions | Neither is engaged yet, as far as the repo records | [decisions.md](../../docs/decisions.md) 2026-10-23; [costing.md](../../docs/subscriptions/costing.md#tax-and-legal-questions-for-a-ca) |
