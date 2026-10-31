// Trends (T44): a running tally of new problems per UTC day, by category and area, kept in the search file's
// `trends` field so the sweep writes no extra file. The kept sweeps cover about 12 days; this tally isn't
// trimmed with them. It holds counts only, so /api/data?key=radar:trends reads it without the paywall.
//   trends = { days: { "2026-10-31": { "gov_policy|India": 2, ... } }, partial: ["2026-10-20", ...] }
// A problem counts once, on the day the radar first saw it (isNew). Keys hold the category key and the area
// name, not their positions, so reordering CATS or AREAS doesn't move old counts.
import { AREAS, areaOf, CATS } from "./radar.js";

export const TREND_MAX_DAYS = 400;
// A rising row needs at least this many new problems in the recent window (Proposed, for the owner to confirm).
export const RISE_MIN = 3;
// "Rising" compares 30 days with the 30 before once 60 days are recorded, and 7 with 7 until then.
export const RISE_LONG = 30, RISE_SHORT = 7;
const DAY = 24 * 3600 * 1000;

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const cell = (p) => p.cat + "|" + areaOf(p.region);
const ok = (t) => t && typeof t.days === "object" && t.days && !Array.isArray(t.days);

function add(days, day, key) {
  const d = days[day] || (days[day] = {});
  d[key] = (d[key] || 0) + 1;
}
// The newest TREND_MAX_DAYS days, and the partial days still among them.
function trim(days, partial) {
  const keep = Object.keys(days).sort().slice(-TREND_MAX_DAYS);
  const out = {};
  for (const d of keep) out[d] = days[d];
  return { days: out, partial: partial.filter((d) => out[d]) };
}

// Once, when the search file has no tally yet: the kept items counted by the day they were first seen. An item
// first seen before the item history began (firstEarlier) is left out, as its day is only a lower bound, and an
// item first seen in a sweep no longer kept is missing, so every day this fills is marked partial.
export function seedTrends(items) {
  const days = {};
  for (const p of Array.isArray(items) ? items : []) {
    if (!p || !p.cat || p.firstEarlier || !p.firstAt || isNaN(Date.parse(p.firstAt))) continue;
    add(days, dayOf(Date.parse(p.firstAt)), cell(p));
  }
  return trim(days, Object.keys(days));
}

// This sweep's new problems added to the tally, on the sweep's UTC day.
export function tallyTrends(prev, problems, at) {
  const days = {};
  for (const [d, cells] of Object.entries(ok(prev) ? prev.days : {})) days[d] = { ...cells };
  const partial = ok(prev) && Array.isArray(prev.partial) ? prev.partial : [];
  const day = dayOf(Date.parse(at));
  for (const p of problems) if (p && p.cat && p.isNew === true) add(days, day, cell(p));
  if (!days[day]) days[day] = {};
  return trim(days, partial);
}

// Monday of a day's week, UTC.
function weekOf(day) {
  const t = Date.parse(day + "T00:00:00Z");
  return dayOf(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY);
}
function sum(days, from, to) {
  const out = {};
  for (const [d, cells] of Object.entries(days)) {
    if (d < from || d > to) continue;
    for (const [k, n] of Object.entries(cells)) out[k] = (out[k] || 0) + n;
  }
  return out;
}
const split = (k) => { const i = k.indexOf("|"); return { cat: k.slice(0, i), area: k.slice(i + 1) }; };

// What the public page draws. Counts only: no ids, titles or links. Null when there's no tally.
export function trendsView(trends, now = Date.now()) {
  if (!ok(trends) || !Object.keys(trends.days).length) return null;
  const days = trends.days;
  const partial = new Set(Array.isArray(trends.partial) ? trends.partial : []);
  const list = Object.keys(days).sort();
  const since = list[0], today = dayOf(now);
  const back = (n) => dayOf(Date.parse(today + "T00:00:00Z") - n * DAY);
  const recorded = Math.round((Date.parse(today) - Date.parse(since)) / DAY) + 1;

  const weeks = new Map();
  for (const d of list) {
    const w = weekOf(d);
    const e = weeks.get(w) || { start: w, partial: false, cells: {} };
    for (const [k, n] of Object.entries(days[d])) e.cells[k] = (e.cells[k] || 0) + n;
    if (partial.has(d)) e.partial = true;
    weeks.set(w, e);
  }

  // Rising: per area and category, and per area across categories, recent window against the one before.
  const span = recorded >= 2 * RISE_LONG ? RISE_LONG : RISE_SHORT;
  const enough = recorded >= 2 * span;
  const recent = sum(days, back(span - 1), today);
  const before = sum(days, back(2 * span - 1), back(span));
  const byArea = (cells) => {
    const out = {};
    for (const [k, n] of Object.entries(cells)) { const a = "|" + split(k).area; out[a] = (out[a] || 0) + n; }
    return out;
  };
  const rNow = { ...recent, ...byArea(recent) }, rBefore = { ...before, ...byArea(before) };
  let rows = !enough ? [] : Object.entries(rNow)
    .filter(([k, n]) => n >= RISE_MIN && n > (rBefore[k] || 0))
    .map(([k, n]) => { const s = split(k); return { area: s.area, cat: s.cat || null, now: n, before: rBefore[k] || 0 }; });
  // An area's all-categories row that only repeats one of its category rows says nothing more.
  rows = rows.filter((r) => r.cat || !rows.some((c) => c.cat && c.area === r.area && c.now === r.now && c.before === r.before));
  rows = rows
    .sort((a, b) => (b.now - b.before) - (a.now - a.before) || b.now - a.now || (a.cat ? 1 : 0) - (b.cat ? 1 : 0))
    .slice(0, 10);
  let partialBefore = false;
  for (const d of partial) if (d >= back(2 * span - 1) && d <= back(span)) partialBefore = true;

  return {
    since, today, recorded,
    partialDays: list.filter((d) => partial.has(d)).length,
    cats: CATS.map((c) => ({ key: c.key, label: c.label })),
    areas: AREAS,
    weeks: [...weeks.values()],
    last30: sum(days, back(29), today),
    rising: { days: span, enough, min: RISE_MIN, partialBefore, rows },
  };
}
