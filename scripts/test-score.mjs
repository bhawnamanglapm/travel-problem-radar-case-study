// Offline tests for scripts/score-items.mjs (T30 step 10). The store is in memory and the link checks are
// stubbed, so this needs no network and no Blob token.
//   node scripts/test-score.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATS, KEY_INDEX, sweepKey } from "../api/_lib/radar.js";
import { parseCsv } from "./compare-models.mjs";
import { buildReview, dateRange, main, pickItems, readSweeps, recent, RECENT_DAYS, RUBRIC, score } from "./score-items.mjs";
import { check, finish, memStorage } from "./test-helpers.mjs";

const [A, B, C, D] = CATS.map((c) => c.key);
const item = (cat, n, over = {}) => ({
  id: `${cat}:p${n}`, cat, title: "Problem " + n, summary: "s", source: "Src", link: `https://example.com/${cat}/${n}`,
  region: "Global", date: "Oct 2026", severity: "Medium", opportunity: "o", ...over,
});

// ---- dates
{
  const d = (s) => { const r = dateRange(s); return r && [new Date(r[0]).toISOString().slice(0, 10), new Date(r[1]).toISOString().slice(0, 10)].join(".."); };
  check(d("Oct 2026") === "2026-10-01..2026-10-31" && d("October 2026") === "2026-10-01..2026-10-31" && d("Sept 2026") === "2026-09-01..2026-09-30",
    "score: a month and year names the whole month");
  check(d("12 Oct 2026") === "2026-10-12..2026-10-12" && d("Oct 12, 2026") === "2026-10-12..2026-10-12" && d("2026-10-12") === "2026-10-12..2026-10-12" && d("2026-02") === "2026-02-01..2026-02-28",
    "score: a day, in the formats a sweep can save, and a year-month");
  check(d("") === null && d("Recent") === null && d("Octember 2026") === null && d("31 Feb 2026") === null && d("2026-13") === null && d("Q3 2026") === null,
    "score: a date that can't be read gives null");
  const found = "2026-10-29T16:58:29.556Z";
  check(RECENT_DAYS === 60, "score: recent is the 60-day window the site promises");
  check(recent("Oct 2026", found) === "yes" && recent("29 Oct 2026", found) === "yes" && recent("Sep 2026", found) === "yes",
    "score: this month and last are recent");
  check(recent("Jul 2026", found) === "no" && recent("Jun 2026", found) === "no", "score: a month wholly older than 60 days is not");
  check(recent("Aug 2026", found) === "unknown", "score: a month across the 60-day line is unknown, not passed or failed");
  check(recent("2026-08-31", found) === "yes" && recent("2026-08-29", found) === "no", "score: a source's exact day settles it either side of the line");
  check(recent("Nov 2026", found) === "unknown" && recent("Recent", found) === "unknown" && recent("Oct 2026", "") === "unknown",
    "score: a date after it was found, an unreadable date or no found time is unknown");
  check(recent("Aug 2026", "2026-09-30T00:00:00Z") === "yes" && recent("Aug 2026", "2026-10-31T00:00:00Z") === "no",
    "score: the line is measured from when the item was found");
}

// ---- reading and picking
{
  const st = memStorage();
  const sweeps = [
    { id: "1000", at: "2026-10-20T00:00:00.000Z", problems: [item(A, 1, { title: "old copy" }), item(A, 2), item(B, 1)] },
    { id: "2000", at: "2026-10-25T00:00:00.000Z", problems: [item(A, 1, { firstAt: "2026-10-20T00:00:00.000Z" }), item(A, 3), item(C, 1), item(C, 2), item(C, 3)] },
  ];
  await st.set(KEY_INDEX, JSON.stringify([{ id: "500", at: "2026-10-19T00:00:00.000Z" }, ...sweeps.map(({ id, at }) => ({ id, at }))]));
  for (const s of sweeps) await st.set(sweepKey(s.id), JSON.stringify({ at: s.at, problems: s.problems }));
  const r = await readSweeps(st);
  check(r.sweeps.map((s) => s.id).join() === "2000,1000" && r.missing === 1, "score: sweeps are read newest first; a listed sweep with no file is skipped and counted");

  const p = pickItems(r.sweeps, 20);
  check(p.unique === 7 && p.items.length === 7, "score: each item once, however many sweeps it was in");
  const a1 = p.items.find((x) => x.id === `${A}:p1`);
  check(a1.title === "Problem 1" && a1.found === "2026-10-20T00:00:00.000Z", "score: an item is taken as its newest sweep has it, found when it was first seen");
  check(p.items.find((x) => x.id === `${A}:p3`).found === "2026-10-25T00:00:00.000Z", "score: without firstAt, found is the sweep's time");
  check(p.items.slice(0, 3).map((x) => x.cat).join() === [A, B, C].join() && p.byCat[D] === 0, "score: one from each category in turn; an empty category is passed over");

  const four = pickItems(r.sweeps, 4);
  check(four.items.length === 4 && four.byCat[A] === 2 && four.byCat[B] === 1 && four.byCat[C] === 1, "score: --count stops the pick, spread across categories");
  check(pickItems([], 20).items.length === 0, "score: no sweeps, no items");

  // T42: --area India scores only the items the board places in India.
  const ind = [{ id: "4000", at: "2026-11-01T00:00:00.000Z", problems: [item(A, 7, { region: "Mumbai, India" }), item(B, 7, { region: "Japan" }),
    item(C, 7, { region: "India" }), item(D, 7, { region: "India and Nepal" }), item(D, 8, { region: "Bengaluru" })] }];
  const pi = pickItems(ind, 20, "India");
  check(pi.items.map((x) => x.id).join() === [`${A}:p7`, `${C}:p7`, `${D}:p8`].join() && pi.unique === 3,
    "score: with an area, only the items the board places there (India and Nepal is Asia)");

  let threw = "";
  try { await readSweeps(memStorage()); } catch (e) { threw = e.message; }
  check(/no sweep index/.test(threw), "score: a store with no index says so");
}

// ---- the review file and the score
{
  const items = [
    { ...item(A, 1, { title: '=HYPERLINK("x")', summary: 'a "quoted", line', date: "Jul 2026", sourceDate: "2026-10-20" }), found: "2026-10-29T00:00:00.000Z" },
    { ...item(B, 1, { date: "Jul 2026" }), found: "2026-10-29T00:00:00.000Z" },
    { ...item(C, 1, { link: "" }), found: "2026-10-29T00:00:00.000Z" },
  ];
  const csv = buildReview(items, { [items[0].link]: "ok", [items[1].link]: "blocked" });
  const [head, ...rows] = parseCsv(csv);
  check(head.slice(-RUBRIC.length).join() === RUBRIC.map((r) => r.col).join(), "score: the rubric columns, in the README's order");
  const col = (name) => rows.map((r) => r[head.indexOf(name)]);
  check(col("link_loads").join() === "ok,blocked,none" && col("recent").join() === "yes,no,yes", "score: the link and date columns are filled in");
  check(col("source_date").join() === "2026-10-20,," && col("date")[0] === "Jul 2026",
    "score: recent uses the source's date when the sweep dated it, over the model's own date, and the file shows both");
  check(col("supports_summary").every((v) => v === "") && col("user_and_build").every((v) => v === ""), "score: the judged columns are left empty");
  check(rows[0][head.indexOf("title")] === `'=HYPERLINK("x")` && rows[0][head.indexOf("summary")] === 'a "quoted", line', "score: quotes and commas survive; a formula is not run");

  // Fill it in as a person would: blocked left as it is, one blank.
  const filled = [head, ...rows.map((r, i) => {
    const out = [...r];
    out[head.indexOf("supports_summary")] = ["y", "N", ""][i];
    out[head.indexOf("category_right")] = ["yes", "y", "no"][i];
    out[head.indexOf("severity_ok")] = "y";
    out[head.indexOf("user_and_build")] = ["n", "maybe", "y"][i];
    return out;
  })].map((r) => r.map((v) => '"' + v.replace(/"/g, '""') + '"').join(",")).join("\n") + "\n\n";
  const s = score(filled);
  check(s.items === 3, "score: blank lines are not items");
  const t = s.results;
  check(t.link_loads.pass === 1 && t.link_loads.fail === 1 && t.link_loads.left === 1, "score: ok passes, no link fails, blocked is not scored");
  check(t.supports_summary.pass === 1 && t.supports_summary.fail === 1 && t.supports_summary.left === 1, "score: y and N count; a blank is not scored");
  check(t.recent.pass === 2 && t.recent.fail === 1, "score: yes and no in recent count");
  check(t.user_and_build.left === 1 && t.severity_ok.pass === 3, "score: an answer that isn't y or n is not scored");
  check(/The source link loads: 1 of 2 \(50%\); 1 not scored/.test(s.text) && /The severity is reasonable: 3 of 3 \(100%\)$/m.test(s.text),
    "score: the report gives each share and what wasn't scored");
  check(/The source link loads: none scored; 3 not scored/.test(score(csv.replace(/"(ok|none)"/g, '""')).text), "score: a column with nothing filled in says none scored");
  let threw = "";
  try { score('"id","title"\n"a","b"\n'); } catch (e) { threw = e.message; }
  check(/no link_loads column/.test(threw), "score: a file without the rubric columns says which is missing");
}

// ---- main: reads only, checks each link once, writes the files, and --score reads them back
{
  const st = memStorage();
  const shared = "https://example.com/same";
  const problems = [item(A, 1, { link: shared }), item(B, 1, { link: shared }), item(C, 1), item(D, 1, { link: "https://example.com/gone" })];
  await st.set(KEY_INDEX, JSON.stringify([{ id: "3000", at: "2026-10-29T00:00:00.000Z" }]));
  await st.set(sweepKey("3000"), JSON.stringify({ at: "2026-10-29T00:00:00.000Z", problems }));
  const writes = [];
  for (const k of ["set", "del", "update"]) { const f = st[k]; st[k] = async (...a) => { writes.push(k); return f.apply(st, a); }; }
  const fetched = [];
  const baseFetch = async (url, init) => {
    fetched.push(init.method + " " + url);
    return { status: url.endsWith("/gone") ? 404 : 200, body: null };
  };
  const out = mkdtempSync(join(tmpdir(), "radar-score-test-"));
  const logs = [];
  try {
    const ra = await main(["--out", out, "--area", "India"], { storage: st, env: {}, baseFetch, clock: () => Date.parse("2026-10-30T00:00:00Z"), log: () => {} });
    check(ra.items.length === 0 && writes.length === 0, "score: --area India with no India items picks none and writes nothing to the store");
    const r = await main(["--out", out, "--count", "20"], { storage: st, env: {}, baseFetch, clock: () => Date.parse("2026-10-30T00:00:00Z"), log: (s) => logs.push(s) });
    check(writes.length === 0, "score: main writes nothing to the store");
    check(fetched.filter((f) => f.endsWith(shared)).length === 1 && fetched.length === 3, "score: a link two items share is checked once");
    check(r.items.length === 4 && /Only 4 items to score, fewer than the 20/.test(logs.join("\n")), "score: fewer items than asked for is said");
    check(/Links: 3 ok, 1 broken, 0 blocked, 0 with no link\./.test(logs.join("\n")), "score: the link results are printed");
    const csv = readFileSync(join(out, "review.csv"), "utf8");
    check(parseCsv(csv).length === 5 && JSON.parse(readFileSync(join(out, "items.json"), "utf8")).items.length === 4, "score: review.csv and items.json are written");
    writeFileSync(join(out, "review.csv"), csv);
    const logs2 = [];
    const s = await main(["--score", out], { log: (x) => logs2.push(x) });
    check(s.scored && s.results.link_loads.pass === 3 && /4 items in review\.csv/.test(logs2[0]), "score: --score reads the folder back");
  } finally { rmSync(out, { recursive: true, force: true }); }

  let threw = "";
  try { await main([], { env: {}, log: () => {} }); } catch (e) { threw = e.message; }
  check(/BLOB_READ_WRITE_TOKEN is not set/.test(threw) && !/[A-Za-z0-9_]{24,}/.test(threw), "score: no token, nothing read, and the error holds no secret");
  for (const bad of [["--count", "0"], ["--count", "x"], ["--nope"], ["--out"], ["--area", "Mars"], ["--area", "india"]]) {
    let e = "";
    try { await main(bad, { env: {}, log: () => {} }); } catch (err) { e = err.message; }
    check(e !== "", "score: refuses " + bad.join(" "));
  }
}

finish("score tests");
