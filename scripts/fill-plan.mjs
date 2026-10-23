// Fills Pro's price, GST line, refund rule and the rest into the built pages from plan.json, the one
// place those facts live (T24). Run by vercel.json's buildCommand before fill-legal:
//   node scripts/fill-plan.mjs public
// Two kinds of block switch with plan.json's "paid":
//   <template data-when="paid">…</template>        unwrapped when paid is true, removed when false
//   <!-- when:free-test -->…<!-- /when -->          kept (markers dropped) when false, removed when true
// A <template> never renders, so the raw file (GitHub Pages serves index.html as it is) shows today's text.
// Fails the build if a page still uses a {{PRO_…}} slot whose value is null, so no page goes live half-filled.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SLOTS = ["PRO_PRICE", "PRO_PRICE_SHORT", "PRO_GST", "PRO_REFUND", "PRO_REFUND_DAYS", "PRO_METHODS", "PRO_TRIAL", "PRO_CONTACT"];
export const PLAN_FILE = fileURLToPath(new URL("../plan.json", import.meta.url));

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rupees = (n) => "₹" + n.toLocaleString("en-IN");
const words = (list) => (list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]);
const text = (v) => typeof v === "string" && v.trim() !== "";
const count = (v) => Number.isInteger(v) && v >= 0;

// What's wrong with plan.json, as a list of sentences. Empty means it's usable.
export function planErrors(plan) {
  const errs = [];
  if (!plan || typeof plan !== "object") return ["plan.json is not an object"];
  if (typeof plan.paid !== "boolean") errs.push("paid must be true or false");
  if (plan.currency !== "INR") errs.push('currency must be "INR" (the only one the pages are written for)');
  if (plan.monthly !== null && !(Number.isInteger(plan.monthly) && plan.monthly > 0)) errs.push("monthly must be null or whole rupees above 0");
  if (plan.yearly !== null) errs.push("yearly must be null: a yearly plan isn't built yet (owner input 8)");
  for (const k of ["gst", "refund", "contact"]) if (plan[k] !== null && !text(plan[k])) errs.push(`${k} must be null or text`);
  for (const k of ["trialDays", "refundDays"]) if (plan[k] !== null && !count(plan[k])) errs.push(`${k} must be null or a whole number of days`);
  if (plan.methods !== null && !(Array.isArray(plan.methods) && plan.methods.length && plan.methods.every(text))) errs.push("methods must be null or a list of payment methods");
  if (plan.paid === true && plan.monthly === null) errs.push("paid is true but monthly is null: there's no price to show");
  return errs;
}

// Each slot's text, or null while plan.json has no value for it.
export function slotValues(plan) {
  const has = (v) => v !== null && v !== undefined;
  return {
    PRO_PRICE: has(plan.monthly) ? rupees(plan.monthly) + " a month" : null,
    PRO_PRICE_SHORT: has(plan.monthly) ? rupees(plan.monthly) : null,
    PRO_GST: has(plan.gst) ? plan.gst.trim() : null,
    PRO_REFUND: has(plan.refund) ? plan.refund.trim() : null,
    PRO_REFUND_DAYS: has(plan.refundDays) ? String(plan.refundDays) : null,
    PRO_METHODS: has(plan.methods) ? words(plan.methods.map((m) => m.trim())) : null,
    PRO_TRIAL: has(plan.trialDays) ? (plan.trialDays === 0 ? "No free trial." : `A ${plan.trialDays}-day free trial.`) : null,
    PRO_CONTACT: has(plan.contact) ? plan.contact.trim() : null,
  };
}

// Returns the filled text and the slots it couldn't fill (null value, or a name that isn't a slot).
// Only {{PRO_…}} slots are touched; {{LEGAL_…}} ones are left for fill-legal.
export function fill(text, plan) {
  const blocks = text
    .replace(/<template data-when="paid">([\s\S]*?)<\/template>/g, (m, inner) => (plan.paid ? inner : ""))
    .replace(/<!-- when:free-test -->([\s\S]*?)<!-- \/when -->/g, (m, inner) => (plan.paid ? "" : inner));
  const values = slotValues(plan);
  const missing = new Set();
  const out = blocks.replace(/\{\{(PRO_[A-Z_]+)\}\}/g, (m, name) => {
    const v = SLOTS.includes(name) ? values[name] : null;
    if (v === null) { missing.add(name); return m; }
    return escapeHtml(v);
  });
  if (/data-when=|<!-- \/?when/.test(out)) missing.add("an unclosed when block");
  return { out, missing: [...missing] };
}

const htmlFiles = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? htmlFiles(p) : n.endsWith(".html") ? [p] : [];
});

// The command line, with its inputs passed in so the tests can run it on a temporary folder.
export function main(argv, { planFile = PLAN_FILE, log = console.log, error = console.error } = {}) {
  const root = argv[0] || "public";
  if (!existsSync(root)) { error(`fill-plan: no ${root}/ folder`); return 1; }
  let plan;
  try { plan = JSON.parse(readFileSync(planFile, "utf8")); } catch (e) { error(`fill-plan: can't read plan.json (${e.message})`); return 1; }
  const errs = planErrors(plan);
  if (errs.length) { error(`fill-plan: plan.json: ${errs.join("; ")}`); return 1; }
  const problems = [];
  for (const f of htmlFiles(root)) {
    const before = readFileSync(f, "utf8");
    const { out, missing } = fill(before, plan);
    if (out !== before) writeFileSync(f, out);
    if (missing.length) problems.push(`${f}: ${missing.join(", ")}`);
  }
  if (problems.length) { error(`fill-plan: plan.json has no value for (${problems.join("; ")})`); return 1; }
  log(`fill-plan: pages filled (${plan.paid ? "paid" : "free test"})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
