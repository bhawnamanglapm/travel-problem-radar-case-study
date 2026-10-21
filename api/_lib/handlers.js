// HTTP handlers, built from injected dependencies so the offline tests can call
// them directly. api/sweep.js and api/data.js wire in the real ones.
import { timingSafeEqual } from "node:crypto";
import { runDailySweep, scanCategory } from "./radar.js";
import { buildDigest, buildFailureNotice, postToSlack } from "./slack.js";
import { buildDigestEmail, buildFailureEmail, sendEmail } from "./email.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";

function bearerOk(header, secret) {
  if (!secret || !header) return false;
  const want = Buffer.from("Bearer " + secret);
  const got = Buffer.from(String(header));
  return got.length === want.length && timingSafeEqual(got, want);
}

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

export function makeSweepHandler({ env, storage, fetchFn, now, log = console.log }) {
  return async function sweep(req, res) {
    if (!bearerOk(req.headers.authorization, env.CRON_SECRET)) return send(res, 401, { error: "unauthorized" });
    if (!env.ANTHROPIC_API_KEY) return send(res, 500, { error: "ANTHROPIC_API_KEY is not set; nothing was run or saved" });
    const model = env.RADAR_MODEL || DEFAULT_MODEL;
    // Vercel's cron sends this user agent and header; the GitHub Actions schedule sends
    // x-sweep-trigger: scheduled. Any other call with the secret is a manual run, which always
    // sweeps (see runDailySweep). Faking these headers only makes a call more restricted.
    const scheduled = /^vercel-cron\//.test(req.headers["user-agent"] || "") || Boolean(req.headers["x-vercel-cron-schedule"])
      || req.headers["x-sweep-trigger"] === "scheduled";
    const trigger = scheduled ? "scheduled" : "manual";
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
      out = await runDailySweep({ storage, scan, now, manual: !scheduled, log: (x) => log("sweep", JSON.stringify({ model, trigger, ...x })) });
    } catch (e) {
      const error = "sweep failed: " + String((e && e.message) || e);
      const at = new Date(now()).toISOString();
      return send(res, 500, { error, ...(await deliver(buildFailureNotice({ at, error }), buildFailureEmail({ at, error }))) });
    }
    // Slack and email hear about every sweep that ran: the digest if it saved, a notice if it
    // didn't. A skipped timer call sends nothing. Delivery errors never fail the sweep.
    const { problems, ...summary } = out;
    if (out.status === "saved") {
      const digest = { ...out, manual: !scheduled };
      Object.assign(summary, await deliver(buildDigest(digest, liveUrl), buildDigestEmail(digest, liveUrl)));
    }
    if (out.status === "empty") {
      const failed = { at: new Date(now()).toISOString(), perCat: out.perCat };
      Object.assign(summary, await deliver(buildFailureNotice(failed), buildFailureEmail(failed)));
    }
    return send(res, out.status === "saved" || out.status === "skipped" ? 200 : 502, { model, trigger, ...summary });
  };
}

// Read-only, and only for the two kinds of key the dashboard asks for.
const ALLOWED_KEY = /^radar:(history|sweep:\d{10,16})$/;

export function makeDataHandler({ storage }) {
  return async function data(req, res) {
    if (req.method !== "GET") return send(res, 405, { error: "read-only" });
    const key = new URL(req.url, "http://x").searchParams.get("key") || "";
    if (!ALLOWED_KEY.test(key)) return send(res, 400, { error: "key not allowed" });
    let value;
    try { value = await storage.get(key); } catch (e) { return send(res, 502, { error: "storage unavailable" }); }
    if (value == null) return send(res, 404, { error: "not found" });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.end(JSON.stringify({ value }));
  };
}
