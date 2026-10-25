// Pro's price, from plan.json, the one place it lives (T24, T33). The pages get it filled in at build time
// (scripts/fill-plan.mjs); the account endpoint, checkout and the webhook read it here, so they can't disagree.
//
// A Pro plan is a choice of categories (how many, 1 to 4), emails a day (1 to 5) and a billing period (months).
// Its price, in whole rupees for the whole period:
//   (pricing.byCategories[number of categories] + pricing.perExtraEmail × (emails a day − 1)) × pricing.periods[months]
// periods[months] is how many months the period charges for, so a longer period can cost less per month.
//
// Razorpay charges it with one plan per period whose amount is ₹1, and the subscription's quantity set to the price
// (RAZORPAY_PLANS maps months to those plan ids). So a new price never needs a new Razorpay plan.
import plan from "../../plan.json" with { type: "json" };

export const PLAN = plan;
const CAT_COUNTS = [1, 2, 3, 4];

const wholeRupees = (n) => Number.isInteger(n) && n > 0;

// What's wrong with the pricing block, as a list of sentences. Empty means it's usable.
export function pricingErrors(p) {
  const errs = [];
  if (!p || typeof p !== "object") return ["pricing must be an object"];
  const by = p.byCategories || {};
  for (const n of CAT_COUNTS) if (!wholeRupees(by[String(n)])) errs.push(`pricing.byCategories["${n}"] must be whole rupees above 0`);
  if (!(Number.isInteger(p.perExtraEmail) && p.perExtraEmail >= 0)) errs.push("pricing.perExtraEmail must be whole rupees, 0 or more");
  const periods = p.periods && typeof p.periods === "object" ? Object.entries(p.periods) : [];
  if (!periods.length) errs.push("pricing.periods must list at least one period");
  for (const [m, charged] of periods) {
    if (!/^(1|3|6|12)$/.test(m)) errs.push(`pricing.periods: ${m} isn't one of 1, 3, 6 or 12 months`);
    if (!(typeof charged === "number" && charged > 0 && charged <= Number(m))) errs.push(`pricing.periods["${m}"] must be the months charged, above 0 and at most ${m}`);
  }
  return errs;
}

// The periods on sale, in months, shortest first.
export function periodsOf(p = plan.pricing) {
  return p && p.periods ? Object.keys(p.periods).map(Number).sort((a, b) => a - b) : [];
}

// The price in whole rupees for a choice, or null if the choice isn't on sale. `catCount` is 1 to 4 (all four
// is 4), `perDay` 1 to 5, `months` one of the periods.
export function priceOf({ catCount, perDay, months }, p = plan.pricing) {
  if (!p || pricingErrors(p).length) return null;
  const base = p.byCategories[String(catCount)];
  const charged = p.periods[String(months)];
  if (!wholeRupees(base) || !charged || !(Number.isInteger(perDay) && perDay >= 1 && perDay <= 5)) return null;
  return Math.max(1, Math.round((base + p.perExtraEmail * (perDay - 1)) * charged));
}

// RAZORPAY_PLANS: {"1":"plan_…","3":"plan_…",…}, one ₹1 plan per period. Only well-formed ids for periods on sale.
const PLAN_ID = /^plan_[A-Za-z0-9]{1,40}$/;
export function razorpayPlans(env, p = plan.pricing) {
  let raw;
  try { raw = JSON.parse(String(env.RAZORPAY_PLANS || "").trim() || "{}"); } catch (e) { return {}; }
  const out = {};
  for (const m of periodsOf(p)) if (raw && typeof raw[String(m)] === "string" && PLAN_ID.test(raw[String(m)])) out[m] = raw[String(m)];
  return out;
}

// The periods a member can pay for now: on sale and with a Razorpay plan. Each with its price for `choice`.
export function offers(env, { catCount = 4, perDay = 1 } = {}, p = plan.pricing) {
  const plans = razorpayPlans(env, p);
  return periodsOf(p).filter((m) => plans[m]).map((m) => ({ months: m, price: priceOf({ catCount, perDay, months: m }, p) }));
}

// The table the manage page builds its prices from, so the page never holds a price of its own.
export function priceTable(p = plan.pricing) {
  return p ? { byCategories: p.byCategories, perExtraEmail: p.perExtraEmail, periods: p.periods } : null;
}
