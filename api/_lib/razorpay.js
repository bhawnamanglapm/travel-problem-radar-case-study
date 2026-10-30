// Razorpay for paid Pro (docs/subscriptions/tasks/T19): the three Subscriptions API calls and the
// two signature checks, without Razorpay's SDK. Checked against Razorpay's docs on 2026-10-23; the
// links are in the task file. Calls use Basic auth with the key id and key secret and never throw:
// they return a few chosen fields or { error }, never the reply itself, a secret or an address.
// Nothing here logs.
import { createHmac, timingSafeEqual } from "node:crypto";
import { razorpayPlans } from "./plan.js";

export const RAZORPAY_API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 10_000;
const SUB_ID = /^sub_[A-Za-z0-9]+$/;
const PLAN_ID = /^plan_[A-Za-z0-9]+$/;
const SID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

const val = (env, name) => String(env[name] || "").trim();

// Everything checkout, cancel and the webhook need: the keys, the webhook secret, and RAZORPAY_PLANS with a ₹1
// plan for at least one billing period on sale (T33). The API calls themselves need only the two keys.
export const razorpayConfigured = (env) =>
  ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].every((n) => val(env, n)) && Object.keys(razorpayPlans(env)).length > 0;

// Test-mode key ids begin rzp_test_, live ones rzp_live_.
export const isTestKey = (env) => val(env, "RAZORPAY_KEY_ID").startsWith("rzp_test_");

// T22: Production takes live keys only, and Preview and Development test keys only. Outside Vercel (VERCEL_ENV
// unset: tests and the owner's scripts) there is no rule, and with no key there is nothing to mix up.
export function keyMismatch(env) {
  const where = val(env, "VERCEL_ENV");
  if (!where || !val(env, "RAZORPAY_KEY_ID")) return false;
  return where === "production" ? isTestKey(env) : !isTestKey(env);
}

// A lowercase hex HMAC-SHA256 sent by Razorpay, compared in constant time with the one we work out.
function hexMacOk(message, signature, secret) {
  if (!secret || typeof signature !== "string" || !HEX_SHA256.test(signature)) return false;
  const want = createHmac("sha256", secret).update(message).digest();
  const got = Buffer.from(signature, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// The X-Razorpay-Signature header: the HMAC of the raw body bytes with the webhook secret. Pass the
// body exactly as it arrived (a Buffer or the unparsed string), never re-serialised JSON.
export function verifyWebhook(rawBody, signatureHeader, secret) {
  if (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody)) return false;
  return hexMacOk(rawBody, signatureHeader, secret);
}

// Checkout's razorpay_signature: the HMAC of `payment id|subscription id` with the key secret.
// `subscriptionId` must be the one saved on our record, not the one Checkout sends back.
export function verifyCheckout({ paymentId, subscriptionId, signature } = {}, keySecret) {
  if (typeof paymentId !== "string" || !paymentId || typeof subscriptionId !== "string" || !subscriptionId) return false;
  return hexMacOk(`${paymentId}|${subscriptionId}`, signature, keySecret);
}

// One API call. Returns the parsed reply or { error }: the HTTP status, "network", "timeout",
// "reply" (a 2xx that isn't a subscription) or "config".
async function call(env, fetchFn, method, path, body) {
  const keyId = val(env, "RAZORPAY_KEY_ID");
  const keySecret = val(env, "RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return { error: "config" };
  let r;
  try {
    r = await fetchFn(RAZORPAY_API + path, {
      method,
      headers: {
        authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { error: e && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network" };
  }
  try {
    if (!r || !r.ok) return { error: Number(r && r.status) || "network" };
    const data = await r.json();
    return data && typeof data === "object" && typeof data.id === "string" && SUB_ID.test(data.id) ? { data } : { error: "reply" };
  } catch (e) { return { error: "reply" }; }
}

// A new subscription for one subscriber. `totalCount` is how many billing cycles it runs for
// (Razorpay requires it); `quantity` is how many times the ₹1 plan is charged each cycle, i.e. the price in
// rupees (T33; **verify** Razorpay's quantity limit at build time). The subscriber id goes in notes so the webhook
// can find the record, with the plan chosen (`extraNotes`, short strings only); no address is sent.
// `startAt` (seconds) starts the first charge later, for a plan that renews after a running one (T34).
// Returns { id, status, shortUrl } (shortUrl: Razorpay's payment page) or { error }.
export async function createSubscription({ env, fetchFn, planId, subscriberId, totalCount, quantity = 1, extraNotes = {}, startAt = null, customerNotify = true }) {
  if (!PLAN_ID.test(String(planId)) || !SID.test(String(subscriberId)) || !Number.isInteger(totalCount) || totalCount < 1) return { error: "input" };
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "input" };
  if (startAt !== null && !(Number.isInteger(startAt) && startAt > 0)) return { error: "input" };
  const notes = { sid: subscriberId };
  for (const [k, v] of Object.entries(extraNotes)) if (/^[a-z]{1,20}$/.test(k) && typeof v === "string" && v.length <= 100) notes[k] = v;
  const r = await call(env, fetchFn, "POST", "/subscriptions", {
    plan_id: planId, total_count: totalCount, quantity, customer_notify: Boolean(customerNotify), notes,
    ...(startAt ? { start_at: startAt } : {}),
  });
  if (r.error) return r;
  return { id: r.data.id, status: String(r.data.status || ""), shortUrl: typeof r.data.short_url === "string" ? r.data.short_url : "" };
}

// Cancels now, or at the end of the current billing cycle with `atCycleEnd`. Returns { id, status } or { error }.
export async function cancelSubscription({ env, fetchFn, subscriptionId, atCycleEnd = false }) {
  if (!SUB_ID.test(String(subscriptionId))) return { error: "input" };
  const r = await call(env, fetchFn, "POST", `/subscriptions/${subscriptionId}/cancel`, { cancel_at_cycle_end: Boolean(atCycleEnd) });
  if (r.error) return r;
  return { id: r.data.id, status: String(r.data.status || "") };
}

// The subscription's state, for the admin script and for checking a webhook that looks wrong.
// Only these fields come back; the reply's customer details are dropped.
export async function fetchSubscription({ env, fetchFn, subscriptionId }) {
  if (!SUB_ID.test(String(subscriptionId))) return { error: "input" };
  const r = await call(env, fetchFn, "GET", `/subscriptions/${subscriptionId}`);
  if (r.error) return r;
  const d = r.data;
  const num = (v) => (typeof v === "number" ? v : null);
  return {
    id: d.id,
    status: String(d.status || ""),
    planId: typeof d.plan_id === "string" ? d.plan_id : "",
    sid: d.notes && typeof d.notes.sid === "string" ? d.notes.sid : "",
    currentStart: num(d.current_start),
    currentEnd: num(d.current_end),
    chargeAt: num(d.charge_at),
    endedAt: num(d.ended_at),
    paidCount: num(d.paid_count),
    remainingCount: num(d.remaining_count),
    totalCount: num(d.total_count),
  };
}
