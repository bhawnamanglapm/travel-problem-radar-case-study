# TS18 · Cross-browser and device testing

| | |
|---|---|
| Component | Cross-browser and device testing |
| Who | The owner, on their own devices; Claude Code fixes what's found |
| Status | Not started: headless Chrome runs in October; no other browser, phone or email client on record |
| Depends on | TS10, TS17 |
| Size | M |
| Unblocks | TS20 |

## What it means here

Checking the site, the Razorpay checkout and the emails work the same on the browsers, screens and inboxes the
target users have. The target users are PMs and founders, so desktop Chrome and phones matter most. The emails
matter as much as the pages, since for Free members the email is the product.

## In place today

- The README records headless-browser runs on 18 Oct 2026: the demo (19 checks) and the live page with the data
  feed stubbed (16 checks), including phone width. The browser isn't named there.
- `check.mjs` checks the bundles are built and fresh, not how they render.
- Nothing on record for Firefox, Safari, Edge, real phones, or any email client.

## Gaps

- No matrix, so nobody knows which combinations work.
- Safari on iPhone is untested. It can treat cookies and dialogs differently from Chrome, and sign-in depends on the
  `SameSite=Lax` session cookie surviving the return from Razorpay and Google.
- Email clients are untested. Gmail, Outlook and Apple Mail each render HTML email differently, and Gmail's one-click
  unsubscribe is client-specific.

## The work

1. **The matrix.** Run the TS13 smoke list plus these journeys: read the demo; sign in; open `/live/` as Pro; filter,
   search and save; open a shared problem link. Payment journeys run on the `staging` Preview with a Razorpay test
   card.

| Browser | Device and width | Priority |
|---|---|---|
| Chrome (latest) | Windows or Mac laptop, 1280 px | 1 |
| Chrome | Android phone, 360 px | 1 |
| Safari | iPhone, 390 px | 1 |
| Edge (latest) | Windows, 1280 px | 2 |
| Firefox (latest) | Windows, 1280 px | 2 |
| Safari | Mac, 1280 px | 2 |
| Any | Tablet, 768 px | 3 |

2. **Payment on phones** (staging, test card): Chrome Android and Safari iPhone. The checkout opens, completes,
   returns to the site and Pro turns on. Also with Google sign-in first (bug note 1, TS19).
3. **Email clients.** Send each email in the TS10 list to test inboxes on staging, and open it in:

| Client | Check |
|---|---|
| Gmail web | Layout, links, images off, the one-click Unsubscribe next to the sender |
| Gmail app (Android or iPhone) | Layout at phone width, links open |
| Outlook (web or desktop) | Layout, buttons, dark mode |
| Apple Mail (iPhone or Mac) | Layout, dark mode |

4. **Record** in a table at the end of this file: combination, date, pass or fail, and the TS19 bug id for a fail.
5. **Fix** in priority order. Rows at priority 1 must pass before a release.

## Done when

- Every priority 1 row passes, and the priority 2 rows are run once.
- Payment works on both phones.
- Every email passes in Gmail web and app, and is run once in Outlook and Apple Mail.

## Tools and cost

- The owner's own laptop and phone, and DevTools device mode for widths: free. Device mode isn't a real phone, so the
  priority 1 phone rows need real devices.
- Test inboxes on Gmail and Outlook.com: free.
- Paid device clouds (BrowserStack, LambdaTest) and email previews (Litmus, Email on Acid) are **ask first**.

## Risks and notes

- Browsers update every few weeks. Record versions with each run.
- If no iPhone is available, say so in the record. Don't mark Safari as passed from device mode.
- Never use a real subscriber's inbox to test.
