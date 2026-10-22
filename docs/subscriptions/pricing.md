# Subscription plan: tiers, costs and rollout

> **Draft proposal, nothing here is built.** Written on 21 Oct 2026. Cost figures come from
> [DEPLOYMENT.md](../../DEPLOYMENT.md) section 3. Any price or limit that is not in this repository is marked
> **check current price** and must be looked up before relying on it. All prices and thresholds are
> **OWNER INPUT NEEDED**: the repo holds no market data or user research. How the parts connect:
> [architecture.md](architecture.md).

## Why a subscription at all

Two things are true today. The board is public and free to read, and every sweep costs the owner money (about $0.21 a
sweep, about $32 a month at 5 sweeps a day). That cost is fixed: it does not rise with the number of readers or
subscribers. So a subscription is not paying for the AI calls one reader at a time. It pays for the fixed monthly bill
and for the effort of running a service.

The PRD records no users besides the owner and asks whether the radar is for one person or for a team
([PRD open question 1](../PRD.md)). So this plan builds in order of what can be learned cheapest: free email
sign-up first, payments only if people actually sign up.

## Tiers (draft)

> **Changed 2026-10-22 ([decision log](../decisions.md)):** Pro now pays for the **live board on the website**; the
> design is [paid-website.md](paid-website.md). The table below is the new plan; the board and the emails work as before until the `BOARD_PAYWALL` switch is turned on.

| | Visitor | Free account | Pro (paid) |
|---|---|---|---|
| Status | Exists today (board open to all) | Exists today as the free email | Planned |
| Demo with sample data | Yes | Yes | Yes |
| Live board (every sweep, history, Copy report) | No: sign-in or upgrade panel | No: upgrade panel | Yes |
| Email digest | No | Teaser once a day: counts and headlines, a link to sign in | Full digest after every saved sweep (up to 5 a day) |
| Choose categories | No | No | Yes (built, T14) |
| Sign in | — | By an emailed link, no password | By an emailed link, no password |
| Price | Free | Free | **OWNER INPUT NEEDED** (monthly and yearly) |

A "Team" tier is out of scope until someone other than the owner asks for it.

**The honest value check.** Until 2026-10-22 the board was public, so Pro could only sell convenience. Now Pro sells
access to the findings themselves. That only works if the free paths don't give them away: the demo shows a saved
sample, and the free email shows headlines without detail or sources. Whether people pay for AI-gathered, unverified
findings is still unmeasured; no real sweep has been scored yet.

The free daily email goes out after the first saved sweep of the UTC day. The scheduled run is at 00:17 UTC (about 05:47
IST), though GitHub can start scheduled runs late.

## Costs

### Fixed monthly costs

| Item | Amount | Source |
|---|---|---|
| Anthropic API, 5 scheduled sweeps a day | About $32 (about $0.21 a sweep, from one local test of all four categories) | DEPLOYMENT.md section 3; real production usage still to be confirmed |
| Vercel Pro (needed to charge money; the free Hobby plan is for non-commercial use) | **check current price** and the current terms | vercel.com/pricing |
| A domain (needed to send email to anyone but the owner) | **check current price** | Registrar |
| Resend beyond the free plan (100 emails a day, 3,000 a month) | **check current price** | resend.com/pricing |

### Costs that grow with subscribers

| Item | How it grows |
|---|---|
| Email | One email per recipient per digest. Confirmation emails count too. |
| Razorpay fees | A percentage and/or fixed fee on each payment and GST on the fee: **check current price** |
| Support and refunds | Owner time |

### Two formulas

**Break-even** for Pro: with fixed monthly costs `F` and, per Pro subscriber, a price after payment fees `p`:

```
Pro subscribers needed = F / p
```

Fill in `F` and `p` once the "check current price" figures above are looked up. Free subscribers add cost and no income, so keep the
free list within the email quota below.

**Email quota** (Resend free plan, 100 a day): the owner's copy goes out up to 5 times a day, each free subscriber gets
1 a day and each Pro subscriber up to 5 a day.

```
5 + free + (5 x pro) + confirmations  <=  100 emails a day
```

So with no Pro subscribers, about 90 free subscribers fit, fewer on days with many new sign-ups. The monthly cap of
3,000 works out to the same limit (3,000 / 30 days = 100). Set `MAX_SUBSCRIBERS` below this and move to a paid Resend
plan before raising it.

## Rollout order, with gates

1. **Phase 0, today.** Public board, owner-only email and Slack.
2. **Phase 1, free email sign-up.** Needs a verified domain. Design: [email-signup.md](email-signup.md).
3. **Measure for a period the owner picks** (**OWNER INPUT NEEDED**):
   - Sign-ups and the share who confirm.
   - Unsubscribes per digest.
   - Replies or clicks showing someone acts on an item.
   - A direct question to subscribers: would you pay, and how much?
4. **Gate.** Build payments only if those numbers pass a threshold the owner sets before looking at the results.
   Otherwise stay free and work on the open risk first: whether the findings are real (no real sweep has been scored
   yet, see the README).
5. **Phase 2, Razorpay Pro.** Design: [payments-razorpay.md](payments-razorpay.md).

## Before charging anyone: checklist

- [ ] A domain, verified in Resend (SPF and DKIM records), with `EMAIL_FROM` set on it
- [ ] Vercel Pro, and the current terms checked for commercial use
- [ ] A Razorpay account activated for live payments (business details and website review: check current requirements)
- [ ] Terms of service, privacy policy, refund and cancellation policy, and a contact address, published on the site
- [ ] Advice on GST and on income tax for software subscriptions, and on India's data-protection law (DPDP Act) for
  storing email addresses
- [ ] A support route and a rule for refunds
- [ ] At least one real sweep scored with the rubric in the README, so the product claim is evidence-based
- [ ] A line on the site that the findings are AI-gathered and not verified (already on the live page)

## Risks

| Risk | Note |
|---|---|
| Findings are wrong or stale and a paying customer relies on them | The main open risk in the README. Do not charge before the first scored sweep. |
| Spam complaints damage the sender's reputation | Double opt-in, one-click unsubscribe, a daily cap for free subscribers |
| Email quota is exceeded and the owner's own digest stops | The quota formula above, plus a `MAX_SUBSCRIBERS` cap |
| Storing a subscriber's Slack webhook URL | It is a secret. If it is built, accept only `hooks.slack.com` URLs and never log or return them. Consider leaving it out of the first Pro release. |
| Personal data of subscribers | Addresses live in the private Blob store, never in logs, replies or the public repo |

## Open questions (OWNER INPUT NEEDED)

1. Who is a subscriber: PMs on a team, solo PMs, founders, or recruiters? This sets the price range.
2. Currency and price points, monthly versus yearly, and whether there is a free trial.
3. The gate: how many confirmed subscribers and what unsubscribe rate count as enough to build Phase 2.
   (The numbers come from `node scripts/subscribers.mjs stats`: confirmed subscribers now, the confirm rate,
   unsubscribes per day split by plan, and Pro requests, from the sign-up box and the manage page's "Request Pro"
   button. A request is interest in a free Pro, not a promise to pay. See DEPLOYMENT.md, "Managing subscribers".)
4. Should Pro keep the free digest's timing (one a day) and add personalisation instead of volume?
5. Refund policy, and which country's tax rules apply to the business.
