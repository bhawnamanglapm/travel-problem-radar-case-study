// Scores saved live items with the README's rubric (T30 step 10, LR-03). It reads the saved sweeps from Blob and
// only reads: nothing is written there and no email or Slack is sent. Results go to a folder outside the repo.
//   node --env-file=.env.local scripts/score-items.mjs     picks the items, checks links and dates, writes review.csv
//   node scripts/score-items.mjs --score DIR               after you fill in the y/n columns of DIR/review.csv
// Options: --count N (default 20), --out DIR.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATS, KEY_INDEX, SOURCE_MAX_DAYS, sweepKey } from "../api/_lib/radar.js";
import { checkLink, mapLimit, parseCsv, toCsv } from "./compare-models.mjs";

const DAY = 86400000;
// The window the site promises: sources published in about the last 60 days.
export const RECENT_DAYS = SOURCE_MAX_DAYS;
// The README's rubric, in its order. The script fills link_loads and recent; you fill the other four.
export const RUBRIC = [
  { col: "link_loads", label: "The source link loads" },
  { col: "supports_summary", label: "The source supports the summary" },
  { col: "recent", label: `Recent (the source within ${RECENT_DAYS} days of being found)` },
  { col: "category_right", label: "The category is right" },
  { col: "severity_ok", label: "The severity is reasonable" },
  { col: "user_and_build", label: "The opportunity names a user and something buildable" },
];
const ITEM_COLS = ["id", "category", "title", "summary", "source", "link", "region", "date", "source_date", "severity", "opportunity", "found"];
const PASS_V = new Set(["y", "yes", "ok"]);
const FAIL_V = new Set(["n", "no", "broken", "none"]);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseArgs(argv) {
  const a = { count: 20, out: null, score: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(k + " needs a value"); return argv[++i]; };
    if (k === "--count") a.count = Number(val());
    else if (k === "--out") a.out = val();
    else if (k === "--score") a.score = val();
    else throw new Error("unknown option " + k);
  }
  if (!Number.isInteger(a.count) || a.count < 1 || a.count > 200) throw new Error("--count must be a whole number from 1 to 200");
  return a;
}

// The saved sweeps, newest first. A sweep whose file is gone (or can't be read) is skipped and counted.
export async function readSweeps(storage) {
  let hist;
  try { hist = JSON.parse(await storage.get(KEY_INDEX)); } catch (e) { hist = null; }
  if (!Array.isArray(hist)) throw new Error("no sweep index (radar:history) in this store; nothing to score");
  const sweeps = [];
  let missing = 0;
  for (const e of [...hist].reverse()) {
    let sw = null;
    try { sw = JSON.parse(await storage.get(sweepKey(e.id))); } catch (err) {}
    if (!sw || !Array.isArray(sw.problems)) { missing++; continue; }
    sweeps.push({ id: e.id, at: sw.at || e.at, problems: sw.problems });
  }
  return { sweeps, missing };
}

// Each item once (by id, as its newest sweep has it), then taken a category at a time in CATS order, so 20
// items is 5 from each when every category has 5. A category that runs out leaves its turns to the others.
export function pickItems(sweeps, count) {
  const seen = new Set();
  const byCat = Object.fromEntries(CATS.map((c) => [c.key, []]));
  for (const s of sweeps) {
    for (const p of s.problems) {
      if (!p || !p.id || seen.has(p.id) || !byCat[p.cat]) continue;
      seen.add(p.id);
      byCat[p.cat].push({ ...p, found: p.firstAt || s.at });
    }
  }
  const out = [];
  for (let i = 0; out.length < count && CATS.some((c) => i < byCat[c.key].length); i++) {
    for (const c of CATS) if (out.length < count && i < byCat[c.key].length) out.push(byCat[c.key][i]);
  }
  return { items: out, unique: seen.size, byCat: Object.fromEntries(CATS.map((c) => [c.key, out.filter((p) => p.cat === c.key).length])) };
}

// The span of days a date names, as [first ms, last ms] in UTC, or null. The sweep saves dates as the model
// wrote them: mostly "Oct 2026", sometimes a day ("12 Oct 2026", "Oct 12, 2026", "2026-10-12") or "2026-10".
export function dateRange(text) {
  const s = String(text || "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const mon = (w) => MONTHS.findIndex((f) => w === f || w === f.slice(0, 3) || (f === "september" && w === "sept"));
  const month = (y, mo) => (mo < 0 || mo > 11 ? null : [Date.UTC(y, mo, 1), Date.UTC(y, mo + 1, 1) - 1]);
  const day = (y, mo, d) => {
    const t = Date.UTC(y, mo, d);
    return mo < 0 || new Date(t).getUTCMonth() !== mo || new Date(t).getUTCDate() !== d ? null : [t, t + DAY - 1];
  };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return day(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return month(+m[1], +m[2] - 1);
  if ((m = s.match(/^(\d{1,2}) ([a-z]+)\.? (\d{4})$/))) return day(+m[3], mon(m[2]), +m[1]);
  if ((m = s.match(/^([a-z]+)\.? (\d{1,2}) (\d{4})$/))) return day(+m[3], mon(m[1]), +m[2]);
  if ((m = s.match(/^([a-z]+)\.? (\d{4})$/))) return month(+m[2], mon(m[1]));
  return null;
}

// yes: every day the date names is within RECENT_DAYS before the item was found. no: every day is older.
// unknown: a month that straddles the line, a date after it was found, or a date that can't be read.
export function recent(dateText, foundAt, days = RECENT_DAYS) {
  const r = dateRange(dateText);
  const at = Date.parse(foundAt);
  if (!r || !Number.isFinite(at) || r[0] > at) return "unknown";
  const from = at - days * DAY;
  if (r[0] >= from) return "yes";
  if (r[1] < from) return "no";
  return "unknown";
}

// recent is judged on the source's date when the sweep dated it (an exact day, from search), else on the model's own date.
export function buildReview(items, links) {
  const rows = items.map((p) => {
    const auto = { link_loads: p.link ? links[p.link] || "broken" : "none", recent: recent(p.sourceDate || p.date, p.found) };
    return [p.id, p.cat, p.title, p.summary, p.source, p.link, p.region, p.date, p.sourceDate || "", p.severity, p.opportunity, p.found,
      ...RUBRIC.map((r) => auto[r.col] || "")];
  });
  return toCsv([[...ITEM_COLS, ...RUBRIC.map((r) => r.col)], ...rows]);
}

// The share that passes each rubric line. y, yes or ok passes; n, no, broken or none fails; anything else
// (blank, blocked, unknown) isn't counted and is reported as not scored.
export function score(csvText) {
  const [head = [], ...rows] = parseCsv(csvText);
  const data = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const results = {};
  const lines = [`${data.length} items in review.csv.`];
  for (const r of RUBRIC) {
    const i = head.indexOf(r.col);
    if (i < 0) throw new Error(`review.csv has no ${r.col} column`);
    const t = { pass: 0, fail: 0, left: 0 };
    for (const row of data) {
      const v = String(row[i] || "").trim().toLowerCase();
      if (PASS_V.has(v)) t.pass++; else if (FAIL_V.has(v)) t.fail++; else t.left++;
    }
    results[r.col] = t;
    const n = t.pass + t.fail;
    lines.push(`  ${r.label}: ${n ? `${t.pass} of ${n} (${Math.round((100 * t.pass) / n)}%)` : "none scored"}${t.left ? `; ${t.left} not scored` : ""}`);
  }
  return { text: lines.join("\n"), results, items: data.length };
}

export async function main(argv = process.argv.slice(2), { storage, env = process.env, baseFetch = fetch, clock = Date.now, log = console.log } = {}) {
  const args = parseArgs(argv);
  if (args.score) {
    const r = score(readFileSync(join(args.score, "review.csv"), "utf8"));
    log(r.text);
    return { scored: true, ...r };
  }
  if (!storage) {
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set; run it with node --env-file=.env.local. Nothing was read");
    storage = (await import("../api/_lib/storage.js")).blobStorage();
  }
  const reader = { get: (k) => storage.get(k) }; // reads only: no set, del or update reaches the store

  const { sweeps, missing } = await readSweeps(reader);
  const { items, unique, byCat } = pickItems(sweeps, args.count);
  log(`Read ${sweeps.length} saved sweeps${missing ? ` (${missing} listed but missing, skipped)` : ""}: ${unique} unique items.`);
  if (items.length < args.count) log(`Only ${items.length} items to score, fewer than the ${args.count} asked for.`);
  log(`Picked ${items.length}: ${CATS.map((c) => `${c.key} ${byCat[c.key]}`).join(", ")}.`);

  const urls = [...new Set(items.map((p) => p.link).filter(Boolean))];
  log(`Checking ${urls.length} links ...`);
  const checked = await mapLimit(urls, 8, (u) => checkLink(u, { baseFetch }));
  const links = Object.fromEntries(urls.map((u, i) => [u, checked[i].result]));
  const csv = buildReview(items, links);

  const count = (col) => {
    const [head, ...rows] = parseCsv(csv);
    const i = head.indexOf(col);
    return rows.reduce((a, r) => ({ ...a, [r[i]]: (a[r[i]] || 0) + 1 }), {});
  };
  const lk = count("link_loads"), rc = count("recent");
  log(`Links: ${lk.ok || 0} ok, ${lk.broken || 0} broken, ${lk.blocked || 0} blocked, ${lk.none || 0} with no link.`);
  log(`Dated within ${RECENT_DAYS} days of being found: ${rc.yes || 0} yes, ${rc.no || 0} no, ${rc.unknown || 0} unknown.`);

  const out = args.out || join(tmpdir(), "radar-score-" + new Date(clock()).toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "review.csv"), csv);
  writeFileSync(join(out, "items.json"), JSON.stringify({ at: new Date(clock()).toISOString(), items, links }, null, 2));
  log(`Files in ${out}`);
  log(`Next: open review.csv. Put y or n in supports_summary, category_right, severity_ok and user_and_build.`);
  log(`Open each blocked link yourself and write ok or broken; where recent says unknown, write yes or no if you can tell.`);
  log(`Then run  node scripts/score-items.mjs --score "${out}"`);
  return { scored: false, out, items, links, missing, unique };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
