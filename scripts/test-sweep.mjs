// Offline tests for the daily sweep and the data feed. The Anthropic API and Blob
// storage are stubbed, so this needs no network and no API key.
//   node scripts/test-sweep.mjs
import { makeDataHandler, makeSweepHandler } from "../api/_lib/handlers.js";
import { CATS, KEY_LLMLOG_PREFIX, extractProblems, llmLogKey, runDailySweep, scanCategory, sweepKey, trimSeen } from "../api/_lib/radar.js";
import { SLOTS_BY_FREQ, normaliseSweepsPerDay, previousSlotAt, siteSweepsPerDay, slotOf, sweepLimits, sweepsPerDayOf } from "../api/_lib/schedule.js";
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

// ---- a scheduled sweep that saves nothing still starts the 2-hour gap
{
  const st = memStorage();
  const t0 = Date.UTC(2026, 9, 18, 1, 30);
  const allFail = { traveler_pain: "http", gov_policy: "http", web_app: "http", industry: "http" };
  const one = { traveler_pain: [item(1)], gov_policy: [], web_app: [], industry: [] };
  const empty = await runDailySweep(sweepOpts(st, allFail, () => t0));
  check(empty.status === "empty" && JSON.parse(st.m.get("radar:lastScheduled")) === new Date(t0).toISOString(), "an empty scheduled sweep records when it started");
  const soon = await runDailySweep(sweepOpts(st, one, () => t0 + 1 * 3600 * 1000));
  check(soon.status === "skipped" && !st.m.has("radar:history"), "a scheduled run 1 h after an empty one is skipped");
  const manual = await runDailySweep({ ...sweepOpts(st, one, () => t0 + 1.5 * 3600 * 1000), manual: true });
  check(manual.status === "saved" && JSON.parse(st.m.get("radar:lastScheduled")) === new Date(t0).toISOString(),
    "a manual run still goes ahead and doesn't move the scheduled start time");
  const later = await runDailySweep(sweepOpts(st, one, () => t0 + 2.5 * 3600 * 1000));
  check(later.status === "saved", "a scheduled run 2.5 h after the empty one goes ahead");
  const repeat = await runDailySweep(sweepOpts(st, one, () => t0 + 3 * 3600 * 1000));
  check(repeat.status === "skipped", "and the gap then counts from that run");

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
  const tp = lg.calls.find((c) => c.cat === "traveler_pain");
  check(tp.request.messages[0].content.includes('"Traveler pain"') && tp.request.model === "claude-test" && tp.request.max_tokens === 16000,
    "a call keeps its request: prompt, model, limits");
  check(tp.response.content.find((b) => b.type === "text").text.includes("Problem 1") && tp.items === 1 && tp.usage.pages === 2,
    "a call keeps the model's answer, its item count and its pages");
  check(tp.response.content.some((b) => b.type === "server_tool_use" && b.input.query === "refund complaints")
    && tp.response.content.find((b) => b.type === "thinking").thinking === "look for refunds",
    "a call keeps the search queries and the thinking");
  check(!/ENC|IDX|SIG|quoted/.test(raw), "encrypted page contents, citation indexes and signatures are left out; pages are links only");
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
  const show = await run(["show", String(t1)]);
  check(show.code === 0 && JSON.parse(show.out).calls.length === 4, "llm-logs show: the whole log as JSON");
  check((await run(["show", "1700000000000"])).code === 1, "llm-logs show: unknown id is not found (exit 1)");
  check((await run(["show"])).code === 2 && (await run(["drop", "x"])).code === 2 && (await run(["list", "--days", "0"])).code === 2,
    "llm-logs: bad usage exits 2");
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
  check(text.includes("Failed this run: Gov &amp; policy") && text.includes("<https://radar.example.com/live/|Open the live board>"),
    "digest names failed categories and links the live board");
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
  check(req.body.subject === "Travel Problem Radar · 2027-01-15 08:00 UTC · 2 problems, 2 new (manual run)",
    `subject has the time, the counts and the trigger (${req.body.subject})`);
  check(req.body.html.includes("<a href=\"https://example.com/a&quot;b\">Fees &lt;rise&gt; &amp; more</a>") && !/<rise>/.test(req.body.html),
    "HTML part escapes titles and links");
  check(req.body.text.includes("Fees <rise> & more") && req.body.text.includes("Failed this run: Gov & policy")
    && req.body.text.includes("Live board: https://radar.example.com/live/") && /not verified/.test(req.body.text),
    "plain-text part has the items, failed categories, live board link and the not-verified note");
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
  check((await call("/api/data?key=" + llmLogKey("1800000000000"))).code === 400, "LLM logs are not exposed");
  check((await call("/api/data?key=../../etc/passwd")).code === 400, "path-like keys are rejected");
  check((await call("/api/data")).code === 400, "missing key is rejected");
  check((await call("/api/data?key=radar:sweep:1700000000000")).code === 404, "unknown sweep: 404");
  check((await call("/api/data?key=radar:history", "POST")).code === 405, "non-GET is refused (read-only)");
}

finish("server tests");
