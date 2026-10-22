# Account flows: sign-up and sign-in

> **What this is:** the user flows on 2026-10-22, after T16, the `/signup/` page (PR #34) and the fixes for #2 to
> #5 below (branch `fix/account-flows`). They are drawn from the code, not from the plan. Below them is a review
> against common practice for email-only accounts, with ranked changes. #2 to #5 are done; the rest are still
> proposals. Flow 4, Continue with Google (#10), is built but stays hidden until the owner sets it up.
> The design behind these flows: [paid-website.md](paid-website.md). Where the pieces sit:
> [architecture.md](architecture.md).

## Flow 1: Create an account

Entry points:
- `/signup/` ("Create your account"), the one sign-up form, with an "I'd also like Pro" box. It posts to
  `POST /api/subscribe`.
- `/subscribe/` ("Get it by email"), the plans page. The home page and the live board link to it, and its "Create
  your account" button leads to `/signup/` (`/signup/?pro=1` ticks the Pro box).
- `/signin/` also links to `/signup/`.

```mermaid
flowchart TD
  P0["Home page or live board:<br/>Get it by email"] --> P1["/subscribe/ plans page"]
  P1 --> A["Visitor opens /signup/"]
  A --> B{"Already signed in<br/>on this browser?"}
  B -- yes --> B1["Shows: You're signed in<br/>board · manage · sign out"]
  B -- no --> C["Enters email, presses<br/>Create account"]
  C --> D{"What is this address?"}
  D -- "new" --> E["Confirmation email sent<br/>Reply: a link is on its way,<br/>check spam"]
  D -- "waiting for confirm,<br/>emailed in last 10 min" --> F["Nothing sent<br/>Reply: sent in the last 10 min,<br/>ask again after that"]
  D -- "waiting for confirm,<br/>older than 10 min" --> E3["Same link re-sent<br/>(at most 5 per address)"]
  D -- "already has an account" --> G["Sign-in link email<br/>(sign-in limits: 5 min, daily cap)<br/>Reply: already has an account"]
  D -- "limit reached / bot field" --> E2["Nothing sent<br/>Same reply as new"]
  E --> H["Opens link in email"]
  H --> I["Page with a Confirm button<br/>(stops mail scanners)"]
  I --> J["Presses Confirm"]
  J --> K["Account active + signed in<br/>on this browser (until it closes,<br/>12 h at most)"]
  K --> L["Page: Your account is ready<br/>→ Open the live board"]
  H -. "after 7 days" .-> X["Link invalid,<br/>address deleted"]
  G --> M["Continues as Flow 2:<br/>Sign in button → /live/"]
```

## Flow 2: Sign in again

Entry points:
- `/signin/`. The home page links to it ("Sign in"), and so do `/subscribe/` and `/signup/`.
- The live board's strip: "Sign in", or "Account" (to `/manage/`) when this browser is signed in.
- `/manage/`, when it has no email link and no cookie.
- Signing up again with an address that already has an account (Flow 1) sends the same sign-in email.

```mermaid
flowchart TD
  A["Opens /signin/"] --> B{"Already signed in?"}
  B -- yes --> B1["Shows: You're signed in<br/>board · manage · sign out"]
  B -- no --> C["Enters email,<br/>presses Email me a link"]
  C --> R["Same reply for everyone:<br/>if that address has an account,<br/>a link is on its way"]
  C --> D{"Behind the scenes"}
  D -- "active account" --> E["Sign-in email sent<br/>link works 15 min, once"]
  D -- "unknown" --> N["Nothing sent"]
  D -- "not confirmed" --> CF["Confirmation link re-sent<br/>(10 min apart, 5 per address,<br/>daily cap)<br/>→ Confirm signs you in"]
  D -- "asked under 5 min ago /<br/>daily or per-IP limit" --> N
  E --> F["Opens link"]
  F --> G["Page with a Sign in button"]
  G --> H["Presses Sign in"]
  H --> I["Cookie set (until the browser<br/>closes, 12 h at most)<br/>→ always lands on /live/"]
  F -. "used before / expired" .-> Z["This link isn't valid<br/>→ ask for a new one"]
```

## Flow 3: While signed in

```mermaid
flowchart LR
  S["Signed in<br/>(cookie, this browser)"] --> M["/manage/ without a link:<br/>plan, categories, Pro request"]
  S --> V["/live/ board<br/>(Pro only once BOARD_PAYWALL is on)"]
  M --> O["Sign out"]
  S --> O
  O --> P["Cookie cleared → /manage/<br/>sends you to /signin/"]
  S -. "browser closed, 12 h pass,<br/>or owner signs everyone out" .-> P
  M --> U["Unsubscribe link in any email<br/>→ Free: account deleted<br/>Pro: emails off, account stays"]
  M --> D["Delete my account<br/>→ record deleted, signed out"]
```

## Flow 4: Continue with Google

Shown only once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (see
[DEPLOYMENT.md](../../DEPLOYMENT.md#google-sign-in-optional)); until then the button stays hidden and Flows 1 and
2 are the only ways in. Entry points: the home page popup (both tabs), `/signup/` and `/signin/`. Under the button:
"New here? You'll confirm before a free account is created."

```mermaid
flowchart TD
  A["Presses Continue with Google<br/>(Pro box ticked → &pro=1)"] --> B["Google: pick an account<br/>(asked every time)"]
  B -- "cancels" --> X1["Google sign-in was cancelled<br/>→ try again or use email"]
  B --> C{"Back on /api/session:<br/>same browser, under 10 min,<br/>Google confirms the address?"}
  C -- no --> X2["Didn't finish / didn't work /<br/>address not verified<br/>→ try again or use email"]
  C -- yes --> D{"That address"}
  D -- "has an account" --> S["Signed in, account unchanged"]
  D -- "never confirmed" --> P["Account made active<br/>(Pro box → Pro request)"]
  D -- "new" --> N{"List full?<br/>(per-IP limit checked<br/>at Create account)"}
  N -- yes --> X3["New accounts are closed /<br/>too many from this network"]
  N -- no --> K["Create your account page:<br/>their address, the daily email,<br/>the Pro box"]
  K -- "Cancel" --> X4["Nothing created"]
  K -- "Create account,<br/>within 10 min" --> F["Free account, active at once,<br/>no confirmation email<br/>(Pro box → Pro request)"]
  P --> S
  F --> S
  S --> L["Cookie set (until the browser<br/>closes, 12 h at most)<br/>→ lands on /live/"]
```

Solid lines are what a person does. Dotted lines are what happens over time or on failure.

**Checked in production on 2026-10-22, with a real inbox:**
- Flow 1, from a pending address to "Your account is ready";
- Flow 3: `/manage/` by cookie and Sign out.

Flow 2's emailed link is not checked yet, and neither are the #4 and #5 changes. See
[progress.md](tasks/progress.md).

## What is right, and should stay

| What | Why |
|---|---|
| No passwords | Nothing to store, leak or reset. The inbox proves who you are, which fits a product that already lives in email. Continue with Google keeps this: Google proves the address, and we keep only the address |
| A button after every link | Mail scanners open links automatically. Requiring a press means they can't confirm or sign anyone in |
| Confirming signs you in | A new user never has to sign in separately right after signing up |
| Short, single-use sign-in links | 15 minutes, once. A forwarded or old email can't be reused |
| The cookie | Signed, `HttpOnly`, ends when the browser closes (12 hours at most), holds no address, and a `POST` from another site is refused |
| Limits and a bot trap | Daily caps, a per-connection limit and a hidden field stop bots from using up the email quota |

## What should change

The items are ranked by how much each one blocks a real person. "Now" means a small fix worth doing before T17,
which sends every visitor through these screens. "With T17" means T17 needs it. "Later" can wait for real users.

| # | Problem | Proposed change | When |
|---|---|---|---|
| 1 | Chrome showed a full-page "Dangerous site" warning on the confirm link, so most new visitors stop there (see [progress.md](tasks/progress.md)) | Move the site to the owner's own domain, then ask Google for a review | Now (parked by the owner) |
| 2 | Nobody can find the account pages. The home page and the live board link only to "Get it by email". `/signup/` is linked only from `/signin/`. Only the account pages show whether you're signed in | Add "Sign in" to the home page and live board nav, and show "Account" there instead when signed in | **Done** (2026-10-22) |
| 3 | Two sign-up pages make one record with different words, and only `/subscribe/` has the Pro box. People can't tell whether a subscription and an account differ | Keep one form. The owner chose: `/subscribe/` becomes the plans page with a "Create account" button to `/signup/`, which gains the Pro box | **Done** (2026-10-22) |
| 4 | A returning user who uses the sign-up form gets "already subscribed" and an email with the manage link. That link doesn't sign them in | For an existing account, send a sign-in link instead. The reply already says the address is subscribed, so this reveals nothing new | **Done** (2026-10-22) |
| 5 | Sign-in for an address that never pressed Confirm says "a link is on its way", and nothing arrives | For a pending address, re-send the confirmation link within the existing limits. The reply stays the same for everyone | **Done** (2026-10-22) |
| 6 | Sign-in always lands on `/live/`, not on the page the person started from | Remember where they started (pages on this site only) and return there after Sign in | Later. T17 didn't need it: the board's panel sends people to sign in, and sign-in lands back on `/live/` |
| 7 | The account is the daily email: unsubscribing deletes the account. Fine for a free newsletter, but a paying Pro user who only wants fewer emails would lose what they paid for | Split "stop emails" from "delete my account": the email link turns emails off, and a manage-page button deletes the account (T17 already plans Delete my account) | **Part done** (T17, 2026-10-23): a Pro's Unsubscribe link turns emails off and keeps the account, and `/manage/` has Delete my account. Free accounts are still deleted by unsubscribing. Cancelling a paid plan comes with T22 |
| 8 | A link opened on a phone signs in the phone, not the laptop that asked | Also put a short code in the sign-in email that can be typed on the page that asked | Later |
| 9 | Two waits the page doesn't explain. A second sign-in request within 5 minutes sends nothing but still says "on its way". A lost confirmation can't be re-sent for 24 hours | Add "You can ask again in 5 minutes" to the sign-in reply. Allow a confirmation re-send after about 10 minutes, still capped per day | **Done** (2026-10-22): re-send after 10 minutes, at most 5 per address |
| 10 | Every way in waits for an email. When one is slow, lost or blocked (#1), the person is stuck | Add "Continue with Google" beside the emailed link. A new address sees "Create your account" and gets a free account when it presses Create account, with no confirmation email | **Built** (2026-10-22). The confirm step was added the same day, at the owner's request |

**Suggested order:**
1. The domain (#1), when the owner picks it up again.
2. ~~One small PR for #2 to #5~~: done on branch `fix/account-flows`, with no new server function.
3. ~~#7 inside T17~~: done for Pro. #6 moved to Later.
4. #8 once there are real users asking. (#9 was done early, on 2026-10-22, after the owner hit it.)
