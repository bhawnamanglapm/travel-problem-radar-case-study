// Offline tests for scripts/fill-plan.mjs, scripts/check-plan.mjs and api/_lib/plan.js (T24, T33). Razorpay is stubbed, so this
// needs no network and no keys. The prices here are samples for the tests, not the owner's price.
//   node scripts/test-plan.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fill, main as fillMain, planErrors, priceWords, slotValues, SLOTS } from "./fill-plan.mjs";
import { compare, cycleOf, main as checkMain } from "./check-plan.mjs";
import { periodsOf, priceErrors, priceOf, priceTable, razorpayPlans } from "../api/_lib/plan.js";
import { check, finish } from "./test-helpers.mjs";

const EMPTY = { paid: false, currency: "INR", monthly: null, yearly: null, gst: null, trialDays: null, refund: null, refundDays: null, methods: null, contact: "a@example.com" };
const SAMPLE = { ...EMPTY, monthly: 2999, yearly: 29990, gst: "GST included", trialDays: 0, refund: "No refunds <for> part months.", refundDays: 7, methods: ["cards", "UPI AutoPay"] };
const PAID = { ...SAMPLE, paid: true };

// plan.json as committed
const committed = JSON.parse(readFileSync(new URL("../plan.json", import.meta.url), "utf8"));
// paid is the owner's switch (on since 2026-10-27), so either value passes; the rest must be valid.
check(planErrors(committed).length === 0 && typeof committed.paid === "boolean", `the committed plan.json is valid (paid is ${committed.paid})`);

// planErrors
check(planErrors(EMPTY).length === 0 && planErrors(SAMPLE).length === 0 && planErrors(PAID).length === 0, "empty, sample and paid sample plans are valid");
check(planErrors({ ...EMPTY, paid: true }).some((e) => /monthly and yearly are both null/.test(e)) && planErrors({ ...EMPTY, paid: true, yearly: 999 }).length === 0,
  "paid: true needs a monthly or a yearly price");
check(planErrors({ ...SAMPLE, monthly: 299.5 }).length === 1 && planErrors({ ...SAMPLE, monthly: 0 }).length === 1 && planErrors({ ...SAMPLE, yearly: "999" }).length === 1, "monthly and yearly must be null or whole rupees above 0");
check(planErrors({ ...SAMPLE, pricing: {} }).some((e) => /replaced by monthly and yearly/.test(e)), "a pricing block (per category or email) is refused: there is one Pro plan");
check(priceErrors(SAMPLE).length === 0 && priceErrors({ monthly: -1, yearly: 1.5 }).length === 2, "priceErrors: whole rupees above 0, or null");

// prices: one Pro plan, a price per billing period (owner, 2026-10-26)
check(priceOf(1, SAMPLE) === 2999 && priceOf(12, SAMPLE) === 29990 && priceOf(3, SAMPLE) === null && priceOf(1, { ...SAMPLE, monthly: null }) === null, "priceOf: monthly or yearly; nothing else is on sale");
check(JSON.stringify(periodsOf(SAMPLE)) === "[1,12]" && JSON.stringify(periodsOf({ ...SAMPLE, monthly: null })) === "[12]" && periodsOf(EMPTY).length === 0, "periodsOf: monthly then yearly, only those with a price");
check(priceOf(1) === 1 && priceOf(12) === 1, "the committed plan.json charges ₹1 monthly and ₹1 yearly while payments are tested");
check(JSON.stringify(priceTable(SAMPLE)) === '{"1":2999,"12":29990}', "priceTable: months to rupees, for the manage page");
const PLANS = JSON.stringify({ 1: "plan_M1", 12: "plan_M12" });
check(JSON.stringify(razorpayPlans({ RAZORPAY_PLANS: PLANS }, SAMPLE)) === JSON.stringify({ 1: "plan_M1", 12: "plan_M12" }), "razorpayPlans: reads the JSON");
check(JSON.stringify(razorpayPlans({ RAZORPAY_PLANS: '{"1":"sub_X","12":"plan_M12","3":"plan_M3"}' }, SAMPLE)) === '{"12":"plan_M12"}' && JSON.stringify(razorpayPlans({ RAZORPAY_PLANS: "{nope" }, SAMPLE)) === "{}"
  && JSON.stringify(razorpayPlans({}, SAMPLE)) === "{}", "razorpayPlans: only plan_… ids for periods on sale; bad JSON or none gives nothing");
check(planErrors({ ...SAMPLE, currency: "USD" }).length === 1 && planErrors({ ...SAMPLE, paid: "no" }).length === 1, "currency must be INR and paid a boolean");
check(planErrors({ ...SAMPLE, methods: [] }).length === 1 && planErrors({ ...SAMPLE, gst: " " }).length === 1 && planErrors({ ...SAMPLE, trialDays: -1 }).length === 1, "empty methods, blank text and negative days are refused");

// slot values
const v = slotValues(SAMPLE);
check(v.PRO_PRICE === "₹2,999 a month or ₹29,990 a year" && v.PRO_PRICE_SHORT === "₹2,999" && v.PRO_PERIODS === "monthly or yearly", "the price: one for each period, with Indian digit grouping");
check(slotValues({ ...SAMPLE, monthly: null, yearly: 150000 }).PRO_PRICE === "₹1,50,000 a year" && slotValues({ ...SAMPLE, yearly: null }).PRO_PERIODS === "monthly", "only the periods on sale are named");
check(priceWords({ monthly: 1, yearly: 1 }) === "₹1 a month or ₹1 a year", "priceWords: the test plan's ₹1");
check(v.PRO_METHODS === "cards and UPI AutoPay" && slotValues({ ...SAMPLE, methods: ["a", "b", "c"] }).PRO_METHODS === "a, b and c" && slotValues({ ...SAMPLE, methods: ["cards"] }).PRO_METHODS === "cards", "payment methods read as a list in words");
check(v.PRO_TRIAL === "No free trial." && slotValues({ ...SAMPLE, trialDays: 7 }).PRO_TRIAL === "A 7-day free trial." && v.PRO_REFUND_DAYS === "7", "trial and refund days");
check(SLOTS.every((s) => s in v) && Object.keys(v).length === SLOTS.length && SLOTS.every((s) => slotValues(EMPTY)[s] === null || s === "PRO_CONTACT"), "every slot has a value from the plan, and null while the plan is empty");

// fill: the paid and free-test blocks
const page = 'A<template data-when="paid">P {{PRO_PRICE}}</template>B<!-- when:free-test -->F<!-- /when -->C';
check(fill(page, EMPTY).out === "ABFC" && fill(page, EMPTY).missing.length === 0, "paid: false drops the paid block, keeps the free-test text, and needs no price");
check(fill(page, SAMPLE).out === "ABFC", "paid: false with a price set still shows the free-test text");
check(fill(page, PAID).out === "AP " + v.PRO_PRICE + "BC", "paid: true unwraps the paid block and drops the free-test text");
const multi = '<template data-when="paid">1</template>x<template data-when="paid">2</template><!-- when:free-test -->a<!-- /when -->y<!-- when:free-test -->b<!-- /when -->';
check(fill(multi, PAID).out === "1x2y" && fill(multi, EMPTY).out === "xayb", "several blocks on a page are each switched, not merged");
check(fill("{{PRO_REFUND}}", SAMPLE).out === "No refunds &lt;for&gt; part months.", "values are HTML-escaped");
check(fill("{{LEGAL_NAME}} {{PRO_PRICE_SHORT}}", SAMPLE).out === "{{LEGAL_NAME}} ₹2,999", "{{LEGAL_…}} slots are left for fill-legal");
const miss = fill("{{PRO_PRICE}} {{PRO_GST}} {{PRO_NOPE}}", EMPTY);
check(miss.missing.includes("PRO_PRICE") && miss.missing.includes("PRO_GST") && miss.missing.includes("PRO_NOPE") && miss.out.includes("{{PRO_PRICE}}"), "a slot with no value, or an unknown slot, is reported by name");
check(fill('<template data-when="paid">x', PAID).missing.includes("an unclosed when block") && fill("<!-- when:free-test -->x", EMPTY).missing.length === 1, "an unclosed block is reported");

// the command line, on a temporary public/ folder
{
  const dir = mkdtempSync(join(tmpdir(), "fill-plan-"));
  const pub = join(dir, "public");
  mkdirSync(join(pub, "pricing"), { recursive: true });
  const planFile = join(dir, "plan.json");
  const run = (plan, files) => {
    writeFileSync(planFile, JSON.stringify(plan));
    for (const [f, t] of Object.entries(files)) writeFileSync(join(pub, f), t);
    const out = [], err = [];
    const code = fillMain([pub], { planFile, log: (s) => out.push(s), error: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n"), read: (f) => readFileSync(join(pub, f), "utf8") };
  };
  let r = run(EMPTY, { "index.html": page, "pricing/index.html": "{{PRO_PRICE}}", "radar.js": "{{PRO_PRICE}}" });
  check(r.code === 1 && /pricing.*PRO_PRICE/.test(r.err) && r.read("index.html") === "ABFC" && r.read("radar.js") === "{{PRO_PRICE}}", "the CLI fills every .html file, leaves other files alone, and fails on a slot with no value");
  r = run(SAMPLE, { "index.html": page, "pricing/index.html": "{{PRO_PRICE}}" });
  check(r.code === 0 && r.read("pricing/index.html") === v.PRO_PRICE && /free test/.test(r.out), "the CLI passes once the plan has the values");
  r = run({ ...EMPTY, paid: true }, { "index.html": "x" });
  check(r.code === 1 && /both null/.test(r.err), "the CLI refuses paid: true with no price");
  check(fillMain([join(dir, "nope")], { planFile, log: () => {}, error: () => {} }) === 1, "the CLI fails when the folder is missing");
  rmSync(dir, { recursive: true, force: true });
}

// The real pages, as the build would make them: free test today, and paid with the sample plan.
for (const f of ["pricing/index.html"]) {
  const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  const paid = fill(src, PAID);
  check(paid.missing.length === 0 && !/\{\{|when:|data-when/.test(paid.out) && !/being tested/.test(paid.out), `${f}, paid: every slot filled, no free-test text`);
  const free = fill(src, SAMPLE);
  check(free.missing.length === 0 && /being tested/.test(free.out) && !/Get Pro</.test(free.out), `${f}, free test: filled, and says Pro is being tested`);
  check((paid.out.match(/id="getpro"/g) || []).length === 1 && (free.out.match(/id="getpro"/g) || []).length === 1, `${f}: one Get Pro button in either version`);
}

// The pages that mention Pro today (T26): with paid false they are word for word what they were, with paid
// true they give the price, GST and renewal, and nothing says Pro is free or switched on by hand.
for (const f of ["index.html", "subscribe/index.html", "signup/index.html", "manage/index.html", "live/index.html"]) {
  const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  const today = src.replace(/<template data-when="paid">[\s\S]*?<\/template>/g, "").replace(/<!-- when:free-test -->|<!-- \/when -->/g, "");
  const free = fill(src, EMPTY), paid = fill(src, PAID);
  check(free.missing.length === 0 && free.out === today, `${f}, free test: unchanged, and needs no price`);
  check(paid.missing.length === 0 && !/\{\{|when:|data-when/.test(paid.out) && !/being tested|switched on by hand/.test(paid.out) && /₹29,990 a year, GST included/.test(paid.out) && /renews automatically at the end of each billing period/i.test(paid.out) && !/every month/.test(paid.out),
    `${f}, paid: price, GST and renewal filled in, no free-test text`);
  check([free.out, paid.out].every((o) => (o.match(/id="upgrade"/g) || []).length === (f === "manage/index.html" ? 1 : 0)), `${f}: at most one pay button in either version`);
}

// The policy pages (T25) take the same facts; their {{LEGAL_…}} slots are left for fill-legal.
for (const f of ["legal/terms/index.html", "legal/refunds/index.html"]) {
  const src = readFileSync(new URL("../" + f, import.meta.url), "utf8");
  const paid = fill(src, PAID), free = fill(src, SAMPLE);
  check(paid.missing.length === 0 && free.missing.length === 0 && !/\{\{PRO_|when:|data-when/.test(paid.out + free.out), `${f}: every Pro slot filled in either version`);
  check(/being tested/.test(free.out) && !/being tested/.test(paid.out) && /No refunds &lt;for&gt; part months\.|₹2,999 a month/.test(paid.out) && !/every month|monthly payments/.test(paid.out), `${f}: the free-test text only while testing; the plan's wording once paid`);
}

// check-plan, with Razorpay stubbed: one ₹1 plan per period (T33)
{
  const dir = mkdtempSync(join(tmpdir(), "check-plan-"));
  const planFile = join(dir, "plan.json");
  writeFileSync(planFile, JSON.stringify(SAMPLE));
  const ENV = { RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "sekrit-value", RAZORPAY_PLANS: PLANS };
  const good = (m) => ({ id: "plan_M" + m, entity: "plan", ...cycleOf(m), item: { amount: 100, currency: "INR" } });
  const run = async ({ env = ENV, reply = null, argv = [], file = planFile } = {}) => {
    const calls = [], out = [], err = [];
    const made = {};
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      if (reply === "throw") throw Object.assign(new Error("x"), { name: "TimeoutError" });
      if (reply && reply.status) return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
      if (init.method === "POST") {
        const b = JSON.parse(init.body), id = "plan_NEW" + (Object.keys(made).length + 1);
        made[id] = b.period === "yearly" ? 12 : b.interval;
        return { ok: true, status: 200, json: async () => ({ id, ...b }) };
      }
      const id = url.split("/").at(-1);
      const m = made[id] || Number(id.slice(6));
      const body = { ...good(m), id, ...(reply && reply.patch ? reply.patch(m) : {}) };
      return { ok: true, status: 200, json: async () => body };
    };
    const code = await checkMain(argv, { env, fetchFn, planFile: file, log: (s) => out.push(s), error: (s) => err.push(s) });
    return { code, calls, text: out.concat(err).join("\n") };
  };
  check(JSON.stringify(cycleOf(1)) === '{"period":"monthly","interval":1}' && JSON.stringify(cycleOf(12)) === '{"period":"yearly","interval":1}',
    "check-plan: monthly repeats every month; 12 months is yearly");
  let r = await run();
  check(r.code === 0 && /match \(test plans, ₹1 each, for 1, 12 months\)/.test(r.text) && r.calls.length === 2
    && r.calls.every((c, i) => c.url === `https://api.razorpay.com/v1/plans/plan_M${[1, 12][i]}` && c.init.method === "GET"), "check-plan: matching plans print match, after one GET per period");
  check(r.calls[0].init.headers.authorization === "Basic " + Buffer.from("rzp_test_abc:sekrit-value").toString("base64") && !/sekrit|rzp_test_abc/.test(r.text), "check-plan: Basic auth with the keys, and neither key is printed");
  check(compare({ ...good(12), period: "monthly", interval: 12 }, 12, SAMPLE).length === 0 && compare(good(1), 12, SAMPLE).length === 1, "check-plan: 12 months may also be monthly every 12; a monthly plan isn't a yearly one");
  r = await run({ reply: { patch: (m) => (m === 12 ? { item: { amount: 299900, currency: "INR" } } : {}) } });
  check(r.code === 1 && /12 months: amount: Razorpay 299900 paise, should be 100 paise/.test(r.text) && !/1 months:/.test(r.text), "check-plan: a plan that isn't ₹1 is reported by its period");
  r = await run({ reply: { patch: (m) => (m === 1 ? { interval: 3 } : {}) } });
  check(r.code === 1 && /1 months: period/.test(r.text) && !/amount/.test(r.text), "check-plan: a wrong period is reported");
  check(compare({ ...good(1), item: { amount: 100, currency: "USD" } }, 1, SAMPLE)[0].includes("currency"), "check-plan: the currency is compared too");
  r = await run({ reply: { status: 404, body: {} } });
  check(r.code === 1 && /404 \(no plan with that id/.test(r.text), "check-plan: plan not found");
  r = await run({ reply: "throw" });
  check(r.code === 1 && /didn't answer/.test(r.text), "check-plan: no answer is reported, not thrown");
  r = await run({ env: { ...ENV, RAZORPAY_KEY_SECRET: "" } });
  check(r.code === 2 && r.calls.length === 0 && /RAZORPAY_KEY_SECRET/.test(r.text), "check-plan: a missing key refuses before any call");
  r = await run({ env: { ...ENV, RAZORPAY_PLANS: '{"1":"sub_X"}' } });
  check(r.code === 2 && r.calls.length === 0 && /plan_/.test(r.text), "check-plan: a plan id that isn't plan_… refuses before any call");
  r = await run({ env: { ...ENV, RAZORPAY_PLANS: "{nope" } });
  check(r.code === 2 && r.calls.length === 0 && /isn't JSON/.test(r.text), "check-plan: RAZORPAY_PLANS that isn't JSON refuses before any call");
  r = await run({ env: { ...ENV, RAZORPAY_PLANS: '{"1":"plan_M1"}' } });
  check(r.code === 2 && r.calls.length === 0 && /no plan for 12 months; run with --create/.test(r.text), "check-plan: a period with no plan refuses and points at --create");
  // --create makes the missing ₹1 plans and prints the value for RAZORPAY_PLANS
  r = await run({ env: { ...ENV, RAZORPAY_PLANS: '{"1":"plan_M1"}' }, argv: ["--create"] });
  const posts = r.calls.filter((c) => c.init.method === "POST").map((c) => JSON.parse(c.init.body));
  check(r.code === 0 && posts.length === 1 && posts.every((b, i) => b.item.amount === 100 && b.item.currency === "INR" && JSON.stringify(cycleOf([12][i])) === JSON.stringify({ period: b.period, interval: b.interval })),
    "check-plan --create: one ₹1 plan for each period without one, repeating every period");
  check(r.text.includes('{"1":"plan_M1","12":"plan_NEW1"}') && /Preview, branch staging/.test(r.text) && !/sekrit/.test(r.text), "check-plan --create: prints the RAZORPAY_PLANS value for the staging Preview, and no key");
  r = await run({ env: { ...ENV, RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_PLANS: "" }, argv: ["--create"] });
  check(r.code === 0 && r.calls.filter((c) => c.init.method === "POST").length === 2 && /created the live 1-month plan/.test(r.text) && /Production/.test(r.text), "check-plan --create: live keys make live plans, for Production");
  r = await run({ env: { ...ENV, RAZORPAY_PLANS: "" }, argv: ["--create"], reply: { status: 401, body: {} } });
  check(r.code === 1 && /creating the 1-month plan failed: Razorpay said 401 \(keys not accepted\)/.test(r.text), "check-plan --create: a refused create stops with the reason");
  writeFileSync(join(dir, "empty.json"), JSON.stringify(EMPTY));
  r = await run({ file: join(dir, "empty.json") });
  check(r.code === 2 && r.calls.length === 0 && /no monthly or yearly price/.test(r.text), "check-plan: no price in plan.json refuses before any call");
  r = await run({ argv: ["extra"] });
  check(r.code === 2 && r.calls.length === 0, "check-plan: other arguments are refused (keys come from the shell)");
  rmSync(dir, { recursive: true, force: true });
}

finish("plan tests");
