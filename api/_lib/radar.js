// Server side of the scheduled sweep. The categories, prompt, parser and normalizer
// mirror travel-problem-radar.jsx (the single-file Claude artifact); scripts/check.mjs
// fails if the prompt or category text drifts between the two.
// Storage and fetch are passed in, so the offline tests can stub both.

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
// When the last scheduled sweep started, saved or not. Not readable through /api/data.
export const KEY_LAST_SCHEDULED = "radar:lastScheduled";
export const sweepKey = (id) => "radar:sweep:" + id;

const SEV_RANK = { High: 3, Medium: 2, Low: 1 };
const MAX_SWEEPS = 60;
const MAX_SEEN = 800;

// The seen ids to keep: this sweep's ids go last, so an item that keeps coming back is never
// trimmed and shown as new again. The oldest unseen-since ids go first.
export function trimSeen(seenBefore, idset, max = MAX_SEEN) {
  return [...[...seenBefore].filter((id) => !idset.has(id)), ...idset].slice(-max);
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

// One Claude call with web search for one category. Returns the items plus the
// usage the API reported, so the sweep can log real token and search counts.
// Current models think by default and thinking counts toward max_tokens: with 1000 the
// thinking could use it all and leave no answer. Low effort keeps thinking short, and the
// larger cap leaves room for it (only tokens actually produced are billed).
export async function scanCategory(cat, { fetchFn = fetch, apiKey, model, maxSearches = 3 }) {
  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: buildPrompt(cat) }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }],
    }),
  });
  if (!res.ok) {
    // Say why the API refused, e.g. "http 400 invalid_request_error: <message>", so a failure
    // notice can be acted on. One line, capped, and the key blanked if it were ever echoed.
    let why = "";
    try {
      const e = (await res.json()).error || {};
      if (typeof e.type === "string" && /^[a-z_]{1,40}$/.test(e.type)) why += " " + e.type;
      if (e.message) why += ": " + String(e.message).split(apiKey).join("[key]").replace(/\s+/g, " ").trim().slice(0, 200);
    } catch (e) {}
    throw new Error("http " + res.status + why);
  }
  const data = await res.json();
  const u = data.usage || {};
  const usage = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    searches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
  };
  let items;
  try {
    items = extractProblems(data).filter((p) => p && p.title).map((p) => normalize(cat, p));
  } catch (e) {
    // No usable answer: say why the model stopped (max_tokens, refusal, pause_turn, ...) and
    // keep the usage, because a failed call is billed too.
    const err = new Error(e.message + (data.stop_reason ? ` (stop_reason: ${data.stop_reason})` : ""));
    err.usage = usage;
    throw err;
  }
  return { items, usage };
}

async function readJSON(storage, key) {
  try {
    const v = await storage.get(key);
    return v == null ? null : JSON.parse(v);
  } catch (e) { return null; }
}

// The server twin of runSweep() in the component: scan all four categories, merge,
// flag what is new, keep the last 60 sweeps. Saves nothing if every category failed.
// Scheduled runs come every 5 hours from GitHub Actions, plus Vercel's daily cron as a
// backstop. The 2-hour gap stops them doubling up (a repeated cron delivery, or both
// schedulers firing close together). A manual run skips the gap and is left out of it, so it
// never cancels the next scheduled sweep. The gap counts from when a scheduled sweep started,
// so one that saves nothing (still billed) holds back the next one too.
export async function runDailySweep({ storage, scan, now = () => Date.now(), minGapHours = 2, manual = false, log = () => {} }) {
  const hist0 = await readJSON(storage, KEY_INDEX);
  let hist = Array.isArray(hist0) ? hist0 : [];
  if (!manual) {
    const saved = hist.filter((e) => !e.manual).pop();
    const started = await readJSON(storage, KEY_LAST_SCHEDULED);
    const last = [saved && saved.at, typeof started === "string" ? started : null]
      .filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).pop();
    if (last && now() - new Date(last).getTime() < minGapHours * 3600 * 1000) {
      return { status: "skipped", reason: `last scheduled sweep ${last} is under ${minGapHours} h old` };
    }
    await storage.set(KEY_LAST_SCHEDULED, JSON.stringify(new Date(now()).toISOString()));
  }

  const seen0 = await readJSON(storage, KEY_SEEN);
  const seenBefore = new Set(Array.isArray(seen0) ? seen0 : []);

  const results = await Promise.allSettled(CATS.map((c) => scan(c)));
  const usage = { input: 0, output: 0, searches: 0 };
  const perCat = {};
  const merged = [];
  const idset = new Set();
  const addUsage = (u) => { usage.input += u.input; usage.output += u.output; usage.searches += u.searches; };
  results.forEach((r, i) => {
    const key = CATS[i].key;
    if (r.status !== "fulfilled") {
      perCat[key] = "failed: " + String((r.reason && r.reason.message) || r.reason);
      if (r.reason && r.reason.usage) addUsage(r.reason.usage);
      return;
    }
    perCat[key] = r.value.items.length + " items";
    addUsage(r.value.usage);
    r.value.items.forEach((it) => {
      if (idset.has(it.id)) return;
      idset.add(it.id);
      merged.push({ ...it, isNew: !seenBefore.has(it.id) });
    });
  });
  log({ perCat, usage });

  if (merged.length === 0) return { status: "empty", perCat, usage };

  merged.sort((a, b) => (b.isNew - a.isNew) || (SEV_RANK[b.severity] - SEV_RANK[a.severity]));

  const at = new Date(now()).toISOString();
  const id = String(now());
  const entry = {
    id, at, total: merged.length,
    newCount: merged.filter((p) => p.isNew).length,
    highCount: merged.filter((p) => p.severity === "High").length,
  };
  if (manual) entry.manual = true;

  hist = [...hist, entry];
  const drop = hist.slice(0, Math.max(0, hist.length - MAX_SWEEPS));
  hist = hist.slice(drop.length);

  // The new sweep and the index first: old files go only once nothing points at them.
  await storage.set(sweepKey(id), JSON.stringify({ at, problems: merged }));
  await storage.set(KEY_INDEX, JSON.stringify(hist));
  await storage.set(KEY_SEEN, JSON.stringify(trimSeen(seenBefore, idset)));
  for (const d of drop) { try { await storage.del(sweepKey(d.id)); } catch (e) {} }

  return { status: "saved", id, at, total: entry.total, newCount: entry.newCount, perCat, usage, problems: merged };
}
