# Account flows: sign-up and sign-in

> **What this is:** the user flows as they run in production on 2026-10-22, after T16 and the `/signup/` page
> (PR #34). They are drawn from the code, not from the plan. Below them is a review against common practice for
> email-only accounts, with ranked changes. **The changes are proposals.** None is built or approved yet.
> The design behind these flows: [paid-website.md](paid-website.md). Where the pieces sit:
> [architecture.md](architecture.md).

## Flow 1: Create an account

Entry points:
- `/signup/` ("Create your account"). Only `/signin/` links to it.
- `/subscribe/` ("Get it by email"). The home page and the live board link to it.

Both post to `POST /api/subscribe` and create the same record.

```mermaid
flowchart TD
  A["Visitor opens /signup/ or /subscribe/"] --> B{"Already signed in<br/>on this browser?"}
  B -- "yes (/signup/ only)" --> B1["Shows: You're signed in<br/>board · manage · sign out"]
  B -- no --> C["Enters email, presses<br/>Create account"]
  C --> D{"What is this address?"}
  D -- "new" --> E["Confirmation email sent<br/>Reply: a link is on its way,<br/>check spam"]
  D -- "waiting for confirm,<br/>emailed in last 24 h" --> F["Nothing sent<br/>Reply: already sent,<br/>check inbox"]
  D -- "already has an account" --> G["Email with the manage link<br/>(at most once a day)<br/>Reply: already subscribed"]
  D -- "limit reached / bot field" --> E2["Nothing sent<br/>Same reply as new"]
  E --> H["Opens link in email"]
  H --> I["Page with a Confirm button<br/>(stops mail scanners)"]
  I --> J["Presses Confirm"]
  J --> K["Account active + signed in<br/>on this browser (30-day cookie)"]
  K --> L["Page: Your account is ready<br/>→ Open the live board"]
  H -. "after 7 days" .-> X["Link invalid,<br/>address deleted"]
  G --> M["Manage page via email link<br/>(not signed in)"]
```

## Flow 2: Sign in again

Entry points:
- `/signin/`.
- `/manage/`, when it has no email link and no cookie.

Nothing on the home page or the live board links here yet.

```mermaid
flowchart TD
  A["Opens /signin/"] --> B{"Already signed in?"}
  B -- yes --> B1["Shows: You're signed in<br/>board · manage · sign out"]
  B -- no --> C["Enters email,<br/>presses Email me a link"]
  C --> R["Same reply for everyone:<br/>if that address has an account,<br/>a link is on its way"]
  C --> D{"Behind the scenes"}
  D -- "active account" --> E["Sign-in email sent<br/>link works 15 min, once"]
  D -- "unknown or not confirmed" --> N["Nothing sent"]
  D -- "asked under 5 min ago /<br/>daily or per-IP limit" --> N
  E --> F["Opens link"]
  F --> G["Page with a Sign in button"]
  G --> H["Presses Sign in"]
  H --> I["30-day cookie set<br/>→ always lands on /live/"]
  F -. "used before / expired" .-> Z["This link isn't valid<br/>→ ask for a new one"]
```

## Flow 3: While signed in

```mermaid
flowchart LR
  S["Signed in<br/>(cookie, this browser)"] --> M["/manage/ without a link:<br/>plan, categories, Pro request"]
  S --> V["/live/ board<br/>(open to everyone until T17)"]
  M --> O["Sign out"]
  S --> O
  O --> P["Cookie cleared → /manage/<br/>sends you to /signin/"]
  S -. "30 days pass, or owner<br/>signs everyone out" .-> P
  M --> U["Unsubscribe link in any email<br/>→ account deleted"]
```

Solid lines are what a person does. Dotted lines are what happens over time or on failure.

**Checked in production on 2026-10-22, with a real inbox:**
- Flow 1, from a pending address to "Your account is ready";
- Flow 3: `/manage/` by cookie and Sign out.

Flow 2's emailed link is not checked yet. See [progress.md](tasks/progress.md).

## What is right, and should stay

| What | Why |
|---|---|
| No passwords | Nothing to store, leak or reset. The inbox proves who you are, which fits a product that already lives in email |
| A button after every link | Mail scanners open links automatically. Requiring a press means they can't confirm or sign anyone in |
| Confirming signs you in | A new user never has to sign in separately right after signing up |
| Short, single-use sign-in links | 15 minutes, once. A forwarded or old email can't be reused |
| The cookie | Signed, `HttpOnly`, 30 days, holds no address, and a `POST` from another site is refused |
| Limits and a bot trap | Daily caps, a per-connection limit and a hidden field stop bots from using up the email quota |

## What should change (proposals)

The items are ranked by how much each one blocks a real person. "Now" means a small fix worth doing before T17,
which sends every visitor through these screens. "With T17" means T17 needs it. "Later" can wait for real users.

| # | Problem | Proposed change | When |
|---|---|---|---|
| 1 | Chrome showed a full-page "Dangerous site" warning on the confirm link, so most new visitors stop there (see [progress.md](tasks/progress.md)) | Move the site to the owner's own domain, then ask Google for a review | Now (parked by the owner) |
| 2 | Nobody can find the account pages. The home page and the live board link only to "Get it by email". `/signup/` is linked only from `/signin/`. Only the account pages show whether you're signed in | Add "Sign in" to the home page and live board nav, and show "Account" there instead when signed in | Now |
| 3 | Two sign-up pages make one record with different words, and only `/subscribe/` has the Pro box. People can't tell whether a subscription and an account differ | Keep one form. Either `/subscribe/` becomes the plans page with a "Create account" button to `/signup/`, or `/signup/` redirects to `/subscribe/` | Now |
| 4 | A returning user who uses the sign-up form gets "already subscribed" and an email with the manage link. That link doesn't sign them in | For an existing account, send a sign-in link instead. The reply already says the address is subscribed, so this reveals nothing new | Now |
| 5 | Sign-in for an address that never pressed Confirm says "a link is on its way", and nothing arrives | For a pending address, re-send the confirmation link within the existing limits. The reply stays the same for everyone | Now |
| 6 | Sign-in always lands on `/live/`, not on the page the person started from | Remember where they started (pages on this site only) and return there after Sign in | With T17 |
| 7 | The account is the daily email: unsubscribing deletes the account. Fine for a free newsletter, but a paying Pro user who only wants fewer emails would lose what they paid for | Split "stop emails" from "delete my account": the email link turns emails off, and a manage-page button deletes the account (T17 already plans Delete my account) | With T17 to T20 |
| 8 | A link opened on a phone signs in the phone, not the laptop that asked | Also put a short code in the sign-in email that can be typed on the page that asked | Later |
| 9 | Two waits the page doesn't explain. A second sign-in request within 5 minutes sends nothing but still says "on its way". A lost confirmation can't be re-sent for 24 hours | Add "You can ask again in 5 minutes" to the sign-in reply. Allow a confirmation re-send after about 10 minutes, still capped per day | Later |

**Suggested order:**
1. The domain (#1), when the owner picks it up again.
2. One small PR for #2 to #5. No new server function is needed.
3. #6 and #7 inside T17.
4. #8 and #9 once there are real users asking.
