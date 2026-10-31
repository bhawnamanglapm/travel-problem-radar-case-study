// HTTP handlers, built from injected dependencies so the offline tests can call
// them directly. api/sweep.js and api/data.js wire in the real ones.
import { CATS, DEFAULT_MODEL, KEY_SEARCH, runDailySweep, scanCategory, sweepKey } from "./radar.js";
import { trendsView } from "./trends.js";
import { buildDigest, buildFailureNotice, postToSlack } from "./slack.js";
import { buildDigestEmail, buildFailureEmail, sendEmail } from "./email.js";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { bearerOk, esc, sendJson, sendPage } from "./http.js";
import { deliverToSubscribers } from "./subscriber-delivery.js";
import { keyMismatch } from "./razorpay.js";
import { readSession } from "./session.js";
import { siteUrl } from "./subscription-handlers.js";
import { countEvents, effectivePlan, recordEvent, utcDay } from "./subscribers.js";
import { SLOTS_BY_FREQ, dueSlot, siteSweepsPerDay } from "./schedule.js";

// Manual runs a UTC day (MAX_MANUAL_SWEEPS_PER_DAY; "0" turns them off). Each costs a full sweep,
// so a leaked CRON_SECRET can't run up the Anthropic bill. Scheduled calls have the 2-hour gap instead.
export const DEFAULT_MAX_MANUAL_SWEEPS_PER_DAY = 3;
const positiveInt = (v) => {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};
// No subscriber send starts after this long into the run: 60 s short of the 300 s function limit in
// vercel.json, which leaves time to save state and reply.
export const SUBSCRIBER_DEADLINE_MS = 240_000;

export function makeSweepHandler({ env, storage, fetchFn, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function sweep(req, res) {
    const startedAt = now();
    if (!bearerOk(req.headers.authorization, env.CRON_SECRET)) return sendJson(res, 401, { error: "unauthorized" });
    if (!env.ANTHROPIC_API_KEY) return sendJson(res, 500, { error: "ANTHROPIC_API_KEY is not set; nothing was run or saved" });
    const model = env.RADAR_MODEL || DEFAULT_MODEL;
    // Vercel's cron sends this user agent and header; the GitHub Actions schedule sends
    // x-sweep-trigger: scheduled. Any other call with the secret is a manual run, which always
    // sweeps (see runDailySweep). Faking these headers only makes a call more restricted.
    const scheduled = /^vercel-cron\//.test(req.headers["user-agent"] || "") || Boolean(req.headers["x-vercel-cron-schedule"])
      || req.headers["x-sweep-trigger"] === "scheduled";
    const trigger = scheduled ? "scheduled" : "manual";
    // A scheduled run sweeps only in a slot some Pro member's choice needs (T32). Skipped here, it
    // saves nothing and doesn't count towards the 2-hour gap, so it costs no Anthropic credit.
    // The slot comes from GitHub's X-Sweep-Slot when it names the slot the run was due for (T35); `late` is how
    // many minutes after that slot began the run started, logged so GitHub's delays can be watched.
    const slot = scheduled ? dueSlot(now(), req.headers["x-sweep-slot"]) : null;
    const late = slot ? { slotAt: new Date(slot.at).toISOString(), lateMinutes: Math.round((now() - slot.at) / 60000) } : {};
    if (scheduled) {
      const site = await siteSweepsPerDay({ env, storage, now: now() });
      if (site.error) log("sweep", JSON.stringify({ model, trigger, slot: slot.hour, error: site.error }));
      if (!SLOTS_BY_FREQ[site.perDay].includes(slot.hour)) {
        const reason = `slot ${String(slot.hour).padStart(2, "0")} not needed: ${site.perDay} a day`;
        log("sweep", JSON.stringify({ model, trigger, status: "skipped", reason, ...late }));
        return sendJson(res, 200, { model, trigger, status: "skipped", reason, ...late });
      }
    }
    if (!scheduled) {
      // Counted before the run, so a failed or empty one (still billed) uses up a run too. Two calls at
      // the same instant can both get through, so the limit is approximate; it is a cost guard.
      const raw = String(env.MAX_MANUAL_SWEEPS_PER_DAY ?? "").trim();
      const maxPerDay = raw === "0" ? 0 : positiveInt(raw) ?? DEFAULT_MAX_MANUAL_SWEEPS_PER_DAY;
      let ranToday;
      try { ranToday = await countEvents(storage, { day: utcDay(now()), type: "manualsweep" }); } catch (e) { ranToday = Infinity; }
      if (ranToday >= maxPerDay) {
        return sendJson(res, 429, { model, trigger, status: "limited", error: `manual sweep limit reached: ${maxPerDay} a day (UTC); nothing was run. Wait until 00:00 UTC or raise MAX_MANUAL_SWEEPS_PER_DAY` });
      }
      if (!(await recordEvent(storage, "manualsweep", { now: now(), randomBytes }))) {
        return sendJson(res, 503, { model, trigger, error: "couldn't record the manual run; nothing was run" });
      }
    }
    const scan = (cat) => scanCategory(cat, { fetchFn, apiKey: env.ANTHROPIC_API_KEY, model });
    const liveUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}/live/` : "";
    // Slack and email go out together. Each reports its own outcome and neither ever throws.
    const deliver = async (slackText, mail) => {
      const [slack, email] = await Promise.all([
        postToSlack(env.SLACK_WEBHOOK_URL, slackText, { fetchFn }),
        sendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, to: env.EMAIL_TO }, mail, { fetchFn }),
      ]);
      log("slack", slack);
      log("email", email);
      return { slack, email };
    };
    let out;
    try {
      out = await runDailySweep({ storage, scan, now, manual: !scheduled, slot, log: (x) => log("sweep", JSON.stringify({ model, trigger, ...x })) });
    } catch (e) {
      const error = "sweep failed: " + String((e && e.message) || e);
      const at = new Date(now()).toISOString();
      return sendJson(res, 500, { error, ...(await deliver(buildFailureNotice({ at, error }), buildFailureEmail({ at, error }))) });
    }
    // Slack and email hear about every sweep that ran: the digest if it saved, a notice if it
    // didn't. A skipped timer call sends nothing. Delivery errors never fail the sweep.
    const { problems, ...summary } = out;
    if (out.status === "saved") {
      const digest = { ...out, manual: !scheduled };
      Object.assign(summary, await deliver(buildDigest(digest, liveUrl), buildDigestEmail(digest, liveUrl)));
      // Subscribers come after the owner, so if the Resend quota runs out it is their send that stops,
      // not the owner's digest. The reply holds counts only: it is printed in a public log.
      try {
        summary.subscribers = await deliverToSubscribers({
          env, storage, fetchFn, now, randomBytes, log, sweep: out, scheduled, deadlineAt: startedAt + SUBSCRIBER_DEADLINE_MS,
        });
      } catch (e) {
        summary.subscribers = { error: "subscriber delivery failed" };
      }
    }
    if (out.status === "empty") {
      const failed = { at: new Date(now()).toISOString(), perCat: out.perCat };
      Object.assign(summary, await deliver(buildFailureNotice(failed), buildFailureEmail(failed)));
    }
    // T22: a Razorpay key in the wrong environment turns payments off; said here so the Actions log shows it.
    // It names the problem only, never the key.
    if (keyMismatch(env)) summary.razorpay = "key mismatch";
    return sendJson(res, out.status === "saved" || out.status === "skipped" ? 200 : 502, { model, trigger, ...late, ...summary });
  };
}

// Read-only, and only for the kinds of key the dashboard asks for: the index, a sweep, the search file (T38).
const ALLOWED_KEY = /^radar:(history|search|sweep:\d{10,16})$/;
// The trends page's counts (T44): read from the search file's tally and open to everyone, paywall or not, as the
// reply holds no ids, titles or links. Cached an hour, since the tally changes only when a sweep runs.
const TRENDS_KEY = "radar:trends";
async function trendsReply(res, storage, now) {
  let file;
  try { file = await storage.get(KEY_SEARCH); } catch (e) { return sendJson(res, 502, { error: "storage unavailable" }); }
  let view = null;
  try { view = file == null ? null : trendsView(JSON.parse(file).trends, now()); } catch (e) { view = null; }
  if (!view) return sendJson(res, 404, { error: "not found" });
  return sendJson(res, 200, view, { "cache-control": "public, s-maxage=3600, stale-while-revalidate=3600" });
}

// One problem's share page, /p/<sweepId>/<itemId> (T40), rewritten to /api/data?page=item by vercel.json so
// it needs no function of its own. Everyone sees the free teaser email's fields; a signed-in Pro also sees
// the summary, the opportunity and the source. The head tags (the preview card) hold teaser fields only.
const SWEEP_ID = /^\d{10,16}$/;
const ITEM_ID = /^[a-z0-9_-]{1,40}:[a-z0-9-]{0,60}$/; // cat.key + ":" + slug(title), as radar.js makes them
const GONE = { title: "This problem is no longer on the board", body: `<p>The board keeps the last 60 sweeps, and this one is older. <a href="/live/">Open the live board</a></p>` };

async function itemPage(req, res, u, { storage, accounts, env, now }) {
  const sweepId = u.searchParams.get("sweep") || "", itemId = u.searchParams.get("item") || "";
  if (!SWEEP_ID.test(sweepId) || !ITEM_ID.test(itemId)) return sendPage(res, 400, { title: "This link isn't valid", body: `<p>Check it was copied in full. <a href="/live/">Open the live board</a></p>` });
  let sweep = null;
  try { sweep = await storage.get(sweepKey(sweepId)); } catch (e) { return sendPage(res, 502, { title: "The board couldn't be read", body: `<p>Please try again in a minute.</p>` }); }
  try { sweep = sweep == null ? null : JSON.parse(sweep); } catch (e) { sweep = null; }
  const p = sweep && Array.isArray(sweep.problems) && sweep.problems.find((x) => x && x.id === itemId);
  if (!p) return sendPage(res, 404, GONE);
  const t = now();
  const record = await readSession(req, { env, storage: accounts, now: t });
  const pro = Boolean(record) && effectivePlan(record, t) === "pro";
  const cat = (CATS.find((c) => c.key === p.cat) || {}).label || "";
  const date = p.date || String(sweep.at || "").slice(0, 10);
  const line = [cat, p.region, date].filter(Boolean).join(" · ");
  const site = siteUrl(env);
  const path = `/p/${sweepId}/${encodeURIComponent(itemId)}`;
  const meta = [
    { property: "og:type", content: "article" },
    { property: "og:site_name", content: "Travel Problem Radar" },
    { property: "og:title", content: p.title },
    { property: "og:description", content: line },
    ...(site ? [
      { property: "og:url", content: site + path },
      { property: "og:image", content: site + "/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Travel Problem Radar" },
    ] : []),
    { name: "twitter:card", content: site ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: p.title },
    { name: "twitter:description", content: line },
  ];
  const facts = [["Category", cat], ["Severity", p.severity], ["Source", p.source], ["Region", p.region], ["Date", date]]
    .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
  const full = pro
    ? [
        p.summary ? `<p>${esc(p.summary)}</p>` : "",
        p.opportunity ? `<p><strong>Opportunity:</strong> ${esc(p.opportunity)}</p>` : "",
        p.link ? `<p><a href="${esc(p.link)}" rel="noopener noreferrer">Read the source</a></p>` : "",
        `<p><a href="/live/?all=1#p=${esc(encodeURIComponent(itemId))}">Open on the board</a></p>`,
      ].join("")
    : `<p>The full problem is part of Pro: the summary, the opportunity and the source. <a href="/signin/">Sign in</a> · <a href="/pricing/">See Pro</a></p>`;
  const about = `<p><small>From <a href="/">Travel Problem Radar</a>: travel-industry problems found by an AI model with web search, 1 to 5 times a day.</small></p>`;
  return sendPage(res, 200, { title: p.title, meta, body: `<dl class="item">${facts}</dl>${full}${about}` });
}

// With BOARD_PAYWALL=1 (T17) only a signed-in Pro reads the board: no login is 401, Free or a
// lapsed Pro 402, and no reply may sit in a shared cache. The login is checked against `accounts`,
// a store that reads fresh, so a revoked or deleted record stops working at once; `storage` (the
// sweeps) may be the cached one. Switched off, nothing about the visitor is read.
export function makeDataHandler({ storage, accounts = storage, env = {}, now = Date.now }) {
  return async function data(req, res) {
    const paywall = env.BOARD_PAYWALL === "1";
    const reply = (code, body) => sendJson(res, code, body, paywall ? { "cache-control": "private, no-store" } : {});
    if (req.method !== "GET") return reply(405, { error: "read-only" });
    const u = new URL(req.url, "http://x");
    if (u.searchParams.get("page") === "item") return itemPage(req, res, u, { storage, accounts, env, now });
    const key = u.searchParams.get("key") || "";
    if (key === TRENDS_KEY) return trendsReply(res, storage, now);
    if (!ALLOWED_KEY.test(key)) return reply(400, { error: "key not allowed" });
    if (paywall) {
      const t = now();
      const record = await readSession(req, { env, storage: accounts, now: t });
      if (!record) return reply(401, { error: "not_signed_in" });
      if (effectivePlan(record, t) !== "pro") return reply(402, { error: "pro_only" });
    }
    let value;
    try { value = await storage.get(key); } catch (e) { return reply(502, { error: "storage unavailable" }); }
    if (value == null) return reply(404, { error: "not found" });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", paywall ? "private, no-store" : "public, s-maxage=300, stale-while-revalidate=3600");
    res.end(JSON.stringify({ value }));
  };
}
