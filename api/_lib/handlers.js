// HTTP handlers, built from injected dependencies so the offline tests can call
// them directly. api/sweep.js and api/data.js wire in the real ones.
import { timingSafeEqual } from "node:crypto";
import { runDailySweep, scanCategory } from "./radar.js";
import { buildDigest, buildFailureNotice, postToSlack } from "./slack.js";

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
    const scan = (cat) => scanCategory(cat, { fetchFn, apiKey: env.ANTHROPIC_API_KEY, model });
    const slack = (text) => postToSlack(env.SLACK_WEBHOOK_URL, text, { fetchFn });
    const liveUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}/live/` : "";
    let out;
    try {
      out = await runDailySweep({ storage, scan, now, log: (x) => log("sweep", JSON.stringify({ model, ...x })) });
    } catch (e) {
      const error = "sweep failed: " + String((e && e.message) || e);
      const sent = await slack(buildFailureNotice({ at: new Date(now()).toISOString(), error }));
      return send(res, 500, { error, slack: sent });
    }
    // Slack hears about every sweep that ran: the digest if it saved, a notice if it didn't.
    // A skipped run (a sweep in the last 20 h) posts nothing. Slack errors never fail the sweep.
    const { problems, ...summary } = out;
    if (out.status === "saved") summary.slack = await slack(buildDigest(out, liveUrl));
    if (out.status === "empty") summary.slack = await slack(buildFailureNotice({ at: new Date(now()).toISOString(), perCat: out.perCat }));
    if (summary.slack) log("slack", summary.slack);
    return send(res, out.status === "saved" || out.status === "skipped" ? 200 : 502, { model, ...summary });
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
