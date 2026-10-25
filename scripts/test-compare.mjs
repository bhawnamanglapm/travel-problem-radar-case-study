// Offline tests for scripts/compare-models.mjs. The Anthropic API and the link checks are stubbed,
// so this needs no network and no API key.
//   node scripts/test-compare.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATS } from "../api/_lib/radar.js";
import { buildReview, callCost, checkLink, main, parseCsv, runSweep, score, summarize, toCsv } from "./compare-models.mjs";
import { check, finish } from "./test-helpers.mjs";

const SONNET = "claude-haiku-5-5", HAIKU = "claude-haiku-5-5";
const near = (a, b) => Math.abs(a - b) < 1e-9;
const item = (n, over = {}) => ({
  title: "Problem " + n, summary: "s", source: "Src", link: "https://example.com/" + n,
  region: "Global", date: "Oct 2026", severity: "Medium", opportunity: "o", ...over,
});
const usage = { input_tokens: 10_000, output_tokens: 1_000, server_tool_use: { web_search_requests: 2 } };
// Fake Anthropic: per category a list of items, "400" (an API error with a message) or "refusal".
const fakeApi = (byCat, calls = []) => async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push(body);
  const cat = CATS.find((c) => body.messages[0].content.includes(`"${c.label}"`));
  const v = byCat[cat.key];
  if (v === "400") return { ok: false, status: 400, json: async () => ({ error: { message: "tool not supported" } }) };
  if (v === "refusal") return { ok: true, status: 200, json: async () => ({ content: [], stop_reason: "refusal", usage }) };
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(v) }], stop_reason: "end_turn", usage }) };
};
const three = (p) => [item(p + 1), item(p + 2), item(p + 3)];

// Prices
check(near(callCost(SONNET, { input: 1e6, output: 1e6, searches: 1 }), 12.01), "Sonnet: $2 + $10 a million tokens, $0.01 a search");
check(near(callCost(HAIKU, { input: 1e6 / 10, output: 1e6 / 10, searches: 0 }), 0.06), "Haiku: $0.10 + $0.50 a million tokens");
check(near(callCost(HAIKU, { input: 200_000, output: 0, searches: 0 }), 0.1), "Haiku over 100K input uses the higher price");

// One sweep
{
  const calls = [];
  const s = await runSweep(HAIKU, {
    apiKey: "k", clock: () => 0,
    baseFetch: fakeApi({ traveler_pain: three(0), gov_policy: three(10), web_app: "400", industry: "refusal" }, calls),
  });
  check(calls.length === 4 && calls.every((b) => b.model === HAIKU), "four calls, all with the model asked for");
  check(calls.every((b) => b.max_tokens === 16000 && b.output_config.effort === "low" && b.tools[0].max_uses === 3),
    "the production settings: max_tokens 16000, effort low, 3 searches");
  const web = s.cats.find((c) => c.cat === "web_app"), ind = s.cats.find((c) => c.cat === "industry");
  check(s.cats.filter((c) => c.ok).length === 2, "two categories succeed");
  check(!web.ok && /http 400: tool not supported/.test(web.error), "an API error keeps the API's message");
  check(!ind.ok && ind.stop === "refusal", "a refusal is recorded as the stop reason");
  check(s.usage.input === 30_000 && s.usage.searches === 6, "usage adds up the billed calls, the refusal included");
  check(near(s.cost, 3 * callCost(HAIKU, { input: 10_000, output: 1_000, searches: 2 })), "cost adds up the billed calls");
}

// Links
{
  const seen = [];
  const f = (byMethod) => async (url, init) => { seen.push(init.method); const st = byMethod[init.method]; if (st instanceof Error) throw st; return { status: st }; };
  check((await checkLink("https://a", { baseFetch: f({ HEAD: 200 }) })).result === "ok", "a 200 loads");
  check((await checkLink("https://a", { baseFetch: f({ HEAD: 405, GET: 200 }) })).result === "ok" && seen.includes("GET"), "HEAD not allowed: tries GET");
  check((await checkLink("https://a", { baseFetch: f({ HEAD: 403, GET: 403 }) })).result === "blocked", "a 403 is blocked, to open by hand");
  check((await checkLink("https://a", { baseFetch: f({ HEAD: 404 }) })).result === "broken", "a 404 is broken");
  check((await checkLink("https://a", { baseFetch: f({ HEAD: new Error("ENOTFOUND") }) })).result === "broken", "no such host is broken");
}

// Summary and the automatic checks
{
  const sweep = (model, perCat, cost, over = {}) => ({
    model, ms: 1000, cost, usage: { input: 1, output: 1, searches: 1 },
    cats: CATS.map((c, i) => ({ cat: c.key, ok: true, stop: "end_turn", items: perCat(i).map((it) => ({ ...it, id: c.key + ":" + it.title, cat: c.key })), ...over[c.key] })),
  });
  const items = (i) => three(i * 10);
  const links = Object.fromEntries(CATS.flatMap((c, i) => items(i).map((it) => [it.link, "ok"])));
  const good = summarize([SONNET, HAIKU], [sweep(SONNET, items, 0.21), sweep(HAIKU, items, 0.05)], links);
  check(good.pass, "a cheap candidate with 3 items per category and working links passes");
  check(/Items both models found \(same title\): 12/.test(good.text), "counts the items both models found");
  check(!summarize([SONNET, HAIKU], [sweep(SONNET, items, 0.21), sweep(HAIKU, items, 0.09)], links).pass, "over $0.08 a sweep fails");
  check(!summarize([SONNET, HAIKU], [sweep(SONNET, items, 0.21), sweep(HAIKU, (i) => [item(i)], 0.05)], links).pass, "under 3 items a category fails");
  const broken = { ...links, "https://example.com/1": "broken" };
  check(!summarize([SONNET, HAIKU], [sweep(SONNET, items, 0.21), sweep(HAIKU, items, 0.05)], broken).pass, "a broken link fails");
  const failed = sweep(HAIKU, items, 0.05, { industry: { ok: false, error: "no json", items: [], stop: "max_tokens" } });
  const f = summarize([SONNET, HAIKU], [sweep(SONNET, items, 0.21), failed], links);
  check(!f.pass && /failed industry: no json/.test(f.text) && /industry: max_tokens/.test(f.text), "a failed category and max_tokens fail, with the reason");
}

// CSV and the blind review
{
  const rows = [["a", 'say "hi", ok', "two\nlines"], ["=1+1", "", "@x"]];
  const back = parseCsv(toCsv(rows));
  check(back[0][1] === 'say "hi", ok' && back[0][2] === "two\nlines", "CSV keeps quotes, commas and line breaks");
  check(back[1][0] === "'=1+1" && back[1][2] === "'@x", "a cell that Excel would run as a formula is made plain text");
  const sw = (model, list) => ({ model, cats: [{ items: list.map((it) => ({ ...it, id: "c:" + it.title, cat: "c" })) }] });
  const sweeps = [sw(SONNET, [item(1), item(2)]), sw(SONNET, [item(1)]), sw(HAIKU, [item(1), item(3)])];
  const { csv, key } = buildReview(sweeps, () => 0);
  const [head, ...body] = parseCsv(csv);
  check(body.length === 4, "each item once per model (repeats across rounds removed)");
  check(!head.includes("model") && !csv.includes(SONNET) && !csv.includes(HAIKU), "the review file doesn't say which model found what");
  check(Object.keys(key).length === 4 && Object.values(key).filter((m) => m === HAIKU).length === 2, "key.json maps every row to its model");

  const marked = (marks) => toCsv([head, ...body.map((r) => { const c = [...r]; c[head.indexOf("keep")] = marks[key[r[0]]].shift() ?? ""; return c; })]);
  const pass = score(marked({ [SONNET]: ["y", "y"], [HAIKU]: ["y", "n"] }), key, [SONNET, HAIKU]);
  check(!pass.pass && /keep rate 50%/.test(pass.text), "50% against 100% is under 80% of the baseline: fails");
  check(score(marked({ [SONNET]: ["y", "n"], [HAIKU]: ["y", "n"] }), key, [SONNET, HAIKU]).pass, "the same keep rate passes");
  check(!score(marked({ [SONNET]: ["y", "n"], [HAIKU]: ["y", "f"] }), key, [SONNET, HAIKU]).pass, "any invented item fails");
  const half = score(marked({ [SONNET]: ["y"], [HAIKU]: ["y", "y"] }), key, [SONNET, HAIKU]);
  check(!half.pass && /Not finished: 1 item/.test(half.text), "unmarked items: not finished");
}

// The command line
{
  const calls = [], logs = [];
  const r = await main([], { env: { ANTHROPIC_API_KEY: "k" }, baseFetch: fakeApi({}, calls), log: (s) => logs.push(s) });
  check(!r.ran && calls.length === 0, "without --yes nothing is sent");
  check(logs.some((l) => /Expected cost about \$0\.79; high-cost scenario about \$3\.73/.test(l)), "it prints the cost: $0.79 expected, $3.73 high-cost");
  let err = "";
  try { await main(["--yes"], { env: {}, baseFetch: fakeApi({}, calls), log: () => {} }); } catch (e) { err = e.message; }
  check(/ANTHROPIC_API_KEY is not set/.test(err) && calls.length === 0, "no key: refuses before any call");
  err = "";
  try { await main(["--models", "claude-opus-5-5,claude-haiku-5-5"], { log: () => {} }); } catch (e) { err = e.message; }
  check(/no price for claude-opus-5-5/.test(err), "a model with no price is refused");

  const dir = mkdtempSync(join(tmpdir(), "radar-compare-test-"));
  try {
    const byCat = Object.fromEntries(CATS.map((c, i) => [c.key, three(i * 10)]));
    const api = fakeApi(byCat, calls);
    const baseFetch = (url, init) => (url.includes("anthropic") ? api(url, init) : Promise.resolve({ status: 200 }));
    const out = await main(["--yes", "--rounds", "2", "--out", dir], { env: { ANTHROPIC_API_KEY: "k" }, baseFetch, clock: () => 0, log: () => {} });
    const res = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
    check(out.ran && res.sweeps.length === 4 && calls.length === 16, "2 rounds: 4 sweeps, 16 calls");
    check(res.sweeps.map((s) => s.model).join() === [SONNET, HAIKU, HAIKU, SONNET].join(), "the model that goes first alternates");
    check(Object.values(res.links).every((v) => v === "ok"), "links are checked");
    const key = JSON.parse(readFileSync(join(dir, "key.json"), "utf8"));
    const csv = parseCsv(readFileSync(join(dir, "review.csv"), "utf8"));
    check(csv.length === 1 + Object.keys(key).length && Object.keys(key).length === 24, "review.csv has each model's 12 items once");
    const kc = csv[0].indexOf("keep");
    writeFileSync(join(dir, "review.csv"), toCsv([csv[0], ...csv.slice(1).map((r) => { const c = [...r]; c[kc] = "y"; return c; })]));
    check((await main(["--score", dir], { log: () => {} })).pass, "--score reads the filled-in file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

finish("model-compare tests");
