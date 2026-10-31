# What to do if members' data leaks: the breach plan

> **Draft, 2026-10-31, for the owner to review and an adviser to confirm.** This is not legal advice. The deadlines
> come from secondary sources that reproduce or summarise the rules (listed at the end), not the official gazette
> text, which was not read. Anything marked **to verify** is a question for the adviser
> ([dpdp-check.md](dpdp-check.md), T30 step 9). Nothing here has been tested in a drill.

## When this plan applies

When members' data is used, seen, changed, lost or deleted by someone, or in a way, that it shouldn't be. India's
data law calls this a "personal data breach" (the DPDP Act, 2023, section 2(u), **to verify**). The sources below
say there is no minimum size: a breach affecting one member counts.

Examples for the radar:

| What happens | Data at risk |
|---|---|
| The read-write Blob token leaks: the owner's laptop is lost, `.env.local` is shared or committed, or a backup leaks | Every member record (see below) |
| A bug shows one member's account, saved problems or votes to someone else | That member's record |
| A manage link (it carries the record's token) is forwarded or posted | That member's choices; Delete my account |
| `ADMIN_PASSWORD` leaks | The admin dashboard: every member's address and plan, and the counts (never a token or sign-in code; `api/_lib/admin.js`) |
| Vercel, Resend, Razorpay, Google or Anthropic reports a breach on its side | What that provider holds (the privacy page lists it) |

**What a member record holds:** the email address; status, plan and choices; saved problems and votes (Pro); a
scrypt password hash and a hashed sign-in code; a random link token; the Razorpay subscription id, status and
dates. **Not held:** card, UPI or bank details (Razorpay), Google tokens, the question asked on the board. The
full list is in [dpdp-check.md](dpdp-check.md#what-the-radar-holds).

## Who has to be told, and how fast

The clock starts when the owner **becomes aware** of the breach, not when it happened.

| Who | When | What | Source |
|---|---|---|---|
| **CERT-In** (India's cyber emergency team) | Within **6 hours** | A report of the incident; data breaches and data leaks are on its list of incidents to report | CERT-In directions of 28 April 2022 ([Trilegal][trilegal]). Whether they cover a one-person business: **to verify** |
| **Data Protection Board** | **Without delay** | A short description: what happened, how much data, when, where, and the likely impact | DPDP Rules 2025, rule 7(2)(a) ([dpdpa.com][rule7]) |
| **Each affected member** | **Without delay** | In plain words: what happened, how much and when; what it may mean for them; what we are doing; what they can do; who to contact | Rule 7(1), by their account or the contact they gave us (for the radar, email) |
| **Data Protection Board** | Within **72 hours** (longer only if the Board agrees in writing) | The full report: updated facts; what led to it and why; what was done to limit the harm; anything found about who caused it; what stops it happening again; a report of the notices sent to members | Rule 7(2)(b) |

**When the rule applies:** rule 7 starts on 12 May 2027 ([AZB & Partners][azb]; another source says 13 May 2027,
**to verify**). CERT-In's directions have applied since 27 June 2022. **Proposed:** follow this whole plan now
anyway. It costs nothing until something happens, and a government buyer (RM-40) is likely to ask.

**How to reach them:**

- **CERT-In:** by email, phone or fax, as listed in the directions ([Trilegal][trilegal]). Check the current
  details on CERT-In's own site before relying on them.
- **The Board:** **to verify**; the method was not checked.

## Who does what

The owner runs the radar alone, so the owner decides and sends every notice. **OWNER INPUT NEEDED:**

- an adviser to call in the first hours (none is named yet);
- someone to step in if the owner is unreachable.

## Steps

Write everything down as it happens, with the time, in the incident log (template below). The 72-hour report is
built from it.

### 1. Contain it (first hour)

- **If a secret leaked, or might have,** rotate it and redeploy. Variables are read only by a new deployment.
  - `SESSION_SECRET`: changing it signs every member out
    ([DEPLOYMENT.md](../../DEPLOYMENT.md#signing-in-t16)).
  - `ADMIN_PASSWORD`.
  - `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, in Razorpay first.
  - `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`, `CRON_SECRET` and `ANTHROPIC_API_KEY`, each
    at its provider first.
- **If the Blob token leaked:** replace the store's read-write token and delete every copy of `.env.local`. How to
  rotate a Blob token in Vercel: **to verify**.
- **If a bug is exposing data:** roll back to the last good deployment
  ([DEPLOYMENT.md](../../DEPLOYMENT.md#8-day-to-day-changes-previews-and-rollbacks)), then fix it on a branch.
- **If it is a provider's breach:** read its notice, and ask the provider which of our data it covers.

### 2. Work out what happened (aim: within 3 hours, so CERT-In's 6 hours can be met)

- **Which data and which members.**
  - `node --env-file=.env.local scripts/subscribers.mjs list` (read-only) gives the addresses of everyone it might
    affect.
  - Vercel's runtime logs show requests. Member addresses are never logged, so the logs give paths and times, not
    people.
- **When it started and when it stopped.**
- **Whether it is still going on.** If it is, go back to step 1.

### 3. Report to CERT-In (within 6 hours)

If the adviser has confirmed the directions apply. **Proposed:** if they haven't been asked yet, report anyway.
Sending a report that wasn't needed costs less than missing one that was.

### 4. Tell the Board, then the members (without delay)

- **The Board:** the short description (template below).
- **Each affected member:** one email each, from the contact address on the privacy page.
  - **Gap:** no tool today sends one email to many members. With a handful of members it is done by hand. With
    more, it needs a script, which is an owner decision to build.
- **Pro members:** if passwords may be exposed, tell them to change the password on the manage page and anywhere
  else they use it. The stored hashes are scrypt, but a hash is still worth changing.

### 5. The Board's full report (within 72 hours)

Built from the incident log, with the six points in the table above.

### 6. Afterwards

- Fix the cause, with a test where code allowed it.
- Add a row to [decisions.md](../decisions.md) and to the RAID log.
- Keep the incident log. How long to keep it: **to verify**.

## Templates

### Email to an affected member (rule 7(1))

> **Subject: Your Travel Problem Radar data: what happened**
>
> On [date] we found that [what happened, in one sentence]. It affected [what data: for example, your email
> address and the categories you chose] between [start] and [end].
>
> What this may mean for you: [for example, you may get emails that pretend to be from us].
>
> What we have done: [for example, closed the gap, signed everyone out, changed our keys].
>
> What you can do: [for example, change your password on the manage page; ignore emails asking for payment
> details].
>
> Questions: reply to this email, or write to [the privacy page's contact address].

### First notice to the Board (rule 7(2)(a))

What happened; what data and roughly how many members; when it started, when it was found and when it stopped;
where (which system or provider); the likely impact.

### Incident log

One line per event: the time (IST); what was seen or done; who did it; evidence (a log line or a screenshot, never
a member's address in the repo).

## Open items

For the owner and the adviser:

1. Does CERT-In's 6-hour rule cover this business?
2. How does the Board take notices?
3. When does rule 7 start: 12 or 13 May 2027?
4. Does Razorpay's merchant agreement require a notice to Razorpay?
5. How is the Blob token rotated?
6. Who is the adviser, and who is the backup if the owner can't act?
7. Should a script be built to email affected members?
8. Run a 30-minute drill once these are answered: a pretend leaked token, timed against the 6 and 72 hours.

## Sources

- [DPDP Rules 2025, rule 7, as reproduced by dpdpa.com][rule7] (a secondary site, not the gazette).
- [AZB & Partners: the DPDP Act's phased rollout][azb], for the start dates.
- [Trilegal: the 2022 CERT-In directions on reporting cyber incidents][trilegal], and
  [Mondaq: 6 hours to report cyber incidents to CERT-In][mondaq].

[rule7]: https://dpdpa.com/dpdparules/rule7.html
[azb]: https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/
[trilegal]: https://trilegal.com/knowledge-repository/2022-cert-in-directions-on-reporting-cyber-incidents/
[mondaq]: https://www.mondaq.com/india/it-and-internet/1270332/6-hours-to-report-cyber-incidents-to-cert-in
