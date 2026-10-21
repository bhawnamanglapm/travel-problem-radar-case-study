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

export function buildDigestEmail({ at, problems, perCat = {}, manual = false }, liveUrl = "") {
  const failed = CATS.filter((c) => /^failed/.test(perCat[c.key] || "")).map((c) => c.label);
  const newCount = problems.filter((p) => p.isNew).length;
  const highCount = problems.filter((p) => p.severity === "High").length;
  const title = manual ? "Travel Problem Radar: digest (manual run)" : "Travel Problem Radar: digest";
  const counts = `${problems.length} problems · ${newCount} new · ${highCount} high severity`;
  // The time keeps each subject unique, so mail apps don't thread five digests a day together.
  const subject = `Travel Problem Radar · ${when(at)} · ${problems.length} problems, ${newCount} new${manual ? " (manual run)" : ""}`;

  const text = [title, `Swept ${when(at)} · ${counts}`];
  const html = [
    `<div style="${FONT};max-width:640px">`,
    `<h1 style="font-size:18px;margin:0 0 4px">${esc(title)}</h1>`,
    `<p style="margin:0 0 12px;${MUTED}">Swept ${esc(when(at))} · ${esc(counts)}</p>`,
  ];
  if (failed.length) {
    text.push(`Failed this run: ${failed.join(", ")}`);
    html.push(`<p style="margin:0 0 12px">Failed this run: ${esc(failed.join(", "))}</p>`);
  }
  if (liveUrl) {
    text.push(`Live board: ${liveUrl}`);
    html.push(`<p style="margin:0 0 12px"><a href="${esc(liveUrl)}">Open the live board</a></p>`);
  }
  CATS.forEach((c) => {
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
