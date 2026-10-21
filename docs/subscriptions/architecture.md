# Subscriptions: how the pieces fit together

> **Draft proposal, nothing here is built.** Written on 21 Oct 2026 from the current code and
> [DEPLOYMENT.md](../../DEPLOYMENT.md). Items marked **new** do not exist yet. The design is split across three
> documents: [pricing and rollout](pricing.md), [free email sign-up](email-signup.md) and
> [paid Pro through Razorpay](payments-razorpay.md).

## What exists today and what would be added

| Today | Added by this plan |
|---|---|
| A sweep every 5 hours (GitHub Actions, plus Vercel's daily cron as a backstop) | Nothing changes in how a sweep is gathered or saved |
| The sweep emails and Slack-posts the owner only | After the owner's delivery, a digest to confirmed subscribers |
| A public board that anyone can read | A sign-up page, a confirm link, an unsubscribe link |
| No accounts, no payments | A subscriber record per address; later, a paid plan checked against Razorpay's signed events |

The cost of a sweep (about $0.21, or about $32 a month at 5 sweeps a day) does not depend on the number of
subscribers. Subscribers add email volume, not AI calls.

## A. System map

```mermaid
flowchart LR
  V([Visitor])
  GHA["GitHub Actions<br/>every 5 hours"]
  subgraph Site["Static site"]
    LIVE["/live/ board"]
    SUBP["/subscribe/ page (new)"]
    MAN["/manage/ page (new)"]
  end
  subgraph Fn["Vercel Functions"]
    SWEEP["api/sweep"]
    DATA["api/data (read-only)"]
    SUBS["api/subscribe (new)"]
    CONF["api/confirm (new)"]
    UNS["api/unsubscribe (new)"]
    CHK["api/checkout (new)"]
    WH["api/razorpay-webhook (new)"]
  end
  BLOB[("Vercel Blob<br/>sweeps, history,<br/>subscribers (new)")]
  ANTH["Anthropic API<br/>+ web search"]
  RES["Resend email"]
  SLK["Slack webhook"]
  RZP["Razorpay"]

  GHA --> SWEEP
  SWEEP --> ANTH
  SWEEP --> BLOB
  SWEEP --> RES
  SWEEP --> SLK
  V --> LIVE --> DATA --> BLOB
  V --> SUBP --> SUBS
  SUBS --> BLOB
  SUBS --> RES
  V -->|email link| CONF --> BLOB
  V -->|email link| UNS --> BLOB
  V --> MAN --> CHK --> RZP
  RZP -->|signed events| WH --> BLOB
```

## B. Free sign-up with double opt-in

```mermaid
sequenceDiagram
  actor U as Visitor
  participant P as Subscribe page
  participant S as api/subscribe
  participant B as Blob
  participant R as Resend
  participant C as api/confirm
  U->>P: enters email
  P->>S: POST email and honeypot
  S->>B: save as pending, with token
  S->>R: confirmation email
  S-->>P: same reply for every address
  U->>C: clicks link with token
  C->>B: status = free
  C-->>U: You are subscribed
```

## C. Sweep to delivery (extends today's `deliver()` step)

```mermaid
flowchart TD
  A[Scheduled or manual call] --> B{Secret valid?}
  B -- no --> X[401]
  B -- yes --> C{Scheduled call within 2 hours of the last sweep?}
  C -- yes --> Y[Skipped, nothing sent]
  C -- no --> D[Run 4 category scans]
  D --> E{Any category saved?}
  E -- no --> F[Failure notice to the owner]
  E -- yes --> G[Save sweep and history]
  G --> H["Owner: Slack and email, unchanged"]
  G --> I["Pro subscribers: digest every sweep (new)"]
  G --> J{First saved sweep of this UTC day?}
  J -- yes --> K["Free subscribers: digest (new)"]
  J -- no --> L[Free subscribers: nothing]
```

## D. Paid Pro through Razorpay (later)

```mermaid
sequenceDiagram
  actor U as Subscriber
  participant M as Manage page
  participant K as api/checkout
  participant Z as Razorpay
  participant W as api/razorpay-webhook
  participant B as Blob
  U->>M: Upgrade to Pro
  M->>K: token
  K->>Z: create subscription for the plan
  Z-->>K: subscription id
  K-->>M: id
  M->>Z: open Checkout, user pays
  Z-->>M: payment id and signature
  Z->>W: webhook event and signature header
  W->>W: verify HMAC on the raw body, skip repeat events
  W->>B: plan = pro, period end
```

## E. Subscriber states

```mermaid
stateDiagram-v2
  [*] --> Pending: signs up
  Pending --> Free: clicks confirm link
  Pending --> [*]: link ignored, record expires
  Free --> Pro: webhook activated or charged
  Pro --> Free: halted, cancelled or completed
  Free --> [*]: unsubscribes, record deleted
  Pro --> [*]: unsubscribes after cancelling
```

## F. Rollout order with gates

```mermaid
flowchart LR
  P0["Phase 0: today<br/>public board, owner-only email"] --> P1["Phase 1: free email sign-up<br/>needs a verified domain"]
  P1 --> G{"Demand measured?<br/>sign-ups, confirm rate,<br/>unsubscribes, would you pay"}
  G -- "below the owner's threshold" --> S[Stay free, improve quality first]
  G -- "meets the threshold" --> P2["Phase 2: Razorpay Pro<br/>needs Vercel Pro, KYC, policy pages"]
```

## Everything the plan adds, in one place

| Kind | Name | Used by | Defined in |
|---|---|---|---|
| Page | `/subscribe/` | Visitors | [email-signup.md](email-signup.md) |
| Page | `/manage/` | Subscribers (Phase 2) | [payments-razorpay.md](payments-razorpay.md) |
| Endpoint | `POST /api/subscribe` | Subscribe page | [email-signup.md](email-signup.md) |
| Endpoint | `GET /api/confirm` | Link in the confirmation email | [email-signup.md](email-signup.md) |
| Endpoint | `GET` and `POST /api/unsubscribe` | Link in every digest | [email-signup.md](email-signup.md) |
| Endpoint | `POST /api/checkout` | Manage page (Phase 2) | [payments-razorpay.md](payments-razorpay.md) |
| Endpoint | `POST /api/razorpay-webhook` | Razorpay (Phase 2) | [payments-razorpay.md](payments-razorpay.md) |
| Blob key | `radar:sub:<hash of email>` | All of the above | [email-signup.md](email-signup.md) |
| Blob key | `radar:lastFreeDigestAt` | Sweep handler | [email-signup.md](email-signup.md) |
| Blob key | `radar:rzp-event:<id>` | Webhook | [payments-razorpay.md](payments-razorpay.md) |
| Variable | `EMAIL_FROM` (existing), `MAX_SUBSCRIBERS`, `SITE_URL`, `UNSUBSCRIBE_SECRET` | Email | [email-signup.md](email-signup.md) |
| Variable | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID` | Payments | [payments-razorpay.md](payments-razorpay.md) |

Everything in the Blob store stays private. `/api/data` serves only history and sweep keys, so none of the new keys
can be read through it (a test should prove this when the code is written).
