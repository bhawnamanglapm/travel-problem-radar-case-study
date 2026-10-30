// Offline tests for scripts/cost-per-run.mjs (T29, cost per run). The store is in memory, so this needs
// no network and no Blob token.
//   node scripts/test-cost.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llmLogKey, runDailySweep, scanCategory } from "../api/_lib/radar.js";
import { parseCsv } from "./compare-models.mjs";
import { costLog, main, priceCall, totals } from "./cost-per-run.mjs";
import { check, finish, memStorage } from "./test-helpers.mjs";

const SONNET = "claude-sonnet-5-5";
const near = (a, b) => Math.abs(a - b) < 1e-9;
const call = (cat, usage, { model = SONNET, error } = {}) => ({ cat, request: { model }, ...(usage ? { usage: { pages: 0, ...usage } } : {}), ...(error ? { error } : {}) });
const DAY = 86400000;
const T = Date.UTC(2026, 9, 30, 12);

// Scheduled, a day ago: two calls that saved, one failed but billed, one failed before a reply.
const logA = {
  id: String(T - DAY), at: new Date(T - DAY).toISOString(), status: "saved",
  summary: { calls: 4, failed: 2, input: 35000, output: 3500, searches: 3 },
  calls: [
    call("traveler_pain", { input: 10000, output: 1000, searches: 2 }), // 0.02 + 0.01 + 0.02 = 0.05
    call("gov_policy", { input: 20000, output: 2000, searches: 1 }), // 0.04 + 0.02 + 0.01 = 0.07
    call("web_app", { input: 5000, output: 500, searches: 0 }, { error: "no JSON" }), // 0.01 + 0.005 = 0.015
    { cat: "industry", error: "socket hang up" },
  ],
};
// Manual, two days ago: one call on a model with no price.
const logB = {
  id: String(T - 2 * DAY), at: new Date(T - 2 * DAY).toISOString(), status: "saved", manual: true,
  summary: { calls: 2, failed: 0, input: 20000, output: 2000, searches: 4 },
  calls: [call("traveler_pain", { input: 10000, output: 1000, searches: 2 }, { model: "claude-unknown" }), call("gov_policy", { input: 10000, output: 1000, searches: 2 })],
};
const logOld = { ...logA, id: String(T - 10 * DAY), at: new Date(T - 10 * DAY).toISOString() };

// ---- pricing one call and one sweep
{
  check(near(priceCall(logA.calls[0]).cost, 0.05), "cost: a call is priced from its usage and model");
  check(priceCall(logA.calls[3]).why === "no usage reported" && priceCall(logB.calls[0]).why === "no price for claude-unknown",
    "cost: no usage, or a model with no price, is not priced, and says why");
  const a = costLog(logA);
  check(near(a.cost, 0.135) && near(a.failedCost, 0.015), "cost: a sweep's cost includes a failed call that was billed");
  check(near(a.byCat.traveler_pain + a.byCat.gov_policy + a.byCat.web_app, a.cost) && !("industry" in a.byCat), "cost: per category adds up to the sweep");
  check(a.unpriced.length === 1 && a.unpriced[0].cat === "industry", "cost: the call that failed before a reply is counted as not priced, not as $0");
}

// ---- totals
{
  const t = totals([costLog(logA), costLog(logB)]);
  check(t.sweeps === 2 && t.scheduled === 1 && t.manual === 1 && t.days === 2, "cost: sweeps, scheduled and manual, and days with a sweep");
  check(near(t.cost, 0.185) && near(t.avg, 0.0925) && near(t.avgScheduled, 0.135), "cost: total, average, and average for scheduled sweeps only");
  check(near(t.byCat.gov_policy, 0.12) && t.byCat.industry === 0 && Object.keys(t.byCat)[0] === "traveler_pain", "cost: per category in CATS order, an unpriced one at $0 in the split");
  check(t.unpriced.length === 2 && near(t.avgSearches, 3.5), "cost: unpriced calls are listed; averages come from the logs' summaries");
  check(totals([]).avgScheduled === null && totals([]).avg === 0, "cost: no sweeps, no averages");
}

// ---- main: reads only, --days, the report and --out
{
  const st = memStorage();
  for (const lg of [logA, logB, logOld]) await st.set(llmLogKey(lg.id), JSON.stringify(lg));
  await st.set(llmLogKey(String(T - 3 * DAY)), "{not json");
  const writes = [];
  for (const k of ["set", "del", "update"]) { const f = st[k]; st[k] = async (...a) => { writes.push(k); return f.apply(st, a); }; }
  const dir = mkdtempSync(join(tmpdir(), "radar-cost-test-"));
  const lines = [];
  try {
    const code = await main(["--days", "7", "--out", dir], { storage: st, now: T, out: (s) => lines.push(s), err: (s) => lines.push(s) });
    const text = lines.join("\n");
    check(code === 0 && writes.length === 0, "cost: main writes nothing to the store");
    check(/2 sweeps on 2 days \(1\.0 a day\); 1 scheduled, 1 manual/.test(text), "cost: --days leaves out the older log");
    check(/Total: \$0\.1850\. Average a sweep: \$0\.0925; scheduled only: \$0\.1350\./.test(text), "cost: the report gives the total and averages");
    check(/Gov & policy\s+\$0\.0600\s+65%/.test(text), "cost: the report gives each category's average and share");
    check(/Failed calls: \$0\.0150/.test(text) && /Not priced: 2 calls \(.*1 no usage reported/.test(text) && /Not priced: 2 calls \(.*1 no price for claude-unknown/.test(text), "cost: failed and not priced are reported");
    check(/1 log could not be read/.test(text) && /not the Anthropic invoice/.test(text), "cost: an unreadable log is counted; the prices are said to be list prices");
    const [head, ...rows] = parseCsv(readFileSync(join(dir, "sweeps.csv"), "utf8"));
    check(rows.length === 2 && head.includes("cost_usd") && head.includes("gov_policy_usd") && rows[1][head.indexOf("kind")] === "scheduled",
      "cost: --out writes sweeps.csv, one row a sweep");
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const none = [];
  check(await main([], { storage: memStorage(), now: T, out: (s) => none.push(s) }) === 0 && /0 sweeps on 0 days/.test(none.join()), "cost: no logs says so");
}

// ---- a real sweep's log prices as the sweep reported it
{
  const st = memStorage();
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({
    id: "m", model: SONNET, stop_reason: "end_turn", content: [{ type: "text", text: "[]" }],
    usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
  }) });
  await runDailySweep({ storage: st, now: () => T, scan: (cat) => scanCategory(cat, { fetchFn, apiKey: "k", model: SONNET }) });
  const lines = [];
  await main(["--days", "1"], { storage: st, now: T + 1000, out: (s) => lines.push(s) });
  check(/1 sweep on 1 day/.test(lines.join("\n")) && /Total: \$0\.0520\./.test(lines.join("\n")), "cost: a log the sweep wrote is read and priced (4 calls at $0.013)");
}

// ---- refusals
{
  const errs = [];
  check(await main([], { env: {}, err: (s) => errs.push(s) }) === 1 && /BLOB_READ_WRITE_TOKEN is not set/.test(errs[0]) && !/[A-Za-z0-9_]{24,}/.test(errs[0]),
    "cost: no token, nothing read, and the error holds no secret");
  for (const bad of [["--days", "0"], ["--days", "31"], ["--days", "x"], ["--nope"], ["--out"]]) {
    check(await main(bad, { env: {}, err: () => {} }) === 2, "cost: refuses " + bad.join(" "));
  }
}

finish("cost tests");
