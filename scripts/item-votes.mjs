// Adds up the Useful / Not useful votes Pro members left on items (T43). It reads the subscriber records and the
// search file from Blob and only reads: nothing is written there and no email or Slack is sent.
//   node --env-file=.env.local scripts/item-votes.mjs              the share of voted items found useful, overall and in India
// Options: --top N (default 20) items listed, most votes first; --area NAME a second area to show beside India.
// An item counts as useful when it has more Useful votes than Not useful; a tie counts as split, not useful.
import { pathToFileURL } from "node:url";
import { AREAS, CATS, KEY_SEARCH, areaOf } from "../api/_lib/radar.js";
import { listSubscribers } from "../api/_lib/subscribers.js";

export function parseArgs(argv) {
  const args = { top: 20, area: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--top") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error("--top takes a whole number from 0 to 500");
      args.top = n;
    } else if (a === "--area") {
      const name = String(argv[++i] || "");
      const area = AREAS.find((x) => x.toLowerCase() === name.toLowerCase());
      if (!area) throw new Error(`--area takes one of: ${AREAS.join(", ")}`);
      args.area = area;
    } else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

// Votes per item from every record, joined to the search file for titles and areas. An item no longer in the
// search file (its sweep has aged out) keeps its votes, with no title and no area.
export function tally(records, searchFile) {
  const byId = new Map();
  for (const p of (searchFile && Array.isArray(searchFile.items) ? searchFile.items : [])) if (p && p.id) byId.set(p.id, p);
  const items = new Map();
  let members = 0;
  let up = 0;
  let down = 0;
  for (const r of records) {
    const votes = Array.isArray(r.votes) ? r.votes.filter((x) => x && typeof x.id === "string" && (x.v === 1 || x.v === -1)) : [];
    if (!votes.length) continue;
    members++;
    for (const x of votes) {
      let t = items.get(x.id);
      if (!t) {
        const p = byId.get(x.id);
        t = { id: x.id, up: 0, down: 0, title: p ? p.title : null, cat: p ? p.cat : x.id.split(":")[0], area: p ? areaOf(p.region) : null };
        items.set(x.id, t);
      }
      if (x.v === 1) { t.up++; up++; } else { t.down++; down++; }
    }
  }
  const list = [...items.values()].sort((a, b) => b.up + b.down - (a.up + a.down) || b.up - a.up || (a.id < b.id ? -1 : 1));
  return { members, up, down, items: list };
}

// Useful, split and not useful counts for a set of items, and the share useful.
export function shares(items) {
  const useful = items.filter((t) => t.up > t.down).length;
  const notUseful = items.filter((t) => t.down > t.up).length;
  const split = items.length - useful - notUseful;
  return { items: items.length, useful, split, notUseful, share: items.length ? useful / items.length : null };
}

const pct = (x) => (x === null ? "none voted" : `${Math.round(100 * x)}%`);
const line = (label, s) => `  ${label}: ${s.items ? `${s.useful} of ${s.items} useful (${pct(s.share)}), ${s.split} split, ${s.notUseful} not useful` : "no items voted on"}`;

export function report(t, { top = 20, area = null } = {}) {
  const lines = [];
  lines.push(`${t.members} ${t.members === 1 ? "member has" : "members have"} voted: ${t.up} Useful, ${t.down} Not useful, on ${t.items.length} items.`);
  const all = shares(t.items);
  const india = shares(t.items.filter((x) => x.area === "India"));
  lines.push(line("All items", all));
  lines.push(line("India", india));
  if (area && area !== "India") lines.push(line(area, shares(t.items.filter((x) => x.area === area))));
  const gone = t.items.filter((x) => x.area === null).length;
  if (gone) lines.push(`  ${gone} voted ${gone === 1 ? "item is" : "items are"} no longer in the search file, so ${gone === 1 ? "its" : "their"} area is unknown.`);
  if (top && t.items.length) {
    lines.push("", `Most voted${t.items.length > top ? ` (top ${top} of ${t.items.length})` : ""}:`);
    const label = (key) => (CATS.find((c) => c.key === key) || {}).label || key;
    for (const x of t.items.slice(0, top)) {
      lines.push(`  +${x.up} -${x.down}  ${x.title || x.id}  [${label(x.cat)}; ${x.area || "area unknown"}]`);
    }
  }
  return { text: lines.join("\n"), all, india };
}

export async function main(argv = process.argv.slice(2), { storage, env = process.env, log = console.log } = {}) {
  const args = parseArgs(argv);
  if (!storage) {
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set; run it with node --env-file=.env.local. Nothing was read");
    storage = (await import("../api/_lib/storage.js")).blobStorage();
  }
  const reader = { get: (k) => storage.get(k), list: (p) => storage.list(p) }; // reads only: no set, del or update reaches the store

  const { records, skipped } = await listSubscribers(reader);
  let file = null;
  try { file = JSON.parse(await reader.get(KEY_SEARCH)); } catch (e) { /* none yet */ }
  log(`Read ${records.length} subscriber records${skipped ? ` (${skipped} unreadable, skipped)` : ""} and ${file && Array.isArray(file.items) ? file.items.length : 0} items in the search file.`);
  const t = tally(records, file);
  const r = report(t, args);
  log(r.text);
  return { ...t, all: r.all, india: r.india, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
