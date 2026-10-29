// Server side of the scheduled sweep. The categories, prompt, parser and normalizer
// mirror travel-problem-radar.jsx (the single-file Claude artifact); scripts/check.mjs
// fails if the prompt or category text drifts between the two.
// Storage and fetch are passed in, so the offline tests can stub both.
import { slotOf } from "./schedule.js";

export const CATS = [
  { key: "traveler_pain", label: "Traveler pain",
    desc: "recurring frustrations travelers report — booking, airlines, hotels, refunds, loyalty, service failures" },
  { key: "gov_policy", label: "Gov & policy",
    desc: "new visa rules, entry requirements, travel bans, tourist taxes, and regulations affecting travelers" },
  { key: "web_app", label: "Website & app",
    desc: "outages, bugs, broken flows, UX failures, and data/security issues on travel platforms and OTAs" },
  { key: "industry", label: "Industry",
    desc: "strikes, bankruptcies, capacity cuts, overtourism, pricing shocks, and major operational disruptions" },
];

export const KEY_SEEN = "radar:seenIds";
export const KEY_INDEX = "radar:history";
// Each item's history (T36), kept with the seen ids. Not readable through /api/data: the board gets the
// history from the fields trackItems writes on each saved item.
export const KEY_ITEMS = "radar:items";
// When the last scheduled sweep started, saved or not. Not readable through /api/data.
export const KEY_LAST_SCHEDULED = "radar:lastScheduled";
export const sweepKey = (id) => "radar:sweep:" + id;
// One file per sweep that ran (saved, empty or failed): every Claude call's request and response.
// Vercel's Hobby plan keeps function logs for an hour; these stay in the private store for 30 days.
// Not readable through /api/data. Read them with scripts/llm-logs.mjs.
export const KEY_LLMLOG_PREFIX = "radar:llmlog:";
export const llmLogKey = (id) => KEY_LLMLOG_PREFIX + id;
export const LLM_LOG_KEEP_DAYS = 30;

const SEV_RANK = { High: 3, Medium: 2, Low: 1 };
const MAX_SWEEPS = 60;
const MAX_SEEN = 800;

// The seen ids to keep: this sweep's ids go last, so an item that keeps coming back is never
// trimmed and shown as new again. The oldest unseen-since ids go first.
export function trimSeen(seenBefore, idset, max = MAX_SEEN) {
  return [...[...seenBefore].filter((id) => !idset.has(id)), ...idset].slice(-max);
}

// Each item's history (T36). `index` maps an id to { f: first sweep id, n: sweeps it was in, s: its latest
// sweep ids, e: 1 when it was seen before the index knew it, so f and n are lower bounds }. Returns the index
// for the ids in keepIds, and the items with firstAt, seen, prev (up to 5 earlier sweep ids) and firstEarlier.
// The same text is in travel-problem-radar.jsx; scripts/check.mjs fails if the two differ.
export function trackItems(index, items, sweepId, keepIds) {
  const next = {};
  const out = items.map((it) => {
    const was = index[it.id];
    const ok = was && Number.isFinite(was.n) && Array.isArray(was.s);
    const e = ok
      ? { f: was.f, n: was.n + 1, s: [...was.s, sweepId].slice(-6), ...(was.e ? { e: 1 } : {}) }
      : { f: sweepId, n: 1, s: [sweepId], ...(it.isNew === false ? { e: 1 } : {}) };
    next[it.id] = e;
    const extra = e.e ? { firstEarlier: true } : {};
    return { ...it, firstAt: new Date(Number(e.f)).toISOString(), seen: e.n, prev: e.s.slice(0, -1), ...extra };
  });
  for (const id of keepIds) if (!next[id] && index[id]) next[id] = index[id];
  return { index: next, items: out };
}

// The index from the saved sweeps, oldest first: once, when the store has sweeps but no index yet (T36).
// At most MAX_SWEEPS reads; a sweep that can't be read is skipped.
async function buildItemIndex(storage, hist) {
  let index = {};
  for (const e of hist) {
    const sw = await readJSON(storage, sweepKey(e.id));
    if (!sw || !Array.isArray(sw.problems)) continue;
    const ids = sw.problems.map((p) => p.id);
    index = trackItems(index, sw.problems, e.id, [...Object.keys(index), ...ids]).index;
  }
  return index;
}

const slug = (s = "") =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function buildPrompt(cat) {
  return (
    `You are a travel-industry problem scout. Using web search, find the most recent, real, notable ` +
    `problems, complaints, breakages, disruptions, or newly announced changes in this area: ` +
    `"${cat.label}" (${cat.desc}). Focus on roughly the last 60 days, from sources anywhere in the world. ` +
    `Return ONLY a JSON array (no prose, no markdown fences) of up to 5 objects with EXACTLY these string ` +
    `fields: "title" (short, specific), "summary" (max 22 words, what the problem is), "source" ` +
    `(publication or site name), "link" (the direct source URL you found it at, starting with https://), ` +
    `"region" (country/region or "Global"), "date" (e.g. "Jul 2026"), ` +
    `"severity" (one of: Low, Medium, High), "opportunity" (max 18 words: a concrete product a PM ` +
    `could build to address it). Output must start with [ and end with ].`
  );
}

export function extractProblems(data) {
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text) throw new Error("empty");
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a === -1) throw new Error("no json");
  s = b > a ? s.slice(a, b + 1) : s.slice(a);
  try { return JSON.parse(s); }
  catch (e) {
    const last = s.lastIndexOf("}");
    if (last > 0) { try { return JSON.parse(s.slice(0, last + 1) + "]"); } catch (_) {} }
    throw e;
  }
}

export function normalize(cat, p) {
  return {
    id: cat.key + ":" + slug(p.title),
    cat: cat.key,
    title: String(p.title).trim(),
    summary: String(p.summary || "").trim(),
    source: String(p.source || "—").trim(),
    link: /^https?:\/\//.test(String(p.link || "").trim()) ? String(p.link).trim() : "",
    region: String(p.region || "Global").trim(),
    date: String(p.date || "").trim(),
    severity: ["Low", "Medium", "High"].includes(p.severity) ? p.severity : "Medium",
    opportunity: String(p.opportunity || "").trim(),
  };
}

// A response's content blocks for the LLM log, without the encrypted parts (page contents, citation
// indexes, thinking signatures): they can't be read and are most of the size. A searched page is kept
// as its link only.
export function logContent(blocks = []) {
  return blocks.map((b) => {
    if (b.type === "web_search_tool_result") {
      return Array.isArray(b.content)
        ? { type: b.type, tool_use_id: b.tool_use_id, pages: b.content.map((r) => r.url).filter(Boolean) }
        : { type: b.type, tool_use_id: b.tool_use_id, error: b.content && b.content.error_code };
    }
    if (b.type === "text") {
      const out = { type: "text", text: b.text };
      const cited = [...new Set((b.citations || []).map((c) => c.url).filter(Boolean))];
      if (cited.length) out.citations = cited;
      return out;
    }
    if (b.type === "thinking") return { type: "thinking", thinking: b.thinking };
    const { encrypted_content, encrypted_index, signature, data, ...rest } = b;
    return rest;
  });
}

// The links of the pages web search put in front of the model, once each.
export function pageLinks(blocks = []) {
  return [...new Set(blocks
    .filter((b) => b.type === "web_search_tool_result" && Array.isArray(b.content))
    .flatMap((b) => b.content.map((r) => r.url))
    .filter(Boolean))];
}

// One Claude call with web search for one category. Returns the items plus the
// usage the API reported, so the sweep can log real token and search counts, and `call`, what
// went in and came out, for the LLM log. A failure carries `call` too (and `usage` once billed).
// The log never holds the headers, which carry the key.
// Current models think by default and thinking counts toward max_tokens: with 1000 the
// thinking could use it all and leave no answer. Low effort keeps thinking short, and the
// larger cap leaves room for it (only tokens actually produced are billed).
export async function scanCategory(cat, { fetchFn = fetch, apiKey, model, maxSearches = 3, clock = Date.now }) {
  const request = {
    model,
    max_tokens: 16000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: buildPrompt(cat) }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
  };
  const t0 = clock();
  const failed = (e, extra = {}) => {
    const err = e instanceof Error ? e : new Error(String(e));
    err.call = { cat: cat.key, ms: clock() - t0, request, ...extra, error: err.message };
    return err;
  };
  let res;
  try {
    res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(request),
    });
  } catch (e) { throw failed(e); }
  if (!res.ok) {
    // Say why the API refused, e.g. "http 400 invalid_request_error: <message>", so a failure
    // notice can be acted on. One line, capped, and the key blanked if it were ever echoed.
    let why = "", body = null;
    try {
      body = await res.json();
      const e = body.error || {};
      if (typeof e.type === "string" && /^[a-z_]{1,40}$/.test(e.type)) why += " " + e.type;
      if (e.message) why += ": " + String(e.message).split(apiKey).join("[key]").replace(/\s+/g, " ").trim().slice(0, 200);
    } catch (e) {}
    if (body && apiKey) { try { body = JSON.parse(JSON.stringify(body).split(apiKey).join("[key]")); } catch (e) { body = null; } }
    throw failed(new Error("http " + res.status + why), { response: { status: res.status, body } });
  }
  const data = await res.json();
  const u = data.usage || {};
  const links = pageLinks(data.content);
  const usage = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    searches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
  };
  const call = () => ({
    cat: cat.key, ms: clock() - t0, request,
    response: { id: data.id, model: data.model, stop_reason: data.stop_reason, usage: data.usage, content: logContent(data.content) },
    usage: { ...usage, pages: links.length }, links,
  });
  let items;
  try {
    items = extractProblems(data).filter((p) => p && p.title).map((p) => normalize(cat, p));
  } catch (e) {
    // No usable answer: say why the model stopped (max_tokens, refusal, pause_turn, ...) and
    // keep the usage, because a failed call is billed too.
    const err = new Error(e.message + (data.stop_reason ? ` (stop_reason: ${data.stop_reason})` : ""));
    err.usage = usage;
    err.call = { ...call(), error: err.message };
    throw err;
  }
  return { items, usage, call: { ...call(), items: items.length } };
}

async function readJSON(storage, key) {
  try {
    const v = await storage.get(key);
    return v == null ? null : JSON.parse(v);
  } catch (e) { return null; }
}

// Writes one sweep's LLM log and, on the first sweep of a UTC day (`tidy`), deletes logs older than
// LLM_LOG_KEEP_DAYS. Once a day because listing is a Blob advanced operation, and Hobby allows 2,000 a
// month. Best effort: a failure here never fails the sweep. Returns the log's id, or null if unsaved.
async function saveLlmLog(storage, id, record, { t, tidy }) {
  let saved = null;
  try { await storage.set(llmLogKey(id), JSON.stringify(record)); saved = id; } catch (e) {}
  if (tidy) {
    try {
      const cutoff = t - LLM_LOG_KEEP_DAYS * 24 * 3600 * 1000;
      for (const old of await storage.list(KEY_LLMLOG_PREFIX)) {
        if (/^\d{10,16}$/.test(old) && Number(old) < cutoff) await storage.del(llmLogKey(old));
      }
    } catch (e) { /* tidying is best effort */ }
  }
  return saved;
}

// The server twin of runSweep() in the component: scan all four categories, merge,
// flag what is new, keep the last 60 sweeps. Saves nothing if every category failed.
// Scheduled runs come in up to 5 slots a day from GitHub Actions (the sweep handler skips the
// slots no Pro member needs, T32), plus Vercel's daily cron as a backstop. A scheduled run passes
// its `slot` (dueSlot in schedule.js), which is saved with the sweep so delivery knows which it was. Each slot
// sweeps at most once (T35), which stops them doubling up (a repeated cron delivery, or both schedulers in one
// slot). A manual run skips that rule and is left out of it, so it never cancels a scheduled sweep. A slot counts
// as swept once its sweep starts, so one that saves nothing (still billed) isn't retried until the next slot.
// Every sweep that ran also leaves an LLM log (saveLlmLog): each call's request and response, and a
// summary of tokens, searches and the pages search found (links only).
export async function runDailySweep({ storage, scan, now = () => Date.now(), manual = false, slot = null, log = () => {} }) {
  const hist0 = await readJSON(storage, KEY_INDEX);
  let hist = Array.isArray(hist0) ? hist0 : [];
  if (!manual) {
    // One scheduled sweep per slot (T35), so the Vercel backstop and a late GitHub run of the same slot can't
    // both sweep, while a late run never holds back the next slot's own run. `radar:lastScheduled` holds when
    // the last scheduled sweep started and its slot; before T35 it held only the time, whose slot is used.
    const slotAt = (slot || slotOf(now())).at;
    const saved = hist.filter((e) => !e.manual).pop();
    const started = await readJSON(storage, KEY_LAST_SCHEDULED);
    const startedSlot = started && typeof started === "object" && Number.isFinite(started.slotAt) ? started.slotAt
      : typeof started === "string" ? slotOf(Date.parse(started)).at : null;
    const savedSlot = saved ? (saved.slotAt ? Date.parse(saved.slotAt) : slotOf(Date.parse(saved.at)).at) : null;
    if (startedSlot === slotAt || savedSlot === slotAt) {
      return { status: "skipped", reason: `slot ${new Date(slotAt).toISOString()} already swept` };
    }
    await storage.set(KEY_LAST_SCHEDULED, JSON.stringify({ at: new Date(now()).toISOString(), slotAt }));
  }

  const seen0 = await readJSON(storage, KEY_SEEN);
  const seenBefore = new Set(Array.isArray(seen0) ? seen0 : []);

  const results = await Promise.allSettled(CATS.map((c) => scan(c)));
  const usage = { input: 0, output: 0, searches: 0 };
  const perCat = {};
  const merged = [];
  const idset = new Set();
  const calls = [];
  const addUsage = (u) => { usage.input += u.input; usage.output += u.output; usage.searches += u.searches; };
  results.forEach((r, i) => {
    const key = CATS[i].key;
    if (r.status !== "fulfilled") {
      perCat[key] = "failed: " + String((r.reason && r.reason.message) || r.reason);
      calls.push((r.reason && r.reason.call) || { cat: key, error: perCat[key].slice("failed: ".length) });
      if (r.reason && r.reason.usage) addUsage(r.reason.usage);
      return;
    }
    perCat[key] = r.value.items.length + " items";
    calls.push(r.value.call || { cat: key });
    addUsage(r.value.usage);
    r.value.items.forEach((it) => {
      if (idset.has(it.id)) return;
      idset.add(it.id);
      merged.push({ ...it, isNew: !seenBefore.has(it.id) });
    });
  });
  const links = [...new Set(calls.flatMap((c) => c.links || []))];
  usage.pages = links.length;
  log({ perCat, usage });

  const t = now();
  const at = new Date(t).toISOString();
  const id = String(t);
  const slotFields = slot ? { slot: slot.hour, slotAt: new Date(slot.at).toISOString() } : {};
  // First of the UTC day by the saved sweeps, read before this one joins them.
  const tidy = !hist.some((e) => String(e.at).slice(0, 10) === at.slice(0, 10));
  const writeLog = (status) => saveLlmLog(storage, id, {
    id, at, status, ...(manual ? { manual: true } : {}), ...slotFields,
    summary: { calls: calls.length, failed: calls.filter((c) => c.error).length, ...usage, links },
    calls,
  }, { t, tidy });

  if (merged.length === 0) return { status: "empty", perCat, usage, llmLog: await writeLog("empty") };

  merged.sort((a, b) => (b.isNew - a.isNew) || (SEV_RANK[b.severity] - SEV_RANK[a.severity]));

  // Item history (T36). A missing index is built once from the saved sweeps; one that can't be read is
  // skipped, and this sweep's items are saved without history rather than the sweep failing.
  const keepIds = trimSeen(seenBefore, idset);
  let problems = merged;
  let itemIndex = null;
  try {
    const raw = await storage.get(KEY_ITEMS);
    const idx0 = raw == null ? await buildItemIndex(storage, hist) : JSON.parse(raw);
    if (idx0 && typeof idx0 === "object" && !Array.isArray(idx0)) {
      ({ index: itemIndex, items: problems } = trackItems(idx0, merged, id, keepIds));
    }
  } catch (e) { itemIndex = null; problems = merged; }

  const entry = {
    id, at, total: merged.length,
    newCount: merged.filter((p) => p.isNew).length,
    highCount: merged.filter((p) => p.severity === "High").length,
  };
  if (manual) entry.manual = true;
  Object.assign(entry, slotFields);

  hist = [...hist, entry];
  const drop = hist.slice(0, Math.max(0, hist.length - MAX_SWEEPS));
  hist = hist.slice(drop.length);

  // The new sweep and the index first: old files go only once nothing points at them.
  try {
    await storage.set(sweepKey(id), JSON.stringify({ at, ...slotFields, problems }));
    await storage.set(KEY_INDEX, JSON.stringify(hist));
    await storage.set(KEY_SEEN, JSON.stringify(keepIds));
  } catch (e) {
    // The calls were billed, so the log is kept even when the sweep can't be.
    await writeLog("save failed: " + String((e && e.message) || e));
    throw e;
  }
  // The item index doesn't fail a saved sweep: the next sweep counts from the last index it could write.
  if (itemIndex) { try { await storage.set(KEY_ITEMS, JSON.stringify(itemIndex)); } catch (e) {} }
  for (const d of drop) { try { await storage.del(sweepKey(d.id)); } catch (e) {} }
  const llmLog = await writeLog("saved");

  return { status: "saved", id, at, ...slotFields, total: entry.total, newCount: entry.newCount, perCat, usage, llmLog, problems };
}
