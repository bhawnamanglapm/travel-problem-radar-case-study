// Checks the Razorpay plans against plan.json, so what the pages say is what Razorpay charges (T24, T27, T33).
// Pro is charged with one plan per billing period whose amount is ₹1; the subscription's quantity is the price
// (api/_lib/plan.js). So each plan must be ₹1, INR, and repeat every `months` months.
// Run by the owner with the keys in the shell, never in a file:
//   RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_PLANS='{"1":"plan_…",…}' node scripts/check-plan.mjs
//   RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… node scripts/check-plan.mjs --create
// --create makes the ₹1 plan for every period that has none yet, then prints the RAZORPAY_PLANS value to set in
// Vercel (test keys make test plans, for the staging Preview; live keys live ones, for Production).
// Prints no key. Exit 0 match, 1 differs or a call failed, 2 not set up.
// GET /v1/plans/:id returns period, interval, item.amount and item.currency (Razorpay's "Fetch a Plan With ID"
// docs, read 2026-10-23); amounts are in paise. **Verify** at build time that a plan can repeat every 3 or 6
// months (monthly, interval 3 or 6); 12 months is made as yearly, interval 1.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RAZORPAY_API } from "../api/_lib/razorpay.js";
import { periodsOf } from "../api/_lib/plan.js";
import { PLAN_FILE, planErrors } from "./fill-plan.mjs";

const val = (env, name) => String(env[name] || "").trim();
export const UNIT_PAISE = 100;
// How Razorpay should repeat a period of `months`.
export const cycleOf = (months) => (months === 12 ? { period: "yearly", interval: 1 } : { period: "monthly", interval: months });

// What differs between a Razorpay plan reply and the ₹1 plan for `months`; empty means they match.
export function compare(rzp, months, plan) {
  const diffs = [];
  const amount = rzp && rzp.item ? rzp.item.amount : undefined;
  const currency = rzp && rzp.item ? rzp.item.currency : undefined;
  const want = cycleOf(months);
  const sameCycle = rzp && ((rzp.period === want.period && rzp.interval === want.interval) || (rzp.period === "monthly" && rzp.interval === months));
  if (amount !== UNIT_PAISE) diffs.push(`${months} months: amount: Razorpay ${amount} paise, should be ${UNIT_PAISE} paise (₹1; the price is the quantity)`);
  if (currency !== plan.currency) diffs.push(`${months} months: currency: Razorpay ${currency}, plan.json ${plan.currency}`);
  if (!sameCycle) diffs.push(`${months} months: period: Razorpay every ${rzp && rzp.interval} ${rzp && rzp.period}, should be every ${want.interval} ${want.period}`);
  return diffs;
}

export async function main(argv, { env = process.env, fetchFn = fetch, log = console.log, error = console.error, planFile = PLAN_FILE } = {}) {
  const create = argv.length === 1 && argv[0] === "--create";
  if (argv.length && !create) { error("usage: node scripts/check-plan.mjs [--create]   (keys and RAZORPAY_PLANS from the shell)"); return 2; }
  const unset = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"].filter((n) => !val(env, n));
  if (unset.length) { error(`check-plan: set ${unset.join(", ")} in the shell first`); return 2; }
  let plan;
  try { plan = JSON.parse(readFileSync(planFile, "utf8")); } catch (e) { error(`check-plan: can't read plan.json (${e.message})`); return 2; }
  const errs = planErrors(plan);
  if (errs.length) { error(`check-plan: plan.json: ${errs.join("; ")}`); return 2; }
  if (!plan.pricing) { error("check-plan: plan.json has no pricing yet"); return 2; }
  let ids = {};
  try { ids = JSON.parse(val(env, "RAZORPAY_PLANS") || "{}"); } catch (e) { error("check-plan: RAZORPAY_PLANS isn't JSON"); return 2; }
  const periods = periodsOf(plan.pricing);
  const bad = periods.filter((m) => ids[m] !== undefined && !/^plan_[A-Za-z0-9]+$/.test(String(ids[m])));
  if (bad.length) { error(`check-plan: RAZORPAY_PLANS: the plan for ${bad.join(", ")} months should look like plan_…`); return 2; }
  const missing = periods.filter((m) => !ids[m]);
  if (missing.length && !create) { error(`check-plan: no plan for ${missing.join(", ")} months; run with --create to make them`); return 2; }

  const auth = { authorization: "Basic " + Buffer.from(`${val(env, "RAZORPAY_KEY_ID")}:${val(env, "RAZORPAY_KEY_SECRET")}`).toString("base64") };
  const mode = val(env, "RAZORPAY_KEY_ID").startsWith("rzp_live_") ? "live" : "test";
  const ask = async (method, path, body) => {
    let r;
    try {
      r = await fetchFn(`${RAZORPAY_API}${path}`, {
        method, headers: body ? { ...auth, "content-type": "application/json" } : auth,
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
      });
    } catch (e) { return { err: `Razorpay didn't answer (${e.name})` }; }
    if (!r.ok) return { err: `Razorpay said ${r.status}${r.status === 404 ? " (no plan with that id for these keys)" : r.status === 401 ? " (keys not accepted)" : ""}` };
    try { return { body: await r.json() }; } catch (e) { return { err: "Razorpay's reply wasn't JSON" }; }
  };

  if (create) {
    for (const m of missing) {
      const { period, interval } = cycleOf(m);
      const r = await ask("POST", "/plans", { period, interval, item: { name: `Travel Problem Radar Pro, ${m === 1 ? "1 month" : m + " months"}`, amount: UNIT_PAISE, currency: plan.currency } });
      if (r.err || !r.body || !/^plan_[A-Za-z0-9]+$/.test(String(r.body.id))) { error(`check-plan: creating the ${m}-month plan failed: ${r.err || "no plan id in the reply"}`); return 1; }
      ids[m] = r.body.id;
      log(`check-plan: created the ${mode} ${m}-month plan`);
    }
  }
  const diffs = [];
  for (const m of periods) {
    const r = await ask("GET", `/plans/${ids[m]}`);
    if (r.err) { error(`check-plan: ${m} months: ${r.err}`); return 1; }
    diffs.push(...compare(r.body, m, plan));
  }
  const value = JSON.stringify(Object.fromEntries(periods.map((m) => [String(m), ids[m]])));
  if (diffs.length) { error(`check-plan: ${mode} plans differ:\n  ${diffs.join("\n  ")}`); return 1; }
  log(`check-plan: match (${mode} plans, ₹1 each, for ${periods.join(", ")} months)`);
  if (create) log(`Set this in Vercel as RAZORPAY_PLANS (${mode === "test" ? "Preview, branch staging" : "Production"}):\n${value}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
