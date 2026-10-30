// Offline tests for the daily sweep and the data feed. The Anthropic API and Blob
// storage are stubbed, so this needs no network and no API key.
//   node scripts/test-sweep.mjs
import { readFileSync } from "node:fs";
import { buildDigestEmail } from "../api/_lib/email.js";
import { makeDataHandler, makeSweepHandler } from "../api/_lib/handlers.js";
import { buildDigest } from "../api/_lib/slack.js";
import { AREAS, CATS, KEY_ITEMS, KEY_LLMLOG_PREFIX, KEY_SEARCH, LOG_QUOTE_MAX, LOG_TITLE_MAX, areaOf, dateSources, extractProblems, llmLogKey, logContent, mergeSearch, pageAgeDays, runDailySweep, sourceLabel, scanCategory, sweepKey, trackItems, trimSeen } from "../api/_lib/radar.js";
import { SLOTS_BY_FREQ, dueSlot, normaliseSweepsPerDay, previousSlotAt, siteSweepsPerDay, slotOf, sweepLimits, sweepsPerDayOf } from "../api/_lib/schedule.js";
import { check, finish, memStorage, mockRes } from "./test-helpers.mjs";

const item = (n, over = {}) => ({
  title: "Problem " + n, summary: "s", source: "Src", link: "https://example.com/" + n,
  region: "Global", date: "Oct 2026", severity: "Medium", opportunity: "o", ...over,
});
// Fake Anthropic: each category gets its own list of items, or an error.
// "cutoff" is a reply that spent its whole budget thinking: no text, stop_reason max_tokens.
const fakeFetch = (byCat, { seenCats = [] } = {}) => async (url, init) => {
  const body = JSON.parse(init.body);
  seenCats.push({ headers: init.headers, body });
  const cat = CATS.find((c) => body.messages[0].content.includes(`"${c.label}"`));
  const v = byCat[cat.key];
  if (v === "http") return { ok: false, status: 529, json: async () => ({}) };
  if (v === "cutoff") return {
    ok: true, status: 200,
    json: async () => ({
      content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens",
      usage: { input_tokens: 100, output_tokens: 8000, server_tool_use: { web_search_requests: 1 } },
    }),
  };
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return {
    ok: true, status: 200,
    json: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 2 } },
    }),
  };
};
const sweepOpts = (storage, byCat, now) => ({
  storage, now,
  scan: (cat) => scanCategory(cat, { fetchFn: fakeFetch(byCat), apiKey: "k", model: "m" }),
});

// ---- the sweep itself
{
  const st = memStorage();
  let t = Date.UTC(2026, 9, 18, 2, 0);
  const four = {
    traveler_pain: [item(1), item(2, { severity: "High" })],
    gov_policy: [item(3)],
    web_app: [item(4), item(4)], // duplicate within a category
    industry: [item(5)],
  };
  const out = await runDailySweep(sweepOpts(st, four, () => t));
  check(out.status === "saved" && out.total === 5, `first sweep saves 5 items, duplicates merged (${out.status}, ${out.total})`);
  const hist = JSON.parse(st.m.get("radar:history"));
  const saved = JSON.parse(st.m.get(sweepKey(out.id)));
  check(hist.length === 1 && hist[0].newCount === 5 && hist[0].highCount === 1, "history entry counts: 5 new, 1 high");
  check(saved.problems.every((p) => p.isNew) && saved.problems[0].severity === "High", "all flagged New, High sorted first");
  check(out.usage.searches === 8 && out.usage.input === 400, "usage totals come from the API response");

  // a second run within 2 h is refused, nothing written
  t += 1 * 3600 * 1000;
  const before = st.m.size;
  const again = await runDailySweep(sweepOpts(st, four, () => t));
  check(again.status === "skipped" && st.m.size === before, "second run within 2 h is skipped, nothing written");

  // next scheduled run, 5 h after the first: one repeat, one fresh item
  t += 4 * 3600 * 1000;
  const next = { ...four, traveler_pain: [item(1), item(9)] };
  const out2 = await runDailySweep(sweepOpts(st, next, () => t));
  const p2 = JSON.parse(st.m.get(sweepKey(out2.id))).problems;
  check(out2.status === "saved" && p2.find((p) => p.title === "Problem 9").isNew && !p2.find((p) => p.title === "Problem 1").isNew,
    "next run: unseen item is New, repeat is not");
  check(JSON.parse(st.m.get("radar:history")).length === 2, "history now has 2 sweeps");
}

// ---- manual runs skip the 2-hour gap and don't count toward it
{
  const st = memStorage();
  const t0 = Date.UTC(2026, 9, 18, 1, 30);
  const one = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] };
  await runDailySweep(sweepOpts(st, one, () => t0));
  const m = await runDailySweep({ ...sweepOpts(st, one, () => t0 + 4 * 3600 * 1000), manual: true });
  check(m.status === "saved" && JSON.parse(st.m.get("radar:history"))[1].manual === true, "manual run 4 h after a scheduled one sweeps, marked manual");
  const next = await runDailySweep(sweepOpts(st, one, () => t0 + 5 * 3600 * 1000));
  check(next.status === "saved", "next scheduled run 1 h after the manual one goes ahead: only scheduled sweeps count toward the gap");
  const dup = await runDailySweep(sweepOpts(st, one, () => t0 + 6 * 3600 * 1000));
  check(dup.status === "skipped", "a repeat scheduled run within 2 h is still skipped");
}

// ---- a scheduled sweep that saves nothing still uses up its slot (T35: one scheduled sweep per slot)
{
  const st = memStorage();
  const t0 = Date.UTC(2026, 9, 18, 1, 30);
  const allFail = { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" };
  const one = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] };
  const empty = await runDailySweep(sweepOpts(st, allFail, () => t0));
  const started0 = { at: new Date(t0).toISOString(), slotAt: Date.UTC(2026, 9, 18, 0) };
  check(empty.status === "empty" && JSON.stringify(JSON.parse(st.m.get("radar:lastScheduled"))) === JSON.stringify(started0), "an empty scheduled sweep records when it started and its slot");
  const soon = await runDailySweep(sweepOpts(st, one, () => t0 + 1 * 3600 * 1000));
  check(soon.status === "skipped" && !st.m.has("radar:history"), "a scheduled run later in the same slot as an empty one is skipped");
  const manual = await runDailySweep({ ...sweepOpts(st, one, () => t0 + 1.5 * 3600 * 1000), manual: true });
  check(manual.status === "saved" && JSON.stringify(JSON.parse(st.m.get("radar:lastScheduled"))) === JSON.stringify(started0),
    "a manual run still goes ahead and doesn't move the scheduled start");
  const later = await runDailySweep(sweepOpts(st, one, () => t0 + 4 * 3600 * 1000));
  check(later.status === "saved", "the next slot's scheduled run goes ahead");
  const repeat = await runDailySweep(sweepOpts(st, one, () => t0 + 4.5 * 3600 * 1000));
  check(repeat.status === "skipped", "and a repeat in that slot is skipped");

  // radar:lastScheduled written before T35 held only the time; its slot is used
  const pre = memStorage();
  pre.m.set("radar:lastScheduled", JSON.stringify(new Date(t0).toISOString()));
  check((await runDailySweep(sweepOpts(pre, one, () => t0 + 3600 * 1000))).status === "skipped"
    && (await runDailySweep(sweepOpts(pre, one, () => t0 + 4 * 3600 * 1000))).status === "saved", "an old time-only start still blocks its own slot, not the next");

  // T35: a late GitHub run sweeps as the slot it was due for, and doesn't block the next slot
  const late = memStorage();
  const s00 = { hour: 0, at: Date.UTC(2026, 9, 25, 0) };
  const r1 = await runDailySweep({ ...sweepOpts(late, one, () => Date.UTC(2026, 9, 25, 4, 49)), slot: s00 });
  const r2 = await runDailySweep({ ...sweepOpts(late, one, () => Date.UTC(2026, 9, 25, 5, 17)), slot: { hour: 5, at: Date.UTC(2026, 9, 25, 5) } });
  check(r1.status === "saved" && r1.slot === 0 && r2.status === "saved" && r2.slot === 5, "a slot-00 run at 04:49 and the slot-05 run at 05:17 both sweep, each as its own slot");
  const backstop = memStorage();
  await runDailySweep({ ...sweepOpts(backstop, one, () => Date.UTC(2026, 9, 25, 1, 30)), slot: s00 });
  check((await runDailySweep({ ...sweepOpts(backstop, one, () => Date.UTC(2026, 9, 25, 4, 49)), slot: s00 })).status === "skipped",
    "the Vercel backstop and a late slot-00 GitHub run don't both sweep");

  // a history saved before this change, with no start time stored, still holds back the next run
  const old = memStorage();
  await runDailySweep(sweepOpts(old, one, () => t0));
  old.m.delete("radar:lastScheduled");
  const afterOld = await runDailySweep(sweepOpts(old, one, () => t0 + 1 * 3600 * 1000));
  check(afterOld.status === "skipped", "with no start time stored, the last saved scheduled sweep still sets the gap");
}

// ---- partial and total failure
{
  const st = memStorage();
  const out = await runDailySweep(sweepOpts(st, {
    traveler_pain: "http", gov_policy: "not json at all", web_app: [item(1)], industry: "```json\n[" + JSON.stringify(item(2)) + ",\n{\"title\":\"cut off",
  }, () => 1_800_000_000_000));
  check(out.status === "saved" && out.total === 2, `failed and broken categories are skipped, the rest saved (${out.total})`);
  check(/failed/.test(out.perCat.traveler_pain) && /failed/.test(out.perCat.gov_policy), "failures are reported per category");

  const st2 = memStorage();
  const none = await runDailySweep(sweepOpts(st2, { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" }, () => 1_800_000_000_000));
  check(none.status === "empty" && [...st2.m.keys()].sort().join() === "radar:lastScheduled," + llmLogKey("1800000000000"),
    "all four failed: nothing saved but the start time and the LLM log");

  const cut = await runDailySweep(sweepOpts(memStorage(), { traveler_pain: "cutoff", gov_policy: [item(1)], web_app: [], industry: [] }, () => 1_800_000_000_000));
  check(cut.perCat.traveler_pain === "failed: empty (stop_reason: max_tokens)", "a failed category says why the model stopped");
  check(cut.usage.output === 8150 && cut.usage.searches === 7 && cut.usage.input === 400, "usage includes failed categories, which are billed too");
}

// ---- LLM log: every call's request and response, kept in the store
{
  // A reply shaped like a real web-search one: searches, results with encrypted page contents, a
  // thinking block with a signature, and an answer with citations.
  const searched = (urls, text) => async (url, init) => ({
    ok: true, status: 200,
    json: async () => ({
      id: "msg_1", model: "claude-test", stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "look for refunds", signature: "SIG" },
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "refund complaints" } },
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: urls.map((u) => ({ type: "web_search_result", url: u, title: "T", encrypted_content: "ENC", page_age: "1 day" })) },
        { type: "web_search_tool_result", tool_use_id: "srv_2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        { type: "text", text, citations: [{ type: "web_search_result_location", url: urls[0], title: "T", encrypted_index: "IDX", cited_text: "quoted" }] },
      ],
      usage: { input_tokens: 1000, output_tokens: 200, server_tool_use: { web_search_requests: 1 } },
    }),
  });
  const st = memStorage();
  const t = Date.UTC(2026, 9, 25, 5, 17);
  const byCat = {
    traveler_pain: searched(["https://a.example/1", "https://b.example/2", "https://a.example/1"], JSON.stringify([item(1)])),
    gov_policy: searched(["https://b.example/2", "https://c.example/3"], JSON.stringify([item(2)])),
    web_app: searched([], "no json here"),
    industry: async () => { throw new Error("socket hang up"); },
  };
  const out = await runDailySweep({ storage: st, now: () => t, scan: (cat) => scanCategory(cat, { fetchFn: byCat[cat.key], apiKey: "sekret", model: "claude-test" }) });
  const raw = st.m.get(llmLogKey(String(t)));
  const lg = JSON.parse(raw || "{}");
  check(out.status === "saved" && out.llmLog === String(t) && out.llmLog === out.id, "a saved sweep's LLM log has the sweep's id");
  check(lg.status === "saved" && lg.calls.length === 4 && lg.summary.calls === 4 && lg.summary.failed === 2, "the log has all four calls, two of them failed");
  check(lg.summary.input === 3000 && lg.summary.output === 600 && lg.summary.searches === 3,
    `summary: total input and output tokens and searches (${lg.summary.input}, ${lg.summary.output}, ${lg.summary.searches})`);
  check(lg.summary.pages === 3 && lg.summary.links.join() === "https://a.example/1,https://b.example/2,https://c.example/3",
    "summary: pages found by search, each link once across the sweep");
  check(out.usage.pages === 3, "the sweep's usage counts the pages too");
  const ubc = lg.summary.usageByCat || {};
  check(Object.keys(ubc).sort().join() === "gov_policy,traveler_pain,web_app" && ubc.web_app.input === 1000,
    "summary: usage per category, a failed call that was billed included, one with no usage left out");
  check(["input", "output", "searches"].every((k) => Object.values(ubc).reduce((a, u) => a + u[k], 0) === lg.summary[k]),
    "summary: usage per category adds up to the total");
  check(!/usageByCat/.test(st.m.get(sweepKey(out.id))) && !("usageByCat" in out.usage), "usage per category is in the private log only, not the public sweep file");
  const tp = lg.calls.find((c) => c.cat === "traveler_pain");
  check(tp.request.messages[0].content.includes('"Traveler pain"') && tp.request.model === "claude-test" && tp.request.max_tokens === 16000,
    "a call keeps its request: prompt, model, limits");
  check(tp.response.content.find((b) => b.type === "text").text.includes("Problem 1") && tp.items === 1 && tp.usage.pages === 2,
    "a call keeps the model's answer, its item count and its pages");
  check(tp.response.content.some((b) => b.type === "server_tool_use" && b.input.query === "refund complaints")
    && tp.response.content.find((b) => b.type === "thinking").thinking === "look for refunds",
    "a call keeps the search queries and the thinking");
  check(!/ENC|IDX|SIG/.test(raw), "encrypted page contents, citation indexes and signatures are left out");
  const sr = tp.response.content.find((b) => b.type === "web_search_tool_result" && b.pages);
  check(sr.pages[0].url === "https://a.example/1" && sr.pages[0].title === "T" && sr.pages[0].age === "1 day", "a searched page keeps its link, title and age");
  const tx = tp.response.content.find((b) => b.type === "text");
  check(tx.citations.length === 1 && tx.citations[0].url === "https://a.example/1" && tx.citations[0].quote === "quoted" && tx.citations[0].title === "T",
    "a citation keeps its link, title and the passage the model quoted");
  check(lg.summary.links.every((l) => typeof l === "string"), "the summary's pages are still links only");
  check(!raw.includes("sekret"), "the API key is never in the log");
  const wa = lg.calls.find((c) => c.cat === "web_app");
  const ind = lg.calls.find((c) => c.cat === "industry");
  check(/no json/.test(wa.error) && wa.response.content.length === 5, "a call with no usable answer keeps its response and the reason");
  check(ind.error === "socket hang up" && ind.request.messages.length === 1, "a call that never reached the API keeps its request and the error");

  // An HTTP error keeps its status and body, with the key blanked.
  let httpErr;
  try { await scanCategory(CATS[0], { apiKey: "sekret", model: "m", fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ error: { type: "authentication_error", message: "bad sekret" } }) }) }); }
  catch (e) { httpErr = e; }
  check(httpErr.call.response.status === 401 && !JSON.stringify(httpErr.call).includes("sekret") && JSON.stringify(httpErr.call).includes("[key]"),
    "an HTTP error's log keeps the status and body, never the key");

  // A sweep whose save fails still keeps the log, since the calls were billed.
  const st2 = memStorage();
  const failing = { ...st2, set: async (k, v) => { if (k.startsWith("radar:sweep:")) throw new Error("down"); return st2.set(k, v); } };
  let threw = false;
  try { await runDailySweep(sweepOpts(failing, { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }, () => t)); } catch (e) { threw = true; }
  check(threw && /^save failed: down/.test(JSON.parse(st2.m.get(llmLogKey(String(t)))).status), "a sweep that can't be saved still leaves its LLM log");

  // A failed log write never fails the sweep.
  const st3 = memStorage();
  const noLog = { ...st3, set: async (k, v) => { if (k.startsWith(KEY_LLMLOG_PREFIX)) throw new Error("down"); return st3.set(k, v); } };
  const out3 = await runDailySweep(sweepOpts(noLog, { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }, () => t));
  check(out3.status === "saved" && out3.llmLog === null, "a log that can't be written leaves the sweep saved (llmLog: null)");
}

// ---- LLM log: search page titles and quoted passages are text from other sites, cleaned
{
  const esc = "\u001b[31mred\u001b[0m\nline";
  const [sr, tx] = logContent([
    { type: "web_search_tool_result", tool_use_id: "s", content: [
      { type: "web_search_result", url: "https://a.example/1", title: esc, page_age: "2 days", encrypted_content: "ENC" },
      { type: "web_search_result", url: "https://b.example/2", title: "x".repeat(1000) },
      { type: "web_search_result", title: "no url" },
    ] },
    { type: "text", text: "t", citations: [
      { url: "https://a.example/1", title: "A", cited_text: esc, encrypted_index: "IDX" },
      { url: "https://a.example/1", title: "A", cited_text: esc, encrypted_index: "IDX2" },
      { url: "https://a.example/1", title: "A", cited_text: "q".repeat(2000) },
    ] },
  ]);
  check(!/[\u0000-\u001f\u007f]/.test(sr.pages[0].title + tx.citations[0].quote) && /red/.test(sr.pages[0].title) && /line/.test(tx.citations[0].quote),
    "log: control characters in a title or quote become spaces; the text stays");
  check(sr.pages[1].title.length === LOG_TITLE_MAX && !("age" in sr.pages[1]) && tx.citations[1].quote.length === LOG_QUOTE_MAX,
    "log: a long title and quote are capped; an age the API didn't give is left out");
  check(sr.pages.length === 2 && tx.citations.length === 2, "log: a result with no link is dropped; a repeated citation is kept once");
  check(!/ENC|IDX/.test(JSON.stringify([sr, tx])), "log: encrypted contents and indexes are still left out");
}

// ---- LLM logs older than 30 days go, listed on the first sweep of a UTC day only
{
  const st = memStorage();
  let lists = 0;
  const counted = { ...st, list: async (p) => { lists++; return st.list(p); } };
  const day = 24 * 3600 * 1000;
  const t0 = Date.UTC(2026, 9, 25, 0, 17);
  st.m.set(llmLogKey(String(t0 - 31 * day)), "{}");
  st.m.set(llmLogKey(String(t0 - 29 * day)), "{}");
  const four = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] };
  await runDailySweep(sweepOpts(counted, four, () => t0));
  check(!st.m.has(llmLogKey(String(t0 - 31 * day))) && st.m.has(llmLogKey(String(t0 - 29 * day))) && lists === 1,
    "the day's first sweep deletes logs older than 30 days and keeps the rest");
  await runDailySweep(sweepOpts(counted, four, () => t0 + 5 * 3600 * 1000));
  check(lists === 1 && [...st.m.keys()].filter((k) => k.startsWith(KEY_LLMLOG_PREFIX)).length === 3, "a later sweep that day lists nothing (Blob advanced operations)");
}

// ---- owner script: scripts/llm-logs.mjs
{
  const tool = await import("./llm-logs.mjs");
  const st = memStorage();
  const t1 = Date.UTC(2026, 9, 24, 3, 17), t2 = Date.UTC(2026, 9, 25, 5, 17);
  const four = { traveler_pain: [item(1)], gov_policy: "http", web_app: [], industry: [] };
  await runDailySweep(sweepOpts(st, four, () => t1));
  await runDailySweep(sweepOpts(st, four, () => t2));
  const run = async (argv) => {
    const out = [];
    const code = await tool.main(argv, { storage: st, now: t2, out: (s) => out.push(s), err: (s) => out.push(s) });
    return { code, out: out.join("\n") };
  };
  const ls = await run(["list"]);
  check(ls.code === 0 && ls.out.split("\n").length === 2 && ls.out.startsWith(String(t2)) && /3\/4 calls ok +in 300 +out 150/.test(ls.out),
    "llm-logs list: newest first, with calls, tokens, searches and pages");
  check((await run(["list", "--days", "1"])).out.split("\n").length === 1, "llm-logs list --days limits the range");
  const sum = await run(["summary", "latest"]);
  check(sum.code === 0 && sum.out.includes(`Sweep ${t2}`) && /gov_policy +failed: http 529/.test(sum.out) && /Tokens: 300 input, 150 output/.test(sum.out),
    "llm-logs summary: totals and each call's outcome");
  const withPages = (pages, citations) => ({
    id: "1", at: "x", status: "saved", summary: { calls: 1, failed: 0, links: ["https://a.example/1", "https://b.example/2"] },
    calls: [{ cat: "traveler_pain", items: 1, usage: {}, response: { content: [
      { type: "web_search_tool_result", pages }, { type: "text", text: "t", ...(citations ? { citations } : {}) },
    ] } }],
  });
  const fresh = tool.formatSummary(withPages([{ url: "https://a.example/1", title: "Refund rules", age: "2 days" }, { url: "https://b.example/2" }],
    [{ url: "https://a.example/1", title: "Refund rules", quote: "airlines must refund" }]));
  check(/^ {2}https:\/\/a\.example\/1 {2}— Refund rules \(2 days\)$/m.test(fresh) && /^ {2}https:\/\/b\.example\/2$/m.test(fresh),
    "llm-logs summary: a page's title and age next to its link, where the log has them");
  check(/Quoted:\n {2}traveler_pain:\n {4}"airlines must refund" {2}https:\/\/a\.example\/1/.test(fresh), "llm-logs summary: the passages each category quoted");
  const old = tool.formatSummary(withPages(["https://a.example/1", "https://b.example/2"], ["https://a.example/1"]));
  check(/^ {2}https:\/\/a\.example\/1$/m.test(old) && !/Quoted:/.test(old), "llm-logs summary: an older log (links only) prints as before");
  const show = await run(["show", String(t1)]);
  check(show.code === 0 && JSON.parse(show.out).calls.length === 4, "llm-logs show: the whole log as JSON");
  check((await run(["show", "1700000000000"])).code === 1, "llm-logs show: unknown id is not found (exit 1)");
  check((await run(["show"])).code === 2 && (await run(["drop", "x"])).code === 2 && (await run(["list", "--days", "0"])).code === 2,
    "llm-logs: bad usage exits 2");

  // Model and cost, at the list prices in compare-models.mjs. These sweeps ran on model "m", which has no price.
  check(/ {2}m {2}not known \(4 calls not priced: /.test(ls.out.split("\n")[0]), "llm-logs list: each sweep's model, and why it has no cost");
  check(/^Model: m\. Cost: not known \(4 calls not priced: .*no price for m.*\), at list prices\.$/m.test(sum.out) && /gov_policy .*, not priced$/m.test(sum.out),
    "llm-logs summary: the model, and no guessed cost for a model with no price");
  const U = { input: 50_000, output: 10_000, searches: 2, pages: 3 }; // under 100K input, so Haiku's lower prices
  const logOf = (id, day, model, calls) => ({
    id: String(id), at: `2026-10-${day}T02:27:00.000Z`, status: "saved",
    summary: ["input", "output", "searches", "pages"].reduce((s, k) => ({ ...s, [k]: calls.reduce((a, c) => a + ((c.usage || {})[k] || 0), 0) }),
      { calls: calls.length, failed: calls.filter((c) => c.error).length }),
    calls: calls.map((c) => ({ ...c, ...(model ? { request: { model } } : {}) })),
  });
  const pages = [{ url: "https://a.example/1", title: "A", age: "2 days ago" }, { url: "https://b.example/2", title: "B", age: "40 days ago" }, "https://c.example/3"];
  const haiku = (id, day) => logOf(id, day, "claude-haiku-5-5", [
    { cat: "traveler_pain", items: 3, usage: U, response: { content: [{ type: "web_search_tool_result", pages },
      { type: "text", text: "t", citations: [{ url: "https://a.example/1", quote: "q" }] }] } },
    { cat: "gov_policy", items: 0, error: "http 529" },
  ]);
  const h1 = haiku(1, 26), h2 = haiku(2, 27);
  const s1 = logOf(3, 28, "claude-sonnet-5-5", [{ cat: "traveler_pain", items: 4, usage: U }]);
  const hs = tool.formatSummary(h1);
  check(/^Model: claude-haiku-5-5\. Cost: \$0\.0300 \(1 call not priced: 1 no usage reported\), at list prices\.$/m.test(hs)
    && /^traveler_pain .*, \$0\.0300$/m.test(hs) && /^gov_policy +failed: http 529;.*, not priced$/m.test(hs),
    "llm-logs summary: the sweep's cost and each call's, and a failed call with no usage is not priced");
  check(/^Model: unknown\. Cost: not known \(1 call not priced: 1 no price for an unknown model\)/m.test(tool.formatSummary(logOf(4, 28, null, [{ cat: "web_app", items: 1, usage: U }]))),
    "llm-logs summary: a log with no model says unknown");
  check(tool.modelOf(logOf(5, 28, null, [{ cat: "a", request: { model: "x" } }, { cat: "b", request: { model: "y" } }])) === "x+y", "llm-logs: a sweep on two models names both");
  check(tool.ageDays("34 days ago") === 34 && tool.ageDays("2 weeks ago") === 14 && tool.ageDays("1 year ago") === 365
    && tool.ageDays("yesterday") === null && tool.ageDays(undefined) === null, "llm-logs: a page's age in days, from search's text");
  const mv = tool.formatModels([h1, s1, h2], 30);
  check(mv.startsWith("LLM logs from the last 30 days: 3 sweeps, 2 models.") && mv.indexOf("claude-haiku-5-5:") < mv.indexOf("claude-sonnet-5-5:"),
    "llm-logs models: one block per model, the most used first");
  check(mv.includes("claude-haiku-5-5: 2 sweeps, 2026-10-26 to 2026-10-27\n  Failed calls: 2 of 4 (50%)\n"
    + "  Per sweep: 3.0 items, 3.0 pages, 2.0 searches, 50,000 input and 10,000 output tokens\n"
    + "  Cost: $0.0300 a sweep, $0.0100 an item (2 calls not priced, left out)\n"
    + "  Calls that quoted a passage: 2 of 4\n"
    + "  Item sources: 0 items, median - old; 0 over 30 days, 0 not dated; 0 dropped (over 60 days)\n"
    + "  Search pages older than 30 days: 2 of 4 with an age (50%); 2 with no age"), "llm-logs models: a model's averages, cost per item, quotes and page age");
  // Item source freshness: from the ages the sweep logged, or for an older log from its answer and logged pages.
  const dated = logOf(6, 29, "claude-haiku-5-5", [{ cat: "traveler_pain", items: 3, usage: U,
    sources: [{ link: "https://a.example/1", days: 8 }, { link: "https://b.example/2", days: 40 }, { link: "https://c.example/3", days: null }],
    dropped: [{ title: "Old news", link: "https://o.example/9", age: "70 days ago" }] }]);
  check(tool.formatModels([dated], 30).includes("  Item sources: 3 items, median 24 days old; 1 over 30 days, 1 not dated; 1 dropped (over 60 days)\n"),
    "llm-logs models: item source ages and drops, from the ages the sweep logged");
  const answer = JSON.stringify(["https://a.example/1", "https://b.example/2/", "https://c.example/3", "https://d.example/4"].map((link, i) => item(i, { link })));
  const before = logOf(7, 29, "claude-haiku-5-5", [{ cat: "traveler_pain", items: 4, usage: U, response: { content: [
    { type: "web_search_tool_result", pages: [...pages, { url: "https://d.example/4", age: "70 days ago" }] }, { type: "text", text: answer }] } }]);
  check(tool.formatModels([before], 30).includes("  Item sources: 4 items, median 40 days old; 2 over 30 days, 1 not dated; 0 dropped (over 60 days)\n"),
    "llm-logs models: an older log's item sources, matched from its answer and pages; one that would now be dropped counts as old");
  const ds = tool.formatSummary(dated);
  check(/^traveler_pain +3 items, 1 dropped;/m.test(ds) && ds.includes("Dropped, source over 60 days old:\n  traveler_pain: Old news (70 days ago)  https://o.example/9"),
    "llm-logs summary: a category's dropped count, and each dropped item with its age");
  check(mv.includes("claude-sonnet-5-5: 1 sweep, 2026-10-28 to 2026-10-28\n  Failed calls: 0 of 1 (0%)\n")
    && mv.includes("  Cost: $0.2200 a sweep, $0.0550 an item\n") && !mv.includes("nothing to compare") && /not quality/.test(mv),
    "llm-logs models: the second model, and the note that this isn't quality");
  check(tool.formatModels([s1], 30).includes("Only one model in these logs, so there's nothing to compare yet."), "llm-logs models: one model, nothing to compare");
  const mr = await run(["models"]);
  check(mr.code === 0 && mr.out.includes("m: 2 sweeps") && mr.out.includes("(8 calls not priced, left out)"), "llm-logs models: reads the store's logs");
  check((await run(["models", "--days", "31"])).code === 2 && (await run(["models", "x"])).code === 2 && (await run(["models", "--days", "1"])).out.includes("1 sweep,"),
    "llm-logs models: --days is 1 to 30; no other arguments");
}

// ---- source freshness: each item's source dated from search's page age, sources over 60 days dropped
{
  const T = Date.UTC(2026, 9, 30, 6, 0);
  check(pageAgeDays("2 hours ago", T) === 2 / 24 && pageAgeDays("8 days ago", T) === 8 && pageAgeDays("3 weeks ago", T) === 21
    && pageAgeDays("2 months ago", T) === 60 && pageAgeDays("1 year ago", T) === 365, "pageAgeDays: hours, days, weeks, months and years ago");
  const abs = pageAgeDays("October 20, 2026", T);
  check(abs > 9.5 && abs < 11, `pageAgeDays: a date with a year (${abs})`);
  check(["yesterday", "5", "", undefined, "December 1, 2026"].every((a) => pageAgeDays(a, T) === null),
    "pageAgeDays: no age, text it can't read, a bare number or a future date gives null");

  const page = (url, age) => ({ type: "web_search_result", url, title: "T", encrypted_content: "ENC", ...(age ? { page_age: age } : {}) });
  const fetchFn = async () => ({
    ok: true, status: 200,
    json: async () => ({
      content: [
        { type: "web_search_tool_result", tool_use_id: "s", content: [
          page("https://a.example/fresh", "8 days ago"), page("https://a.example/today", "2 hours ago"), page("https://a.example/old", "70 days ago"),
          page("https://a.example/undated"), page("https://A.example/slash/", "5 days ago"), page("https://a.example/edge", "2 months ago"),
        ] },
        { type: "text", text: JSON.stringify([
          item(1, { link: "https://a.example/fresh" }), item(2, { link: "https://a.example/today" }), item(3, { link: "https://a.example/old" }),
          item(4, { link: "https://a.example/undated" }), item(5, { link: "https://elsewhere.example/x" }), item(6, { link: "https://a.example/slash#top" }),
          item(7, { link: "https://a.example/edge" }),
        ]) },
      ],
      usage: { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 1 } },
    }),
  });
  const scan = (cat) => scanCategory(cat, { fetchFn, apiKey: "k", model: "m", clock: () => T });
  const r = await scan(CATS[0]);
  const by = Object.fromEntries(r.items.map((p) => [p.title, p]));
  check(by["Problem 1"].sourceDate === "2026-10-22" && by["Problem 2"].sourceDate === "2026-10-30",
    "scanCategory: an item's source date is the sweep's day less its page's age");
  check(!by["Problem 3"] && r.call.dropped.length === 1 && r.call.dropped[0].title === "Problem 3" && r.call.dropped[0].age === "70 days ago"
    && r.call.items === 6, "scanCategory: an item whose source is over 60 days old is dropped and listed in the log");
  check(by["Problem 7"].sourceDate === "2026-08-31", "scanCategory: a source exactly 60 days old is kept");
  check(by["Problem 4"] && !("sourceDate" in by["Problem 4"]) && by["Problem 5"] && !("sourceDate" in by["Problem 5"]),
    "scanCategory: a page with no age, or a link search didn't return, is kept undated");
  check(by["Problem 6"].sourceDate === "2026-10-25", "scanCategory: links match without the fragment, trailing slash or host case");
  const days = Object.fromEntries(r.call.sources.map((s) => [s.link, s.days]));
  check(r.call.sources.length === 6 && days["https://a.example/fresh"] === 8 && days["https://a.example/undated"] === null,
    "scanCategory: the log keeps each kept item's source age in days");
  const found = Object.fromEntries(r.call.sources.map((s) => [s.link, s.searched]));
  check(found["https://a.example/fresh"] === true && found["https://a.example/undated"] === true && found["https://a.example/slash#top"] === true,
    "scanCategory: a link search returned is marked searched, with or without a page age, matched loosely too");
  check(found["https://elsewhere.example/x"] === false, "scanCategory: a link search never returned is marked not searched");
  const bare = dateSources([{ title: "No link", link: "" }, { title: "Bad", link: "not a url" }], [], T);
  check(bare.sources.every((s) => s.searched === false) && bare.items.length === 2, "dateSources: no link, or one that isn't a URL, is not searched and still kept");

  const st = memStorage();
  const none = (cat) => Promise.resolve({ items: [], usage: { input: 0, output: 0, searches: 0 }, call: { cat: cat.key } });
  const out = await runDailySweep({ storage: st, now: () => T, scan: (cat) => (cat.key === "traveler_pain" ? scan(cat) : none(cat)) });
  check(out.perCat.traveler_pain === "6 items, 1 dropped (source over 60 days)" && out.perCat.gov_policy === "0 items",
    `the sweep says how many items it dropped (${out.perCat.traveler_pain})`);
  const saved = JSON.parse(st.m.get(sweepKey(out.id))).problems;
  check(saved.find((p) => p.title === "Problem 1").sourceDate === "2026-10-22" && !saved.some((p) => p.title === "Problem 3"),
    "the saved sweep carries the source dates, without the dropped item");
  const lg = JSON.parse(st.m.get(llmLogKey(out.id)));
  check(lg.calls.find((c) => c.cat === "traveler_pain").dropped.length === 1, "the LLM log keeps the dropped item");
}

// ---- 60-sweep cap
{
  const st = memStorage();
  let t = 1_800_000_000_000;
  for (let i = 0; i < 62; i++) {
    t += 5 * 3600 * 1000;
    await runDailySweep(sweepOpts(st, { traveler_pain: [item(i)], gov_policy: [], web_app: [], industry: [] }, () => t));
  }
  const hist = JSON.parse(st.m.get("radar:history"));
  const sweeps = [...st.m.keys()].filter((k) => k.startsWith("radar:sweep:")).length;
  check(hist.length === 60 && sweeps === 60, `keeps only the last 60 sweeps (${hist.length} in index, ${sweeps} stored)`);

  // A failed index write leaves the old sweep files in place: nothing is deleted before the index is saved.
  const failing = { ...st, set: async (k, v) => { if (k === "radar:history") throw new Error("down"); return st.set(k, v); } };
  t += 5 * 3600 * 1000;
  let threw = false;
  try { await runDailySweep(sweepOpts(failing, { traveler_pain: [item(99)], gov_policy: [], web_app: [], industry: [] }, () => t)); } catch (e) { threw = true; }
  const indexed = JSON.parse(st.m.get("radar:history"));
  check(threw && indexed.length === 60 && indexed.every((h) => st.m.has(sweepKey(h.id))), "an index write that fails deletes no sweep the index still lists");
}

// ---- the seen list keeps what keeps coming back
{
  const ids = Array.from({ length: 10 }, (_, i) => "c:" + i);
  const kept = trimSeen(new Set(ids), new Set(["c:0", "c:new"]), 5);
  check(kept.length === 5 && kept.includes("c:0") && kept.includes("c:new") && kept[kept.length - 1] === "c:new" && !kept.includes("c:5"),
    "trimSeen: an old id seen again moves to the end and survives the trim");
}

// ---- T36: each item's history (radar:items, and firstAt / seen / prev on saved items)
{
  const a = { id: "c:a", isNew: true }, b = { id: "c:b", isNew: false };
  const r1 = trackItems({}, [a, b], "1800000000000", ["c:a", "c:b"]);
  check(r1.items[0].seen === 1 && r1.items[0].prev.length === 0 && r1.items[0].firstAt === new Date(1800000000000).toISOString() && !r1.items[0].firstEarlier,
    "trackItems: a new item is seen once, first seen in this sweep");
  check(r1.items[1].firstEarlier === true && r1.index["c:b"].e === 1, "trackItems: an item seen before the index knew it is marked firstEarlier");
  let idx = r1.index;
  for (let i = 1; i <= 7; i++) idx = trackItems(idx, [a], String(1800000000000 + i), ["c:a", "c:b"]).index;
  const r2 = trackItems(idx, [a], "1800000000008", ["c:a"]);
  check(r2.items[0].seen === 9 && r2.items[0].prev.length === 5 && r2.items[0].prev[4] === "1800000000007" && r2.index["c:a"].f === "1800000000000",
    "trackItems: the count goes up, the first sweep stays, prev keeps the 5 latest earlier sweeps");
  check(!("c:b" in r2.index), "trackItems: ids outside keepIds are dropped");
  check(trackItems({ "c:a": { f: "x" } }, [a], "1800000000009", ["c:a"]).items[0].seen === 1, "trackItems: a malformed entry starts over");
}
{
  const st = memStorage();
  let t = 1_800_000_000_000;
  const run = (items) => { t += 5 * 3600 * 1000; return runDailySweep(sweepOpts(st, { traveler_pain: items, gov_policy: [], web_app: [], industry: [] }, () => t)); };
  const s1 = await run([item(1), item(2)]);
  await run([item(1)]);
  const s3 = await run([item(1), item(2)]);
  const saved = JSON.parse(st.m.get(sweepKey(s3.id))).problems;
  const p1 = saved.find((p) => p.title === "Problem 1"), p2 = saved.find((p) => p.title === "Problem 2");
  check(p1.seen === 3 && p1.firstAt === s1.at && p1.prev.length === 2 && p2.seen === 2 && p2.prev[0] === s1.id,
    "the saved sweep carries each item's firstAt, seen and prev; an item missing from one sweep keeps its count");
  check(s3.problems.find((p) => p.title === "Problem 1").seen === 3, "the sweep's reply has the same fields");
  const idx = JSON.parse(st.m.get(KEY_ITEMS));
  const seen = JSON.parse(st.m.get("radar:seenIds"));
  check(Object.keys(idx).every((k) => seen.includes(k)), "the item index holds no id the seen list has dropped");

  // A store with sweeps but no index: built once from the saved sweeps.
  st.m.delete(KEY_ITEMS);
  const s4 = await run([item(1), item(3)]);
  const p = JSON.parse(st.m.get(sweepKey(s4.id))).problems;
  check(p.find((x) => x.title === "Problem 1").seen === 4 && p.find((x) => x.title === "Problem 1").firstAt === s1.at && p.find((x) => x.title === "Problem 3").seen === 1,
    "a missing index is rebuilt from the saved sweeps");

  // An index that can't be read: the sweep still saves, its items without history.
  const failing = { ...st, get: async (k) => { if (k === KEY_ITEMS) throw new Error("down"); return st.get(k); } };
  t += 5 * 3600 * 1000;
  const s5 = await runDailySweep(sweepOpts(failing, { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }, () => t));
  const p5 = JSON.parse(st.m.get(sweepKey(s5.id))).problems[0];
  check(s5.status === "saved" && !("seen" in p5), "an unreadable item index doesn't fail the sweep; its items are saved without history");

  // A failed index write doesn't fail the sweep either.
  const noWrite = { ...st, set: async (k, v) => { if (k === KEY_ITEMS) throw new Error("down"); return st.set(k, v); } };
  t += 5 * 3600 * 1000;
  const s6 = await runDailySweep(sweepOpts(noWrite, { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }, () => t));
  check(s6.status === "saved", "a failed item-index write doesn't fail the sweep");
}

// ---- T37: areaOf places the AI's free-text region in one of the fixed areas
{
  const cases = {
    "Japan": "Asia", "Thailand": "Asia", "Southeast Asia": "Asia", "rural Japan": "Asia", "Asia-Pacific": "Asia",
    "Spain": "Europe", "Europe": "Europe", "United Kingdom": "Europe", "UK": "Europe", "the UK": "Europe", "EU": "Europe",
    "Spain and Portugal": "Europe", "UK / France / Italy": "Europe", "Southern Spain": "Europe",
    "United States": "North America", "US": "North America", "U.S.": "North America", "USA (Chicago)": "North America",
    "Canada/United States": "North America", "New York City": "North America", "New Mexico": "North America",
    "Mexico": "Latin America", "Mexico (Tulum)": "Latin America", "São Paulo": "Latin America", "the Caribbean": "Latin America",
    "Saudi Arabia": "Middle East & Africa", "UAE": "Middle East & Africa", "Dubai, United Arab Emirates": "Middle East & Africa",
    "Tanzania, Kenya": "Middle East & Africa", "Côte d’Ivoire": "Middle East & Africa",
    "Niger, Burkina Faso, Mali (US citizens affected)": "Middle East & Africa",
    "Australia": "Oceania", "New South Wales, Australia": "Oceania", "Papua New Guinea": "Oceania",
    "Global": "Global", "global": "Global", "Worldwide": "Global", "": "Global", "  ": "Global",
    "US and Europe": "Global", "India/Europe": "Global", "Spain / Global": "Global", "Global (mostly US)": "Global",
    "Narnia": "Other", "Antarctica": "Other", "???": "Global",
  };
  const wrong = Object.entries(cases).filter(([r, a]) => areaOf(r) !== a).map(([r, a]) => `${JSON.stringify(r)} gave ${areaOf(r)}, not ${a}`);
  check(wrong.length === 0, "areaOf: countries, continents, short forms, mixed text, brackets, empty, Global and nonsense" + (wrong.length ? " (" + wrong.join("; ") + ")" : ""));
  check(areaOf(null) === "Global" && areaOf(undefined) === "Global" && areaOf(42) === "Other", "areaOf: a missing region is Global, and a non-string doesn't throw");
  check(AREAS.length === 8 && AREAS[0] === "Global" && AREAS[7] === "Other", "AREAS: the 8 areas, Global first and Other last");
  const sample = JSON.parse(readFileSync(new URL("../sampleData.json", import.meta.url), "utf8"));
  check(sample.every((p) => AREAS.includes(areaOf(p.region)) && areaOf(p.region) !== "Other"), "areaOf: every region in sampleData.json lands in a named area");
}

// ---- T38: the search file (radar:search), the latest copy of every item in the kept sweeps
{
  const a1 = { id: "c:a", title: "A old" }, a2 = { id: "c:a", title: "A new" }, b = { id: "c:b", title: "B" };
  let s = mergeSearch(null, [a1, b], "100", "t100", ["100"]);
  s = mergeSearch(s, [a2], "200", "t200", ["100", "200"]);
  const a = s.items.filter((x) => x.id === "c:a");
  check(a.length === 1 && a[0].title === "A new" && a[0].sweep === "200" && a[0].sweepAt === "t200",
    "mergeSearch: an item in several sweeps appears once, the latest copy with its sweep");
  check(s.items.find((x) => x.id === "c:b").sweep === "100" && JSON.stringify(s.sweeps) === '["100","200"]',
    "mergeSearch: an item only in an older sweep stays, with that sweep's id");
  check(s.items.at(-1).id === "c:a", "mergeSearch: the latest copy goes last, so the file stays in sweep order");
  const later = mergeSearch(s, [], "300", "t300", ["200", "300"]);
  check(!later.items.some((x) => x.id === "c:b") && JSON.stringify(later.sweeps) === '["200","300"]',
    "mergeSearch: items and sweeps no longer kept leave");
  for (const bad of [null, "x", { items: [] }, { sweeps: [], items: "x" }, []]) {
    const r = mergeSearch(bad, [b], "400", "t400", ["400"]);
    if (r.items.length !== 1 || r.sweeps.length !== 1) check(false, "mergeSearch: a bad previous file starts fresh (" + JSON.stringify(bad) + ")");
  }
  check(true, "mergeSearch: a bad or missing previous file starts fresh");
}
{
  const st = memStorage();
  let t = 1_800_000_000_000;
  const run = (items, storage = st) => { t += 5 * 3600 * 1000; return runDailySweep(sweepOpts(storage, { traveler_pain: items, gov_policy: [], web_app: [], industry: [] }, () => t)); };
  const s1 = await run([item(1), item(2)]);
  const s2 = await run([item(1)]);
  const file = JSON.parse(st.m.get(KEY_SEARCH));
  const p1 = file.items.filter((x) => x.title === "Problem 1");
  check(JSON.stringify(file.sweeps) === JSON.stringify([s1.id, s2.id]) && file.items.length === 2 && p1.length === 1 && p1[0].sweep === s2.id && p1[0].seen === 2,
    "the sweep writes radar:search: each item once, the latest copy with its history");
  check(file.items.find((x) => x.title === "Problem 2").sweep === s1.id, "radar:search keeps an item that is only in an older sweep");

  // A store with sweeps but no search file: built once from the saved sweeps.
  st.m.delete(KEY_SEARCH);
  const reads = [];
  const counting = { ...st, get: async (k) => { reads.push(k); return st.get(k); } };
  const s3 = await run([item(3)], counting);
  const built = JSON.parse(st.m.get(KEY_SEARCH));
  check(JSON.stringify(built.sweeps) === JSON.stringify([s1.id, s2.id, s3.id]) && built.items.length === 3,
    "a missing search file is built from the saved sweeps");
  check(reads.filter((k) => k === sweepKey(s1.id) || k === sweepKey(s2.id)).length >= 2, "building it reads each kept sweep");
  reads.length = 0;
  await run([item(3)], counting);
  check(reads.filter((k) => k.startsWith("radar:sweep:")).length === 0, "once the file exists, a sweep reads no old sweeps for it");

  // A search file that can't be read or written: the sweep still saves.
  const noRead = { ...st, get: async (k) => { if (k === KEY_SEARCH) throw new Error("down"); return st.get(k); } };
  check((await run([item(1)], noRead)).status === "saved", "an unreadable search file doesn't fail the sweep");
  const noWrite = { ...st, set: async (k, v) => { if (k === KEY_SEARCH) throw new Error("down"); return st.set(k, v); } };
  const s6 = await run([item(4)], noWrite);
  check(s6.status === "saved" && !JSON.parse(st.m.get(KEY_SEARCH)).sweeps.includes(s6.id), "a failed search-file write doesn't fail the sweep; that sweep is missing from it");
  const s7 = await run([item(5)]);
  const after = JSON.parse(st.m.get(KEY_SEARCH));
  check(after.sweeps.includes(s7.id) && after.items.some((x) => x.title === "Problem 5"), "the next sweep goes on writing the file");
}

// ---- T38: the board's URL helpers, run from their marked block in the jsx with the server's CATS and AREAS
{
  const jsx = readFileSync(new URL("../travel-problem-radar.jsx", import.meta.url), "utf8");
  const block = (jsx.match(/\n\/\/ Board URL \(T38\):[\s\S]*?\n\/\/ End of board URL\.\n/) || [""])[0];
  check(/function readBoardUrl\(/.test(block) && /function boardQuery\(/.test(block), "the board URL block is in the jsx");
  const { readBoardUrl, boardQuery } = new Function("CATS", "AREAS", block + "\nreturn { readBoardUrl, boardQuery };")(CATS, AREAS);
  const none = { q: "", cat: "all", area: "all", all: false };
  check(JSON.stringify(readBoardUrl("")) === JSON.stringify(none) && JSON.stringify(readBoardUrl(undefined)) === JSON.stringify(none),
    "board URL: no query is the defaults");
  const r = readBoardUrl("?q=%20visa%20delays%20&cat=gov_policy&area=Middle%20East%20%26%20Africa&all=1");
  check(r.q === "visa delays" && r.cat === "gov_policy" && r.area === "Middle East & Africa" && r.all === true,
    "board URL: q (trimmed), cat, area and all=1 are read");
  const bad = readBoardUrl("?cat=nope&area=Mars&all=yes&q=" + "x".repeat(300));
  check(bad.cat === "all" && bad.area === "all" && bad.all === false && bad.q.length === 200,
    "board URL: an unknown cat or area, all other than 1, and an over-long q are ignored or cut");
  check(boardQuery(none, "") === "" && boardQuery({ ...none, q: "   " }, "") === "", "board URL: the defaults and a blank search leave no query");
  const q = boardQuery({ q: "visa", cat: "gov_policy", area: "Europe", all: true }, "?utm=x&q=old&cat=industry");
  const u = new URLSearchParams(q.slice(1));
  check(q.startsWith("?") && u.get("utm") === "x" && u.get("q") === "visa" && u.get("cat") === "gov_policy" && u.get("area") === "Europe" && u.get("all") === "1",
    "board URL: the filters replace the old ones and other parameters stay");
  check(boardQuery({ ...none, cat: "industry" }, "?q=old&all=1") === "?cat=industry", "board URL: a filter set back to its default leaves the URL");
  const back = readBoardUrl(boardQuery({ q: "strike & delays", cat: "industry", area: "Latin America", all: true }, ""));
  check(back.q === "strike & delays" && back.cat === "industry" && back.area === "Latin America" && back.all, "board URL: what boardQuery writes, readBoardUrl reads back");
  check(!/location|history|window/.test(block), "board URL: the helpers only read and return strings; the hash is never touched");
}

// ---- parser
check(extractProblems({ content: [{ type: "text", text: "```json\n[{\"title\":\"a\"}]\n```" }] })[0].title === "a", "parser strips code fences");
{
  let threw = false;
  try { extractProblems({ content: [] }); } catch (e) { threw = true; }
  check(threw, "parser rejects an empty response");
}

// ---- request sent to Anthropic
{
  const seen = [];
  await scanCategory(CATS[0], { fetchFn: fakeFetch({ traveler_pain: [] }, { seenCats: seen }), apiKey: "sekret", model: "claude-test", maxSearches: 3 });
  const b = seen[0].body;
  check(b.model === "claude-test" && b.max_tokens === 16000 && b.output_config.effort === "low" && b.tools[0].max_uses === 3,
    "request uses the configured model, 16000 max tokens, low effort, 3 searches");
  check(seen[0].headers["x-api-key"] === "sekret" && !JSON.stringify(b).includes("sekret"), "key goes in a header, never in the body");
}

// ---- an API error says why
{
  const refuse = (status, body) => async () => ({ ok: false, status, json: async () => body });
  const why = async (fetchFn) => {
    try { await scanCategory(CATS[0], { fetchFn, apiKey: "sekret", model: "m" }); return null; } catch (e) { return e.message; }
  };
  const credit = await why(refuse(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low." } }));
  check(credit === "http 400 invalid_request_error: Your credit balance is too low.", "a 400 keeps the error type and message");
  const echoed = await why(refuse(401, { error: { type: "authentication_error", message: "bad key sekret\n  try again " + "x".repeat(300) } }));
  check(echoed.startsWith("http 401 authentication_error: bad key [key] try again x") && !echoed.includes("sekret") && echoed.length < 260,
    "the message is one line, capped, and never contains the key");
  check(await why(refuse(529, {})) === "http 529", "no error body: just the status");
  check(await why(async () => ({ ok: false, status: 502, json: async () => { throw new Error("not json"); } })) === "http 502", "a body that isn't JSON: just the status");
  check(await why(refuse(400, { error: { type: "Not A Type!", message: "m" } })) === "http 400: m", "an odd error type is left out");
}

// ---- /api/sweep
{
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", SWEEPS_PER_DAY_MIN: "5" };
  const run = async (headers, e = env, st = memStorage(), byCat = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }) => {
    const h = makeSweepHandler({ env: e, storage: st, fetchFn: fakeFetch(byCat), now: () => 1_800_000_000_000, log: () => {} });
    const res = mockRes(); await h({ headers }, res); return { res, st };
  };
  check((await run({})).res.code === 401, "sweep without the secret: 401");
  check((await run({ authorization: "Bearer wrong" })).res.code === 401, "sweep with a wrong secret: 401");
  check((await run({ authorization: "Bearer abc123" }, { CRON_SECRET: "", ANTHROPIC_API_KEY: "k" })).res.code === 401, "no CRON_SECRET configured: always 401");
  const nokey = await run({ authorization: "Bearer abc123" }, { CRON_SECRET: "abc123" });
  check(nokey.res.code === 500 && /ANTHROPIC_API_KEY/.test(nokey.res.json().error) && nokey.st.m.size === 0, "no API key: clear error, nothing saved");
  const ok = await run({ authorization: "Bearer abc123" });
  check(ok.res.code === 200 && ok.res.json().status === "saved" && !ok.res.body.includes("abc123"), "valid call saves, response never echoes secrets");
  const bad = await run({ authorization: "Bearer abc123" }, env, memStorage(), { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" });
  check(bad.res.code === 502, "all categories failed: 502 so the cron run shows as failed");

  const cron = { authorization: "Bearer abc123", "user-agent": "vercel-cron/1.0", "x-vercel-cron-schedule": "30 1 * * *" };
  const st = memStorage();
  const first = await run(cron, env, st);
  const cronAgain = await run(cron, env, st);
  const manualAgain = await run({ authorization: "Bearer abc123" }, env, st);
  check(first.res.json().trigger === "scheduled" && cronAgain.res.json().status === "skipped", "timer call within 2 h of the last one is skipped");
  check(manualAgain.res.code === 200 && manualAgain.res.json().status === "saved" && manualAgain.res.json().trigger === "manual",
    "manual call with the secret sweeps even within 2 h");

  // the GitHub Actions schedule marks itself with x-sweep-trigger; its "Run workflow" button doesn't
  const gh = (trigger) => ({ authorization: "Bearer abc123", "user-agent": "curl/8.5.0", "x-sweep-trigger": trigger });
  const st2 = memStorage();
  const ghFirst = await run(gh("scheduled"), env, st2);
  const ghAgain = await run(gh("scheduled"), env, st2);
  const ghButton = await run(gh("manual"), env, st2);
  check(ghFirst.res.json().trigger === "scheduled" && ghAgain.res.json().status === "skipped", "GitHub Actions schedule counts as scheduled and respects the gap");
  check(ghButton.res.json().trigger === "manual" && ghButton.res.json().status === "saved", "GitHub Actions \"Run workflow\" counts as manual and sweeps");
}

// ---- manual runs: at most MAX_MANUAL_SWEEPS_PER_DAY a UTC day (default 3), counted before they run
{
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", SWEEPS_PER_DAY_MIN: "5", SLACK_WEBHOOK_URL: "https://webhook.example/x" };
  const day0 = Date.UTC(2027, 0, 15, 8);
  const one = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] };
  const run = async ({ st, headers = { authorization: "Bearer abc123" }, e = env, t = day0, byCat = one }) => {
    const calls = [];
    const anthropic = fakeFetch(byCat);
    const fetchFn = async (url, init) => { calls.push(url); return url === env.SLACK_WEBHOOK_URL ? { ok: true, status: 200, text: async () => "ok" } : anthropic(url, init); };
    const h = makeSweepHandler({ env: e, storage: st, fetchFn, now: () => t, log: () => {} });
    const res = mockRes(); await h({ headers }, res); return { res, calls };
  };
  const events = (st) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes("-manualsweep-"));

  const st = memStorage();
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await run({ st, t: day0 + i * 60_000 })).res.code);
  const fourth = await run({ st, t: day0 + 3 * 60_000 });
  check(codes.every((c) => c === 200) && events(st).length === 3, "manual: 3 runs on one UTC day sweep, each recorded");
  check(fourth.res.code === 429 && fourth.res.json().status === "limited" && fourth.calls.length === 0 && events(st).length === 3,
    "manual: the 4th that day gets 429, calls neither Anthropic nor Slack, and isn't recorded");
  check(/MAX_MANUAL_SWEEPS_PER_DAY/.test(fourth.res.json().error) && !fourth.res.body.includes("abc123"), "manual: the 429 says how to raise the limit and never echoes the secret");
  const nextDay = await run({ st, t: day0 + 24 * 3600 * 1000 });
  check(nextDay.res.code === 200 && nextDay.res.json().status === "saved", "manual: the next UTC day allows runs again");

  const cron = { authorization: "Bearer abc123", "user-agent": "vercel-cron/1.0" };
  const gh = { authorization: "Bearer abc123", "x-sweep-trigger": "scheduled" };
  const sched = await run({ st, headers: cron, t: day0 + 4 * 3600 * 1000 });
  const ghSched = await run({ st, headers: gh, t: day0 + 7 * 3600 * 1000 });
  check(sched.res.json().status === "saved" && ghSched.res.json().status === "saved" && events(st).length === 4,
    "scheduled calls (Vercel cron, GitHub schedule) are not limited and not counted");

  const off = await run({ st: memStorage(), e: { ...env, MAX_MANUAL_SWEEPS_PER_DAY: "0" } });
  check(off.res.code === 429 && off.calls.length === 0, "MAX_MANUAL_SWEEPS_PER_DAY=0 refuses every manual run");
  const st1 = memStorage();
  const a = await run({ st: st1, e: { ...env, MAX_MANUAL_SWEEPS_PER_DAY: "1" } });
  const b = await run({ st: st1, e: { ...env, MAX_MANUAL_SWEEPS_PER_DAY: "1" } });
  check(a.res.code === 200 && b.res.code === 429, "MAX_MANUAL_SWEEPS_PER_DAY=1 allows one");
  const st9 = memStorage();
  const junk = [];
  for (let i = 0; i < 4; i++) junk.push((await run({ st: st9, e: { ...env, MAX_MANUAL_SWEEPS_PER_DAY: "lots" } })).res.code);
  check(junk.join() === "200,200,200,429", "an invalid MAX_MANUAL_SWEEPS_PER_DAY falls back to 3");

  const stF = memStorage();
  const allFail = { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" };
  const failed = await run({ st: stF, byCat: allFail });
  check(failed.res.code === 502 && events(stF).length === 1, "manual: a run where every category fails still uses one of the day's runs");

  const noList = { ...memStorage(), list: async () => { throw new Error("list failed"); } };
  const unlisted = await run({ st: noList });
  check(unlisted.res.code === 429 && unlisted.calls.length === 0, "manual: if the day's runs can't be counted, nothing runs");
  const noWrite = { ...memStorage(), set: async () => { throw new Error("write failed"); } };
  const unrecorded = await run({ st: noWrite });
  check(unrecorded.res.code === 503 && unrecorded.calls.length === 0, "manual: if the run can't be recorded, nothing runs");
}

// ---- Slack delivery after the sweep
{
  const hook = "https://webhook.example/not-a-real-secret"; // fake: real webhooks live only in Vercel
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", SWEEPS_PER_DAY_MIN: "5", SLACK_WEBHOOK_URL: hook, VERCEL_PROJECT_PRODUCTION_URL: "radar.example.com" };
  const some = { traveler_pain: [item(1, { severity: "High", title: "Fees <rise> & more" })], gov_policy: "http", web_app: [item(2)], industry: [] };
  const allFail = { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" };
  // Anthropic calls go to fakeFetch; calls to the webhook are recorded and answered with slackStatus.
  const run = async ({ byCat = some, e = env, st = memStorage(), slackStatus = 200, slackThrows = false, headers = { authorization: "Bearer abc123" } } = {}) => {
    const posts = [];
    const api = fakeFetch(byCat);
    const fetchFn = async (url, init) => {
      if (url !== hook) return api(url, init);
      posts.push(JSON.parse(init.body));
      if (slackThrows) throw new Error("connect ECONNREFUSED " + hook);
      return { ok: slackStatus < 300, status: slackStatus };
    };
    const h = makeSweepHandler({ env: e, storage: st, fetchFn, now: () => 1_800_000_000_000, log: () => {} });
    const res = mockRes(); await h({ headers }, res);
    return { res, posts };
  };

  const ok = await run();
  const text = (ok.posts[0] || {}).text || "";
  check(ok.res.code === 200 && ok.res.json().slack === "sent" && ok.posts.length === 1, "saved sweep: digest posted to Slack once");
  check(text.includes("<https://example.com/1|Fees &lt;rise&gt; &amp; more>") && text.includes("*NEW*"),
    "digest links each title to its source, escapes Slack control characters, marks New");
  check(text.includes("*FAILED: 1 of 4 categories failed this run; its problems are missing from this sweep.*")
    && /\n• Gov &amp; policy: \S/.test(text) && text.includes("<https://radar.example.com/live/|Open the live board>"),
    "digest flags failed categories with each one's error, and links the live board");
  check(ok.posts[0].unfurl_links === false && !ok.res.body.includes("not-a-real-secret") && !("problems" in ok.res.json()),
    "no link previews; response has neither the webhook URL nor the items");

  const off = await run({ e: { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k" } });
  check(off.res.code === 200 && off.posts.length === 0 && off.res.json().slack === "not configured", "no webhook set: sweep saves, nothing posted");

  const down = await run({ slackStatus: 404 });
  check(down.res.code === 200 && down.res.json().status === "saved" && down.res.json().slack === "failed: http 404", "Slack error does not fail a saved sweep");
  const unreachable = await run({ slackThrows: true });
  check(unreachable.res.json().slack === "failed: network error" && !unreachable.res.body.includes("not-a-real-secret"),
    "Slack unreachable: reported without the webhook URL");

  const none = await run({ byCat: allFail });
  const notice = (none.posts[0] || {}).text || "";
  check(none.res.code === 502 && none.posts.length === 1 && /sweep failed/.test(notice) && notice.includes("Traveler pain: failed: http 529"),
    "all categories failed: failure notice posted, still 502");

  const cron = { authorization: "Bearer abc123", "user-agent": "vercel-cron/1.0" };
  const st = memStorage();
  const sched = await run({ st, headers: cron });
  const again = await run({ st, headers: cron });
  check(again.res.json().status === "skipped" && again.posts.length === 0, "skipped timer call posts nothing");
  check(/^\*Travel Problem Radar: digest\*/.test(sched.posts[0].text) && /digest \(manual run\)/.test(text), "digest title says whether the timer or a manual run produced it");

  const broken = { get: async () => null, set: async () => { throw new Error("Vercel Blob: No blob credentials found"); }, del: async () => {} };
  const err = await run({ st: broken, headers: cron });
  check(err.res.code === 500 && err.posts.length === 1 && /No blob credentials/.test(err.posts[0].text), "sweep error: failure notice posted, still 500");
}

// ---- Email delivery through Resend
{
  const RESEND = "https://api.resend.com/emails";
  const hook = "https://webhook.example/not-a-real-secret";
  // fake: the real key and addresses live only in Vercel
  const mail = { RESEND_API_KEY: "re_test_fake", EMAIL_TO: "a@example.com, b@example.com" };
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", SWEEPS_PER_DAY_MIN: "5", VERCEL_PROJECT_PRODUCTION_URL: "radar.example.com", ...mail };
  const some = { traveler_pain: [item(1, { severity: "High", title: "Fees <rise> & more", link: "https://example.com/a\"b" })], gov_policy: "http", web_app: [item(2)], industry: [] };
  const allFail = { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" };
  // Anthropic calls go to fakeFetch; Resend and Slack calls are recorded and answered as asked.
  const run = async ({ byCat = some, e = env, st = memStorage(), resend = { status: 200 }, slackStatus = 200, headers = { authorization: "Bearer abc123" } } = {}) => {
    const sent = [], posts = [];
    const api = fakeFetch(byCat);
    const fetchFn = async (url, init) => {
      if (url === hook) { posts.push(JSON.parse(init.body)); return { ok: slackStatus < 300, status: slackStatus }; }
      if (url !== RESEND) return api(url, init);
      sent.push({ headers: init.headers, body: JSON.parse(init.body) });
      if (resend.throws) throw new Error("getaddrinfo ENOTFOUND api.resend.com");
      return { ok: resend.status < 300, status: resend.status, json: async () => resend.body || { id: "e1" } };
    };
    const h = makeSweepHandler({ env: e, storage: st, fetchFn, now: () => 1_800_000_000_000, log: () => {} });
    const res = mockRes(); await h({ headers }, res);
    return { res, sent, posts };
  };

  const ok = await run();
  const req = ok.sent[0] || { headers: {}, body: {} };
  check(ok.res.code === 200 && ok.res.json().email === "sent" && ok.sent.length === 1, "saved sweep: one email sent through Resend");
  check(req.headers.authorization === "Bearer re_test_fake" && !!req.headers["user-agent"]
    && JSON.stringify(req.body.to) === JSON.stringify(["a@example.com", "b@example.com"]),
    "Resend request: bearer key, user agent, recipients split from EMAIL_TO");
  check(req.body.from === "Travel Problem Radar <onboarding@resend.dev>", "no EMAIL_FROM: sends from Resend's shared address, no domain needed");
  const own = await run({ e: { ...env, EMAIL_FROM: "Radar <radar@example.com>" } });
  check(own.sent[0].body.from === "Radar <radar@example.com>", "EMAIL_FROM, when set, is the sender");
  check(req.body.subject === "Travel Problem Radar · FAILED: Gov & policy · 2027-01-15 08:00 UTC · 2 problems, 2 new (manual run)",
    `subject has the time, the counts and the trigger (${req.body.subject})`);
  check(req.body.html.includes("<a href=\"https://example.com/a&quot;b\">Fees &lt;rise&gt; &amp; more</a>") && !/<rise>/.test(req.body.html),
    "HTML part escapes titles and links");
  check(req.body.text.includes("Fees <rise> & more") && req.body.text.includes("FAILED: 1 of 4 categories failed this run; its problems are missing from this sweep.")
    && /\n  Gov & policy: \S/.test(req.body.text)
    && req.body.text.includes("Live board: https://radar.example.com/live/") && /not verified/.test(req.body.text),
    "plain-text part has the items, failed categories with their errors, live board link and the not-verified note");
  check(req.body.html.includes("FAILED: 1 of 4 categories failed this run") && /<li>Gov &amp; policy: \S/.test(req.body.html),
    "HTML part has the same alert and errors");
  check(!ok.res.body.includes("re_test_fake") && !ok.res.body.includes("a@example.com") && !ok.res.body.includes("b@example.com"),
    "reply has neither the key nor any address");

  const off = await run({ e: { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k" } });
  check(off.res.code === 200 && off.sent.length === 0 && off.res.json().email === "not configured", "no email settings: sweep saves, nothing sent");
  const partial = await run({ e: { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", RESEND_API_KEY: "re_test_fake" } });
  check(partial.sent.length === 0 && partial.res.json().email === "not configured: EMAIL_TO missing", "key without recipients: says what is missing");
  const nokey = await run({ e: { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", EMAIL_TO: "a@example.com" } });
  check(nokey.sent.length === 0 && nokey.res.json().email === "not configured: RESEND_API_KEY missing", "recipients without a key: says what is missing");
  const many = await run({ e: { ...env, EMAIL_TO: Array.from({ length: 51 }, (_, i) => `u${i}@example.com`).join(",") } });
  check(many.sent.length === 0 && /more than 50/.test(many.res.json().email), "more than 50 recipients: refused before calling Resend");

  const refused = await run({ resend: { status: 403, body: { statusCode: 403, name: "validation_error", message: "You can only send testing emails to your own email address (owner@example.com)." } } });
  check(refused.res.code === 200 && refused.res.json().status === "saved" && refused.res.json().email === "failed: http 403 validation_error",
    "Resend error does not fail a saved sweep; reply gives the status and error name");
  check(!refused.res.body.includes("owner@example.com") && !refused.res.body.includes("testing emails"), "Resend's message, which can hold addresses, stays out of the reply");
  const unreachable = await run({ resend: { throws: true } });
  check(unreachable.res.json().email === "failed: network error", "Resend unreachable: reported as a network error");

  const both = await run({ e: { ...env, SLACK_WEBHOOK_URL: hook }, slackStatus: 404 });
  check(both.res.json().slack === "failed: http 404" && both.res.json().email === "sent" && both.posts.length === 1 && both.sent.length === 1,
    "Slack and email are sent independently: one failing doesn't stop the other");

  const none = await run({ byCat: allFail });
  const n = (none.sent[0] || { body: {} }).body;
  check(none.res.code === 502 && none.sent.length === 1 && /sweep failed/.test(n.subject) && n.text.includes("Traveler pain: failed: http 529"),
    "all categories failed: failure email sent, still 502");

  const cron = { authorization: "Bearer abc123", "user-agent": "vercel-cron/1.0" };
  const st = memStorage();
  const sched = await run({ st, headers: cron });
  const again = await run({ st, headers: cron });
  check(again.res.json().status === "skipped" && again.sent.length === 0, "skipped timer call sends no email");
  check(!/manual run/.test(sched.sent[0].body.subject) && /^Travel Problem Radar: digest$/m.test(sched.sent[0].body.text), "scheduled digest is not marked manual");

  const broken = { get: async () => null, set: async () => { throw new Error("Vercel Blob: No blob credentials found"); }, del: async () => {} };
  const err = await run({ st: broken, headers: cron });
  check(err.res.code === 500 && err.res.json().email === "sent" && /No blob credentials/.test(err.sent[0].body.text), "sweep error: failure email sent, still 500");
}

// ---- LLM-failure alert: the owner's digest names each failed category with its error
{
  const at = "2027-01-15T08:00:00.000Z";
  const problems = [{ id: "a", cat: "traveler_pain", title: "T", summary: "", source: "S", link: "", region: "Europe", date: "Jan 2027", severity: "Medium", opportunity: "", isNew: true }];
  const two = { traveler_pain: "1 item", gov_policy: "failed: <b>overloaded</b> & retry", web_app: "0 items", industry: "failed: timeout" };
  const m = buildDigestEmail({ at, problems, perCat: two });
  check(m.subject === "Travel Problem Radar · FAILED: Gov & policy, Industry · 2027-01-15 08:00 UTC · 1 problems, 1 new",
    `two failed: both named in the subject, first (${m.subject})`);
  check(m.text.includes("FAILED: 2 of 4 categories failed this run; their problems are missing from this sweep.")
    && m.text.includes("  Gov & policy: <b>overloaded</b> & retry") && m.text.includes("  Industry: timeout") && !/failed: timeout/.test(m.text),
    "email: each failed category with its error, without the failed: prefix");
  check(m.html.includes("<li>Gov &amp; policy: &lt;b&gt;overloaded&lt;/b&gt; &amp; retry</li>") && !m.html.includes("<b>overloaded"), "email: the error is escaped in HTML");
  const s = buildDigest({ at, problems, perCat: two });
  check(s.includes("*FAILED: 2 of 4 categories failed this run; their problems are missing from this sweep.*")
    && s.includes("• Gov &amp; policy: &lt;b&gt;overloaded&lt;/b&gt; &amp; retry") && s.includes("• Industry: timeout"), "slack: the same alert, escaped for Slack");
  const long = buildDigestEmail({ at, problems, perCat: { industry: "failed: " + "x".repeat(1000) } });
  const line = long.text.split("\n").find((l) => l.startsWith("  Industry: "));
  check(line.length === "  Industry: ".length + 300 && buildDigest({ at, problems, perCat: { industry: "failed: " + "x".repeat(1000) } }).includes("x".repeat(300) + "\n"),
    "a 1,000-character error is cut to 300 in email and Slack");
  const ok = buildDigestEmail({ at, problems, perCat: { traveler_pain: "1 item", industry: "0 items" } });
  check(!/FAILED|fail/i.test(ok.subject + ok.text + ok.html) && !/FAILED/.test(buildDigest({ at, problems, perCat: { industry: "0 items" } })),
    "no failed category: no FAILED subject and no alert");
  const bare = buildDigestEmail({ at, problems, perCat: { industry: "failed" } });
  check(bare.text.includes("  Industry: no reason given"), "a failure with no reason still says so");
}

// ---- the source date readers see: "Source 22 Oct" when the sweep dated the source, the model's date when not
{
  const at = "2026-10-30T06:00:00.000Z", t = Date.parse(at);
  check(sourceLabel({ sourceDate: "2026-10-22" }, t) === "Source 22 Oct" && sourceLabel({ sourceDate: "2025-12-28" }, t) === "Source 28 Dec 2025",
    "sourceLabel: the day and month, and the year when it isn't this year's");
  check([{}, { sourceDate: "" }, { sourceDate: "22 Oct" }, { sourceDate: "2026-13-45" }].every((p) => sourceLabel(p, t) === null), "sourceLabel: no date, or one it can't read, gives null");
  const p = (n, over) => ({ id: "traveler_pain:" + n, cat: "traveler_pain", title: "T" + n, summary: "", source: "Skift", link: "", region: "Europe", date: "Oct 2026", severity: "Medium", opportunity: "", ...over });
  const m = buildDigestEmail({ at, problems: [p(1, { sourceDate: "2026-10-22" }), p(2)], perCat: {} });
  check(m.text.includes("  Skift · Europe · Source 22 Oct\n") && m.text.includes("  Skift · Europe · Oct 2026\n") && m.html.includes("Skift · Europe · Source 22 Oct"),
    "email: an item's line shows the source date when known, the model's date when not");
}

// ---- T32: sweeps a day. Slots, the site's number, and the handler skipping unneeded slots
{
  const H = 3600 * 1000;
  const day = Date.UTC(2027, 0, 15);
  check(JSON.stringify(SLOTS_BY_FREQ) === '{"1":[0],"2":[0,10],"3":[0,10,15],"4":[0,5,10,15],"5":[0,5,10,15,20]}', "slots: each number a day has its UTC hours");
  check([1, 2, 3, 4].every((f) => SLOTS_BY_FREQ[f].every((h) => SLOTS_BY_FREQ[f + 1].includes(h))), "slots: each number holds every slot of the smaller ones");
  check(slotOf(day + 5 * H + 40 * 60_000).hour === 5 && slotOf(day + 5 * H + 40 * 60_000).at === day + 5 * H, "slots: a 05:40 run is slot 05, which began at 05:00");
  check(slotOf(day + H + 30 * 60_000).hour === 0 && slotOf(day + 23 * H + 59 * 60_000).hour === 20, "slots: the Vercel 01:30 backstop is slot 00; 23:59 is slot 20");
  check(previousSlotAt(2, slotOf(day + 10 * H + 17 * 60_000)) === day && previousSlotAt(2, slotOf(day + 17 * 60_000)) === day - 14 * H,
    "slots: on 2 a day, slot 10 follows 00 the same day, and slot 00 follows 10 the day before");
  check(previousSlotAt(1, slotOf(day + 17 * 60_000)) === day - 24 * H && previousSlotAt(2, slotOf(day + 5 * H)) === undefined, "slots: on 1 a day the previous slot is a day back; slot 05 isn't one of 2 a day");

  const lim = (e) => JSON.stringify(sweepLimits(e));
  check(lim({}) === '{"min":1,"max":5}' && lim({ SWEEPS_PER_DAY_MIN: "2", SWEEPS_PER_DAY_MAX: "3" }) === '{"min":2,"max":3}', "limits: default 1 to 5; both can be set");
  check(lim({ SWEEPS_PER_DAY_MIN: "4", SWEEPS_PER_DAY_MAX: "2" }) === '{"min":2,"max":2}' && lim({ SWEEPS_PER_DAY_MIN: "0", SWEEPS_PER_DAY_MAX: "9" }) === '{"min":1,"max":5}' && lim({ SWEEPS_PER_DAY_MAX: "2.5" }) === '{"min":1,"max":5}',
    "limits: a floor above the cap is lowered to it; a value that isn't 1 to 5 is the default");
  check(normaliseSweepsPerDay(3, 5).ok && normaliseSweepsPerDay(3, 5).value === 3 && normaliseSweepsPerDay(4, 3).error === "over the limit"
    && ["3", 0, 6, 2.5, null].every((v) => normaliseSweepsPerDay(v, 5).error === "unknown frequency"), "choice: 1 to the cap; above the cap and anything else are told apart");
  check(sweepsPerDayOf({}, 5) === 2 && sweepsPerDayOf({ sweepsPerDay: 4 }, 5) === 4 && sweepsPerDayOf({ sweepsPerDay: 4 }, 3) === 3 && sweepsPerDayOf({ sweepsPerDay: 9 }, 5) === 2 && sweepsPerDayOf({}, 1) === 1,
    "choice: no choice is 2; the cap lowers a choice; a stored value that isn't 1 to 5 counts as no choice");

  const sub = (n, over = {}) => ({ id: String(n).padStart(64, "a"), email: `p${n}@example.com`, token: "t", status: "active", plan: "pro", proUntil: null, ...over });
  const stWith = (recs) => { const st = memStorage(); for (const r of recs) st.m.set("radar:sub:" + r.id, JSON.stringify(r)); return st; };
  const on = { SUBSCRIPTIONS_ENABLED: "1" };
  const site = async (recs, e = on) => (await siteSweepsPerDay({ env: e, storage: stWith(recs), now: day })).perDay;
  check(await site([]) === 1 && await site([sub(1, { plan: "free" })]) === 1, "site: no Pro members, once a day");
  check(await site([sub(1)]) === 2, "site: a Pro who hasn't chosen counts as 2");
  check(await site([sub(1, { sweepsPerDay: 1 }), sub(2, { sweepsPerDay: 4 })]) === 4, "site: choices 1 and 4 give 4");
  check(await site([sub(1, { sweepsPerDay: 5 })], { ...on, SWEEPS_PER_DAY_MAX: "3" }) === 3 && await site([], { ...on, SWEEPS_PER_DAY_MIN: "3" }) === 3, "site: the cap and the floor clamp it");
  check(await site([sub(1, { sweepsPerDay: 5, proUntil: new Date(day - 1000).toISOString() }), sub(2, { sweepsPerDay: 5, emailOff: "unsubscribed" }), sub(3, { sweepsPerDay: 5, status: "pending" })]) === 1,
    "site: a lapsed Pro, one with emails off and a pending record don't count");
  check(await site([sub(1, { sweepsPerDay: 5 })], {}) === 1 && await site([sub(1, { sweepsPerDay: 5 })], { SWEEPS_PER_DAY_MIN: "2" }) === 2, "site: with subscriptions off, the floor");
  const broken = () => ({ ...memStorage(), list: async () => { throw new Error("list failed"); } });
  const b = await siteSweepsPerDay({ env: { ...on, SWEEPS_PER_DAY_MAX: "4" }, storage: broken(), now: day });
  check(b.perDay === 4 && /couldn't read/.test(b.error), "site: if the list can't be read, the cap, so a needed slot still runs");

  // The handler: an unneeded slot is skipped before Anthropic; a needed one saves the slot.
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", ...on };
  const gh = { authorization: "Bearer abc123", "x-sweep-trigger": "scheduled" };
  const run = async ({ st = memStorage(), t, headers = gh, e = env }) => {
    const seenCats = [];
    const logs = [];
    const h = makeSweepHandler({ env: e, storage: st, fetchFn: fakeFetch({ traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }, { seenCats }), now: () => t, log: (...a) => logs.push(a.join(" ")) });
    const res = mockRes(); await h({ headers }, res); return { res, st, scans: seenCats.length, logs };
  };
  const s05 = await run({ t: day + 5 * H + 17 * 60_000 });
  check(s05.res.code === 200 && s05.res.json().status === "skipped" && s05.res.json().reason === "slot 05 not needed: 1 a day" && s05.scans === 0,
    "handler: with no Pro, slot 05 is skipped, 200, and the scan is never called");
  check(!s05.st.m.has("radar:lastScheduled") && !s05.st.m.has("radar:history"), "handler: a skipped slot saves nothing and doesn't start the 2-hour gap");
  const s00 = await run({ t: day + 17 * 60_000 });
  const idx = JSON.parse(s00.st.m.get("radar:history"));
  const file = JSON.parse(s00.st.m.get(sweepKey(idx[0].id)));
  check(s00.res.json().status === "saved" && s00.scans === 4 && idx[0].slot === 0 && idx[0].slotAt === new Date(day).toISOString() && file.slot === 0 && file.slotAt === idx[0].slotAt,
    "handler: slot 00 sweeps and saves the slot on the index entry and the sweep");
  const st2 = stWith([sub(1, { sweepsPerDay: 2 })]);
  const at10 = await run({ st: st2, t: day + 10 * H + 17 * 60_000 });
  const at15 = await run({ st: st2, t: day + 15 * H + 17 * 60_000 });
  check(at10.res.json().status === "saved" && at15.res.json().reason === "slot 15 not needed: 2 a day" && at15.scans === 0, "handler: a Pro on 2 a day: slot 10 sweeps, slot 15 is skipped");
  const backstop = await run({ t: day + H + 30 * 60_000, headers: { authorization: "Bearer abc123", "user-agent": "vercel-cron/1.0" } });
  check(backstop.res.json().status === "saved" && JSON.parse(backstop.st.m.get("radar:history"))[0].slot === 0, "handler: the Vercel backstop at 01:30 is slot 00, which always sweeps");
  const manual = await run({ t: day + 5 * H + 17 * 60_000, headers: { authorization: "Bearer abc123" } });
  const mIdx = JSON.parse(manual.st.m.get("radar:history"));
  check(manual.res.json().status === "saved" && manual.res.json().trigger === "manual" && !("slot" in mIdx[0]) && !("slotAt" in mIdx[0]), "handler: a manual run in an unneeded slot still sweeps, with no slot saved");
  const unread = await run({ st: broken(), t: day + 20 * H + 17 * 60_000 });
  check(unread.res.json().status !== "skipped" && unread.scans === 4 && unread.logs.some((l) => /couldn't read the subscriber list/.test(l)), "handler: if the list can't be read, the slot runs and the log says why");
}

// ---- T35: the slot a scheduled run was due for
{
  const H = 3600 * 1000, d = Date.UTC(2026, 9, 25);
  check(dueSlot(d + 15 * H + 5 * 60000, "10").hour === 10 && dueSlot(d + 15 * H + 5 * 60000, "10").at === d + 10 * H, "dueSlot: a slot-10 run starting at 15:05 is slot 10");
  check(dueSlot(d + 30 * 60000, "20").at === d - 4 * H, "dueSlot: a slot-20 run starting after midnight is yesterday's slot 20");
  check(dueSlot(d + 23 * H, "10").hour === 20, "dueSlot: a header slot that began 12 h or more ago is ignored for the run's own slot");
  check(["", "7", "abc", "05x", undefined].every((h) => dueSlot(d + 11 * H, h).hour === 10), "dueSlot: a missing or bad header gives the run's own slot");
  check(dueSlot(d + 9 * H, "5").hour === 5 && dueSlot(d + 9 * H, "05").hour === 5, "dueSlot: the header can be 5 or 05");

  // the handler: the header's slot is used, and the reply says how late the run was
  const env = { CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", SWEEPS_PER_DAY_MIN: "2" };
  const call = async (t, slotHeader) => {
    const st = memStorage();
    const h = makeSweepHandler({ env, storage: st, fetchFn: fakeFetch({ traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] }), now: () => t, log: () => {} });
    const res = mockRes();
    await h({ headers: { authorization: "Bearer abc123", "x-sweep-trigger": "scheduled", "x-sweep-slot": slotHeader } }, res);
    return res.json();
  };
  const lateRun = await call(d + 15 * H + 5 * 60000, "10");
  check(lateRun.status === "saved" && lateRun.slot === 10 && lateRun.lateMinutes === 305 && lateRun.slotAt === new Date(d + 10 * H).toISOString(),
    "handler: a run due at slot 10 that starts at 15:05 sweeps as slot 10 and reports 305 minutes late");
  const noHeader = await call(d + 15 * H + 5 * 60000, "");
  check(noHeader.status === "skipped" && /slot 15 not needed/.test(noHeader.reason) && noHeader.lateMinutes === 5, "handler: without the header the run counts as its own slot (15, not needed at 2 a day), 5 minutes in");
}

// ---- /api/data
{
  const st = memStorage();
  st.m.set("radar:history", "[1]");
  st.m.set("radar:seenIds", "[\"x\"]");
  st.m.set("radar:sweep:1800000000000", "{\"a\":1}");
  const h = makeDataHandler({ storage: st });
  const call = async (url, method = "GET") => { const res = mockRes(); await h({ url, method }, res); return res; };
  const r1 = await call("/api/data?key=radar:history");
  check(r1.code === 200 && r1.json().value === "[1]" && /s-maxage/.test(r1.headers["cache-control"]), "history is served with a CDN cache header");
  check((await call("/api/data?key=radar:sweep:1800000000000")).code === 200, "a sweep is served");
  check((await call("/api/data?key=radar:seenIds")).code === 400, "seenIds is not exposed");
  check((await call("/api/data?key=radar:lastScheduled")).code === 400, "lastScheduled is not exposed");
  check((await call("/api/data?key=radar:items")).code === 400, "the item index is not exposed (T36)");
  st.m.set("radar:search", "{\"sweeps\":[],\"items\":[]}");
  check((await call("/api/data?key=radar:search")).code === 200, "the search file is served (T38)");
  check((await call("/api/data?key=" + llmLogKey("1800000000000"))).code === 400, "LLM logs are not exposed");
  check((await call("/api/data?key=../../etc/passwd")).code === 400, "path-like keys are rejected");
  check((await call("/api/data")).code === 400, "missing key is rejected");
  check((await call("/api/data?key=radar:sweep:1700000000000")).code === 404, "unknown sweep: 404");
  check((await call("/api/data?key=radar:history", "POST")).code === 405, "non-GET is refused (read-only)");
}

finish("server tests");
