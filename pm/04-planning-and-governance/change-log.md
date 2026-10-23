# Change log: decisions that were revised

> **Stage 4 of 7.** Each row is a decision in [decisions.md](../../docs/decisions.md) that a later decision changed,
> written as a change request. There was no change board: the owner decided, often in conversation while building, and
> the decision log recorded it. Where the log says the reason isn't recorded, this page says so too. Dates are when
> the change appears in the repository.

| ID | Date | Was | Now | Why, as recorded | Impact and trade-off | Source |
|---|---|---|---|---|---|---|
| CR-01 | 2026-10-18 | The case study claimed email delivery, working buttons and "raised result quality" | Claims removed or qualified; offline checks fail if they return | No evidence in the repo for them | Less impressive copy | [decisions.md](../../docs/decisions.md) 2026-10-18 |
| CR-02 | 2026-10-21 | One server sweep a day, from Vercel's cron | A sweep every 5 hours from GitHub Actions; Vercel's daily cron kept as a backstop | Hobby allows only a daily cron; the reason for wanting more sweeps isn't recorded | About 5 sweeps a day instead of 1, which sets the cost floor | `b691d54`; [CHANGELOG](../../CHANGELOG.md) 2026-10-21 |
| CR-03 | 2026-10-22 | Payments only if free sign-ups show demand (the Phase 1 gate) | Phase 2 prerequisites start without the gate (T15) | Owner's choice; the reason isn't recorded | Payment work starts before demand is measured. pricing.md's rule not to charge before a scored sweep still stands | [decisions.md](../../docs/decisions.md) 2026-10-21, 2026-10-22 |
| CR-04 | 2026-10-22 | The board is public, so Pro can't sell access (pricing.md) | Pro pays for the live board; Free gets a teaser email | Owner's choice | Needed accounts, a locked data feed and a Pro account that survives unsubscribing | [decisions.md](../../docs/decisions.md) 2026-10-22; [paid-website.md](../../docs/subscriptions/paid-website.md) |
| CR-05 | 2026-10-22 | D6: no category choice in the first release | Pro members choose their categories on `/manage/` (T14) | The owner picked T14; pricing lists it as one of the few Pro features besides frequency | A Pro member whose categories have nothing in a sweep gets no email for it. No new function | [decisions.md](../../docs/decisions.md) D6 and 2026-10-22 |
| CR-06 | 2026-10-22 | A sign-in lasts 30 days | Until the browser closes, 12 hours at most | The owner asked that the last login not be remembered | More sign-ins, each one an email (R-04) | [decisions.md](../../docs/decisions.md) 2026-10-22 |
| CR-07 | 2026-10-22 | The same reply for every address at sign-up | An already-confirmed address is told so and emailed its manage link, at most once a day | The old reply promised an email that never came; the owner chose this fix | The reply now shows whether an address subscribes; the owner accepted that | `3af6403`; [decisions.md](../../docs/decisions.md) 2026-10-22 |
| CR-08 | 2026-10-22 | Sign in only by an emailed link | "Continue with Google" as well; then a new Google address confirms on a "Create your account" page first | The emailed link failed twice (a `wrong_origin` button and Chrome's warning). The owner wanted Google sign-up to go through sign-up steps | One more click for new people; Google stays off until its keys are set | [decisions.md](../../docs/decisions.md) 2026-10-22 (two rows) |
| CR-09 | 2026-10-22 | The home page was a portfolio case study | A customer product page with a sign-up / sign-in popup on every signed-out visit | The owner asked for a page fit for customers | The popup shows every time; Google counts covering popups against pages on mobile | [homepage-review.md](../../docs/site/homepage-review.md) |
| CR-10 | 2026-10-23 | Unsubscribing, a bounce or a complaint deletes the record | A Pro account outlives its emails (`emailOff`); `/manage/` gains Delete my account | The account is what Pro pays for; mailing a bounced or complaining address hurts the domain | A Pro's address stays stored until they delete the account. No command clears a bounce yet (RM-22) | [decisions.md](../../docs/decisions.md) 2026-10-23 |
| CR-11 | 2026-10-23 | `BOARD_PAYWALL` stays off until checkout works | Turned on in production before checkout exists | Owner's choice; the reason isn't recorded | Only accounts given Pro by hand read the board; "Live" links lead to a sign-in panel | [decisions.md](../../docs/decisions.md) 2026-10-22, 2026-10-23 |
| CR-12 | 2026-10-23 | T20 as written: checkout, return and cancel as three new functions | Actions on `/api/account` | Hobby allows 12 functions and the site had 8 | One endpoint does more, so its actions are tested together | [decisions.md](../../docs/decisions.md) 2026-10-23 |
| CR-13 | 2026-10-23 | GST left blank until a CA advises | Not registered, so no GST is charged | The owner's answer | If the owner registers, `plan.json` and the price wording change | [decisions.md](../../docs/decisions.md) 2026-10-23 |
| CR-14 | 2026-10-23 | Contact address `hello@pehchanthetraveller.com` | `pehchanthetraveller19@gmail.com` on every page, in `plan.json` and in `npm run check`; email is still sent from `hello@` | The owner asked for it | Option not taken: keep `hello@` as the contact | [decisions.md](../../docs/decisions.md) 2026-10-23 |

## What the pattern shows

- **The changes came from the owner and from the build, not from user feedback:** no one else's feedback is recorded
  (DSC-05). CR-06, CR-08 and CR-09 were the owner's requests; CR-08 followed the emailed link failing twice.
- **Three changes moved faster than the evidence:** CR-03 and CR-11 have no recorded reason, and CR-04 reversed a
  documented design. Each is noted as a trade-off in the decision log rather than hidden.
- **Hobby's limits shaped the design more than once** (CR-02, CR-12, and R-09 in the [RAID log](raid-log.md)).
