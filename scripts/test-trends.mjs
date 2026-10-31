// Offline tests for api/_lib/trends.js (T44, the trends page): the tally, its seeding, "rising", the sweep that
// writes it and the public read. Storage and the Anthropic API are stubbed, so this needs no network.
//   node scripts/test-trends.mjs
import { makeDataHandler } from "../api/_lib/handlers.js";
import { CATS, KEY_SEARCH, runDailySweep, scanCategory } from "../api/_lib/radar.js";
import { RISE_MIN, TREND_MAX_DAYS, seedTrends, tallyTrends, trendsView } from "../api/_lib/trends.js";
import { check, finish, memStorage, mockRes } from "./test-helpers.mjs";

const DAY = 24 * 3600 * 1000;
const p = (n, over = {}) => ({ id: "gov_policy:p" + n, cat: "gov_policy", title: "Problem " + n, region: "India", isNew: true, ...over });
const at = (day) => day + "T06:00:00.000Z";

// ---- the tally
{
  const t = tallyTrends(null, [p(1), p(2, { region: "Mumbai, India" }), p(3, { isNew: false }), p(4, { region: "India and Nepal" }),
    p(5, { cat: "industry", region: "France" })], at("2026-10-31"));
  const d = t.days["2026-10-31"];
  check(d["gov_policy|India"] === 2, "trends: new India problems counted under India (a city in India too)");
  check(!Object.values(d).some((n) => n > 2) && Object.values(d).reduce((a, b) => a + b, 0) === 4, "trends: a problem seen before isn't counted");
  check(d["gov_policy|Asia"] === 1, "trends: India and Nepal counts as Asia, as areaOf places it");
  check(d["industry|Europe"] === 1, "trends: category and area both kept");
  const t2 = tallyTrends(t, [p(6)], at("2026-10-31"));
  check(t2.days["2026-10-31"]["gov_policy|India"] === 3 && t.days["2026-10-31"]["gov_policy|India"] === 2,
    "trends: a second sweep the same day adds to that day, without changing the earlier tally");
  const quiet = tallyTrends(t2, [p(7, { isNew: false })], at("2026-11-01"));
  check(quiet.days["2026-11-01"] && Object.keys(quiet.days["2026-11-01"]).length === 0, "trends: a day with no new problems is still recorded, as zero");
  check(JSON.stringify(t).indexOf("Problem") < 0 && JSON.stringify(t).indexOf("gov_policy:p") < 0, "trends: the tally holds no titles or ids");

  let long = null;
  for (let i = 0; i < TREND_MAX_DAYS + 5; i++) long = tallyTrends(long, [p(i)], new Date(Date.UTC(2025, 0, 1) + i * DAY).toISOString());
  const days = Object.keys(long.days).sort();
  check(days.length === TREND_MAX_DAYS && days[0] === new Date(Date.UTC(2025, 0, 6)).toISOString().slice(0, 10),
    `trends: kept to the newest ${TREND_MAX_DAYS} days, oldest dropped first`);
  check(tallyTrends({ days: "x" }, [p(1)], at("2026-10-31")).days["2026-10-31"]["gov_policy|India"] === 1, "trends: a damaged tally starts again");
}

// ---- seeding from the kept items
{
  const s = seedTrends([
    p(1, { firstAt: "2026-10-20T05:00:00.000Z" }),
    p(2, { firstAt: "2026-10-20T22:00:00.000Z", region: "Japan" }),
    p(3, { firstAt: "2026-10-18T01:00:00.000Z", firstEarlier: true }),
    p(4, {}),
    p(5, { firstAt: "2026-10-25T01:00:00.000Z", cat: "web_app" }),
  ]);
  check(s.days["2026-10-20"]["gov_policy|India"] === 1 && s.days["2026-10-20"]["gov_policy|Asia"] === 1 && s.days["2026-10-25"]["web_app|India"] === 1,
    "trends seed: kept items counted on the day they were first seen");
  check(!s.days["2026-10-18"], "trends seed: an item first seen before the history began is left out (its day is a lower bound)");
  check(s.partial.join() === "2026-10-20,2026-10-25", "trends seed: every seeded day is marked partial");
  check(JSON.stringify(seedTrends(null)) === '{"days":{},"partial":[]}', "trends seed: no items, an empty tally");
  const next = tallyTrends(s, [p(9)], at("2026-10-31"));
  check(next.partial.join() === "2026-10-20,2026-10-25" && !next.partial.includes("2026-10-31"), "trends: days the sweep tallies aren't partial");
}

// ---- the view and "rising"
const build = (spec) => { // spec: { "YYYY-MM-DD": { "cat|Area": n } }
  return { days: spec, partial: [] };
};
const daysBack = (today, n) => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);
{
  check(trendsView(null) === null && trendsView({ days: {} }) === null, "trends view: none without a tally");
  const today = "2026-11-20", now = Date.parse(today + "T12:00:00Z");
  const spec = {};
  for (let i = 0; i < 20; i++) spec[daysBack(today, i)] = {};
  // Last 7 days: India gov 4, Europe industry 5; the 7 before: India gov 1, Europe industry 6.
  for (const i of [0, 1, 2, 3]) spec[daysBack(today, i)]["gov_policy|India"] = 1;
  spec[daysBack(today, 10)]["gov_policy|India"] = 1;
  spec[daysBack(today, 2)]["industry|Europe"] = 5;
  spec[daysBack(today, 9)]["industry|Europe"] = 6;
  spec[daysBack(today, 1)]["web_app|Oceania"] = 2; // under the minimum
  spec[daysBack(today, 5)]["industry|India"] = 1; // India across categories: 5, up from 1
  const v = trendsView(build(spec), now);
  check(v.since === daysBack(today, 19) && v.today === today && v.recorded === 20, "trends view: since, today and days recorded");
  check(v.rising.days === 7 && v.rising.enough && v.rising.min === RISE_MIN, "trends view: under 60 days recorded, rising compares 7 days with the 7 before");
  const [top, second] = v.rising.rows;
  check(top.area === "India" && top.cat === null && top.now === 5 && top.before === 1 && second.cat === "gov_policy" && second.now === 4,
    "trends view: the biggest rise first (India, all categories, 5 up from 1; then India gov 4 up from 1)");
  check(!v.rising.rows.some((r) => r.area === "Europe"), "trends view: a fall isn't rising");
  check(!v.rising.rows.some((r) => r.area === "Oceania"), `trends view: fewer than ${RISE_MIN} isn't a rise`);
  const one = trendsView(build({ ...Object.fromEntries(Object.keys(spec).map((d) => [d, {}])), [daysBack(today, 1)]: { "gov_policy|India": 3 } }), now);
  check(one.rising.rows.length === 1 && one.rising.rows[0].cat === "gov_policy", "trends view: an area row that only repeats its one category row is left out");
  check(v.last30["gov_policy|India"] === 5 && v.last30["industry|India"] === 1 && v.last30["industry|Europe"] === 11, "trends view: totals for the last 30 days");
  const wk = v.weeks.map((w) => w.start);
  check(wk.every((d) => new Date(d + "T00:00:00Z").getUTCDay() === 1) && v.weeks.reduce((a, w) => a + (w.cells["industry|Europe"] || 0), 0) === 11,
    "trends view: weeks start on Monday and hold every count");
  check(v.cats.length === CATS.length && v.areas.includes("India") && !JSON.stringify(v).includes("gov_policy:"), "trends view: labels for the page, and no item ids");

  const short = trendsView(build({ [daysBack(today, 3)]: { "gov_policy|India": 5 } }), now);
  check(!short.rising.enough && short.rising.rows.length === 0, "trends view: under 14 days recorded, no rising list yet");

  const spec60 = {};
  for (let i = 0; i < 65; i++) spec60[daysBack(today, i)] = {};
  spec60[daysBack(today, 20)]["traveler_pain|India"] = 6;
  spec60[daysBack(today, 40)]["traveler_pain|India"] = 2;
  const v60 = trendsView(build(spec60), now);
  check(v60.rising.days === 30 && v60.rising.rows[0].now === 6 && v60.rising.rows[0].before === 2, "trends view: from 60 days recorded, rising compares 30 days with the 30 before");

  const part = trendsView({ days: spec, partial: [daysBack(today, 10)] }, now);
  check(part.rising.partialBefore && part.partialDays === 1 && part.weeks.some((w) => w.partial), "trends view: partial days in the earlier window are flagged");
  check(!v.rising.partialBefore, "trends view: no partial days, no flag");
}

// ---- the sweep writes the tally into the search file
const fakeFetch = (byCat) => async (url, init) => {
  const body = JSON.parse(init.body);
  const cat = CATS.find((c) => body.messages[0].content.includes(`"${c.label}"`));
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(byCat[cat.key] || []) }], usage: { input_tokens: 1, output_tokens: 1 } }) };
};
const raw = (n, region = "India") => ({ title: "Problem " + n, summary: "s", source: "Src", link: "https://example.com/" + n, region, date: "Oct 2026", severity: "Medium", opportunity: "o" });
const sweep = (st, byCat, t) => runDailySweep({ storage: st, now: () => t, scan: (cat) => scanCategory(cat, { fetchFn: fakeFetch(byCat), apiKey: "k", model: "m" }) });
{
  const st = memStorage();
  const t1 = Date.UTC(2026, 9, 30, 2, 0);
  await sweep(st, { gov_policy: [raw(1), raw(2, "Delhi")], industry: [raw(3, "Spain")] }, t1);
  let file = JSON.parse(await st.get(KEY_SEARCH));
  check(file.trends && file.trends.days["2026-10-30"]["gov_policy|India"] === 2 && file.trends.days["2026-10-30"]["industry|Europe"] === 1,
    "sweep: the search file carries the tally of this sweep's new problems");
  check(Array.isArray(file.items) && file.items.length === 3 && Array.isArray(file.sweeps), "sweep: the search file's items and sweeps are unchanged");
  await sweep(st, { gov_policy: [raw(1), raw(4)] }, t1 + DAY);
  file = JSON.parse(await st.get(KEY_SEARCH));
  check(file.trends.days["2026-10-31"]["gov_policy|India"] === 1 && file.trends.days["2026-10-30"]["gov_policy|India"] === 2,
    "sweep: a problem seen again isn't counted again; earlier days kept");

  // A search file from before T44 (no tally) is seeded from its items once.
  const old = JSON.parse(await st.get(KEY_SEARCH));
  delete old.trends;
  await st.set(KEY_SEARCH, JSON.stringify(old));
  await sweep(st, { web_app: [raw(5, "Goa")] }, t1 + 2 * DAY);
  file = JSON.parse(await st.get(KEY_SEARCH));
  check(file.trends.days["2026-10-30"]["gov_policy|India"] === 2 && file.trends.partial.includes("2026-10-30") && file.trends.days["2026-11-01"]["web_app|India"] === 1,
    "sweep: a search file without a tally is seeded from its items, those days marked partial");
}

// ---- the public read
{
  const st = memStorage();
  const today = "2026-11-20", now = () => Date.parse(today + "T12:00:00Z");
  await st.set(KEY_SEARCH, JSON.stringify({ sweeps: ["1"], items: [{ id: "gov_policy:secret-title", title: "SECRET TITLE", link: "https://secret.example" }],
    trends: { days: { [today]: { "gov_policy|India": 3 } }, partial: [] } }));
  const call = async (key, env = {}, storage = st) => {
    const res = mockRes();
    await makeDataHandler({ storage, env, now })({ method: "GET", url: "/api/data?key=" + encodeURIComponent(key), headers: {} }, res);
    return res;
  };
  const on = { BOARD_PAYWALL: "1" };
  const r = await call("radar:trends", on);
  check(r.code === 200 && r.json().last30["gov_policy|India"] === 3, "trends read: open to everyone with the paywall on");
  check(!/SECRET|secret|gov_policy:/.test(r.body), "trends read: no titles, ids or links in the reply");
  check(/public/.test(r.headers["cache-control"]) && /s-maxage=3600/.test(r.headers["cache-control"]), "trends read: cached an hour");
  check((await call("radar:search", on)).code === 401, "trends read: the search file itself is still behind the paywall");
  check((await call("radar:trends", {}, memStorage())).code === 404, "trends read: no search file, 404");
  const noTally = memStorage();
  await noTally.set(KEY_SEARCH, JSON.stringify({ sweeps: [], items: [] }));
  check((await call("radar:trends", {}, noTally)).code === 404, "trends read: a search file without a tally, 404");
  const broken = { ...memStorage(), get: async () => { throw new Error("down"); } };
  check((await call("radar:trends", {}, broken)).code === 502, "trends read: storage down, 502");
}

finish("trends tests");
