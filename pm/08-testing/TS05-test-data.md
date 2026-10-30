# TS05 · Test data

| | |
|---|---|
| Component | Test data |
| Who | Claude Code for offline data; the owner for staging accounts and inboxes |
| Status | Partial |
| Depends on | — |
| Size | S |
| Unblocks | TS07, TS08, TS16, TS18 |

## What it means here

The data each kind of test uses, where it lives, and the rules that keep it safe: no real customers, no secrets,
and a way to clean up afterwards.

## In place today

| Data | Where | Used by |
|---|---|---|
| In-memory Blob store | `memStorage()` in [test-helpers.mjs](../../scripts/test-helpers.mjs) | Every suite that stores records |
| Fake HTTP reply | `mockRes()` in test-helpers.mjs | Handler tests |
| Fake Anthropic replies | `fakeFetch` in [test-sweep.mjs](../../scripts/test-sweep.mjs), `fakeApi` in [test-compare.mjs](../../scripts/test-compare.mjs) | Sweep and model-compare tests |
| Fake Resend and Blob calls | `fakeResend`, `fakeGet`, `fakePut` in [test-subscriptions.mjs](../../scripts/test-subscriptions.mjs) | Delivery and storage tests |
| A saved sweep | [sampleData.json](../../sampleData.json) (July 2026) | The demo and `check.mjs` |
| Prices and refund rule | [plan.json](../../plan.json) | Pages and `test-plan.mjs` |
| Razorpay test mode | The `staging` Preview's test keys, Razorpay's published test cards | Payment checks on staging |
| Test inboxes | The owner's own | Sign-up, email and sign-in checks |

## Gaps

- **No inventory of staging records.** Test sign-ups, test Pro accounts and test subscriptions pile up.
- **Test data reached production.** Two test-mode subscriptions made before go-live were still counted as paid Pro
  in production on 2026-10-29 (T27 notes). They lapse on 25 and 26 Nov, or 48 hours later.
- **No rule** for which inbox is used for which test, so one inbox can be in several states at once (bug note 2).
- Offline fixtures are built inside each suite. There's no shared set of standard records (a Free member, a Pro
  member, a lapsed Pro, a pending sign-up).

## The work

1. **Name the test accounts.** One test inbox per state, kept in a private note, not in the repo:
   - new (never signed up);
   - Free, confirmed;
   - Pro, paid in test mode on staging;
   - Pro, granted by hand;
   - lapsed;
   - unsubscribed Pro.
2. **Keep test and live apart.** A test-mode payment is only ever made on `staging`. Production accounts are only the
   owner's own.
3. **A clean-up step** after each staging run: list test records with `scripts/subscribers.mjs` against the Preview
   store, then delete them with the admin page. The owner decides which; nothing is deleted automatically.
4. **Watch the two test-mode subscriptions** in production until they lapse; the sweep reply's
   `subscribers.rzpMismatch` count and LR-21's weekly check cover them (T27).
5. **Optional:** move the standard records into `test-helpers.mjs` as small builders (`freeMember()`, `proMember()`),
   when a suite next needs them. Not a separate task.

## Done when

- Each test state has a named inbox, recorded privately.
- The staging clean-up step is written and has been run once.
- The two test-mode subscriptions are gone from production's paid count.

## Tools and cost

- Razorpay test mode: free.
- No new tools.

## Risks and notes

- Never copy a production record to staging or into a test. Use made-up addresses offline (the suites mostly use
  `example.com`; the Gmail ones test address spellings and send nothing).
- Razorpay test card numbers are public, but keep them out of the repo anyway; link to Razorpay's docs instead.
- The `plan.json` contact address is real. Tests mustn't send to it.
