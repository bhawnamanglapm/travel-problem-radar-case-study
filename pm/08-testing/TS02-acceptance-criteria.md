# TS02 · Acceptance criteria

| | |
|---|---|
| Component | Acceptance criteria |
| Who | The owner (PM, BA, product owner) approves; Claude Code drafts |
| Status | Partial: the T-files have criteria, the PRD doesn't |
| Depends on | TS01 (the REQs must be current first) |
| Size | M |
| Unblocks | TS03, TS04, TS09, TS16 |

## What it means here

The conditions a feature must meet to count as done, written so a test or a person can say pass or fail. Here, one
set per REQ in the PRD, in Given / When / Then form, linked to the T-file that already holds the detail.

## In place today

- Most T-files in [docs/subscriptions/tasks/](../../docs/subscriptions/tasks/) end with acceptance criteria (for
  example T41's "Done when").
- The PRD names each REQ's T-file in its Source column, so the criteria can be found, but they aren't in one place.
- REQ-01 to REQ-11 come from PRD v1 and have no T-file; their criteria are only the tests in
  [traceability.md](../02-product-definition/traceability.md).

## Gaps

| REQ | Gap |
|---|---|
| REQ-05 | The Copy button is checked by hand only (18 Oct 2026); no written criteria |
| REQ-13 | "One-click" isn't defined: which header, which client, what the user sees |
| REQ-21 | The board side is tested; the email side has no criteria |
| REQ-23 | Out of date (passwords exist), so its criteria are wrong |
| REQ-28 | Was "planned"; built 2026-10-30, criteria only in T22 |
| REQ-01 to REQ-11 | Criteria exist only as tests |

## The work

1. **Make one table** in this file: REQ, the T-file with its criteria, and the Given/When/Then lines. Copy the
   criteria from the T-file; don't invent new ones.
2. **Write the missing criteria** for the gaps. Drafts below, for the owner to approve or change.
3. **For REQ-01 to REQ-11**, turn each test section named in `traceability.md` into a Given/When/Then line.
4. **Mark each line** auto (a named test) or manual (a TS04 case).
5. **Add criteria for REQ-33 onwards** when TS01 gives T33 to T41 their ids.

### Drafts for the gaps

**REQ-05, the digest with Copy**
- Given a sweep with new and old items, when the reader opens the Report tab, then the digest lists new items first,
  as plain text.
- Given the Report tab, when the reader presses Copy, then the clipboard holds the same text and the button says it
  was copied.
- Given a browser that blocks the clipboard, when the reader presses Copy, then the page says it couldn't copy and
  the text can still be selected by hand.

**REQ-13, unsubscribe and one-click**
- Given any email we send to a subscriber, then it carries a visible unsubscribe link and the `List-Unsubscribe`
  and `List-Unsubscribe-Post` headers.
- Given Gmail shows its own Unsubscribe button, when the user presses it, then the subscriber gets no more email
  and no page needs to be opened.
- Given a Pro member unsubscribes, then Pro is kept (REQ-25) and only email stops.
- Given an old or invalid link, then the page says so and nothing else changes.

**REQ-21, Pro chooses categories (and areas, T41)**
- Given a Pro member who chose 2 categories, when a sweep is saved, then their email holds only items in those 2.
- Given a choice with nothing in a sweep, then that member gets no email, and the sweep reply counts it.
- Given a Free member, then the category choice on `/manage/` is shown but disabled.

**REQ-23, sign-in (rewritten for passwords)**
- Given an account, when the user signs in by emailed link, Google or password, then they reach `/manage/` signed in.
- Given a sign-in, when the browser closes or 12 hours pass, then the user is signed out.
- Given an emailed code, then it works once, within 15 minutes, and is stored hashed.
- Given too many wrong tries, then the server answers 429 and doesn't say whether the address exists.

**REQ-28, Pro expiry, paid unsubscribe, key safety**
- Given a paid Pro due to renew, when payment doesn't arrive, then Pro stays for 48 hours (`PRO_GRACE_HOURS`) and then
  becomes Free.
- Given a paid Pro unsubscribes, then the Razorpay subscription is cancelled first, and Pro runs to the end of the
  paid period.
- Given a test key on Production or a live key on a Preview, then payments are off and the sweep reply says
  `razorpay: "key mismatch"`.

## Done when

- Every REQ, including REQ-33 onwards, has at least one Given/When/Then line.
- Each line is marked auto, with the test section, or manual, with a TS04 case id.
- The owner approved the drafts for REQ-05, 13, 21, 23 and 28.

## Tools and cost

None. Free.

## Risks and notes

- The drafts above are written from the PRD, the T-files and the code's constants. The owner must approve them;
  they are not yet the agreed behaviour.
- Keep criteria about what the user sees, not how the code does it, so they survive refactoring.
