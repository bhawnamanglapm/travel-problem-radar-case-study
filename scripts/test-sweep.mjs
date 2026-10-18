// Offline tests for the daily sweep and the data feed. The Anthropic API and Blob
// storage are stubbed, so this needs no network and no API key.
//   node scripts/test-sweep.mjs
import { makeDataHandler, makeSweepHandler } from "../api/_lib/handlers.js";
import { CATS, extractProblems, runDailySweep, scanCategory, sweepKey } from "../api/_lib/radar.js";

const failures = [];
const check = (ok, label) => {
  console.log((ok ? "PASS " : "FAIL ") + label);
  if (!ok) failures.push(label);
};

const memStorage = () => {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); },
    del: async (k) => { m.delete(k); },
  };
};
const mockRes = () => {
  const r = { code: 0, headers: {}, body: "" };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b; };
  Object.defineProperty(r, "statusCode", { set(v) { r.code = v; }, get() { return r.code; } });
  r.json = () => JSON.parse(r.body);
  return r;
};
const item = (n, over = {}) => ({
  title: "Problem " + n, summary: "s", source: "Src", link: "https://example.com/" + n,
  region: "Global", date: "Oct 2026", severity: "Medium", opportunity: "o", ...over,
});
// Fake Anthropic: each category gets its own list of items, or an error.
const fakeFetch = (byCat, { seenCats = [] } = {}) => async (url, init) => {
  const body = JSON.parse(init.body);
  seenCats.push({ headers: init.headers, body });
  const cat = CATS.find((c) => body.messages[0].content.includes(`"${c.label}"`));
  const v = byCat[cat.key];
  if (v === "http") return { ok: false, status: 529, json: async () => ({}) };
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return {
    ok: true, status: 200,
    json: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 2 } },
    }),
  };
};
const sweepOpts = (storage, byCat, now) => ({
  storage, now,
  scan: (cat) => scanCategory(cat, { fetchFn: fakeFetch(byCat), apiKey: "k", model: "m" }),
});

// ---- the sweep itself
{
  const st = memStorage();
  let t = Date.UTC(2026, 9, 18, 2, 0);
  const four = {
    traveler_pain: [item(1), item(2, { severity: "High" })],
    gov_policy: [item(3)],
    web_app: [item(4), item(4)], // duplicate within a category
    industry: [item(5)],
  };
  const out = await runDailySweep(sweepOpts(st, four, () => t));
  check(out.status === "saved" && out.total === 5, `first sweep saves 5 items, duplicates merged (${out.status}, ${out.total})`);
  const hist = JSON.parse(st.m.get("radar:history"));
  const saved = JSON.parse(st.m.get(sweepKey(out.id)));
  check(hist.length === 1 && hist[0].newCount === 5 && hist[0].highCount === 1, "history entry counts: 5 new, 1 high");
  check(saved.problems.every((p) => p.isNew) && saved.problems[0].severity === "High", "all flagged New, High sorted first");
  check(out.usage.searches === 8 && out.usage.input === 400, "usage totals come from the API response");

  // a second run within 20 h is refused, nothing written
  t += 10 * 3600 * 1000;
  const before = st.m.size;
  const again = await runDailySweep(sweepOpts(st, four, () => t));
  check(again.status === "skipped" && st.m.size === before, "second run within 20 h is skipped, nothing written");

  // next day: one repeat, one fresh item
  t += 20 * 3600 * 1000;
  const next = { ...four, traveler_pain: [item(1), item(9)] };
  const out2 = await runDailySweep(sweepOpts(st, next, () => t));
  const p2 = JSON.parse(st.m.get(sweepKey(out2.id))).problems;
  check(out2.status === "saved" && p2.find((p) => p.title === "Problem 9").isNew && !p2.find((p) => p.title === "Problem 1").isNew,
    "next day: unseen item is New, repeat is not");
  check(JSON.parse(st.m.get("radar:history")).length === 2, "history now has 2 sweeps");
}

// ---- partial and total failure
{
  const st = memStorage();
  const out = await runDailySweep(sweepOpts(st, {
    traveler_pain: "http", gov_policy: "not json at all", web_app: [item(1)], industry: "```json\n[" + JSON.stringify(item(2)) + ",\n{\"title\":\"cut off",
  }, () => 1_800_000_000_000));
  check(out.status === "saved" && out.total === 2, `failed and broken categories are skipped, the rest saved (${out.total})`);
  check(/failed/.test(out.perCat.traveler_pain) && /failed/.test(out.perCat.gov_policy), "failures are reported per category");

  const st2 = memStorage();
  const none = await runDailySweep(sweepOpts(st2, { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" }, () => 1_800_000_000_000));
  check(none.status === "empty" && st2.m.size === 0, "all four failed: nothing saved");
}

// ---- 60-sweep cap
{
  const st = memStorage();
  let t = 1_800_000_000_000;
  for (let i = 0; i < 62; i++) {
    t += 21 * 3600 * 1000;
    await runDailySweep(sweepOpts(st, { traveler_pain: [item(i)], gov_policy: [], web_app: [], industry: [] }, () => t));
  }
  const hist = JSON.parse(st.m.get("radar:history"));
  const sweeps = [...st.m.keys()].filter((k) => k.startsWith("radar:sweep:")).length;
  check(hist.length === 60 && sweeps === 60, `keeps only the last 60 sweeps (${hist.length} in index, ${sweeps} stored)`);
}

// ---- parser
check(extractProblems({ content: [{ type: "text", text: "```json\n[{\"title\":\"a\"}]\n```" }] })[0].title === "a", "parser strips code fences");
{
  let threw = false;
  try { extractProblems({ content: [] }); } catch (e) { threw = true; }
  check(threw, "parser rejects an empty response");
}

// ---- request sent to Anthropic
{
  const seen = [];
  await scanCategory(CATS[0], { fetchFn: fakeFetch({ traveler_pain: [] }, { seenCats: seen }), apiKey: "sekret", model: "claude-test", maxSearches: 3 });
  const b = seen[0].body;
  check(b.model === "claude-test" && b.max_tokens === 1000 && b.tools[0].max_uses === 3, "request uses the configured model, 1000 max tokens, 3 searches");
  check(seen[0].headers["x-api-key"] === "sekret" && !JSON.stringify(b).includes("sekret"), "key goes in a header, never in the body");
}

// ---- /api/sweep
{
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k" };
  const run = async (headers, e = env, st = memStorage(), byCat = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }) => {
    const h = makeSweepHandler({ env: e, storage: st, fetchFn: fakeFetch(byCat), now: () => 1_800_000_000_000, log: () => {} });
    const res = mockRes(); await h({ headers }, res); return { res, st };
  };
  check((await run({})).res.code === 401, "sweep without the secret: 401");
  check((await run({ authorization: "Bearer wrong" })).res.code === 401, "sweep with a wrong secret: 401");
  check((await run({ authorization: "Bearer abc123" }, { CRON_SECRET: "", ANTHROPIC_API_KEY: "k" })).res.code === 401, "no CRON_SECRET configured: always 401");
  const nokey = await run({ authorization: "Bearer abc123" }, { CRON_SECRET: "abc123" });
  check(nokey.res.code === 500 && /ANTHROPIC_API_KEY/.test(nokey.res.json().error) && nokey.st.m.size === 0, "no API key: clear error, nothing saved");
  const ok = await run({ authorization: "Bearer abc123" });
  check(ok.res.code === 200 && ok.res.json().status === "saved" && !ok.res.body.includes("abc123"), "valid call saves, response never echoes secrets");
  const bad = await run({ authorization: "Bearer abc123" }, env, memStorage(), { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" });
  check(bad.res.code === 502, "all categories failed: 502 so the cron run shows as failed");
}

// ---- /api/data
{
  const st = memStorage();
  st.m.set("radar:history", "[1]");
  st.m.set("radar:seenIds", "[\"x\"]");
  st.m.set("radar:sweep:1800000000000", "{\"a\":1}");
  const h = makeDataHandler({ storage: st });
  const call = async (url, method = "GET") => { const res = mockRes(); await h({ url, method }, res); return res; };
  const r1 = await call("/api/data?key=radar:history");
  check(r1.code === 200 && r1.json().value === "[1]" && /s-maxage/.test(r1.headers["cache-control"]), "history is served with a CDN cache header");
  check((await call("/api/data?key=radar:sweep:1800000000000")).code === 200, "a sweep is served");
  check((await call("/api/data?key=radar:seenIds")).code === 400, "seenIds is not exposed");
  check((await call("/api/data?key=../../etc/passwd")).code === 400, "path-like keys are rejected");
  check((await call("/api/data")).code === 400, "missing key is rejected");
  check((await call("/api/data?key=radar:sweep:1700000000000")).code === 404, "unknown sweep: 404");
  check((await call("/api/data?key=radar:history", "POST")).code === 405, "non-GET is refused (read-only)");
}

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll server tests passed.");
process.exit(failures.length ? 1 : 0);
