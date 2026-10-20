// Slack delivery for the daily sweep: the digest after a saved sweep, or a short notice
// when nothing could be saved. Optional; it runs only when SLACK_WEBHOOK_URL is set.
// Text uses Slack's mrkdwn, laid out like the component's "Copy report" digest.
import { CATS } from "./radar.js";

// &, < and > are control characters in Slack text.
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const when = (at) => at.slice(0, 16).replace("T", " ") + " UTC";

export function buildDigest({ at, problems, perCat = {} }, liveUrl = "") {
  const failed = CATS.filter((c) => /^failed/.test(perCat[c.key] || "")).map((c) => esc(c.label));
  const newCount = problems.filter((p) => p.isNew).length;
  const highCount = problems.filter((p) => p.severity === "High").length;
  const lines = [
    "*Travel Problem Radar: daily digest*",
    `Swept ${when(at)} · ${problems.length} problems · ${newCount} new · ${highCount} high severity`,
  ];
  if (failed.length) lines.push(`Failed this run: ${failed.join(", ")}`);
  if (liveUrl) lines.push(`<${liveUrl}|Open the live board>`);
  CATS.forEach((c) => {
    const items = problems.filter((p) => p.cat === c.key);
    if (!items.length) return;
    lines.push("", `*${esc(c.label.toUpperCase())} (${items.length})*`);
    items.forEach((p) => {
      const title = p.link ? `<${esc(p.link).replace(/\|/g, "%7C")}|${esc(p.title)}>` : esc(p.title);
      lines.push(`• *[${p.severity}]*${p.isNew ? " *NEW*" : ""} ${title}`);
      if (p.summary) lines.push(`   ${esc(p.summary)}`);
      lines.push(`   _${esc(p.source)} · ${esc(p.region)} · ${esc(p.date)}_`);
      if (p.opportunity) lines.push(`   Opportunity: ${esc(p.opportunity)}`);
    });
  });
  return lines.join("\n");
}

export function buildFailureNotice({ at, perCat = {}, error = "" }) {
  const lines = [
    "*Travel Problem Radar: sweep failed*",
    `${when(at)}: nothing was saved, so the live board still shows the previous sweep.`,
  ];
  if (error) lines.push(`Error: ${esc(error)}`);
  CATS.forEach((c) => { if (perCat[c.key]) lines.push(`• ${esc(c.label)}: ${esc(perCat[c.key])}`); });
  return lines.join("\n");
}

// Never throws, and never reports the webhook URL: it is a secret.
export async function postToSlack(webhookUrl, text, { fetchFn = fetch, timeoutMs = 10000 } = {}) {
  if (!webhookUrl) return "not configured";
  try {
    const r = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok ? "sent" : "failed: http " + r.status;
  } catch (e) {
    return "failed: " + (e && e.name === "TimeoutError" ? "timeout" : "network error");
  }
}
