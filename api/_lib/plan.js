// Pro's price, from plan.json, the one place it lives (T24, T33). The pages get it filled in at build time
// (scripts/fill-plan.mjs); the account endpoint, checkout and the webhook read it here, so they can't disagree.
//
// There is one Pro plan (the owner's choice, 2026-10-26). A member chooses their categories and emails a day freely;
// neither changes the price. Only the billing period does: plan.json's `monthly` (1 month) and `yearly` (12 months),
// each whole rupees for the whole period, or null when that period isn't on sale.
//
// Razorpay charges it with one plan per period whose amount is ₹1, and the subscription's quantity set to the price
// (RAZORPAY_PLANS maps months to those plan ids). So a new price never needs a new Razorpay plan.
import plan from "../../plan.json" with { type: "json" };

export const PLAN = plan;
// Months in each period, and plan.json's key for its price.
export const PERIOD_KEYS = { 1: "monthly", 12: "yearly" };

const wholeRupees = (n) => Number.isInteger(n) && n > 0;

// What's wrong with the prices, as a list of sentences. Empty means they're usable.
export function priceErrors(p) {
  const errs = [];
  for (const k of Object.values(PERIOD_KEYS)) if (p[k] !== null && p[k] !== undefined && !wholeRupees(p[k])) errs.push(`${k} must be null or whole rupees above 0`);
  return errs;
}

// The periods on sale, in months, shortest first.
export function periodsOf(p = plan) {
  return p && !priceErrors(p).length ? Object.keys(PERIOD_KEYS).map(Number).filter((m) => wholeRupees(p[PERIOD_KEYS[m]])) : [];
}

// The price in whole rupees for a period of `months`, or null if that period isn't on sale.
export function priceOf(months, p = plan) {
  return periodsOf(p).includes(months) ? p[PERIOD_KEYS[months]] : null;
}

// RAZORPAY_PLANS: {"1":"plan_…","12":"plan_…"}, one ₹1 plan per period. Only well-formed ids for periods on sale.
const PLAN_ID = /^plan_[A-Za-z0-9]{1,40}$/;
export function razorpayPlans(env, p = plan) {
  let raw;
  try { raw = JSON.parse(String(env.RAZORPAY_PLANS || "").trim() || "{}"); } catch (e) { return {}; }
  const out = {};
  for (const m of periodsOf(p)) if (raw && typeof raw[String(m)] === "string" && PLAN_ID.test(raw[String(m)])) out[m] = raw[String(m)];
  return out;
}

// The prices the manage page shows, keyed by months, so the page never holds a price of its own.
export function priceTable(p = plan) {
  return Object.fromEntries(periodsOf(p).map((m) => [String(m), priceOf(m, p)]));
}
