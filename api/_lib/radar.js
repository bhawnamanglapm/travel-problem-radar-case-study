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

// The categories a sweep's perCat marks failed, each with its error (the text after "failed: ") cut to
// ERR_MAX characters. Only the owner's digest and failure notices show these; subscriber emails never do.
export const ERR_MAX = 300;
export function failedCats(perCat = {}, cats = CATS) {
  return cats.filter((c) => /^failed/.test(perCat[c.key] || "")).map((c) => ({
    label: c.label,
    error: String(perCat[c.key]).replace(/^failed:?\s*/, "").slice(0, ERR_MAX) || "no reason given",
  }));
}
// "1 of 4 categories failed this run; its problems are missing from this sweep."
export function failedLine(failed, of) {
  const n = failed.length;
  return `${n} of ${of} categor${of === 1 ? "y" : "ies"} failed this run; ${n === 1 ? "its" : "their"} problems are missing from this sweep.`;
}

// Areas (T37): a fixed list the board filters by, and areaOf() to place the AI's free-text region in one.
// The same text is in travel-problem-radar.jsx and api/_lib/radar.js; scripts/check.mjs fails if they differ.
const AREAS = ["Global", "Asia", "India", "Europe", "North America", "Latin America", "Middle East & Africa", "Oceania", "Other"];
const AREA_NAMES = {
  Global: "global|globally|worldwide|world|international|multinational|multiple|various|online|multiple countries|multiple regions|several countries|many countries",
  Asia: "asia|south asia|southeast asia|south east asia|east asia|central asia|asia pacific|apac|asean|afghanistan|armenia|azerbaijan|bangladesh|bhutan|brunei|cambodia|china|mainland china|hong kong|macau|macao|indonesia|japan|kazakhstan|kyrgyzstan|laos|malaysia|maldives|mongolia|myanmar|burma|nepal|north korea|south korea|korea|pakistan|philippines|singapore|sri lanka|taiwan|tajikistan|thailand|timor leste|east timor|turkmenistan|uzbekistan|vietnam|viet nam|bali|tokyo|kyoto|osaka|seoul|beijing|shanghai|bangkok|phuket|kathmandu|manila|jakarta|kuala lumpur|hanoi|ho chi minh city",
  // India is its own area (T42), though it's in Asia: text naming both counts as Asia, not Global.
  India: "india|bharat|delhi|new delhi|mumbai|bombay|bengaluru|bangalore|chennai|madras|kolkata|calcutta|hyderabad|pune|ahmedabad|jaipur|udaipur|agra|varanasi|amritsar|kochi|cochin|goa|kerala|rajasthan|maharashtra|karnataka|tamil nadu|gujarat|uttar pradesh|uttarakhand|himachal pradesh|ladakh|andaman|andaman and nicobar|lakshadweep|sikkim",
  Europe: "europe|eu|european union|schengen|schengen area|western europe|eastern europe|southern europe|northern europe|central europe|scandinavia|nordics|nordic countries|balkans|mediterranean|albania|andorra|austria|belarus|belgium|bosnia|herzegovina|bulgaria|croatia|cyprus|czech republic|czechia|denmark|estonia|finland|france|germany|greece|hungary|iceland|ireland|italy|kosovo|latvia|liechtenstein|lithuania|luxembourg|malta|moldova|monaco|montenegro|netherlands|holland|north macedonia|macedonia|norway|poland|portugal|romania|russia|san marino|serbia|slovakia|slovenia|spain|sweden|switzerland|turkey|turkiye|ukraine|united kingdom|uk|great britain|britain|england|scotland|wales|northern ireland|vatican|vatican city|london|paris|rome|venice|florence|milan|barcelona|madrid|lisbon|amsterdam|berlin|munich|vienna|prague|budapest|athens|santorini|istanbul|dublin|edinburgh|copenhagen|stockholm|oslo|reykjavik|zurich|geneva|brussels|mallorca|majorca|ibiza|canary islands|tenerife",
  "North America": "north america|america|united states|united states of america|us|usa|canada|greenland|bermuda|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|washington dc|nyc|los angeles|san francisco|las vegas|chicago|boston|miami|orlando|seattle|honolulu|ontario|quebec|british columbia|alberta|toronto|vancouver|montreal",
  "Latin America": "latin america|latam|south america|central america|caribbean|west indies|mexico|guatemala|belize|honduras|el salvador|nicaragua|costa rica|panama|cuba|jamaica|haiti|dominican republic|puerto rico|bahamas|barbados|trinidad|tobago|aruba|curacao|st lucia|saint lucia|colombia|venezuela|ecuador|galapagos|peru|bolivia|brazil|paraguay|uruguay|argentina|chile|guyana|suriname|patagonia|cancun|tulum|mexico city|rio de janeiro|sao paulo|buenos aires|cusco|machu picchu",
  "Middle East & Africa": "middle east|mena|gcc|gulf states|persian gulf|gulf region|africa|north africa|sub saharan africa|east africa|west africa|southern africa|central africa|bahrain|iran|iraq|israel|jordan|kuwait|lebanon|oman|palestine|gaza|west bank|qatar|saudi arabia|saudi|syria|uae|united arab emirates|yemen|dubai|abu dhabi|doha|riyadh|jeddah|tel aviv|jerusalem|egypt|cairo|morocco|marrakech|algeria|tunisia|libya|sudan|south sudan|ethiopia|kenya|nairobi|tanzania|zanzibar|uganda|rwanda|nigeria|lagos|ghana|senegal|south africa|cape town|johannesburg|namibia|botswana|zimbabwe|zambia|mozambique|madagascar|mauritius|seychelles|cameroon|ivory coast|cote divoire|angola|congo|drc|mali|niger|chad|somalia|eritrea|djibouti|benin|togo|burkina faso|guinea|sierra leone|liberia|gambia|gabon|malawi|lesotho|eswatini|cape verde|cabo verde",
  Oceania: "oceania|australasia|pacific islands|south pacific|australia|new zealand|fiji|papua new guinea|papua|samoa|tonga|vanuatu|solomon islands|tahiti|french polynesia|guam|sydney|melbourne|brisbane|perth|queensland|new south wales|tasmania|auckland",
};
let areaTable = null;
function areaOf(region) {
  if (!areaTable) {
    areaTable = new Map();
    for (const [area, names] of Object.entries(AREA_NAMES)) for (const n of names.split("|")) areaTable.set(n, area);
  }
  const text = String(region || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'\u2019]/g, "");
  if (!/[a-z0-9]/.test(text)) return "Global";
  const scan = (t) => {
    const found = new Set();
    for (const raw of t.split(/[,;\/&+()]|\band\b|\bor\b/)) {
      const part = raw.replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
      if (!part) continue;
      if (areaTable.has(part)) { found.add(areaTable.get(part)); continue; }
      // Words inside the text, longest name first: "southern spain", "new south wales", "rural japan".
      const w = part.split(" ");
      for (let i = 0; i < w.length; i++) {
        for (let n = 3; n >= 1; n--) {
          const a = i + n <= w.length && areaTable.get(w.slice(i, i + n).join(" "));
          if (a) { found.add(a); i += n - 1; break; }
        }
      }
    }
    return found;
  };
  // Text in brackets qualifies the rest ("Mali (US citizens affected)"), so it counts only when the rest names nothing.
  let found = scan(text.replace(/\([^)]*\)/g, " "));
  if (!found.size) found = scan(text);
  if (found.has("India") && found.has("Asia")) found.delete("India");
  // Text that names two or more areas ("US and Europe") spans them, so it counts as Global.
  return found.size === 1 ? [...found][0] : found.size ? "Global" : "Other";
}
// End of areas.
export { AREAS, areaOf };

// Search file (T38): the latest copy of every item in the kept sweeps, so "All saved sweeps" is one read.
// `prev` is the file so far ({ sweeps, items }); each item carries the sweep it came from (sweep, sweepAt).
// The same text is in travel-problem-radar.jsx and api/_lib/radar.js; scripts/check.mjs fails if they differ.
function mergeSearch(prev, problems, sweepId, at, keepSweepIds) {
  const keep = new Set(keepSweepIds);
  const ok = prev && Array.isArray(prev.sweeps) && Array.isArray(prev.items);
  const byId = new Map();
  for (const it of ok ? prev.items : []) if (it && it.id && keep.has(it.sweep)) byId.set(it.id, it);
  // The latest copy wins and goes last, so the file stays in sweep order.
  for (const p of problems) { byId.delete(p.id); byId.set(p.id, { ...p, sweep: sweepId, sweepAt: at }); }
  const sweeps = [...new Set([...(ok ? prev.sweeps : []), sweepId])].filter((id) => keep.has(id));
  return { sweeps, items: [...byId.values()] };
}
// End of search file.
export { mergeSearch };

export const KEY_SEEN = "radar:seenIds";
export const KEY_INDEX = "radar:history";
// Each item's history (T36), kept with the seen ids. Not readable through /api/data: the board gets the
// history from the fields trackItems writes on each saved item.
export const KEY_ITEMS = "radar:items";
// Every item in the kept sweeps, latest copy each (T38). Readable through /api/data, for "All saved sweeps".
export const KEY_SEARCH = "radar:search";
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

// The search file from the saved sweeps, oldest first: once, when the store has sweeps but no search file (T38).
// At most MAX_SWEEPS reads; a sweep that can't be read is skipped, and is missing from `sweeps`.
async function buildSearch(storage, entries, keepIds) {
  let search = null;
  for (const e of entries) {
    const sw = await readJSON(storage, sweepKey(e.id));
    if (sw && Array.isArray(sw.problems)) search = mergeSearch(search, sw.problems, e.id, e.at, keepIds);
  }
  return search;
}

const slug = (s = "") =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function buildPrompt(cat) {
  return (
    `You are a travel-industry problem scout. Using web search, find the most recent, real, notable ` +
    `problems, complaints, breakages, disruptions, or newly announced changes in this area: ` +
    `"${cat.label}" (${cat.desc}). Focus on roughly the last 60 days, from sources anywhere in the world. ` +
    `Then use one search for India (sources such as DGCA, the Ministry of Civil Aviation, IRCTC and Indian ` +
    `Railways, Indian airlines and online travel agencies, and Indian news and consumer forums). ` +
    `Return ONLY a JSON array (no prose, no markdown fences) of up to 5 objects from anywhere, plus up to 2 more ` +
    `about India only where real, recent ones exist (return none rather than stretch; their "region" is "India"). ` +
    `Each object has EXACTLY these string fields: "title" (short, specific), "summary" (max 22 words, what the problem is), "source" ` +
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

// A searched page's age in days before `at`, from search's `page_age`: text like "34 days ago", or a date with a
// four-digit year. Null when there's none or it can't be read.
const UNIT_DAYS = { hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
const DAY = 24 * 3600 * 1000;
export function pageAgeDays(age, at = Date.now()) {
  const s = String(age || "").trim();
  const m = /^(\d+)\s+(hour|day|week|month|year)s?\s+ago$/i.exec(s);
  if (m) return Number(m[1]) * UNIT_DAYS[m[2].toLowerCase()];
  const t = /\b\d{4}\b/.test(s) ? Date.parse(s) : NaN;
  return Number.isFinite(t) && t <= at ? (at - t) / DAY : null;
}

// "Source 22 Oct" (with the year when it isn't this year's): the date search gave an item's source page, for
// readers. Null when the sweep couldn't date it; the caller then shows the model's own `date`.
export function sourceLabel(p, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((p && p.sourceDate) || "")) return null;
  const d = new Date(p.sourceDate + "T00:00:00Z");
  if (isNaN(d)) return null;
  const year = d.getUTCFullYear() !== new Date(Number.isFinite(now) ? now : Date.now()).getUTCFullYear() ? { year: "numeric" } : {};
  return "Source " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC", ...year });
}

// Items whose source is older than this are dropped: the prompt asks for roughly the last 60 days.
export const SOURCE_MAX_DAYS = 60;
// A link compared loosely: no protocol, fragment or trailing slash.
const linkKey = (u) => {
  try { const x = new URL(u); return x.host + x.pathname.replace(/\/+$/, "") + x.search; } catch (e) { return null; }
};

// Dates each item's source from the age search gave its page (`sourceDate`, the UTC day of `at` less the age), and
// drops items whose source is over SOURCE_MAX_DAYS old. An item whose link wasn't searched, or whose page has no
// age, is kept undated: an unknown age is never taken as old. Returns the kept items, the dropped ones (for the
// log) and, per kept item, its age in days (null when unknown) and whether search returned its link at all. With
// web search the only tool, a link search never returned came from the model's memory: a warning sign, logged only.
export function dateSources(items, blocks = [], at = Date.now()) {
  const exact = new Map(), loose = new Map(), searched = new Set();
  for (const b of blocks) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const r of b.content) {
      if (!r || !r.url) continue;
      const k = linkKey(r.url);
      searched.add(r.url);
      if (k) searched.add(k);
      if (!r.page_age) continue;
      if (!exact.has(r.url)) exact.set(r.url, r.page_age);
      if (k && !loose.has(k)) loose.set(k, r.page_age);
    }
  }
  const kept = [], dropped = [], sources = [];
  for (const it of items) {
    const age = it.link ? exact.get(it.link) ?? loose.get(linkKey(it.link)) : undefined;
    const days = pageAgeDays(age, at);
    if (days != null && days > SOURCE_MAX_DAYS) {
      dropped.push({ title: it.title, link: it.link, age: siteText(age, 50) });
      continue;
    }
    kept.push(days == null ? it : { ...it, sourceDate: new Date(at - days * DAY).toISOString().slice(0, 10) });
    sources.push({ link: it.link, days: days == null ? null : Math.round(days * 10) / 10,
      searched: !!it.link && (searched.has(it.link) || searched.has(linkKey(it.link))) });
  }
  return { items: kept, dropped, sources };
}

// A response's content blocks for the LLM log, without the encrypted parts (page contents, citation
// indexes, thinking signatures): they can't be read and are most of the size. A searched page is kept
// as its link, title and age; a citation as its link, title and the passage the model quoted.
export const LOG_TITLE_MAX = 300;
export const LOG_QUOTE_MAX = 500;
// Text from other sites, cleaned for the log: no control characters (a title can't send escape codes
// to the terminal that prints it), trimmed and capped. Empty gives undefined, so the field is left out.
const siteText = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, max) || undefined;
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function logContent(blocks = []) {
  return blocks.map((b) => {
    if (b.type === "web_search_tool_result") {
      return Array.isArray(b.content)
        ? { type: b.type, tool_use_id: b.tool_use_id, pages: b.content.filter((r) => r.url).map((r) => defined({
          url: r.url, title: siteText(r.title, LOG_TITLE_MAX), age: siteText(r.page_age, 50),
        })) }
        : { type: b.type, tool_use_id: b.tool_use_id, error: b.content && b.content.error_code };
    }
    if (b.type === "text") {
      const out = { type: "text", text: b.text };
      const seen = new Set();
      const cited = (b.citations || []).filter((c) => c.url).map((c) => defined({
        url: c.url, title: siteText(c.title, LOG_TITLE_MAX), quote: siteText(c.cited_text, LOG_QUOTE_MAX),
      })).filter((c) => !seen.has(c.url + "\n" + c.quote) && seen.add(c.url + "\n" + c.quote));
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
export async function scanCategory(cat, { fetchFn = fetch, apiKey, model, maxSearches = 4, clock = Date.now }) {
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
  let parsed;
  try {
    parsed = extractProblems(data).filter((p) => p && p.title).map((p) => normalize(cat, p));
  } catch (e) {
    // No usable answer: say why the model stopped (max_tokens, refusal, pause_turn, ...) and
    // keep the usage, because a failed call is billed too.
    const err = new Error(e.message + (data.stop_reason ? ` (stop_reason: ${data.stop_reason})` : ""));
    err.usage = usage;
    err.call = { ...call(), error: err.message };
    throw err;
  }
  const { items, dropped, sources } = dateSources(parsed, data.content, clock());
  return { items, usage, call: { ...call(), items: items.length, sources, ...(dropped.length ? { dropped } : {}) } };
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
    const dropped = ((r.value.call && r.value.call.dropped) || []).length;
    perCat[key] = r.value.items.length + " items" + (dropped ? `, ${dropped} dropped (source over ${SOURCE_MAX_DAYS} days)` : "");
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
  // Usage per category, for the cost per run (T29). Private like the rest of the log; a failed call
  // that reported usage is in it, because it was billed.
  const usageByCat = Object.fromEntries(calls.filter((c) => c.usage).map((c) => [c.cat, c.usage]));
  const writeLog = (status) => saveLlmLog(storage, id, {
    id, at, status, ...(manual ? { manual: true } : {}), ...slotFields,
    summary: { calls: calls.length, failed: calls.filter((c) => c.error).length, ...usage, links, usageByCat },
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
  // The search file (T38) doesn't either: one read and one write, and a missing file is built once from the kept
  // sweeps. One that can't be read or written is left for the next sweep, and the board counts what it lacks.
  try {
    const keepIds = hist.map((e) => e.id);
    const raw = await storage.get(KEY_SEARCH);
    const prev = raw == null ? await buildSearch(storage, hist.slice(0, -1), keepIds) : JSON.parse(raw);
    await storage.set(KEY_SEARCH, JSON.stringify(mergeSearch(prev, problems, id, at, keepIds)));
  } catch (e) {}
  for (const d of drop) { try { await storage.del(sweepKey(d.id)); } catch (e) {} }
  const llmLog = await writeLog("saved");

  return { status: "saved", id, at, ...slotFields, total: entry.total, newCount: entry.newCount, perCat, usage, llmLog, problems };
}
