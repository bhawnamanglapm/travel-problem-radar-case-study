# RAID log: risks, assumptions, issues, dependencies

> **Stage 4 of 8.** State on 2026-10-31 (first written 2026-10-24). Each row cites where it comes from; the cost and safeguard rows summarise
> [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards), which stays the detailed source. "Owner"
> means a step only the owner can take. Links to the [roadmap](roadmap.md) are by `RM-` ID.

## Risks

| ID | Risk | Effect | Safeguard today | Still open | Source |
|---|---|---|---|---|---|
| R-01 | The findings are wrong or stale, and a paying member relies on them | The product's main claim fails | Every item links its source; every page tells the reader to check it (REQ-10) | No live sweep has been scored by a person. The 2026-10-30 model test's blind review was marked by ChatGPT. pricing.md said not to charge before one is scored; charging started 2026-10-28 at ₹1 (RM-13) | [pricing.md](../../docs/subscriptions/pricing.md); [v1 PRD](../../docs/PRD.md#risks) |
| R-02 | Spend runs away: a leaked `CRON_SECRET`, a dearer `RADAR_MODEL`, more sweeps than planned, or a costly sweep | Costs above the model; extra emails to Pro | Manual sweeps capped at 3 a day in code (PR #60) | Whether a spend limit is set in the Anthropic Console is **not verified** (RM-08) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards) |
| R-03 | One AI vendor does all the finding | When Anthropic refuses calls, nothing new is saved. This happened on 2026-10-23 (I-01) | Partial results are saved; if every category fails, nothing is saved and the board keeps the last sweep; a failure notice is sent | No second provider. Production runs the cheaper `claude-haiku-5-5` since 2026-10-25, kept by the 2026-10-30 model test (DSC-08) | [decisions.md](../../docs/decisions.md) 2026-10-18 (sweep guardrails); [CHANGELOG](../../CHANGELOG.md) 2026-10-21 |
| R-04 | Sign-ins use up Resend Free's 100 emails a day | Digests stop | `MAX_CONFIRMS_PER_DAY` cut from 500 to 50 (2026-10-29), leaving about half the day's emails for digests and sign-ins | Resend Pro before the first paying member (RM-08). Payments went live on 2026-10-28 and the account was still on the free plan on 2026-10-29 | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards); D7 and 2026-10-29 in [decisions.md](../../docs/decisions.md) |
| R-05 | Emails land in Junk or spam | Members never see the confirm link or the digest | The sign-up reply says to check spam | I-03 | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| R-06 | Razorpay webhooks stop arriving | A paid account stays Free | Check the webhook is Enabled; compare Razorpay's active subscriptions with Pro records weekly by hand | Manual | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards) |
| R-07 | A refund or chargeback | The account stays Pro | Revoke by hand; since 2026-10-29 `revoke-pro --paid` also cancels the Razorpay subscriptions at once | A webhook handler later (RM-21) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards); [refunds-and-chargebacks.md](../../docs/subscriptions/refunds-and-chargebacks.md) |
| R-08 | Vercel Hobby used commercially | Breach of Vercel's terms (**verify** the current fair-use terms) | Was: `paid` is `false`, nothing is charged. **Now no safeguard:** live payments since 2026-10-28, still on Hobby | Move to Vercel Pro, an open T27 step (RM-05) | [costing.md](../../docs/subscriptions/costing.md#risks-and-safeguards); [T27](../../docs/subscriptions/tasks/T27-razorpay-test-run-and-go-live.md) |
| R-09 | Hobby locks Blob for 30 days after 2,000 advanced operations in a month | Subscriber records and sweeps live in Blob, so the site can't save either while it's locked | A Vercel Firewall rate-limit rule in front of `/api/subscribe` | Each sweep uses 12 advanced operations, so 5 sweeps a day is about 1,920 a month before any member acts (T39 notes, from the code; not checked against the dashboard). On Vercel Pro, Blob operations are billed by use instead (RM-05) | [decisions.md](../../docs/decisions.md) 2026-10-22 (T13 part B) |
| R-10 | The policy pages haven't been reviewed by a lawyer | A promise or a gap in them could be wrong | The owner chose to publish and update them later | Terms shipped 2026-10-29 with the owner's plain liability clause; an adviser's check of it is open (T30 step 3) | [decisions.md](../../docs/decisions.md) 2026-10-22, 2026-10-23 |
| R-11 | "Continue with Google" trusts the `id_token` because it comes straight from Google over TLS, not by checking its signature | Recorded as a trade-off of the hand-written sign-in | None; Google sign-in is on (TS09, 2026-10-30) | — | [decisions.md](../../docs/decisions.md) 2026-10-22 |
| R-12 | Pro's price, ₹1 a month or a year, is below its cost | Revenue can't cover about ₹6,797 a month at any number of members | The owner's decision, "the real price for now" (2026-10-29) | The target price is **OWNER INPUT NEEDED** | [decisions.md](../../docs/decisions.md) 2026-10-29; [costing.md](../../docs/subscriptions/costing.md#break-even) |
| R-13 | Test-mode subscriptions count as paid Pro | `/admin/` showed 5 paid Pro against 3 live payments (2026-10-29), so counts overstate paying members | The owner confirmed in Razorpay that the 2 are test-mode; they end on Nov 25 and 26 | Until then, read paying members from Razorpay, not `/admin/` | [progress.md](../../docs/subscriptions/tasks/progress.md), T27 |
| R-14 | `staging` is 121 commits behind `main` | The real Razorpay, Resend and Google checks (IT-1 to IT-8) would test old code, so they were blocked in the first test run | — | Update `staging` before the next test run | [progress.md](../../docs/subscriptions/tasks/progress.md), T20; [TS07 results](../08-testing/results/TS07-integration-testing-results-2026-10-30.md) |
| R-15 | Asking for India items yields weak or invented ones | Items stretched to fill the 2 India places, or with a source search never returned, shown to paying members | The prompt says to return none rather than stretch (T42); sources over 60 days old are dropped (REQ-45); the log's `searched` flag marks a link search never returned | No India item has been scored. On or after 2026-11-06, a week after T42 went live, read `llm-logs.mjs models` (`searched`, dropped) beside `llm-logs.mjs areas` (RM-38) | [T42](../../docs/subscriptions/tasks/T42-india-focus.md) |
| R-16 | Indian sources are paywalled or not indexed by web search | Few India items, or ones from secondary sites, so KPI-20 stays low | The prompt names the kinds of Indian source: DGCA, the Ministry of Civil Aviation, IRCTC and Indian Railways, Indian airlines and online travel agencies, Indian news and consumer forums | Which sources search returns isn't known until a week of sweeps is read (RM-38) | [T42](../../docs/subscriptions/tasks/T42-india-focus.md) |
| R-17 | Taking the radar to government (RM-40) | A wrong or invented item costs far more in front of a ministry than a PM; government work brings duties under India's data law (the Digital Personal Data Protection Act, 2023) | The R-15 safeguards; every item links its source | No check of the data law has been done; it is to be done before RM-40 (owner) | The owner, "I want to take this till govt of india" (2026-10-31) |

## Assumptions

The product assumptions are `DSC-01` to `DSC-10` in the [discovery log](../01-discovery/discovery-log.md#assumptions-and-their-evidence).
The ones below are planning assumptions: the numbers and outside rules the plan rests on.

| ID | Assumption | Status | Source |
|---|---|---|---|
| A-01 | Was: about 5 scheduled sweeps a day, at about $0.21 each. Now: 1 to 5 a day, as the highest Pro choice needs (T32) | 10 Haiku sweeps, 26 to 30 Oct, averaged $0.1121 (`node scripts/llm-logs.mjs models`, 2026-10-30). costing.md's budget still uses $0.21. A month of real spend hasn't been read (RM-14). From T42 each call may run 4 searches, not 3; the cost per sweep is to be read again on or after 2026-11-06, a week after it went live (RM-38) | [costing.md](../../docs/subscriptions/costing.md#measurement-checklist); [TECHNICAL.md](../../docs/TECHNICAL.md) |
| A-02 | 24 to 28 members at ₹299 a month cover the running costs | Follows from A-01 and the cost model. The price is ₹1 since 2026-10-25 (R-12), so this holds only for the break-even analysis | [costing.md](../../docs/subscriptions/costing.md#break-even) |
| A-03 | For card mandates, the bank sends the notice before each automatic payment | From the RBI e-mandate framework and Razorpay's FAQ; **verify** before go-live | [decisions.md](../../docs/decisions.md) 2026-10-23 (terms) |
| A-04 | Razorpay keeps about ₹10 of a refunded ₹299 payment; a standard refund takes 5–7 working days, cards up to 10 | **Verify** before go-live | [decisions.md](../../docs/decisions.md) 2026-10-23 (refund rule) |
| A-05 | The payment methods are cards and UPI AutoPay | Must match what Razorpay switches on after activation (**verify**) | [decisions.md](../../docs/decisions.md) 2026-10-23 (GST and methods) |

## Issues

Open on 2026-10-30:

| ID | Issue | Effect | Next step | Source |
|---|---|---|---|---|
| I-03 | Outlook.com files the emails in Junk; Gmail filed the first confirmation as spam | See R-05 | Recheck as the domain ages; perhaps the owner's own domain for the site (RM-16) | [progress.md](../../docs/subscriptions/tasks/progress.md) |
| I-04 | Chrome showed a "Dangerous site" warning on the confirm link (2026-10-22) | New visitors may stop there. The cause is unknown | The site moved to the owner's own domain on 2026-10-28. Whether the warning is gone isn't recorded; ask Google for a review if it returns | [account-flows.md](../../docs/subscriptions/account-flows.md#what-should-change) #1 |
| I-10 | BUG-002: one account, the one used to test Razorpay, doesn't see the live board while another does | Severity S1 until the cause is known, priority P1 | Compare both records read-only with `subscribers.mjs show --check`; the owner gives the two addresses in chat, never in the repo | [TS19](../08-testing/TS19-bug-reporting-and-retesting.md) |
| I-11 | The first test run (2026-10-30) ended **not ready to sign off** | No release sign-off; UAT-3 isn't done | BUG-001 and BUG-008 to BUG-011 fixed; the owner closed 10 bugs without retests (2026-10-30). BUG-002 (I-10) and UAT-3 remain | [results](../08-testing/results/README.md); [TS19](../08-testing/TS19-bug-reporting-and-retesting.md) |

Closed, kept for the record:

| ID | Issue | Fix | Source |
|---|---|---|---|
| I-05 | The terms page waited for an adviser's liability clause | Shipped 2026-10-29 with the owner's plain clause; the adviser's check moved to R-10 | [progress.md](../../docs/subscriptions/tasks/progress.md), T25 |
| I-01 | Every scheduled sweep from 2026-10-23 15:09 UTC failed: Anthropic answered HTTP 400 for all four categories. The reason, once logged (I-02): "Your credit balance is too low" | A new key with credit in Vercel Production, deployed 2026-10-25 17:00 UTC; a manual sweep at 17:18 UTC saved all four categories (RM-01) | GitHub Actions run 40215787749; [CHANGELOG](../../CHANGELOG.md) 2026-10-25 |
| I-06 | The first production sweep saved items from only 1 of 4 categories | The output token limit was raised to 16,000, because thinking counts toward it; a test covers a cut-off reply | `f200a79`; [CHANGELOG](../../CHANGELOG.md) 2026-10-21 |
| I-07 | One inbox could subscribe several times under different spellings (Gmail dots, `+tags`) | One subscription per inbox, keyed on the canonical address | `33d1ef1`; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| I-02 | The failure notice said only `http 400`: the code dropped Anthropic's error message, so the cause of I-01 had to be guessed | The notice gives the error's type and message on one line, capped at 200 characters, with the key blanked if it appears (RM-02) | `1ff7825`, PR #79; [CHANGELOG](../../CHANGELOG.md) 2026-10-24 |
| I-09 | A code audit on 2026-10-24 found 9 bugs and 3 design risks. The worst: if Razorpay's webhook landed while Checkout's return was running, the payer stayed Free; and Confirm on a forwarded digest signed the reader in | Fixed in four PRs: the board and the sweep; Confirm signs in only when it confirms; subscriber updates re-check the stored record and retry, so none undoes another; the admin `delete` refuses a subscription that still charges, and the sign-up and sign-in limits say what they are (RM-25) | PRs #81 to #84; [CHANGELOG](../../CHANGELOG.md) 2026-10-24 |
| I-08 | An already-confirmed address was told "a confirmation link is on its way" and then got no email | The reply says the address is subscribed and emails its manage link, at most once a day | `3af6403`; [decisions.md](../../docs/decisions.md) 2026-10-22 |

## Dependencies

| ID | Depends on | For | Limit or condition that matters | Source |
|---|---|---|---|---|
| D-01 | Anthropic API | Every sweep: `claude-haiku-5-5` (the default since 2026-10-25; `RADAR_MODEL` overrides it) with web search | Needs a key with credit; see R-03 and I-01 (closed) | `api/_lib/handlers.js`, `api/_lib/radar.js` |
| D-02 | Vercel | Pages, the 10 functions, Blob storage, environment variables | Hobby: 12 functions (10 used since `/api/admin`, 2026-10-26), 2,000 Blob advanced operations a month, one rate-limit rule, no commercial use | [T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md) C9; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| D-03 | GitHub Actions | Calls the sweep in 5 fixed UTC slots; unneeded slots are skipped (T32) | Runs start late: 228 to 418 minutes on 2026-10-26 to 29, still counted in the right slot (T35). Vercel's daily cron at 00:05 UTC is the backstop (BUG-008) | `.github/workflows/sweep.yml`; T23 B2 |
| D-04 | Resend | Confirmation, sign-in and digest emails | Free plan: 100 emails a day, still the plan on 2026-10-29 (R-04). The sending domain is verified with DMARC (D8) | [decisions.md](../../docs/decisions.md) D7, D8 |
| D-05 | Razorpay | Checkout, subscriptions, the webhook | Live mode since 2026-10-28, after the website review | [payments-razorpay.md](../../docs/subscriptions/payments-razorpay.md#prerequisites) |
| D-06 | Google | "Continue with Google" | The client keys are set and Google sign-in is on (TS09, 2026-10-30). After the domain move its redirect URI must name the new address (CHANGELOG 2026-10-28) | [decisions.md](../../docs/decisions.md) 2026-10-22 |
| D-07 | The sending domain | Email from `hello@pehchanthetraveller.com` | Renewal is an open owner input (RM-09) | D8; [T23](../../docs/subscriptions/tasks/T23-pro-display-standards.md) |
| D-08 | An adviser and a CA | The liability clause; GST and tax questions | Neither is engaged yet, as far as the repo records | [decisions.md](../../docs/decisions.md) 2026-10-23; [costing.md](../../docs/subscriptions/costing.md#tax-and-legal-questions-for-a-ca) |
