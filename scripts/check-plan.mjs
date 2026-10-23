// Compares the Razorpay Plan with plan.json, so the price on the pages is the price Razorpay charges (T24, T27).
// Run by the owner before go-live and after any price change, with the keys in the shell, never in a file:
//   RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_PLAN_ID=plan_… node scripts/check-plan.mjs
// Prints "match" or what differs. Prints no key. Exit 0 match, 1 differs or the call failed, 2 not set up.
// GET /v1/plans/:id returns period, interval, item.amount and item.currency (Razorpay's "Fetch a Plan With ID"
// docs, read 2026-10-23). That page doesn't state the unit; its sample (69900 INR) and Razorpay's other APIs use
// paise. Verify the unit at go-live: a mismatch here shows as "amount" differing by 100 times.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RAZORPAY_API } from "../api/_lib/razorpay.js";
import { PLAN_FILE, planErrors } from "./fill-plan.mjs";

const val = (env, name) => String(env[name] || "").trim();

// What differs between the Razorpay Plan reply and plan.json; empty means they match.
export function compare(rzp, plan) {
  const diffs = [];
  const amount = rzp && rzp.item ? rzp.item.amount : undefined;
  const currency = rzp && rzp.item ? rzp.item.currency : undefined;
  if (amount !== plan.monthly * 100) diffs.push(`amount: Razorpay ${amount} paise, plan.json ${plan.monthly * 100} paise (₹${plan.monthly})`);
  if (currency !== plan.currency) diffs.push(`currency: Razorpay ${currency}, plan.json ${plan.currency}`);
  if (!rzp || rzp.period !== "monthly" || rzp.interval !== 1) diffs.push(`period: Razorpay every ${rzp && rzp.interval} ${rzp && rzp.period}, plan.json every 1 monthly`);
  return diffs;
}

export async function main(argv, { env = process.env, fetchFn = fetch, log = console.log, error = console.error, planFile = PLAN_FILE } = {}) {
  if (argv.length) { error("usage: node scripts/check-plan.mjs   (keys and plan id from the shell)"); return 2; }
  const unset = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_PLAN_ID"].filter((n) => !val(env, n));
  if (unset.length) { error(`check-plan: set ${unset.join(", ")} in the shell first`); return 2; }
  const planId = val(env, "RAZORPAY_PLAN_ID");
  if (!/^plan_[A-Za-z0-9]+$/.test(planId)) { error("check-plan: RAZORPAY_PLAN_ID should look like plan_…"); return 2; }
  let plan;
  try { plan = JSON.parse(readFileSync(planFile, "utf8")); } catch (e) { error(`check-plan: can't read plan.json (${e.message})`); return 2; }
  const errs = planErrors(plan);
  if (errs.length) { error(`check-plan: plan.json: ${errs.join("; ")}`); return 2; }
  if (plan.monthly === null) { error("check-plan: plan.json has no monthly price yet"); return 2; }

  let r;
  try {
    r = await fetchFn(`${RAZORPAY_API}/plans/${planId}`, {
      headers: { authorization: "Basic " + Buffer.from(`${val(env, "RAZORPAY_KEY_ID")}:${val(env, "RAZORPAY_KEY_SECRET")}`).toString("base64") },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) { error(`check-plan: Razorpay didn't answer (${e.name})`); return 1; }
  if (!r.ok) { error(`check-plan: Razorpay said ${r.status}${r.status === 404 ? " (no plan with that id for these keys)" : r.status === 401 ? " (keys not accepted)" : ""}`); return 1; }
  let body;
  try { body = await r.json(); } catch (e) { error("check-plan: Razorpay's reply wasn't JSON"); return 1; }
  const diffs = compare(body, plan);
  const mode = val(env, "RAZORPAY_KEY_ID").startsWith("rzp_live_") ? "live" : "test";
  if (diffs.length) { error(`check-plan: ${mode} plan differs from plan.json:\n  ${diffs.join("\n  ")}`); return 1; }
  log(`check-plan: match (${mode} plan, ₹${plan.monthly.toLocaleString("en-IN")} every month)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(await main(process.argv.slice(2)));
