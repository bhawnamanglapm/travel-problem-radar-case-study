// Email delivery for the scheduled sweep, through Resend (https://resend.com): the digest after
// a saved sweep, or a short notice when nothing could be saved. Optional; it runs only when
// RESEND_API_KEY and EMAIL_TO are set. Each message has an HTML and a plain-text part.
import { esc } from "./http.js";
import { CATS } from "./radar.js";

// Resend's shared sender, so no domain of our own is needed. Resend delivers mail from it only
// to the address the Resend account was created with; EMAIL_FROM on a verified domain lifts that.
export const DEFAULT_FROM = "Travel Problem Radar <onboarding@resend.dev>";

const when = (at) => at.slice(0, 16).replace("T", " ") + " UTC";

const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a";
const MUTED = "color:#5f6368";
const NOTE = "Gathered by an AI model with web search. Items are not verified; check each source link.";

// The third argument is for the subscriber emails: `heading` replaces the title, and `subjectLead`
// (for example "daily") makes the subject "Travel Problem Radar daily · <date> · ...". With no third
// argument the output is exactly the owner's digest. `cats` (a Pro subscriber's choice, T14) limits
// the sections and the "Failed this run" line to those categories; the caller filters `problems`.
export function buildDigestEmail({ at, problems, perCat = {}, manual = false }, liveUrl = "", { heading, subjectLead, cats = null } = {}) {
  const shown = cats ? CATS.filter((c) => cats.includes(c.key)) : CATS;
  const failed = shown.filter((c) => /^failed/.test(perCat[c.key] || "")).map((c) => c.label);
  const newCount = problems.filter((p) => p.isNew).length;
  const highCount = problems.filter((p) => p.severity === "High").length;
  const title = heading || (manual ? "Travel Problem Radar: digest (manual run)" : "Travel Problem Radar: digest");
  const counts = `${problems.length} problems · ${newCount} new · ${highCount} high severity`;
  // The time keeps each subject unique, so mail apps don't thread five digests a day together.
  const lead = subjectLead ? `Travel Problem Radar ${subjectLead}` : "Travel Problem Radar";
  const stamp = subjectLead ? at.slice(0, 10) : when(at);
  const subject = `${lead} · ${stamp} · ${problems.length} problems, ${newCount} new${manual ? " (manual run)" : ""}`;

  const text = [title, `Swept ${when(at)} · ${counts}`];
  const html = [
    `<div style="${FONT};max-width:640px">`,
    `<h1 style="font-size:18px;margin:0 0 4px">${esc(title)}</h1>`,
    `<p style="margin:0 0 12px;${MUTED}">Swept ${esc(when(at))} · ${esc(counts)}</p>`,
  ];
  if (cats) {
    const chosen = `Your categories: ${shown.map((c) => c.label).join(", ")}`;
    text.push(chosen);
    html.push(`<p style="margin:0 0 12px">${esc(chosen)}</p>`);
  }
  if (failed.length) {
    text.push(`Failed this run: ${failed.join(", ")}`);
    html.push(`<p style="margin:0 0 12px">Failed this run: ${esc(failed.join(", "))}</p>`);
  }
  if (liveUrl) {
    text.push(`Live board: ${liveUrl}`);
    html.push(`<p style="margin:0 0 12px"><a href="${esc(liveUrl)}">Open the live board</a></p>`);
  }
  shown.forEach((c) => {
    const items = problems.filter((p) => p.cat === c.key);
    if (!items.length) return;
    text.push("", `${c.label.toUpperCase()} (${items.length})`);
    html.push(`<h2 style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;margin:20px 0 8px;${MUTED}">${esc(c.label)} (${items.length})</h2>`);
    items.forEach((p) => {
      const meta = [p.source, p.region, p.date].filter(Boolean).join(" · ");
      text.push(`- [${p.severity}]${p.isNew ? " NEW" : ""} ${p.title}`);
      if (p.summary) text.push(`  ${p.summary}`);
      text.push(`  ${meta}`);
      if (p.link) text.push(`  ${p.link}`);
      if (p.opportunity) text.push(`  Opportunity: ${p.opportunity}`);
      const head = p.link ? `<a href="${esc(p.link)}">${esc(p.title)}</a>` : esc(p.title);
      html.push(
        `<div style="margin:0 0 14px">`,
        `<div><strong>[${esc(p.severity)}]</strong>${p.isNew ? ` <strong style="color:#b3261e">NEW</strong>` : ""} ${head}</div>`,
        p.summary ? `<div>${esc(p.summary)}</div>` : "",
        `<div style="font-size:12px;${MUTED}">${esc(meta)}</div>`,
        p.opportunity ? `<div>Opportunity: ${esc(p.opportunity)}</div>` : "",
        `</div>`,
      );
    });
  });
  text.push("", NOTE);
  html.push(`<p style="margin:20px 0 0;font-size:12px;${MUTED}">${esc(NOTE)}</p>`, `</div>`);
  return { subject, text: text.join("\n"), html: html.filter(Boolean).join("\n") };
}

export function buildFailureEmail({ at, perCat = {}, error = "" }) {
  const lines = [`${when(at)}: nothing was saved, so the live board still shows the previous sweep.`];
  if (error) lines.push(`Error: ${error}`);
  CATS.forEach((c) => { if (perCat[c.key]) lines.push(`${c.label}: ${perCat[c.key]}`); });
  return {
    subject: `Travel Problem Radar: sweep failed (${when(at)})`,
    text: ["Travel Problem Radar: sweep failed", ...lines].join("\n"),
    html: [
      `<div style="${FONT};max-width:640px">`,
      `<h1 style="font-size:18px;margin:0 0 8px">Travel Problem Radar: sweep failed</h1>`,
      ...lines.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`),
      `</div>`,
    ].join("\n"),
  };
}

// ---- subscriber emails (docs/subscriptions/tasks/T04)

const PLAN_LINE = {
  free: "You get this because you subscribed (Free plan: one email a day).",
  pro: "You get this because you subscribed (Pro plan: an email after every sweep).",
};
const LINK_OK = /^https?:\/\/[^\s<>"]+$/;

// A copy of a built message with the subscriber footer and the one-click unsubscribe headers
// (RFC 8058). The digest is built once; only this footer differs per person.
export function withSubscriberFooter(mail, { unsubscribeUrl, manageUrl = "", plan = "free" }) {
  if (!LINK_OK.test(unsubscribeUrl || "")) throw new Error("withSubscriberFooter: bad unsubscribe link");
  const intro = PLAN_LINE[plan] || PLAN_LINE.free;
  const text = ["", "--", intro, `Unsubscribe: ${unsubscribeUrl}`];
  const links = [`<a href="${esc(unsubscribeUrl)}">Unsubscribe</a>`];
  if (manageUrl) {
    text.push(`Manage subscription: ${manageUrl}`);
    links.push(`<a href="${esc(manageUrl)}">Manage subscription</a>`);
  }
  const footer = `<p style="margin:20px 0 0;font-size:12px;${MUTED}">${esc(intro)} ${links.join(" · ")}</p>`;
  return {
    ...mail,
    text: mail.text + "\n" + text.join("\n"),
    html: /<\/div>\s*$/.test(mail.html) ? mail.html.replace(/<\/div>\s*$/, footer + "\n</div>") : mail.html + "\n" + footer,
    headers: {
      ...(mail.headers || {}),
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export function buildConfirmEmail({ confirmUrl, siteUrl = "" }) {
  if (!LINK_OK.test(confirmUrl || "")) throw new Error("buildConfirmEmail: bad confirm link");
  const subject = "Confirm your Travel Problem Radar subscription";
  const intro = "You asked to get the Travel Problem Radar digest by email: one email a day with the travel problems an AI model found in the last 24 hours.";
  const ignore = "If you didn't ask for this, ignore this email; nothing more will be sent.";
  const stored = "What we keep: your email address and the dates you subscribed and confirmed. Unsubscribing deletes it.";
  return {
    subject,
    text: [subject, "", intro, "", `Confirm: ${confirmUrl}`, "", ignore, "", stored, ...(siteUrl ? ["", siteUrl] : [])].join("\n"),
    html: [
      `<div style="${FONT};max-width:640px">`,
      `<h1 style="font-size:18px;margin:0 0 8px">${esc(subject)}</h1>`,
      `<p style="margin:0 0 14px">${esc(intro)}</p>`,
      `<p style="margin:0 0 14px"><a href="${esc(confirmUrl)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px">Confirm subscription</a></p>`,
      `<p style="margin:0 0 14px">${esc(ignore)}</p>`,
      `<p style="margin:0;font-size:12px;${MUTED}">${esc(stored)}</p>`,
      `</div>`,
    ].join("\n"),
  };
}

// The sign-in link (T16), sent only to a confirmed address that asked for it on /signin/.
export function buildSignInEmail({ signInUrl, siteUrl = "" }) {
  if (!LINK_OK.test(signInUrl || "")) throw new Error("buildSignInEmail: bad sign-in link");
  const subject = "Your Travel Problem Radar sign-in link";
  const intro = "Someone, probably you, asked to sign in to Travel Problem Radar with this address. The link works once and expires in 15 minutes.";
  const ignore = "If you didn't ask for this, ignore this email; nobody can sign in without the link.";
  return {
    subject,
    text: [subject, "", intro, "", `Sign in: ${signInUrl}`, "", ignore, ...(siteUrl ? ["", siteUrl] : [])].join("\n"),
    html: [
      `<div style="${FONT};max-width:640px">`,
      `<h1 style="font-size:18px;margin:0 0 8px">${esc(subject)}</h1>`,
      `<p style="margin:0 0 14px">${esc(intro)}</p>`,
      `<p style="margin:0 0 14px"><a href="${esc(signInUrl)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px">Sign in</a></p>`,
      `<p style="margin:0;font-size:12px;${MUTED}">${esc(ignore)}</p>`,
      `</div>`,
    ].join("\n"),
  };
}

// To an address that is already subscribed, when someone signs it up again (at most once a day).
export function buildAlreadySubscribedEmail({ manageUrl, unsubscribeUrl, siteUrl = "" }) {
  if (!LINK_OK.test(manageUrl || "") || !LINK_OK.test(unsubscribeUrl || "")) throw new Error("buildAlreadySubscribedEmail: bad link");
  const subject = "You're already subscribed to Travel Problem Radar";
  const intro = "Someone, probably you, just tried to sign this address up for the Travel Problem Radar digest. It is already subscribed, so nothing has changed.";
  const how = "To see or change your subscription, or to ask for Pro, use the manage link.";
  const ignore = "If this wasn't you, ignore this email; your subscription stays as it is.";
  return {
    subject,
    text: [subject, "", intro, "", how, `Manage subscription: ${manageUrl}`, `Unsubscribe: ${unsubscribeUrl}`, "", ignore, ...(siteUrl ? ["", siteUrl] : [])].join("\n"),
    html: [
      `<div style="${FONT};max-width:640px">`,
      `<h1 style="font-size:18px;margin:0 0 8px">${esc(subject)}</h1>`,
      `<p style="margin:0 0 14px">${esc(intro)}</p>`,
      `<p style="margin:0 0 14px">${esc(how)}</p>`,
      `<p style="margin:0 0 14px"><a href="${esc(manageUrl)}" style="display:inline-block;padding:10px 18px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px">Manage subscription</a></p>`,
      `<p style="margin:0 0 14px">${esc(ignore)}</p>`,
      `<p style="margin:0;font-size:12px;${MUTED}"><a href="${esc(unsubscribeUrl)}" style="${MUTED}">Unsubscribe</a></p>`,
      `</div>`,
    ].join("\n"),
  };
}

// To the owner (EMAIL_TO) when a subscriber asks for Pro. It names nobody: the address stays in
// storage, and the owner looks it up with the admin script.
export function buildProRequestEmail({ at, source }) {
  const subject = "Travel Problem Radar: Pro request";
  const how = source === "signup" ? "ticked \"I'd also like Pro\" when signing up, and has now confirmed" : "pressed \"Request Pro\" on the manage page";
  const lines = [
    `${when(at)}: a subscriber ${how}.`,
    "See who is waiting:  node --env-file=.env.local scripts/subscribers.mjs list --plan requested",
    "Then switch them on:  node --env-file=.env.local scripts/subscribers.mjs grant-pro <email> --yes",
  ];
  return {
    subject,
    text: [subject, "", ...lines].join("\n"),
    html: [
      `<div style="${FONT};max-width:640px">`,
      `<h1 style="font-size:18px;margin:0 0 8px">${esc(subject)}</h1>`,
      `<p style="margin:0 0 10px">${esc(lines[0])}</p>`,
      ...lines.slice(1).map((l) => `<p style="margin:0 0 6px;font-family:ui-monospace,monospace;font-size:12px">${esc(l)}</p>`),
      `</div>`,
    ].join("\n"),
  };
}

// ---- batch sending (https://resend.com/docs/api-reference/emails/send-batch-emails)

export const BATCH_SIZE = 100; // Resend's documented maximum per call
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postBatch({ apiKey, from }, chunk, { fetchFn, timeoutMs, key }) {
  const headers = {
    authorization: "Bearer " + apiKey,
    "content-type": "application/json",
    "user-agent": "travel-problem-radar", // Resend refuses requests without one (403)
  };
  if (key) headers["idempotency-key"] = key;
  try {
    const r = await fetchFn("https://api.resend.com/emails/batch", {
      method: "POST",
      headers,
      body: JSON.stringify(chunk.map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.headers ? { headers: m.headers } : {}) }))),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await r.json(); } catch (e) {}
    const name = body && /^[a-z_]{1,40}$/.test(body.name) ? body.name : "";
    const retryAfter = Number(r.headers && typeof r.headers.get === "function" ? r.headers.get("retry-after") : NaN);
    return { ok: r.ok, status: r.status, name, retryAfter, count: !r.ok ? 0 : body && Array.isArray(body.data) ? body.data.length : chunk.length };
  } catch (e) {
    return { ok: false, status: 0, name: "", count: 0, error: e && e.name === "TimeoutError" ? "timeout" : "network error" };
  }
}

const isQuota = (r) => r.status === 429 && /quota_exceeded$/.test(r.name);
const why = (r) => r.error || `http ${r.status}${r.name ? " " + r.name : ""}`;

// Sends one email per message (each has a single recipient), in chunks of BATCH_SIZE. Never
// throws. The result holds counts, positions and reasons only: never an address, the key, or
// Resend's message text. `sentIndexes` are positions in `messages`, so the caller can record who
// was sent. Messages after a quota, auth or deadline stop are neither sent nor failed: the caller
// counts them as deferred.
//   messages: [{ to, subject, html, text, headers }]
//   options:  fetchFn, timeoutMs, sleep, idempotencyKey (a base: "-<chunk n>" is added),
//             shouldStop() (checked before each chunk; true stops with "deadline"),
//             onChunk({ sentIndexes }) (awaited after each chunk, so progress can be saved)
export async function sendBatch({ apiKey, from = "" }, messages, { fetchFn = fetch, timeoutMs = 10000, sleep = defaultSleep, idempotencyKey, shouldStop, onChunk } = {}) {
  const out = { sent: 0, failed: 0, stopped: null, reason: null, sentIndexes: [] };
  if (!apiKey) { out.stopped = "not configured: RESEND_API_KEY missing"; return out; }
  if (!from || from === DEFAULT_FROM || /@resend\.dev\b/i.test(from)) {
    out.stopped = "not configured: EMAIL_FROM must be on a verified domain";
    return out;
  }
  const creds = { apiKey, from };
  const opts = { fetchFn, timeoutMs };
  try {
    for (let start = 0, n = 0; start < messages.length; start += BATCH_SIZE, n++) {
      if (shouldStop && shouldStop()) { out.stopped = "deadline"; break; }
      const chunk = messages.slice(start, start + BATCH_SIZE);
      const key = idempotencyKey ? `${idempotencyKey}-${n}` : undefined;
      const sentHere = [];
      let r = await postBatch(creds, chunk, { ...opts, key });
      if (r.status === 429 && !isQuota(r)) {
        await sleep(Math.min(Number.isFinite(r.retryAfter) ? r.retryAfter * 1000 : 1000, 2000));
        r = await postBatch(creds, chunk, { ...opts, key });
      }
      if (r.ok) {
        const c = Math.min(r.count, chunk.length);
        for (let i = 0; i < c; i++) sentHere.push(start + i);
        out.failed += chunk.length - c;
        if (c < chunk.length) out.reason = "short reply";
      } else if (isQuota(r)) {
        out.stopped = "quota";
      } else if (r.status === 401 || r.status === 403) {
        out.stopped = why(r);
        out.reason = out.stopped;
      } else if ((r.status === 400 || r.status === 422) && chunk.length > 1) {
        // One bad message can fail the whole call. Send them one at a time so only it fails.
        for (let i = 0; i < chunk.length; i++) {
          const one = await postBatch(creds, [chunk[i]], { ...opts, key: key ? `${key}-s${i}` : undefined });
          if (one.ok) sentHere.push(start + i);
          else if (isQuota(one)) { out.stopped = "quota"; break; }
          else if (one.status === 401 || one.status === 403) { out.stopped = why(one); out.reason = out.stopped; break; }
          else { out.failed++; out.reason = why(one); }
        }
      } else {
        out.failed += chunk.length;
        out.reason = why(r);
      }
      out.sent += sentHere.length;
      out.sentIndexes.push(...sentHere);
      if (onChunk) { try { await onChunk({ sentIndexes: sentHere }); } catch (e) {} }
      if (out.stopped) break;
    }
  } catch (e) {
    out.stopped = "error";
    out.reason = "unexpected error";
  }
  return out;
}

// One message: "sent", or the same "failed: ..." strings sendEmail() uses.
export async function sendOne(creds, message, options = {}) {
  const r = await sendBatch(creds, [message], options);
  if (r.sent === 1) return "sent";
  if (r.stopped && r.stopped.startsWith("not configured")) return r.stopped;
  return "failed: " + (r.reason || r.stopped || "unknown");
}

// Never throws. The result goes into /api/sweep's reply, which the GitHub Actions job prints to
// a public log, so it carries the HTTP status and Resend's error name only: never the key, the
// addresses or Resend's message (that is in the Resend dashboard's logs).
export async function sendEmail({ apiKey, from = "", to }, { subject, html, text }, { fetchFn = fetch, timeoutMs = 10000 } = {}) {
  if (!apiKey && !to) return "not configured";
  if (!apiKey || !to) return `not configured: ${apiKey ? "EMAIL_TO" : "RESEND_API_KEY"} missing`;
  from = from || DEFAULT_FROM;
  const recipients = String(to).split(",").map((s) => s.trim()).filter(Boolean);
  if (recipients.length > 50) return "failed: EMAIL_TO has more than 50 addresses";
  try {
    const r = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/json",
        "user-agent": "travel-problem-radar", // Resend refuses requests without one (403)
      },
      body: JSON.stringify({ from, to: recipients, subject, html, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return "sent";
    let name = "";
    try { const j = await r.json(); if (/^[a-z_]{1,40}$/.test(j && j.name)) name = " " + j.name; } catch (e) {}
    return "failed: http " + r.status + name;
  } catch (e) {
    return "failed: " + (e && e.name === "TimeoutError" ? "timeout" : "network error");
  }
}
