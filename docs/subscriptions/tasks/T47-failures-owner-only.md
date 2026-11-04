# T47 · Only the owner hears that a check failed; everyone else gets the last good results

| | |
|---|---|
| Phase | 5, board UX and emails |
| Who | Developer |
| Size | M |
| Depends on | T46 (a failed check keeps the last results) |
| Unblocks | — |

> Added 2026-11-04, at the owner's request: "don't show failed sweep to everyone, show them last run if anytime
> latest sweep fail". Asked whether this meant the board only or the emails too, the owner chose both.

## Why

T46 keeps a failed category's last good results on the board, but it also tells every Pro viewer that the check
failed:
- a "couldn't complete" line under the category;
- a banner when a whole run saved nothing;
- a line in Copy report.

The emails don't carry results forward. A failed category drops out of the Pro and Free emails. When every
category fails, as on 2 and 3 Nov, subscribers get no email at all.

The owner's decision: **a failure is the owner's business only. When the latest check fails, subscribers and board
viewers get the last good results instead**, on the board and in the emails. The owner's own digest, failure
notice and alert still name the failure.

## What was built

### Board ([travel-problem-radar.jsx](../../../travel-problem-radar.jsx), rebuilt into `live/` and `demo/`)

Carry-forward works as in T46. The items come from the newest earlier sweep where the check finished, and the
cards are tagged "Sweep of {day}". Star, votes and share use the item's own sweep. Only the wording changes:

| Failed category | T46 | T47 |
|---|---|---|
| Earlier results found | The latest check couldn't complete. Showing results from the sweep of {day}. | Showing results from the sweep of {day}. |
| The last check that finished found nothing | …couldn't complete. The last check that finished … found nothing. | Checked {that sweep's time}: nothing found. |
| Nothing within 12 sweeps | …couldn't complete, and there are no earlier results to show. | The category is hidden, as before T46 |
| Still looking | …Looking for earlier results… | No line |

- These lines are no longer in the warning colour.
- "Checked {time}: nothing found this time." stays for a category whose check finished. It isn't a failure.
- **Removed:**
  - the banner;
  - the board's read of `radar:lastRun`;
  - the Copy report "couldn't complete" lines.

### Server

- **`/api/data`** refuses `radar:lastRun` again, Pro included ([api/_lib/handlers.js](../../../api/_lib/handlers.js)).
  The sweep still writes it for the owner, in the Blob store, and still saves `cats` in each sweep file.
- **The empty result** of `runDailySweep` now has `id`, `at`, the slot and `cats`
  ([api/_lib/radar.js](../../../api/_lib/radar.js)).
- **The owner's digest:** the FAILED line ends "subscribers and the board get its last results instead".

### Emails ([api/_lib/subscriber-delivery.js](../../../api/_lib/subscriber-delivery.js), [api/_lib/email.js](../../../api/_lib/email.js))

- **`carryFor(storage, sweep)`** reads the history once. For each category whose `sweep.cats` entry is `"failed"`,
  it calls the shared `findCarry` with a loader that caches each sweep it reads.
  - It counts back from the sweep's place in the history, or from the end when the sweep wasn't saved.
  - The items it returns are not New, and carry `fromAt`, the time of the sweep they are from.
  - A sweep without `cats` brings none.
- **Pro and Free** both add the carried items whose ids the email doesn't already hold, then apply the member's
  category and area choices as before. A member whose only chosen category failed now gets its last results.
- **A carried item's meta line** ends "From the sweep of {day}", in the HTML and the plain text. Subscriber emails
  still never show a FAILED line.
- **A run where every check failed** saves nothing, but the sweep handler now also delivers to subscribers. It
  passes the run with no problems of its own, so everything comes from `carryFor`.
  - The idempotency keys use the run's own id, so they can't clash with the last saved sweep's emails.
  - Pro slots and the Free once-a-day rule apply as before.
  - A run where every check finished but found nothing still sends subscribers nothing.
  - A run that crashes (the 500 reply) still tells only the owner.

### What subscribers will notice

- **Pro, in a slot where every check failed:** an email where every item is tagged "From the sweep of {day}", with
  0 new. They will mostly have had these items before.
- **Free, on a day where every sweep failed:** the daily email, with the last results, where before there was none.

## How it was checked

- `npm test`: 1,748 pass, 12 more than T46. `npm run check`: 259 pass, 1 more.
- The board, in headless Chrome against the T46 stub, at desktop width and at about 500 px:
  - the plain line and the tagged cards;
  - a failed category with nothing earlier is hidden;
  - there is no banner.
- A sample Pro email and Free email with a failed category, built by the real delivery code with a fake Resend and
  screenshotted. Nothing was sent to anyone.
- **Not checked yet:** a production sweep. Nothing should change while every check finishes.

## Acceptance criteria

- [x] The board never says a check failed, and doesn't read `radar:lastRun`
- [x] `/api/data` refuses `radar:lastRun` for everyone
- [x] A failed category's last results reach Pro and Free emails, tagged with their sweep's day
- [x] A run where every check failed still reaches subscribers; one that finished with nothing doesn't
- [x] No subscriber email says FAILED or "couldn't complete"
- [x] The owner's digest, failure notice and alert still name the failure
- [x] Docs: TECHNICAL.md, CHANGELOG.md, DEPLOYMENT.md

## Tests

- **`scripts/test-sweep.mjs`:**
  - the all-failed result has the run's id, time and `cats`;
  - `/api/data` refuses `radar:lastRun`;
  - the owner's FAILED line has the new wording.
- **`scripts/test-subscriptions.mjs`, the T10 block:**
  - an all-failed scheduled run is still 502;
  - the owner's failure email goes first;
  - Pro and Free each get the last results, tagged, with no failure wording;
  - the Pro key is the failed run's, not the last saved sweep's;
  - an empty run where every check finished sends subscribers nothing.
- **`scripts/test-subscriptions.mjs`, the T47 block:**
  - `carryFor` finds the newest finished check, reads a shared sweep once, counts from the end for an unsaved run,
    and brings nothing without `cats`;
  - a Free item that is in the roll-up and in the carry comes once, untagged;
  - a Pro member who chose only a failed category gets its last results;
  - the paywall check now expects `radar:lastRun` to be refused.
- **`scripts/check.mjs`:** neither bundle reads `radar:lastRun` or says "couldn't complete".
