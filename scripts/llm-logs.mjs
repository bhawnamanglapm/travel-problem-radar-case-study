// Owner tool for the sweep's LLM logs: every Claude call's request and response, saved in the Blob
// store because Vercel's Hobby plan keeps function logs for an hour only. Runs on your own machine;
// it is not deployed (.vercelignore skips scripts/) and adds no endpoint. Read-only.
//
//   node --env-file=.env.local scripts/llm-logs.mjs list [--days 7]
//   node --env-file=.env.local scripts/llm-logs.mjs summary <id|latest>
//   node --env-file=.env.local scripts/llm-logs.mjs show <id|latest>
//
// `list`: one line per sweep that ran, newest first, with its tokens, searches and pages.
// `summary`: one sweep's totals, per-call outcomes and the links of the pages search found.
// `show`: the whole log as JSON (requests, responses, thinking, links).
// Exit codes: 0 done, 1 not found or error, 2 bad usage.
import { pathToFileURL } from "node:url";
import { KEY_LLMLOG_PREFIX, llmLogKey } from "../api/_lib/radar.js";

const DAY_MS = 24 * 3600 * 1000;
const COMMANDS = { list: 0, summary: 1, show: 1 };

class UsageError extends Error {}

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!(cmd in COMMANDS)) throw new UsageError(`unknown command${cmd ? ` "${cmd}"` : ""}; one of: ${Object.keys(COMMANDS).join(", ")}`);
  const args = [];
  let days = 7;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--days" && cmd === "list") {
      if (!/^\d{1,4}$/.test(rest[i + 1] || "") || Number(rest[i + 1]) < 1) throw new UsageError("--days must be a whole number, 1 or more");
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
const line = (lg) => {
  const s = lg.summary || {};
  return `${lg.id}  ${lg.at}  ${String(lg.status).slice(0, 12).padEnd(12)}  ${s.calls - s.failed}/${s.calls} calls ok  `
    + `in ${n(s.input)}  out ${n(s.output)}  searches ${n(s.searches)}  pages ${n(s.pages)}${lg.manual ? "  (manual)" : ""}`;
};

export function formatSummary(lg) {
  const s = lg.summary || {};
  const out = [
    `Sweep ${lg.id} at ${lg.at}: ${lg.status}${lg.manual ? " (manual)" : ""}${lg.slot != null ? `, slot ${lg.slot}` : ""}`,
    `Tokens: ${n(s.input)} input, ${n(s.output)} output. Searches: ${n(s.searches)}. Pages: ${n(s.pages)}.`,
    "",
  ];
  for (const c of lg.calls || []) {
    const u = c.usage || {};
    const how = c.error ? `failed: ${c.error}` : `${c.items} items`;
    out.push(`${String(c.cat).padEnd(14)} ${how}; in ${n(u.input)}, out ${n(u.output)}, searches ${n(u.searches)}, pages ${n(u.pages)}${c.ms != null ? `, ${(c.ms / 1000).toFixed(1)} s` : ""}`);
  }
  out.push("", "Pages:", ...(s.links || []).map((l) => "  " + l));
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
