// HTTP handlers, built from injected dependencies so the offline tests can call
// them directly. api/sweep.js and api/data.js wire in the real ones.
import { timingSafeEqual } from "node:crypto";
import { runDailySweep, scanCategory } from "./radar.js";

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
    try {
      const out = await runDailySweep({ storage, scan, now, log: (x) => log("sweep", JSON.stringify({ model, ...x })) });
      return send(res, out.status === "saved" || out.status === "skipped" ? 200 : 502, { model, ...out });
    } catch (e) {
      return send(res, 500, { error: "sweep failed: " + String((e && e.message) || e) });
    }
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
