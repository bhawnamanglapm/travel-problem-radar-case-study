// Compares two models on the sweep (docs/subscriptions/haiku-test.md). Each model runs the production
// prompt and settings (scanCategory), back to back, so both see the same news. Nothing is written to
// Blob and no email or Slack is sent; results go to a folder outside the repo.
//   node scripts/compare-models.mjs                 prints the plan and its cost; runs nothing
//   node scripts/compare-models.mjs --yes           runs it (needs ANTHROPIC_API_KEY in the shell)
//   node scripts/compare-models.mjs --score DIR     after you fill in the keep column of DIR/review.csv
// Options: --rounds N (default 3), --models baseline,candidate, --out DIR.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import { CATS, scanCategory } from "../api/_lib/radar.js";

// $ per million tokens. Haiku 5.5 charges the higher pair when a prompt is over 100K tokens.
export const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, over100k: { input: 0.5, output: 2.5 } },
};
export const SEARCH_PRICE = 0.01;
const DEFAULT_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
// The measured Sonnet average and the high-cost scenario, per sweep (docs/subscriptions/costing.md).
const AVG_SWEEP = { input: 60229, output: 4355, searches: 4.6 };
const HIGH_SWEEP = { input: 157000, output: 64000, searches: 12 };
// Pass marks for the candidate, the second model (docs/subscriptions/haiku-test.md).
export const PASS = { minItemsPerCat: 3, maxCostPerSweep: 0.08, minKeepRatio: 0.8 };
const BAD_STOPS = ["refusal", "max_tokens"];
const BLOCKED = new Set([401, 403, 429]);
const REVIEW_COLS = ["id", "category", "title", "summary", "source", "link", "region", "date", "severity", "opportunity", "keep"];
const ZERO = { input: 0, output: 0, searches: 0 };

// One API call. input_tokens is the call's total, so using it for Haiku's 100K rule can only overstate.
export function callCost(model, u) {
  const p = PRICES[model];
  const r = p.over100k && u.input > 100_000 ? p.over100k : p;
  return (u.input * r.input + u.output * r.output) / 1e6 + u.searches * SEARCH_PRICE;
}
// A whole sweep's usage spread evenly over its 4 calls.
const sweepEstimate = (model, s) =>
  CATS.length * callCost(model, { input: s.input / CATS.length, output: s.output / CATS.length, searches: s.searches / CATS.length });

// One sweep: all four categories at once, as runDailySweep does. The wrapper keeps the stop reason,
// which scanCategory doesn't return; an API error's message is already in scanCategory's error.
export async function runSweep(model, { apiKey, baseFetch = fetch, clock = Date.now }) {
  const t0 = clock();
  const cats = await Promise.all(CATS.map(async (cat) => {
    const meta = {};
    const fetchFn = async (url, init) => {
      const res = await baseFetch(url, init);
      const data = await res.json().catch(() => null);
      meta.stop = (data && data.stop_reason) || null;
      return { ok: res.ok, status: res.status, json: async () => data };
    };
    try {
      const { items, usage } = await scanCategory(cat, { fetchFn, apiKey, model });
      return { cat: cat.key, ok: true, items, usage, cost: callCost(model, usage), stop: meta.stop };
    } catch (e) {
      const usage = e.usage || ZERO;
      return { cat: cat.key, ok: false, error: e.message, items: [], usage, cost: callCost(model, usage), stop: meta.stop };
    }
  }));
  const usage = { ...ZERO };
  for (const c of cats) { usage.input += c.usage.input; usage.output += c.usage.output; usage.searches += c.usage.searches; }
  return { model, ms: clock() - t0, cats, usage, cost: cats.reduce((a, c) => a + c.cost, 0) };
}

// ok: loads. blocked: the site refuses scripts (open it by hand). broken: 404 and the like, no such
// host, or no answer in time.
export async function checkLink(url, { baseFetch = fetch, timeoutMs = 10_000 } = {}) {
  const go = (method) => baseFetch(url, {
    method, redirect: "follow", signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "Mozilla/5.0 (compatible; travel-problem-radar link check)" },
  });
  try {
    let res = await go("HEAD");
    if (res.status === 405 || res.status === 501 || BLOCKED.has(res.status)) res = await go("GET");
    try { await res.body?.cancel?.(); } catch (e) {}
    return { status: res.status, result: res.status < 400 ? "ok" : BLOCKED.has(res.status) ? "blocked" : "broken" };
  } catch (e) { return { status: null, result: "broken" }; }
}

async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) { const k = next++; out[k] = await fn(list[k]); }
  }));
  return out;
}

const uniqueItems = (sweeps) => {
  const by = new Map();
  for (const s of sweeps) for (const c of s.cats) for (const it of c.items) if (!by.has(it.id)) by.set(it.id, it);
  return [...by.values()];
};
const $ = (n) => "$" + n.toFixed(4);

// Text summary for each model, plus the automatic checks on the candidate. links: url -> result.
export function summarize(models, sweeps, links) {
  const lines = [];
  const stats = {};
  for (const m of models) {
    const ss = sweeps.filter((s) => s.model === m);
    const runs = ss.flatMap((s) => s.cats);
    const items = uniqueItems(ss);
    const avg = (f) => ss.reduce((a, s) => a + f(s), 0) / (ss.length || 1);
    const linkResults = items.filter((it) => it.link).map((it) => links[it.link] || "broken");
    const st = stats[m] = {
      allCats: ss.length > 0 && ss.every((s) => s.cats.every((c) => c.ok)),
      failures: runs.filter((c) => !c.ok).map((c) => `${c.cat}: ${c.error}`),
      badStops: runs.filter((c) => BAD_STOPS.includes(c.stop)).map((c) => `${c.cat}: ${c.stop}`),
      itemsPerCat: runs.reduce((a, c) => a + c.items.length, 0) / (runs.length || 1),
      cost: avg((s) => s.cost),
      missing: items.filter((it) => !it.link).length,
      ok: linkResults.filter((r) => r === "ok").length,
      blocked: items.filter((it) => it.link && links[it.link] === "blocked").map((it) => it.link),
      broken: items.filter((it) => it.link && (links[it.link] || "broken") === "broken").map((it) => it.link),
      ids: new Set(items.map((it) => it.id)),
    };
    lines.push(`\n${m}: ${ss.length} sweeps`);
    lines.push(`  categories with items: ${runs.filter((c) => c.ok).length} of ${runs.length}`);
    for (const f of st.failures) lines.push(`    failed ${f}`);
    lines.push(`  refusal or max_tokens: ${st.badStops.length ? st.badStops.join("; ") : "none"}`);
    lines.push(`  items per category: ${st.itemsPerCat.toFixed(1)} on average; ${items.length} different items`);
    lines.push(`  per sweep: ${Math.round(avg((s) => s.usage.input))} input, ${Math.round(avg((s) => s.usage.output))} output, ${avg((s) => s.usage.searches).toFixed(1)} searches, ${$(st.cost)}, ${(avg((s) => s.ms) / 1000).toFixed(0)} s`);
    lines.push(`  links: ${st.ok} load, ${st.blocked.length} blocked, ${st.broken.length} broken, ${st.missing} items with no link`);
    for (const u of st.broken) lines.push(`    broken ${u}`);
    for (const u of st.blocked) lines.push(`    blocked (open by hand) ${u}`);
  }
  const [base, cand] = models;
  const shared = [...stats[cand].ids].filter((id) => stats[base].ids.has(id)).length;
  lines.push(`\nItems both models found (same title): ${shared}`);
  const c = stats[cand];
  const checks = [
    [c.allCats, "every category returned items in every sweep"],
    [c.badStops.length === 0, "no refusal or max_tokens"],
    [c.itemsPerCat >= PASS.minItemsPerCat, `at least ${PASS.minItemsPerCat} items per category on average`],
    [c.missing === 0 && c.broken.length === 0, "every item has a link and none is broken (blocked ones: check by hand)"],
    [c.cost <= PASS.maxCostPerSweep, `at most $${PASS.maxCostPerSweep} a sweep`],
  ];
  lines.push(`\nAutomatic checks for ${cand}:`);
  for (const [ok, label] of checks) lines.push(`  ${ok ? "PASS" : "FAIL"} ${label}`);
  lines.push(`  The keep/drop review decides the rest: fill in review.csv, then run --score.`);
  return { text: lines.join("\n"), pass: checks.every(([ok]) => ok) };
}

// Excel would run a cell starting with = + - @ as a formula; the items come from web pages.
const cell = (v) => {
  const s = String(v ?? "");
  return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"';
};
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else q = false;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Every item once per model, shuffled, with no model column. key.json says which model found which.
export function buildReview(sweeps, rand = randomInt) {
  const seen = new Set();
  const rows = [];
  for (const s of sweeps) for (const c of s.cats) for (const it of c.items) {
    if (seen.has(s.model + "|" + it.id)) continue;
    seen.add(s.model + "|" + it.id);
    rows.push({ model: s.model, it });
  }
  for (let i = rows.length - 1; i > 0; i--) { const j = rand(i + 1); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  const key = {};
  const table = rows.map(({ model, it }, i) => {
    const id = "R" + String(i + 1).padStart(3, "0");
    key[id] = model;
    return [id, it.cat, it.title, it.summary, it.source, it.link, it.region, it.date, it.severity, it.opportunity, ""];
  });
  return { csv: toCsv([REVIEW_COLS, ...table]), key };
}

// keep column: y = keep, n = drop, f = invented (not real, or the link doesn't support it).
export function score(csvText, key, models) {
  const [head = [], ...rows] = parseCsv(csvText);
  const idCol = head.indexOf("id"), keepCol = head.indexOf("keep");
  if (idCol < 0 || keepCol < 0) throw new Error("review.csv needs its id and keep columns");
  const by = Object.fromEntries(models.map((m) => [m, { y: 0, n: 0, f: 0, blank: 0 }]));
  for (const r of rows) {
    const m = key[r[idCol]];
    if (!m || !by[m]) continue;
    const v = String(r[keepCol] || "").trim().toLowerCase()[0];
    by[m][["y", "n", "f"].includes(v) ? v : "blank"]++;
  }
  const rate = (b) => (b.y + b.n + b.f ? b.y / (b.y + b.n + b.f) : 0);
  const lines = models.map((m) => {
    const b = by[m];
    return `${m}: keep ${b.y}, drop ${b.n}, invented ${b.f}, not marked ${b.blank}; keep rate ${(rate(b) * 100).toFixed(0)}%`;
  });
  const [base, cand] = models;
  const blanks = by[base].blank + by[cand].blank;
  const pass = blanks === 0 && by[cand].f === 0 && rate(by[cand]) >= PASS.minKeepRatio * rate(by[base]);
  lines.push(blanks
    ? `Not finished: ${blanks} item(s) have no y, n or f.`
    : `${pass ? "PASS" : "FAIL"} ${cand}: no invented items and a keep rate of at least ${PASS.minKeepRatio * 100}% of ${base}'s`);
  return { text: lines.join("\n"), pass };
}

function parseArgs(argv) {
  const a = { rounds: 3, models: DEFAULT_MODELS, yes: false, out: null, score: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { const x = argv[++i]; if (x === undefined) throw new Error(k + " needs a value"); return x; };
    if (k === "--yes") a.yes = true;
    else if (k === "--rounds") a.rounds = Number(val());
    else if (k === "--models") a.models = val().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--out") a.out = val();
    else if (k === "--score") a.score = val();
    else throw new Error("unknown option " + k);
  }
  if (!Number.isInteger(a.rounds) || a.rounds < 1 || a.rounds > 10) throw new Error("--rounds must be a whole number from 1 to 10");
  if (a.models.length !== 2) throw new Error("--models takes two model IDs: baseline,candidate");
  for (const m of a.models) if (!PRICES[m]) throw new Error(`no price for ${m}; add it to PRICES first`);
  return a;
}

export async function main(argv = process.argv.slice(2), { env = process.env, baseFetch = fetch, clock = Date.now, log = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.score) {
    const key = JSON.parse(readFileSync(join(args.score, "key.json"), "utf8"));
    const { models } = JSON.parse(readFileSync(join(args.score, "results.json"), "utf8"));
    const r = score(readFileSync(join(args.score, "review.csv"), "utf8"), key, models);
    log(r.text);
    return { ran: false, pass: r.pass };
  }

  const { models, rounds } = args;
  const est = (s) => rounds * models.reduce((a, m) => a + sweepEstimate(m, s), 0);
  log(`${rounds} round(s), each one sweep with ${models.join(" and one with ")}: ${rounds * models.length} sweeps.`);
  log(`Expected cost about $${est(AVG_SWEEP).toFixed(2)}; high-cost scenario about $${est(HIGH_SWEEP).toFixed(2)}.`);
  if (!args.yes) { log("Nothing was run. Add --yes to run it; it needs ANTHROPIC_API_KEY in the shell."); return { ran: false }; }
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set; nothing was run");

  const out = args.out || join(tmpdir(), "radar-compare-" + new Date(clock()).toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  const save = (name, text) => writeFileSync(join(out, name), text);
  const sweeps = [];
  for (let r = 1; r <= rounds; r++) {
    // Alternate which model goes first, so neither always sees the news a minute later.
    for (const m of r % 2 ? models : [...models].reverse()) {
      log(`Round ${r}: ${m} ...`);
      const s = { round: r, ...(await runSweep(m, { apiKey: env.ANTHROPIC_API_KEY, baseFetch, clock })) };
      sweeps.push(s);
      log(`  ${s.cats.filter((c) => c.ok).length}/${CATS.length} categories, ${s.cats.reduce((a, c) => a + c.items.length, 0)} items, ${$(s.cost)}, ${(s.ms / 1000).toFixed(0)} s`);
      for (const c of s.cats) if (!c.ok) log(`    failed ${c.cat}: ${c.error}`);
      save("results.json", JSON.stringify({ models, sweeps }, null, 2)); // kept even if a later step fails
    }
  }

  const urls = [...new Set(sweeps.flatMap((s) => s.cats.flatMap((c) => c.items.map((it) => it.link))).filter(Boolean))];
  log(`Checking ${urls.length} links ...`);
  const checked = await mapLimit(urls, 8, (u) => checkLink(u, { baseFetch }));
  const links = Object.fromEntries(urls.map((u, i) => [u, checked[i].result]));

  const summary = summarize(models, sweeps, links);
  const review = buildReview(sweeps);
  save("results.json", JSON.stringify({ models, sweeps, links }, null, 2));
  save("summary.txt", summary.text + "\n");
  save("review.csv", review.csv);
  save("key.json", JSON.stringify(review.key, null, 2));
  log(summary.text);
  log(`\nTotal spent: ${$(sweeps.reduce((a, s) => a + s.cost, 0))}`);
  log(`Files in ${out}`);
  log(`Next: open review.csv (not key.json), put y, n or f in the keep column, save it as CSV, then run`);
  log(`  node scripts/compare-models.mjs --score "${out}"`);
  return { ran: true, out, pass: summary.pass };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
