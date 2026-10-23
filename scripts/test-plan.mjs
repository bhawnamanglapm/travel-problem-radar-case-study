// Offline tests for scripts/fill-plan.mjs and scripts/check-plan.mjs (T24). Razorpay is stubbed, so this
// needs no network and no keys. The prices here are samples for the tests, not the owner's price.
//   node scripts/test-plan.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fill, main as fillMain, planErrors, slotValues, SLOTS } from "./fill-plan.mjs";
import { compare, main as checkMain } from "./check-plan.mjs";
import { check, finish } from "./test-helpers.mjs";

const EMPTY = { paid: false, currency: "INR", monthly: null, yearly: null, gst: null, trialDays: null, refund: null, refundDays: null, methods: null, contact: "a@example.com" };
const SAMPLE = { ...EMPTY, monthly: 2999, gst: "GST included", trialDays: 0, refund: "No refunds <for> part months.", refundDays: 7, methods: ["cards", "UPI AutoPay"] };
const PAID = { ...SAMPLE, paid: true };

// plan.json as committed
const committed = JSON.parse(readFileSync(new URL("../plan.json", import.meta.url), "utf8"));
check(planErrors(committed).length === 0 && committed.paid === false, "the committed plan.json is valid and paid is false");

// planErrors
check(planErrors(EMPTY).length === 0 && planErrors(SAMPLE).length === 0 && planErrors(PAID).length === 0, "empty, sample and paid sample plans are valid");
check(planErrors({ ...EMPTY, paid: true }).some((e) => /monthly is null/.test(e)), "paid: true with monthly: null is refused");
check(planErrors({ ...SAMPLE, monthly: 299.5 }).length === 1 && planErrors({ ...SAMPLE, monthly: 0 }).length === 1, "monthly must be whole rupees above 0");
check(planErrors({ ...SAMPLE, yearly: 2999 }).some((e) => /yearly/.test(e)), "a yearly price is refused until a yearly plan is built");
check(planErrors({ ...SAMPLE, currency: "USD" }).length === 1 && planErrors({ ...SAMPLE, paid: "no" }).length === 1, "currency must be INR and paid a boolean");
check(planErrors({ ...SAMPLE, methods: [] }).length === 1 && planErrors({ ...SAMPLE, gst: " " }).length === 1 && planErrors({ ...SAMPLE, trialDays: -1 }).length === 1, "empty methods, blank text and negative days are refused");

// slot values
const v = slotValues(SAMPLE);
check(v.PRO_PRICE === "₹2,999 a month" && v.PRO_PRICE_SHORT === "₹2,999" && slotValues({ ...SAMPLE, monthly: 150000 }).PRO_PRICE_SHORT === "₹1,50,000", "the price is in rupees with Indian grouping, and says 'a month'");
check(v.PRO_METHODS === "cards and UPI AutoPay" && slotValues({ ...SAMPLE, methods: ["a", "b", "c"] }).PRO_METHODS === "a, b and c" && slotValues({ ...SAMPLE, methods: ["cards"] }).PRO_METHODS === "cards", "payment methods read as a list in words");
check(v.PRO_TRIAL === "No free trial." && slotValues({ ...SAMPLE, trialDays: 7 }).PRO_TRIAL === "A 7-day free trial." && v.PRO_REFUND_DAYS === "7", "trial and refund days");
check(SLOTS.every((s) => s in v) && Object.keys(v).length === SLOTS.length && SLOTS.every((s) => slotValues(EMPTY)[s] === null || s === "PRO_CONTACT"), "every slot has a value from the plan, and null while the plan is empty");

// fill: the paid and free-test blocks
const page = 'A<template data-when="paid">P {{PRO_PRICE}}</template>B<!-- when:free-test -->F<!-- /when -->C';
check(fill(page, EMPTY).out === "ABFC" && fill(page, EMPTY).missing.length === 0, "paid: false drops the paid block, keeps the free-test text, and needs no price");
check(fill(page, SAMPLE).out === "ABFC", "paid: false with a price set still shows the free-test text");
check(fill(page, PAID).out === "AP ₹2,999 a monthBC", "paid: true unwraps the paid block and drops the free-test text");
const multi = '<template data-when="paid">1</template>x<template data-when="paid">2</template><!-- when:free-test -->a<!-- /when -->y<!-- when:free-test -->b<!-- /when -->';
check(fill(multi, PAID).out === "1x2y" && fill(multi, EMPTY).out === "xayb", "several blocks on a page are each switched, not merged");
check(fill("{{PRO_REFUND}}", SAMPLE).out === "No refunds &lt;for&gt; part months.", "values are HTML-escaped");
check(fill("{{LEGAL_NAME}} {{PRO_PRICE}}", SAMPLE).out === "{{LEGAL_NAME}} ₹2,999 a month", "{{LEGAL_…}} slots are left for fill-legal");
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
  check(r.code === 0 && r.read("pricing/index.html") === "₹2,999 a month" && /free test/.test(r.out), "the CLI passes once the plan has the values");
  r = run({ ...EMPTY, paid: true }, { "index.html": "x" });
  check(r.code === 1 && /monthly is null/.test(r.err), "the CLI refuses paid: true with no price");
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

// check-plan, with Razorpay stubbed
{
  const dir = mkdtempSync(join(tmpdir(), "check-plan-"));
  const planFile = join(dir, "plan.json");
  writeFileSync(planFile, JSON.stringify(SAMPLE));
  const ENV = { RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "sekrit-value", RAZORPAY_PLAN_ID: "plan_ABC123" };
  const RZP = { id: "plan_ABC123", entity: "plan", interval: 1, period: "monthly", item: { amount: 299900, currency: "INR" } };
  const run = async ({ env = ENV, reply = { status: 200, body: RZP }, argv = [], file = planFile } = {}) => {
    const calls = [], out = [], err = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      if (reply === "throw") throw Object.assign(new Error("x"), { name: "TimeoutError" });
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
    };
    const code = await checkMain(argv, { env, fetchFn, planFile: file, log: (s) => out.push(s), error: (s) => err.push(s) });
    return { code, calls, text: out.concat(err).join("\n") };
  };
  let r = await run();
  check(r.code === 0 && /match \(test plan, ₹2,999 every month\)/.test(r.text) && r.calls.length === 1 && r.calls[0].url === "https://api.razorpay.com/v1/plans/plan_ABC123", "check-plan: a matching plan prints match, after one GET of the plan");
  check(r.calls[0].init.headers.authorization === "Basic " + Buffer.from("rzp_test_abc:sekrit-value").toString("base64") && !/sekrit|rzp_test_abc/.test(r.text), "check-plan: Basic auth with the keys, and neither key is printed");
  r = await run({ reply: { status: 200, body: { ...RZP, item: { amount: 29900, currency: "INR" } } } });
  check(r.code === 1 && /amount: Razorpay 29900 paise, plan\.json 299900 paise/.test(r.text), "check-plan: a different amount is reported");
  r = await run({ reply: { status: 200, body: { ...RZP, period: "yearly" } } });
  check(r.code === 1 && /period/.test(r.text) && !/amount/.test(r.text), "check-plan: a different period is reported");
  check(compare({ ...RZP, interval: 3 }, SAMPLE).length === 1 && compare({ ...RZP, item: { amount: 299900, currency: "USD" } }, SAMPLE)[0].startsWith("currency"), "check-plan: interval and currency are compared too");
  r = await run({ reply: { status: 404, body: {} } });
  check(r.code === 1 && /404 \(no plan with that id/.test(r.text), "check-plan: plan not found");
  r = await run({ reply: "throw" });
  check(r.code === 1 && /didn't answer/.test(r.text), "check-plan: no answer is reported, not thrown");
  r = await run({ env: { ...ENV, RAZORPAY_KEY_SECRET: "" } });
  check(r.code === 2 && r.calls.length === 0 && /RAZORPAY_KEY_SECRET/.test(r.text), "check-plan: a missing key refuses before any call");
  r = await run({ env: { ...ENV, RAZORPAY_PLAN_ID: "sub_X" } });
  check(r.code === 2 && r.calls.length === 0, "check-plan: a plan id that isn't plan_… refuses before any call");
  writeFileSync(join(dir, "empty.json"), JSON.stringify(EMPTY));
  r = await run({ file: join(dir, "empty.json") });
  check(r.code === 2 && r.calls.length === 0 && /no monthly price/.test(r.text), "check-plan: no price in plan.json refuses before any call");
  r = await run({ argv: ["extra"] });
  check(r.code === 2 && r.calls.length === 0, "check-plan: arguments are refused (keys come from the shell)");
  rmSync(dir, { recursive: true, force: true });
}

finish("plan tests");
