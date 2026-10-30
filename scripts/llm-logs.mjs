// Owner tool for the sweep's LLM logs: every Claude call's request and response, saved in the Blob
// store because Vercel's Hobby plan keeps function logs for an hour only. Runs on your own machine;
// it is not deployed (.vercelignore skips scripts/) and adds no endpoint. Read-only.
//
//   node --env-file=.env.local scripts/llm-logs.mjs list [--days 7]
//   node --env-file=.env.local scripts/llm-logs.mjs summary <id|latest>
//   node --env-file=.env.local scripts/llm-logs.mjs show <id|latest>
//   node --env-file=.env.local scripts/llm-logs.mjs models [--days 30]
//
// `list`: one line per sweep that ran, newest first, with its tokens, searches, pages, model and cost.
// `summary`: one sweep's model, cost and totals, per-call outcomes, the pages search found (link, title, age) and
// what was quoted.
// `show`: the whole log as JSON (requests, responses, thinking, links).
// `models`: the logs grouped by model, with averages per sweep: items, pages, searches, tokens, cost, failed calls,
// quotes and how old the pages were. Volume, freshness and cost, not quality.
// Costs are list prices (scripts/compare-models.mjs) applied to the usage the API reported, as cost-per-run.mjs does.
// Exit codes: 0 done, 1 not found or error, 2 bad usage.
import { pathToFileURL } from "node:url";
import { KEY_LLMLOG_PREFIX, LLM_LOG_KEEP_DAYS, llmLogKey } from "../api/_lib/radar.js";
import { costLog, priceCall } from "./cost-per-run.mjs";

const DAY_MS = 24 * 3600 * 1000;
const COMMANDS = { list: 0, summary: 1, show: 1, models: 0 };
const OLD_PAGE_DAYS = 30;

class UsageError extends Error {}

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!(cmd in COMMANDS)) throw new UsageError(`unknown command${cmd ? ` "${cmd}"` : ""}; one of: ${Object.keys(COMMANDS).join(", ")}`);
  const args = [];
  let days = cmd === "models" ? LLM_LOG_KEEP_DAYS : 7;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--days" && (cmd === "list" || cmd === "models")) {
      const d = rest[i + 1] || "";
      if (cmd === "models" && (!/^\d{1,2}$/.test(d) || Number(d) < 1 || Number(d) > LLM_LOG_KEEP_DAYS)) {
        throw new UsageError(`--days must be a whole number from 1 to ${LLM_LOG_KEEP_DAYS}`);
      }
      if (!/^\d{1,4}$/.test(d) || Number(d) < 1) throw new UsageError("--days must be a whole number, 1 or more");
      days = Number(rest[++i]);
    } else if (rest[i].startsWith("--")) throw new UsageError(`${cmd}: unknown option ${rest[i]}`);
    else args.push(rest[i]);
  }
  if (args.length !== COMMANDS[cmd]) throw new UsageError(`${cmd}: expected ${COMMANDS[cmd] ? "a log id or latest" : "no arguments"}`);
  if (args[0] && args[0] !== "latest" && !/^\d{10,16}$/.test(args[0])) throw new UsageError("the id is the number `list` shows, or latest");
  return { cmd, id: args[0] || null, days };
}

const ids = async (storage) => (await storage.list(KEY_LLMLOG_PREFIX)).filter((s) => /^\d{10,16}$/.test(s)).sort((a, b) => a - b);

async function readLog(storage, id) {
  if (id === "latest") id = (await ids(storage)).pop();
  if (!id) return null;
  const v = await storage.get(llmLogKey(id));
  return v == null ? null : JSON.parse(v);
}

const n = (x) => Number(x || 0).toLocaleString("en-US");
const usd = (x) => "$" + x.toFixed(4);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const plural = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;

// The model the sweep's calls asked for: models joined with + if they differ, unknown if none says.
export function modelOf(lg) {
  const ms = [...new Set((lg.calls || []).map((c) => c && c.request && c.request.model).filter(Boolean))];
  return ms.length ? ms.join("+") : "unknown";
}

// The sweep's cost, and why any call in it can't be priced. Never a guess.
function costText(lg) {
  const r = costLog(lg);
  if (!r.unpriced.length) return usd(r.cost);
  const why = Object.entries(r.unpriced.reduce((a, u) => ({ ...a, [u.why]: (a[u.why] || 0) + 1 }), {}))
    .map(([w, c]) => `${c} ${w}`).join(", ");
  const left = `${plural(r.unpriced.length, "call")} not priced: ${why}`;
  return r.unpriced.length === (lg.calls || []).length ? `not known (${left})` : `${usd(r.cost)} (${left})`;
}

const line = (lg) => {
  const s = lg.summary || {};
  return `${lg.id}  ${lg.at}  ${String(lg.status).slice(0, 12).padEnd(12)}  ${s.calls - s.failed}/${s.calls} calls ok  `
    + `in ${n(s.input)}  out ${n(s.output)}  searches ${n(s.searches)}  pages ${n(s.pages)}  ${modelOf(lg)}  ${costText(lg)}`
    + `${lg.manual ? "  (manual)" : ""}`;
};

const blocksOf = (c) => (c && c.response && c.response.content) || [];
const pagesOf = (c) => blocksOf(c).flatMap((b) => (Array.isArray(b.pages) ? b.pages : []));
const quotesOf = (c) => blocksOf(c).flatMap((b) => (Array.isArray(b.citations) ? b.citations : [])).filter((q) => q && q.quote);

export function formatSummary(lg) {
  const s = lg.summary || {};
  const out = [
    `Sweep ${lg.id} at ${lg.at}: ${lg.status}${lg.manual ? " (manual)" : ""}${lg.slot != null ? `, slot ${lg.slot}` : ""}`,
    `Model: ${modelOf(lg)}. Cost: ${costText(lg)}, at list prices.`,
    `Tokens: ${n(s.input)} input, ${n(s.output)} output. Searches: ${n(s.searches)}. Pages: ${n(s.pages)}.`,
    "",
  ];
  for (const c of lg.calls || []) {
    const u = c.usage || {};
    const how = c.error ? `failed: ${c.error}` : `${c.items} items`;
    const p = priceCall(c);
    out.push(`${String(c.cat).padEnd(14)} ${how}; in ${n(u.input)}, out ${n(u.output)}, searches ${n(u.searches)}, pages ${n(u.pages)}`
      + `${c.ms != null ? `, ${(c.ms / 1000).toFixed(1)} s` : ""}, ${p.cost != null ? usd(p.cost) : "not priced"}`);
  }
  // Each page's title and age, from the calls' search results. Older logs kept links only.
  const about = {};
  for (const p of (lg.calls || []).flatMap(pagesOf)) {
    if (p && p.url && p.title && !about[p.url]) about[p.url] = `${p.title}${p.age ? ` (${p.age})` : ""}`;
  }
  out.push("", "Pages:", ...(s.links || []).map((l) => "  " + l + (about[l] ? `  — ${about[l]}` : "")));
  const quoted = [];
  for (const c of lg.calls || []) {
    const qs = quotesOf(c);
    if (qs.length) quoted.push(`  ${c.cat}:`, ...qs.map((q) => `    "${q.quote}"  ${q.url}`));
  }
  if (quoted.length) out.push("", "Quoted:", ...quoted);
  return out.join("\n");
}

// A page's age in days, from search's text ("34 days ago"); null when there's none or it reads otherwise.
const UNIT_DAYS = { hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
export function ageDays(age) {
  const m = /^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/i.exec(String(age || "").trim());
  return m ? Number(m[1]) * UNIT_DAYS[m[2].toLowerCase()] : null;
}

// One model's numbers, from its sweeps' logs. Items from failed calls were lost, so they aren't counted.
export function modelStats(logs) {
  const sweeps = logs.length;
  const calls = logs.flatMap((lg) => lg.calls || []);
  const avg = (f) => logs.reduce((a, lg) => a + (f(lg.summary || {}) || 0), 0) / sweeps;
  const items = calls.reduce((a, c) => a + (c.error ? 0 : c.items || 0), 0);
  const costs = logs.map(costLog);
  const cost = costs.reduce((a, r) => a + r.cost, 0);
  // Each sweep's pages once; older logs kept links only, so those pages have no age.
  let aged = 0, old = 0, noAge = 0;
  for (const lg of logs) {
    const seen = new Set();
    for (const p of (lg.calls || []).flatMap(pagesOf)) {
      const url = typeof p === "string" ? p : p && p.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const d = typeof p === "string" ? null : ageDays(p.age);
      if (d == null) noAge++;
      else { aged++; if (d > OLD_PAGE_DAYS) old++; }
    }
  }
  const dates = logs.map((lg) => String(lg.at).slice(0, 10)).sort();
  return {
    sweeps, first: dates[0], last: dates[dates.length - 1],
    calls: calls.length, failed: calls.filter((c) => c.error).length,
    items, avgItems: items / sweeps,
    avgPages: avg((s) => s.pages), avgSearches: avg((s) => s.searches), avgInput: avg((s) => s.input), avgOutput: avg((s) => s.output),
    cost, avgCost: cost / sweeps, costPerItem: items ? cost / items : null,
    unpriced: costs.reduce((a, r) => a + r.unpriced.length, 0),
    quotedCalls: calls.filter((c) => quotesOf(c).length).length,
    aged, old, noAge,
  };
}

export function formatModels(logs, days) {
  const by = {};
  for (const lg of logs) (by[modelOf(lg)] ||= []).push(lg);
  const models = Object.entries(by).sort((a, b) => b[1].length - a[1].length);
  const out = [`LLM logs from the last ${plural(days, "day")}: ${plural(logs.length, "sweep")}, ${plural(models.length, "model")}.`];
  for (const [model, lgs] of models) {
    const m = modelStats(lgs);
    out.push("", `${model}: ${plural(m.sweeps, "sweep")}, ${m.first} to ${m.last}`,
      `  Failed calls: ${m.failed} of ${m.calls} (${pct(m.failed, m.calls)})`,
      `  Per sweep: ${m.avgItems.toFixed(1)} items, ${m.avgPages.toFixed(1)} pages, ${m.avgSearches.toFixed(1)} searches, `
        + `${n(Math.round(m.avgInput))} input and ${n(Math.round(m.avgOutput))} output tokens`,
      `  Cost: ${usd(m.avgCost)} a sweep, ${m.costPerItem != null ? usd(m.costPerItem) : "-"} an item`
        + `${m.unpriced ? ` (${plural(m.unpriced, "call")} not priced, left out)` : ""}`,
      `  Calls that quoted a passage: ${m.quotedCalls} of ${m.calls}`,
      `  Pages older than ${OLD_PAGE_DAYS} days: ${m.old} of ${m.aged} with an age (${pct(m.old, m.aged)}); ${m.noAge} with no age`);
  }
  if (models.length === 1) out.push("", "Only one model in these logs, so there's nothing to compare yet.");
  out.push("", "These measure volume, freshness and cost, not quality. For quality, review the items: the blind test in",
    "docs/subscriptions/haiku-test.md, or scripts/score-items.mjs.");
  return out.join("\n");
}

export async function main(argv, { storage, now = Date.now(), out = console.log, err = console.error } = {}) {
  let p;
  try { p = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`usage error: ${e.message}`);
    return 2;
  }
  try {
    if (p.cmd === "models") {
      const logs = [];
      for (const id of (await ids(storage)).filter((id) => Number(id) >= now - p.days * DAY_MS)) {
        try {
          const lg = JSON.parse(await storage.get(llmLogKey(id)));
          if (lg && Array.isArray(lg.calls)) logs.push(lg);
        } catch (e) { /* an unreadable log is left out */ }
      }
      out(logs.length ? formatModels(logs, p.days) : `no LLM logs in the last ${plural(p.days, "day")}`);
      return 0;
    }
    if (p.cmd === "list") {
      const recent = (await ids(storage)).filter((id) => Number(id) >= now - p.days * DAY_MS).reverse();
      if (!recent.length) { out(`no LLM logs in the last ${p.days} day${p.days === 1 ? "" : "s"}`); return 0; }
      for (const id of recent) {
        let lg = null;
        try { lg = JSON.parse(await storage.get(llmLogKey(id))); } catch (e) { /* shown as unreadable */ }
        out(lg ? line(lg) : `${id}  unreadable`);
      }
      return 0;
    }
    const lg = await readLog(storage, p.id);
    if (!lg) { err(`not found: no LLM log ${p.id}`); return 1; }
    out(p.cmd === "show" ? JSON.stringify(lg, null, 2) : formatSummary(lg));
    return 0;
  } catch (e) {
    err(`error: ${e && e.message ? e.message : e}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { blobStorage } = await import("../api/_lib/storage.js");
  process.exitCode = await main(process.argv.slice(2), { storage: blobStorage() });
}
