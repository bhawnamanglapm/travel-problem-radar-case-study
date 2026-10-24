// HTTP handlers, built from injected dependencies so the offline tests can call
// them directly. api/sweep.js and api/data.js wire in the real ones.
import { runDailySweep, scanCategory } from "./radar.js";
import { buildDigest, buildFailureNotice, postToSlack } from "./slack.js";
import { buildDigestEmail, buildFailureEmail, sendEmail } from "./email.js";
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { bearerOk, sendJson } from "./http.js";
import { deliverToSubscribers } from "./subscriber-delivery.js";
import { readSession } from "./session.js";
import { countEvents, effectivePlan, recordEvent, utcDay } from "./subscribers.js";
import { SLOTS_BY_FREQ, siteSweepsPerDay, slotOf } from "./schedule.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";
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
    const slot = scheduled ? slotOf(now()) : null;
    if (scheduled) {
      const site = await siteSweepsPerDay({ env, storage, now: now() });
      if (site.error) log("sweep", JSON.stringify({ model, trigger, slot: slot.hour, error: site.error }));
      if (!SLOTS_BY_FREQ[site.perDay].includes(slot.hour)) {
        const reason = `slot ${String(slot.hour).padStart(2, "0")} not needed: ${site.perDay} a day`;
        log("sweep", JSON.stringify({ model, trigger, status: "skipped", reason }));
        return sendJson(res, 200, { model, trigger, status: "skipped", reason });
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
    return sendJson(res, out.status === "saved" || out.status === "skipped" ? 200 : 502, { model, trigger, ...summary });
  };
}

// Read-only, and only for the two kinds of key the dashboard asks for.
const ALLOWED_KEY = /^radar:(history|sweep:\d{10,16})$/;

// With BOARD_PAYWALL=1 (T17) only a signed-in Pro reads the board: no login is 401, Free or a
// lapsed Pro 402, and no reply may sit in a shared cache. The login is checked against `accounts`,
// a store that reads fresh, so a revoked or deleted record stops working at once; `storage` (the
// sweeps) may be the cached one. Switched off, nothing about the visitor is read.
export function makeDataHandler({ storage, accounts = storage, env = {}, now = Date.now }) {
  return async function data(req, res) {
    const paywall = env.BOARD_PAYWALL === "1";
    const reply = (code, body) => sendJson(res, code, body, paywall ? { "cache-control": "private, no-store" } : {});
    if (req.method !== "GET") return reply(405, { error: "read-only" });
    const key = new URL(req.url, "http://x").searchParams.get("key") || "";
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
