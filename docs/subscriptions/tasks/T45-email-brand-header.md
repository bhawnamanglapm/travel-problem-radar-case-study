# T45 · A brand header on every email

| | |
|---|---|
| Phase | 5, board UX |
| Who | Developer |
| Size | S |
| Depends on | T04 (the email builders), the brand colours in `brand.css` (2026-10-29) |
| Unblocks | — |

> Added 2026-10-31, at the owner's request ("improve the UI/UX of the emails, like adding a banner"). The owner chose
> the brand header over the other options offered.

## Why

Every email was a bare block of near-black text (#1a1a1a) with black buttons and a red NEW tag. None of the site's
brand colours were used, so an email didn't look like it came from the site it links to.

## What to build

- **A shared shell** around every email: the page colour behind a white card, a dark-green banner with "Travel
  Problem Radar" and a short line under it (the kicker), and an amber rule. HTML colour, not an image, so it shows
  when images are blocked. **No link in the banner**, so the Free teaser keeps exactly one link.
- **A hidden preview line** (the inbox preheader), with counts only for the digest.
- **Brand colours** for text, links, buttons, the NEW tag and severity, each checked for 4.5:1 contrast.
- **The footer** goes inside the card.
- **Unchanged:** the plain-text parts, the subjects, every link and the List-Unsubscribe headers.

## What was built

All in [api/_lib/email.js](../../../api/_lib/email.js); the callers are unchanged.

- **`brandShell({ kicker, preheader }, body)`**, used by all 8 builders.
  - An outer div in the page colour, then a card: at most 640 px wide, centred, white, a 1 px border, 8 px corners.
  - The banner: dark green (#1d4e45), the name in Georgia at 24 px, the kicker in bold amber capitals, a 4 px amber
    rule under it.
  - The body, then an `<!--end-->` marker before the closing divs.

  | Email | Kicker | Preview line |
  |---|---|---|
  | Digest (owner, Pro, teaser) | The sweep's date, e.g. "31 October 2026" | "3 problems, 2 new, 1 high severity" |
  | Sweep failed | Sweep alert | Nothing was saved; the live board still shows the previous sweep. |
  | Confirm | Confirm your email | Press the button inside to confirm your subscription. |
  | Sign-in | Sign-in link | The link works once and expires in 15 minutes. |
  | Already subscribed | Your subscription | This address is already subscribed; nothing has changed. |
  | Pro ending | Your Pro plan | Pro ends on (day) and won't renew. |
  | Pro request (to the owner) | Owner alert | A subscriber asked for Pro. |

- **Headings.** The h1 drops a leading "Travel Problem Radar: ", since the banner shows the name ("Digest", "Pro
  update", "Sweep failed"). A custom heading such as "Your daily Travel Problem Radar" is kept as it is.
- **The digest.** The live-board link and the teaser's Sign in link are buttons. Category headings are small bold
  capitals in brand green over a 2 px line. Item titles are bold links. High is red (#b91c1c) and Medium amber-brown
  (#a15c07).
- **Colours.** `EMAIL_COLORS` is exported. Each value is a light-mode token in `brand.css`, and `npm run check`
  fails if one drifts from its token (`--bg2`, `--line2`, `--text`, `--text-2`, `--link`, `--primary`,
  `--on-primary`, `--accent`, `--on-accent`, `--high`, `--medium`). The check also tests 15 text and background
  pairs for 4.5:1.
- **The footer.** `withSubscriberFooter` puts the footer before `<!--end-->`, inside the card, above a thin line.
  An email without the marker falls back to the old rule (before the last `</div>`).

### Changes from the plan

- **Darker than first built.** The first test email looked washed out in Gmail. The owner said the whole email was
  too light, so the second commit (`04aec40`) made these changes:
  - secondary text uses `--text-2` (#2f4a45) instead of `--muted`;
  - lines use `--line2`;
  - the page behind the card is `--bg2`;
  - the kicker is bold amber;
  - category headings are brand green;
  - body text is 15 px.
- **The colour check also ties each colour to its `brand.css` token**, not only to contrast.
- **The T41 hash test changed.** It pinned the whole Pro email, which includes the HTML. It is now two checks: the
  whole email (recomputed for T45), and everything except the HTML, which still matches the hash from before T41.
  So the plain text, the subjects, the links and the keys are byte for byte what they were.

## How it was checked

- `npm test` 1,719 pass (10 new for T45); `npm run check` 256 pass (2 new).
- The digest, the teaser and the confirm email rendered with made-up sample problems and screenshotted in headless
  Chrome, at desktop width and at about 500 px.
- **Two test emails to the owner's inbox, 2026-10-31.** Both carried the sample Pro digest, the first before the
  darkening and the second after. They went through the Gmail connector from the owner's own Gmail, not through
  Resend. The Resend key pulled from Vercel is marked Sensitive and came back as a placeholder. So they show
  Gmail's rendering, not Resend's delivery.
- **Not checked:** Outlook desktop, which ignores rounded corners and some padding (the email still reads, just
  plainer), Apple Mail, and dark-mode mail apps that recolour HTML.

## Acceptance criteria

- [x] Every email has the banner and the amber rule, with no link in the banner
- [x] The teaser still has exactly one link and no item detail
- [x] The footer lands inside the card, once
- [x] The preview line has counts only, with no link or address
- [x] Every email colour passes 4.5:1 and matches its `brand.css` token
- [x] Plain text, subjects, links and keys unchanged (hash without the HTML)
- [x] Docs: TECHNICAL.md, CHANGELOG.md

## Tests

In `scripts/test-subscriptions.mjs`, the "brand header" checks:
- every builder has the banner;
- there is no link in the banner;
- the divs are balanced;
- the kicker and headings are right;
- the plain text and a custom heading are unchanged;
- the preview lines are right;
- the footer is inside the card;
- none of the old colours is left.

Also the split T41 hash check. In `scripts/test-sweep.mjs`, the exact item-link markup gains its colour. In
`scripts/check.mjs`, the contrast and token checks.
