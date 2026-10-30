// Owner tool: what each sweep cost, from the private LLM logs (T29, cost per run). Each call's usage is
// priced with the list prices in compare-models.mjs. Runs on your own machine; it is not deployed
// (.vercelignore skips scripts/) and adds no endpoint. Read-only: nothing is written to the store and
// nothing is sent.
//
//   node --env-file=.env.local scripts/cost-per-run.mjs [--days 7] [--out DIR]
//
// --days: how far back, 1 to 30 (the logs are kept 30 days). --out: also write DIR/sweeps.csv.
// Exit codes: 0 done, 1 error, 2 bad usage.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATS, KEY_LLMLOG_PREFIX, LLM_LOG_KEEP_DAYS, llmLogKey } from "../api/_lib/radar.js";
import { callCost, PRICES, toCsv } from "./compare-models.mjs";

const DAY_MS = 24 * 3600 * 1000;

class UsageError extends Error {}

export function parseArgs(argv) {
  const a = { days: 7, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--days") {
      if (!/^\d{1,2}$/.test(argv[i + 1] || "") || Number(argv[i + 1]) < 1 || Number(argv[i + 1]) > LLM_LOG_KEEP_DAYS) {
        throw new UsageError(`--days must be a whole number from 1 to ${LLM_LOG_KEEP_DAYS}`);
      }
      a.days = Number(argv[++i]);
    } else if (k === "--out") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new UsageError("--out needs a folder");
      a.out = argv[++i];
    } else throw new UsageError(`unknown option ${k}`);
  }
  return a;
}

// One call's cost in dollars, or why it can't be priced: no usage reported (it failed before a reply),
// or a model with no price in PRICES. Never a guess.
export function priceCall(c) {
  const u = c && c.usage;
  const model = c && c.request && c.request.model;
  if (!u) return { why: "no usage reported" };
  if (!PRICES[model]) return { why: `no price for ${model || "an unknown model"}` };
  return { cost: callCost(model, { input: u.input || 0, output: u.output || 0, searches: u.searches || 0 }) };
}

// One sweep's cost, in all and per category, from its log's calls.
export function costLog(lg) {
  const s = lg.summary || {};
  const row = {
    id: lg.id, at: lg.at, status: String(lg.status), manual: !!lg.manual,
    calls: s.calls || 0, failed: s.failed || 0, input: s.input || 0, output: s.output || 0, searches: s.searches || 0,
    cost: 0, failedCost: 0, byCat: {}, unpriced: [],
  };
  for (const c of lg.calls || []) {
    const p = priceCall(c);
    if (p.cost == null) { row.unpriced.push({ cat: c.cat, why: p.why }); continue; }
    row.cost += p.cost;
    row.byCat[c.cat] = (row.byCat[c.cat] || 0) + p.cost;
    if (c.error) row.failedCost += p.cost;
  }
  return row;
}

export function totals(rows) {
  const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
  const sched = rows.filter((r) => !r.manual);
  const n = rows.length;
  const cost = sum(rows, (r) => r.cost);
  const keys = [...CATS.map((c) => c.key), ...new Set(rows.flatMap((r) => Object.keys(r.byCat)))].filter((k, i, a) => a.indexOf(k) === i);
  return {
    sweeps: n, scheduled: sched.length, manual: n - sched.length,
    days: new Set(rows.map((r) => String(r.at).slice(0, 10))).size,
    cost, avg: n ? cost / n : 0, avgScheduled: sched.length ? sum(sched, (r) => r.cost) / sched.length : null,
    avgInput: n ? sum(rows, (r) => r.input) / n : 0, avgOutput: n ? sum(rows, (r) => r.output) / n : 0, avgSearches: n ? sum(rows, (r) => r.searches) / n : 0,
    byCat: Object.fromEntries(keys.map((k) => [k, sum(rows, (r) => r.byCat[k] || 0)])),
    failedCost: sum(rows, (r) => r.failedCost),
    unpriced: rows.flatMap((r) => r.unpriced),
  };
}

const usd = (x) => "$" + x.toFixed(4);
const n = (x) => Math.round(x).toLocaleString("en-US");
const label = (k) => (CATS.find((c) => c.key === k) || { label: k }).label;

export function formatReport(rows, t, days) {
  const out = [`LLM logs from the last ${days} day${days === 1 ? "" : "s"}: ${t.sweeps} sweep${t.sweeps === 1 ? "" : "s"} on ${t.days} day${t.days === 1 ? "" : "s"}`
    + `${t.days ? ` (${(t.sweeps / t.days).toFixed(1)} a day)` : ""}; ${t.scheduled} scheduled, ${t.manual} manual.`];
  if (!t.sweeps) return out.join("\n");
  out.push("");
  for (const r of rows) {
    out.push(`${r.id}  ${r.at}  ${r.status.slice(0, 12).padEnd(12)}  ${r.manual ? "manual   " : "scheduled"}  ${usd(r.cost)}  `
      + `in ${n(r.input)}  out ${n(r.output)}  searches ${n(r.searches)}${r.failed ? `  ${r.failed} failed` : ""}`);
  }
  out.push("", `Total: ${usd(t.cost)}. Average a sweep: ${usd(t.avg)}${t.avgScheduled != null ? `; scheduled only: ${usd(t.avgScheduled)}` : ""}.`);
  out.push(`Average a sweep: ${n(t.avgInput)} input, ${n(t.avgOutput)} output, ${t.avgSearches.toFixed(1)} searches.`);
  out.push("Per category (average a sweep, share of the total):");
  for (const [k, c] of Object.entries(t.byCat)) {
    out.push(`  ${label(k).padEnd(16)} ${usd(c / t.sweeps)}  ${t.cost ? Math.round((100 * c) / t.cost) : 0}%`);
  }
  out.push(`Failed calls: ${usd(t.failedCost)} in all (billed, though their items were lost).`);
  if (t.unpriced.length) {
    const why = t.unpriced.reduce((a, u) => ({ ...a, [u.why]: (a[u.why] || 0) + 1 }), {});
    out.push(`Not priced: ${t.unpriced.length} call${t.unpriced.length === 1 ? "" : "s"} (${Object.entries(why).map(([w, c]) => `${c} ${w}`).join(", ")}).`);
  }
  out.push("List prices from scripts/compare-models.mjs applied to the usage the API reported; not the Anthropic invoice.");
  return out.join("\n");
}

export function buildCsv(rows, t) {
  const cats = Object.keys(t.byCat);
  return toCsv([
    ["id", "at", "status", "kind", "calls", "failed", "input", "output", "searches", "cost_usd", ...cats.map((k) => k + "_usd"), "not_priced"],
    ...rows.map((r) => [r.id, r.at, r.status, r.manual ? "manual" : "scheduled", r.calls, r.failed, r.input, r.output, r.searches,
      r.cost.toFixed(6), ...cats.map((k) => (r.byCat[k] || 0).toFixed(6)), r.unpriced.length].map(String)),
  ]);
}

export async function main(argv, { storage, env = process.env, now = Date.now(), out = console.log, err = console.error } = {}) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`usage error: ${e.message}`);
    return 2;
  }
  try {
    if (!storage) {
      if (!env.BLOB_READ_WRITE_TOKEN) { err("error: BLOB_READ_WRITE_TOKEN is not set; run it with node --env-file=.env.local. Nothing was read"); return 1; }
      storage = (await import("../api/_lib/storage.js")).blobStorage();
    }
    const reader = { get: (k) => storage.get(k), list: (p) => storage.list(p) }; // reads only: no set, del or update reaches the store
    const ids = (await reader.list(KEY_LLMLOG_PREFIX)).filter((s) => /^\d{10,16}$/.test(s) && Number(s) >= now - a.days * DAY_MS).sort((x, y) => x - y);
    const rows = [];
    let unreadable = 0;
    for (const id of ids) {
      let lg = null;
      try { lg = JSON.parse(await reader.get(llmLogKey(id))); } catch (e) { /* counted below */ }
      if (!lg || !Array.isArray(lg.calls)) { unreadable++; continue; }
      rows.push(costLog({ id, ...lg }));
    }
    const t = totals(rows);
    out(formatReport(rows, t, a.days));
    if (unreadable) out(`${unreadable} log${unreadable === 1 ? "" : "s"} could not be read and ${unreadable === 1 ? "is" : "are"} left out.`);
    if (a.out) {
      mkdirSync(a.out, { recursive: true });
      writeFileSync(join(a.out, "sweeps.csv"), buildCsv(rows, t));
      out(`Wrote ${join(a.out, "sweeps.csv")}`);
    }
    return 0;
  } catch (e) {
    err(`error: ${e && e.message ? e.message : e}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
