# TS18 results · Cross-browser and device testing

| | |
|---|---|
| Task | [TS18](../TS18-cross-browser-and-device-testing.md) |
| Run | 2026-10-30 |
| Commit | `d2b9639` (main) |
| Environment | None run: no browser was connected to Claude in Chrome, and phones, Safari and email clients need a person |
| Run by | Claude Code prepared the sheet; the runs are the owner's |

## Results

| Browser | Device and width | Priority | Result | Notes |
|---|---|---|---|---|
| Chrome (latest) | Windows or Mac laptop, 1280 px | 1 | Needs owner | Claude Code can run it if a Chrome browser is connected, signed in as Pro |
| Chrome | Android phone, 360 px | 1 | Needs owner | |
| Safari | iPhone, 390 px | 1 | Needs owner | |
| Edge (latest) | Windows, 1280 px | 2 | Needs owner | |
| Firefox (latest) | Windows, 1280 px | 2 | Needs owner | |
| Safari | Mac, 1280 px | 2 | Needs owner | |
| Any | Tablet, 768 px | 3 | Needs owner | |
| Payment on phones (Chrome Android, Safari iPhone) | Staging, test card | 1 | Blocked | Staging is about 121 commits behind `main` |
| Email: Gmail web, Gmail app, Outlook, Apple Mail | Test inboxes on staging | — | Blocked | Staging, as above |

What every row runs: the TS13 smoke list, then read the demo, sign in, open `/live/` as Pro, filter, search and save,
and open a shared problem link (for example the `/p/...` link checked in API-5, [TS11](TS11-api-testing-results-2026-10-30.md)).

**Totals:** 7 Needs owner, 2 Blocked. The 3 priority-1 browser rows must pass before a release.

## Bugs found

None (nothing was run).

## Left to do

| What | Who |
|---|---|
| Run the 3 priority-1 rows, and record date and pass or fail here | Owner (or Claude Code for Chrome desktop with a connected browser) |
| Payment on phones and the email clients, once staging is on `main` | Owner |
| Priority 2 and 3 rows | Owner, when time allows |
