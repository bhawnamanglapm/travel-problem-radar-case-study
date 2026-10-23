# Home page review: from case study to customer page (2026-10-22)

`index.html` was a portfolio case study. On 2026-10-22 the owner asked for a page fit for customers, with a sign-up /
sign-in popup on every visit and no remembered login. It was replaced on both copies (Vercel and GitHub Pages). This
is the audit behind that change. Everything on the new page comes from text already on `/subscribe/` and `/signup/`,
or from the sweep code (`api/_lib/radar.js`); nothing was made up.

## What was there and is gone (not for customers)

| Item | Why it went |
|---|---|
| "BHAWNA." mark, "← More work", the owner's name and job title in the title and footer | Portfolio branding; the product needs its own name |
| "AI prototype · 2026" eyebrow; Role / Timeline / Status chips | Case-study framing |
| Lede saying sweeps run "on demand" | Not accurate: sweeps run on a schedule, about 5 a day |
| Five buttons of equal weight, with "Try the demo" (a July sample) as the main one | No clear next step; the main action showed stale data |
| A note about Claude's app; a "Run sweep" pill on the mock card | Customers can't run sweeps |
| "The problem", in the first person | A builder's story, not a customer benefit |
| Slack digest and history tab under "What I built" | Customers can't use them |
| The six-step internal pipeline (Slack, Claude scheduled task) | Internal detail |
| "Decisions & tradeoffs" (API key, machine awake, PM calls) | Internal detail; kept in this repo's docs |
| "Builds what she learns" and tech-stack chips | Portfolio pitch |
| The July 2026 sample as the main proof | Old; the live data is newer |

"← Back to portfolio" stays, on the GitHub Pages copy only (the portfolio links there).

The other pages followed the same day: their "← Case study" link became "← Home", and the live board lost its
"Sample demo" (the July sample) and "Source" (the GitHub repo) links, with "Get it by email" renamed "Plans". The demo
page still exists at `/demo/`, linked from the README.

## What was missing and is now there

| Item | On the new page |
|---|---|
| Product name and nav | Header: Travel Problem Radar · Live board · Plans · Sign in (Account when signed in). Signed in, the hero and plan buttons change too: Your account (Free) or Open the live board (Pro), Your plan, Request Pro |
| One main action | "Create free account" opens the popup; "See the live board" is the second action |
| Plain value proposition | What it finds, the four categories, about 5 sweeps a day |
| Real recent findings | Top 6 items of the latest sweep, from `/api/data` (the live board's feed). If it fails, only a link to `/live/` shows; no sample or made-up items |
| How it works | Create an account → confirm by email → get the findings |
| Plans | Free and Pro, as on `/subscribe/` (Pro free while it's tested) |
| FAQ | Cost, password, unsubscribing, what's stored, how far to trust it |
| Honest note and contact | The AI notice and the contact address in the footer (pehchanthetraveller19@gmail.com since 2026-10-23) |
| Search and sharing | Meta description, canonical URL (the Vercel copy), Open Graph tags, favicon |
| Accessibility | Skip link, visible focus rings, small text at WCAG AA contrast, a labelled modal dialog |
| Speed and mobile | Fonts by `<link>` with preconnect, not `@import`; one main button; the popup is a bottom sheet on phones |

## The popup

- Opens on every visit while signed out (checked with `/api/session?action=me`). Closing it (✕, Esc, the backdrop or
  "Just look around") isn't remembered.
- Two tabs: Create account (posts to `/api/subscribe`, with the Pro box) and Sign in (posts to `/api/session`,
  `action: "request"`). The replies are the server's own.
- On the GitHub Pages copy the API isn't reachable (no `/api/`, and other sites' posts are refused), so the tabs link
  to the Vercel `/signup/` and `/signin/` pages.
- Accepted trade-off: Google treats pop-ups that cover content on mobile as a negative signal, and returning visitors
  see it every time.

## Still to come

- Privacy, Terms and Refunds links in the footer, once the legal pages ship (T15; they need the `LEGAL_*` env vars).
- An Open Graph image (none exists yet).
