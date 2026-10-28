// HTTP handlers for the subscriber endpoints (docs/subscriptions/tasks/T05 to T07), built from
// injected dependencies like handlers.js, so the offline tests can call them directly.
// Nothing here puts an address, an id or a token in a reply or a log line.
import { createHash, createHmac, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_FROM, buildAlreadySubscribedEmail, buildConfirmEmail, buildProRequestEmail, buildSignInEmail, sendEmail, sendOne } from "./email.js";
import { BodyTooLargeError, allowMethods, esc, readFields, sendJson, sendPage } from "./http.js";
import { OAUTH_COOKIE, OAUTH_MINUTES, clearOAuthCookie, googleConfigured, googleFinish, googleStart, readOAuthCookie, readSignupCookie, signupCookie } from "./google.js";
import { cancelSubscription, createSubscription, fetchSubscription, razorpayConfigured, verifyCheckout, verifyWebhook } from "./razorpay.js";
import { DEFAULT_SWEEPS_PER_DAY, normaliseSweepsPerDay, sweepLimits, sweepsPerDayOf } from "./schedule.js";
import { periodsOf, priceOf, priceTable, razorpayPlans } from "./plan.js";
import { hashPassword, passwordProblem, storedHash, verifyPassword } from "./password.js";
import { clearCookie, originOk, parseCookies, readSession, sessionCookie, sessionSecret, signSession } from "./session.js";
import {
  CONFIRM_RESEND_MINUTES, KEY_RZPSUB_PREFIX, KEY_SUB_PREFIX, MAX_CONFIRMS_PER_ADDRESS, PENDING_TTL_DAYS, countEvents, deleteSubscriber, deleteSubscriberData, effectivePlan, findSubscriber, getSubscriber, newPending, normaliseCats, normaliseEmail, putSubscriber,
  recordEvent, tokenOk, updateSubscriber, utcDay,
} from "./subscribers.js";

// The sweep writes the number of active plus pending records here after each run (T10), so a
// sign-up reads one small file instead of listing every subscriber.
export const KEY_SUBSCRIBER_COUNT = "radar:subscriberCount";
export const DEFAULT_MAX_CONFIRMS_PER_DAY = 10;

// Per-IP sign-up attempts (T13 part B): one file per accepted attempt,
// radar:iphit:<YYYYMMDDHH>-<16 hex of a hash of the IP>-<6 hex>, counted with list. No raw IP is
// stored; the sweep deletes files older than IPHIT_KEEP_HOURS. The Vercel firewall rule in front
// (DEPLOYMENT.md) stops floods before they cost Blob operations; this gives the exact hourly limit.
export const KEY_IPHIT_PREFIX = "radar:iphit:";
export const DEFAULT_MAX_SIGNUPS_PER_IP_HOUR = 5;
export const IPHIT_KEEP_HOURS = 2;
export const utcHour = (now) => new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, ""); // YYYYMMDDHH

const OK_REPLY = { ok: true, message: "If that address can be subscribed, a confirmation link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder." };
// An address that is already subscribed is told so (the owner's choice, 2026-10-22, accepting that
// the reply shows whether an address subscribes). The inbox gets a notice with its manage link at
// most once every NOTICE_HOURS.
const ALREADY_EMAILED = { ok: true, already: true, message: "This address is already subscribed. We've emailed it a link to manage the subscription." };
const ALREADY = { ok: true, already: true, message: "This address is already subscribed. Use the Manage link in any digest email to change it." };
// Row 7 with sign-in set up (T16): the way back in is a sign-in link, so that is what goes.
const ALREADY_SIGNIN = { ok: true, already: true, message: "This address already has an account. We've emailed it a sign-in link. Not in your inbox within a few minutes? Check your spam or junk folder." };
const ALREADY_HELD = { ok: true, already: true, message: "This address already has an account. Sign in with a link from the sign-in page, or use the Manage link in any digest email." };
const PENDING_REPLY = { ok: true, message: "A confirmation link was sent to this address in the last 10 minutes. Check your inbox and spam or junk folder. Nothing there after 10 minutes? Ask again here." };
const PENDING_CAPPED = { ok: true, message: "A confirmation link was already sent to this address several times. Check your inbox and spam or junk folder for the newest one." };
export const NOTICE_HOURS = 24;
const HOUR_MS = 3600 * 1000;

// Whether a pending record may get its confirmation again: "wait" within CONFIRM_RESEND_MINUTES of
// the last one, "capped" after MAX_CONFIRMS_PER_ADDRESS, otherwise null. resent() is the record to store.
const confirmSends = (record) => (Number.isInteger(record.confirmSends) && record.confirmSends > 0 ? record.confirmSends : 1);
function confirmHeld(record, t) {
  if (t - Date.parse(record.confirmSentAt) < CONFIRM_RESEND_MINUTES * 60 * 1000) return "wait";
  return confirmSends(record) >= MAX_CONFIRMS_PER_ADDRESS ? "capped" : null;
}
const resent = (record, t) => ({ ...record, confirmSentAt: new Date(t).toISOString(), confirmSends: confirmSends(record) + 1 });

// Emails sign-up has sent today: confirmations and already-subscribed notices share MAX_CONFIRMS_PER_DAY.
async function signupEmailsToday(storage, t) {
  const day = utcDay(t);
  return (await countEvents(storage, { day, type: "confirmsent" })) + (await countEvents(storage, { day, type: "noticesent" }));
}

const positiveInt = (v) => {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

// Paid Pro (T20). Payments are on only with razorpay.js's four settings and RAZORPAY_TOTAL_COUNT,
// the number of billing cycles a subscription runs for (the owner's number). The index file
// radar:rzpsub:<subscription id> holds { id } so the webhook (T21) finds the record without listing.
// A checkout still in "created" is reused for CHECKOUT_REUSE_MINUTES instead of making another.
export { KEY_RZPSUB_PREFIX };
export const CHECKOUT_REUSE_MINUTES = 60;
const totalCount = (env) => positiveInt(env.RAZORPAY_TOTAL_COUNT);
export const paymentsReady = (env) => razorpayConfigured(env) && totalCount(env) !== null;
// Why payments are on or off, for the admin dashboard: what is missing or unreadable, by variable name only,
// never a value. `on` is paymentsReady; `periods` are those with a usable plan.
const PAY_VARS = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PLANS", "RAZORPAY_TOTAL_COUNT"];
export function paymentsCheck(env) {
  const v = (n) => String(env[n] || "").trim();
  const problems = PAY_VARS.filter((n) => !v(n)).map((n) => `${n} is not set on this deployment`);
  const id = v("RAZORPAY_KEY_ID");
  if (id && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(id)) problems.push("RAZORPAY_KEY_ID doesn't look like rzp_test_… or rzp_live_…");
  if (v("RAZORPAY_PLANS")) {
    let raw;
    try { raw = JSON.parse(v("RAZORPAY_PLANS")); } catch (e) { raw = undefined; }
    if (raw === undefined) problems.push(`RAZORPAY_PLANS isn't valid JSON: paste it exactly as check-plan.mjs printed it, {"1":"plan_…","12":"plan_…"}, with no quotes around it`);
    else if (!raw || typeof raw !== "object" || Array.isArray(raw)) problems.push(`RAZORPAY_PLANS should be {"1":"plan_…","12":"plan_…"}; it looks quoted twice`);
    else for (const m of periodsOf()) if (!razorpayPlans(env)[m]) problems.push(`RAZORPAY_PLANS has no usable plan_… id for "${m}" (${m === 12 ? "yearly" : "monthly"}), so that period isn't offered`);
  }
  if (v("RAZORPAY_TOTAL_COUNT") && totalCount(env) === null) problems.push("RAZORPAY_TOTAL_COUNT must be a whole number of 1 or more (months)");
  return {
    on: paymentsReady(env), mode: id.startsWith("rzp_live_") ? "live" : id.startsWith("rzp_test_") ? "test" : null,
    deployment: env.VERCEL_ENV || null, periods: periodsOf().filter((m) => razorpayPlans(env)[m]), problems,
  };
}
// RAZORPAY_TOTAL_COUNT counts months (T33): a plan billed every `months` runs for that many months, rounded up.
const cyclesFor = (env, months) => Math.max(1, Math.ceil(totalCount(env) / months));

// A Pro plan choice sent by the manage page (T33): categories (null for all four), emails a day and billing
// months (1 or 12). Missing parts take the defaults (all four, the default emails a day, monthly), so an old
// page that sends nothing still works. `months` must be on sale, and with `forPayment` have a Razorpay plan.
// The price depends on the period only. Returns { ok, cats, perDay, months, price } or { ok: false, error }.
export function readChoice({ cats, sweepsPerDay, months }, env, { forPayment = false } = {}) {
  const max = sweepLimits(env).max;
  let chosenCats = null;
  if (cats !== undefined && cats !== null) {
    const c = normaliseCats(cats);
    if (!c.ok) return { ok: false, error: "unknown category" };
    chosenCats = c.cats;
  }
  let perDay = Math.min(DEFAULT_SWEEPS_PER_DAY, max);
  if (sweepsPerDay !== undefined && sweepsPerDay !== null) {
    const f = normaliseSweepsPerDay(sweepsPerDay, max);
    if (!f.ok) return { ok: false, error: f.error };
    perDay = f.value;
  }
  const onSale = forPayment ? periodsOf().filter((m) => razorpayPlans(env)[m]) : periodsOf();
  const m = months === undefined || months === null ? onSale[0] : months;
  if (!Number.isInteger(m) || !onSale.includes(m)) return { ok: false, error: "unknown period" };
  const price = priceOf(m);
  if (price === null) return { ok: false, error: "unknown period" };
  return { ok: true, cats: chosenCats, perDay, months: m, price };
}
const PAYMENT_ID = /^pay_[A-Za-z0-9]+$/;
// Subscription states that mean Checkout's payment didn't give a running plan; Pro then waits for the webhook.
const RETURN_NO_GRANT = new Set(["halted", "cancelled", "completed", "expired", "paused", "pending"]);
const DAY_MS = 24 * 3600 * 1000;

// Unset or unreadable gives the default; an explicit 0 closes confirmations.
const maxConfirmsPerDay = (v) => {
  const raw = String(v ?? "").trim();
  if (raw === "0") return 0;
  return positiveInt(raw) ?? DEFAULT_MAX_CONFIRMS_PER_DAY;
};

// The client's IP as Vercel reports it. Vercel overwrites x-forwarded-for, so a client can't set
// it (docs: "Request headers"); x-vercel-forwarded-for is the same value and survives another
// proxy in front. Null when there is none (local runs, tests) or it doesn't look like an IP.
export function clientIp(headers = {}) {
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const v = headers[name];
    const first = String(Array.isArray(v) ? v[0] : v ?? "").split(",")[0].trim();
    if (first && /^[0-9a-f:.]{2,45}$/i.test(first)) return first;
  }
  return null;
}

// The list prefix for this IP's attempts in this UTC hour.
export const ipHitPrefix = (ip, now) =>
  `${KEY_IPHIT_PREFIX}${utcHour(now)}-${createHash("sha256").update("radar-ip:" + ip).digest("hex").slice(0, 16)}-`;

// T13 part B: true when this IP has used up its attempts this hour (sign-up and sign-in share the
// limit); otherwise the attempt is counted. A count we can't read counts as reached.
async function ipLimitReached({ req, env, storage, t, randomBytes }) {
  const ip = clientIp(req.headers);
  if (!ip) return false;
  const prefix = ipHitPrefix(ip, t);
  const maxPerIp = positiveInt(env.MAX_SIGNUPS_PER_IP_HOUR) ?? DEFAULT_MAX_SIGNUPS_PER_IP_HOUR;
  let hits;
  try { hits = (await storage.list(prefix)).length; } catch (e) { hits = Infinity; }
  if (hits >= maxPerIp) return true;
  try {
    await storage.set(prefix + Buffer.from(randomBytes(3)).toString("hex"), JSON.stringify({ at: new Date(t).toISOString() }));
  } catch (e) { /* best effort: a lost hit only makes the limit a little looser */ }
  return false;
}

// The count as a number. A missing file is 0 (no sweep has written one yet); a file that can't
// be read or understood is null, which callers treat as "full".
async function readSubscriberCount(storage) {
  try {
    const raw = await storage.get(KEY_SUBSCRIBER_COUNT);
    if (raw == null) return 0;
    const v = JSON.parse(raw);
    const n = typeof v === "number" ? v : v && typeof v === "object" ? v.count : NaN;
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch (e) { return null; }
}

// Where the links in emails point. SITE_URL, else the Vercel production domain, else nothing. On a
// Preview it is the branch's own URL instead, never production, so a test email can't send anyone there.
export function siteUrl(env) {
  const set = String(env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (set) return /^https?:\/\/[^\s<>"]+$/.test(set) ? set : "";
  const v = String((env.VERCEL_ENV === "preview" ? env.VERCEL_BRANCH_URL : env.VERCEL_PROJECT_PRODUCTION_URL) || "").trim();
  return v && /^[a-z0-9.-]+(:\d+)?$/i.test(v) ? `https://${v}` : "";
}

export const senderOk = (from) => Boolean(from) && from !== DEFAULT_FROM && !/@resend\.dev\b/i.test(from);

// A ticked checkbox ("on"), the page script's "1", or JSON true.
const isYes = (v) => v === true || v === "1" || v === "on";

// Where a subscriber sees their plan and asks for Pro (T20 adds checkout to the same page).
export const managePath = (id, t) => `/manage/?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;

// The confirmation link's password key, stored only as this hash (with the pending password), compared in constant time.
const pwKeyHash = (k) => createHash("sha256").update("radar-pw-key:" + k).digest("hex");
function pwKeyOk(pending, k) {
  if (!pending || typeof pending.k !== "string" || typeof k !== "string" || !k) return false;
  const want = Buffer.from(pending.k);
  const got = Buffer.from(pwKeyHash(k));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Tells the owner (EMAIL_TO) that someone asked for Pro. Names nobody. Never throws, and a
// failed send never fails the request that caused it.
async function notifyOwnerProRequest({ env, fetchFn, at, source, log }) {
  try {
    const r = await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, to: env.EMAIL_TO }, buildProRequestEmail({ at: new Date(at).toISOString(), source }), { fetchFn });
    if (r !== "sent") log("pro-request owner-email", r);
  } catch (e) {
    log("pro-request owner-email", "error: " + ((e && e.name) || "Error"));
  }
}

// Stores a pending record whose confirmSentAt is now and emails it the confirmation link. Records
// "subscribed" for a new one and "confirmsent" always. The caller has checked MAX_CONFIRMS_PER_DAY.
// A re-send is checked again on the stored record: if it was confirmed, or another request re-sent
// the link, in the meantime, nothing is written or sent.
async function sendConfirmation({ record, isNew, env, storage, fetchFn, t, randomBytes, log, logAs, pwKey = null }) {
  const site = siteUrl(env);
  if (isNew) await putSubscriber(storage, record);
  else {
    const { changed } = await updateSubscriber(storage, record.id, (r) => (r.status === "pending" && !confirmHeld(r, t)
      ? { ...r, confirmSentAt: record.confirmSentAt, confirmSends: record.confirmSends, proRequestedAt: r.proRequestedAt || record.proRequestedAt,
        ...(record.proRequest ? { proRequest: record.proRequest } : {}), pendingPw: record.pendingPw || null }
      : null));
    if (!changed) return;
  }
  if (isNew) await recordEvent(storage, "subscribed", { now: t, randomBytes, plan: "free" });
  await recordEvent(storage, "confirmsent", { now: t, randomBytes, plan: "free" });

  const mail = buildConfirmEmail({ confirmUrl: `${site}/api/confirm?id=${record.id}&t=${record.token}${pwKey ? `&k=${pwKey}` : ""}`, siteUrl: site, withPassword: Boolean(pwKey) });
  const result = await sendOne({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, { to: record.email, ...mail }, {
    fetchFn,
    idempotencyKey: `confirm-${record.id.slice(0, 24)}-${Date.parse(record.confirmSentAt)}`,
  });
  if (result !== "sent") log(logAs, result);
}

export function makeSubscribeHandler({ env, storage, fetchFn, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function subscribe(req, res) {
    if (!allowMethods(req, res, ["POST"])) return;
    if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendJson(res, 503, { error: "subscriptions are not open yet" });
    const site = siteUrl(env);
    // No cap set (MAX_SUBSCRIBERS unset or not a positive whole number) is a setup gap, answered as
    // one, for every address alike: "a link is on its way" would promise an email that never comes.
    const maxSubs = positiveInt(env.MAX_SUBSCRIBERS);
    if (!env.RESEND_API_KEY || !senderOk(env.EMAIL_FROM) || !site || maxSubs === null) {
      log("subscribe", "not configured");
      return sendJson(res, 503, { error: "subscriptions are not open yet" });
    }

    let fields;
    try {
      fields = await readFields(req, { limit: 8192 });
    } catch (e) {
      if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
      throw e;
    }
    const reply = () => sendJson(res, 200, OK_REPLY);

    if (fields.website) return reply(); // the honeypot
    const email = normaliseEmail(fields.email);
    const wantsPro = isYes(fields.wantsPro); // counts only once the address is confirmed
    if (!email) return sendJson(res, 400, { error: "enter a valid email address" });
    // A password is optional: without one, the account signs in by emailed link or Google.
    const password = typeof fields.password === "string" && fields.password !== "" ? fields.password : null;
    const pwProblem = password === null ? null : passwordProblem(password);
    if (pwProblem) return sendJson(res, 400, { error: pwProblem });

    try {
      const t = now();
      // More than the limit from one IP this hour gets the usual reply and nothing is stored or sent.
      if (await ipLimitReached({ req, env, storage, t, randomBytes })) return reply();
      const maxConfirms = maxConfirmsPerDay(env.MAX_CONFIRMS_PER_DAY);

      const existing = await findSubscriber(storage, email);
      if (existing && existing.status === "active") { // row 7
        if (sessionSecret(env)) {
          const sent = await sendSignInLink({ record: existing, env, storage, fetchFn, t, randomBytes, log, already: true });
          return sendJson(res, 200, sent === "sent" ? ALREADY_SIGNIN : ALREADY_HELD);
        }
        // Without sign-in (no SESSION_SECRET), the manage link instead.
        // A notice at most once every NOTICE_HOURS, and only under the day's cap.
        if (existing.noticeSentAt && t - Date.parse(existing.noticeSentAt) < NOTICE_HOURS * HOUR_MS) return sendJson(res, 200, ALREADY);
        let sentToday;
        try { sentToday = await signupEmailsToday(storage, t); } catch (e) { sentToday = Infinity; }
        if (sentToday >= maxConfirms) return sendJson(res, 200, ALREADY);
        const mail = buildAlreadySubscribedEmail({
          manageUrl: site + managePath(existing.id, existing.token),
          unsubscribeUrl: `${site}/api/unsubscribe?id=${existing.id}&t=${existing.token}`,
          siteUrl: site,
        });
        const result = await sendOne({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, { to: existing.email, ...mail }, {
          fetchFn,
          idempotencyKey: `notice-${existing.id.slice(0, 24)}-${t}`,
        });
        if (result !== "sent") {
          log("subscribe notice-email", result);
          return sendJson(res, 200, ALREADY);
        }
        try {
          await updateSubscriber(storage, existing.id, (r) => ({ ...r, noticeSentAt: new Date(t).toISOString() }));
          await recordEvent(storage, "noticesent", { now: t, randomBytes, plan: effectivePlan(existing, t) });
        } catch (e) {
          log("subscribe notice-record", "error: " + ((e && e.name) || "Error")); // the email went; say so
        }
        return sendJson(res, 200, ALREADY_EMAILED);
      }
      if (existing && existing.status !== "pending") return reply(); // anything unexpected
      const held = existing && confirmHeld(existing, t); // row 8
      if (held) return sendJson(res, 200, held === "wait" ? PENDING_REPLY : PENDING_CAPPED);

      if (!existing) {
        // Rows 10: a full list, or one we can't measure, takes no new address.
        const count = await readSubscriberCount(storage);
        if (count === null || count >= maxSubs) return reply();
      }
      // Row 11 (and the same cap on a re-send, which spends quota the same way). A count we
      // can't read counts as reached.
      let sentToday;
      try { sentToday = await signupEmailsToday(storage, t); } catch (e) { sentToday = Infinity; }
      if (sentToday >= maxConfirms) return reply();

      let record = existing;
      if (!record) {
        record = newPending(email, { now: t, randomBytes });
      } else {
        record = resent(record, t);
      }
      if (wantsPro && !record.proRequestedAt) record = { ...record, proRequestedAt: new Date(t).toISOString() };
      // The billing period picked on the sign-up form, so confirming can go straight to paying for it. Anything not
      // on sale is dropped: the plan card then asks for it.
      const picked = wantsPro && fields.months !== undefined ? readChoice({ months: Number(fields.months) }, env) : null;
      if (picked && picked.ok) record = { ...record, proRequest: { cats: picked.cats, perDay: picked.perDay, months: picked.months } };
      // A password chosen here starts working only through the confirmation link sent for this request, which carries
      // a key whose hash is stored beside it: whoever types an address in can't set the password of the person who
      // owns the inbox and later confirms. A later sign-up for the address, with a password or without, replaces it.
      let pwKey = null;
      if (password) {
        pwKey = Buffer.from(randomBytes(32)).toString("base64url");
        record = { ...record, pendingPw: { ...(await hashPassword(password, { randomBytes })), k: pwKeyHash(pwKey) } };
      } else if (record.pendingPw) record = { ...record, pendingPw: null };
      await sendConfirmation({ record, isNew: !existing, env, storage, fetchFn, t, randomBytes, log, logAs: "subscribe confirm-email", pwKey });
      return reply();
    } catch (e) {
      log("subscribe", "error: " + ((e && e.name) || "Error"));
      return sendJson(res, 500, { error: "could not process the request; try again later" });
    }
  };
}

// ---- confirm and unsubscribe links (T06, T07)

const PAUSED = { title: "Subscriptions are paused", body: "<p>Subscriptions are paused right now. Your link stays valid: try it again later.</p>" };
const INVALID = { title: "This link isn't valid", body: `<p>It may have expired. <a href="/signup/">Sign up again</a>.</p>` };

// The id and token from the query string (GET), or from the form (POST) unless `queryOnly`: a
// mail app's one-click unsubscribe POSTs to the link itself, with only a fixed body. Anything not a string is "".
async function linkParams(req, { queryOnly }) {
  if (req.method === "POST" && !queryOnly) {
    const f = await readFields(req, { limit: 2048 });
    return { id: typeof f.id === "string" ? f.id : "", t: typeof f.t === "string" ? f.t : "", k: typeof f.k === "string" ? f.k : "", fields: f };
  }
  let q = req.query;
  if (!q || typeof q !== "object") q = Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
  return { id: typeof q.id === "string" ? q.id : "", t: typeof q.t === "string" ? q.t : "", k: typeof q.k === "string" ? q.k : "" };
}

// `name` is the secret's field: "t" for a token, "c" for a sign-in code. `k`: a confirmation link's password key.
const hiddenForm = (action, id, secret, label, name = "t", k = "") =>
  `<form method="post" action="${action}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="${name}" value="${esc(secret)}">${k ? `<input type="hidden" name="k" value="${esc(k)}">` : ""}<p><button type="submit">${esc(label)}</button></p></form>`;

// Shared by confirm and unsubscribe. Unknown id, bad token and missing fields are all the same
// answer (the invalid page), so the endpoint can't be used to test ids.
async function handleLink({ req, res, env, storage, now, page, queryOnly = false, needsEnabled = true, invalid = { code: 404, page: INVALID } }) {
  if (!allowMethods(req, res, ["GET", "POST"])) return;
  if (needsEnabled && env.SUBSCRIPTIONS_ENABLED !== "1") return sendPage(res, 503, PAUSED);
  let params;
  try {
    params = await linkParams(req, { queryOnly });
  } catch (e) {
    if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
    throw e;
  }
  try {
    const record = await getSubscriber(storage, params.id);
    if (!record || !tokenOk(record, params.t)) return sendPage(res, invalid.code, invalid.page);
    return await page({ record, params, post: req.method === "POST", now: now() });
  } catch (e) {
    return sendPage(res, 500, { title: "Something went wrong", body: "<p>Please try the link again in a minute.</p>" });
  }
}

export function makeConfirmHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function confirm(req, res) {
    return handleLink({
      req, res, env, storage, now,
      page: async ({ record, params, post, now: t }) => {
        // A pending record that was never confirmed within 7 days is deleted, and only for the
        // holder of its token, so nobody can delete a record by guessing an address's id.
        if (record.status === "pending" && t - Date.parse(record.createdAt) > PENDING_TTL_DAYS * 24 * 3600 * 1000) {
          await deleteSubscriber(storage, record.id);
          await recordEvent(storage, "expired", { now: t, randomBytes });
          return sendPage(res, 404, INVALID);
        }
        // Confirming also signs this browser in (T16), when sign-in is set up.
        const done = (rec) => {
          const secret = sessionSecret(env);
          if (secret) res.setHeader("set-cookie", sessionCookie(signSession(rec, { secret, now: t })));
          // Ticked Pro with payments on: straight to the manage page, which opens Razorpay's Checkout for the plan
          // picked at sign-up (or the plan card, if none was).
          if (paymentsReady(env) && rec.proRequestedAt && effectivePlan(rec, t) !== "pro") {
            res.statusCode = 303;
            res.setHeader("location", managePath(params.id, params.t) + "&pay=1");
            res.setHeader("cache-control", "no-store");
            return res.end();
          }
          return sendPage(res, 200, {
            title: "You're subscribed",
            body: (secret ? `<p>Your account is ready, and you're signed in on this browser.</p>` : "")
              + (rec.pw ? `<p>Next time, sign in with your email address and the password you chose.</p>` : "")
              + `<p>You'll get the daily digest after the first sweep of the UTC day (about 05:47 IST).</p>`
              + (effectivePlan(rec, t) === "pro" ? ""
                // Payments on: one step left, paying, on the manage page with the plan card open (?pay=1).
                : paymentsReady(env) ? `<p>Want the live board and 1 to 5 emails a day? <a href="${esc(managePath(params.id, params.t) + "&pay=1")}">Upgrade to Pro</a></p>`
                : rec.proRequestedAt ? `<p>You asked for Pro (the live board and 1 to 5 emails a day). You'll be switched over shortly; until then you get the daily digest.</p>`
                : `<p>Want the live board and 1 to 5 emails a day? <a href="${esc(managePath(params.id, params.t))}">Request Pro</a></p>`)
              + `<p><a href="/live/">Open the live board</a></p>`,
          });
        };
        // Already confirmed: never a sign-in. The same id and token are in every digest's manage and
        // unsubscribe links, so signing in here would let anyone a digest is forwarded to log in.
        const already = () => sendPage(res, 200, { title: "You're already subscribed", body: `<p>Nothing more to do. <a href="${esc(managePath(params.id, params.t))}">Manage your subscription</a> · <a href="/live/">Open the live board</a> · <a href="/signin/">Sign in</a></p>` });
        if (record.status === "active") return already();
        if (record.status !== "pending") return sendPage(res, 404, INVALID);
        if (!post) {
          return sendPage(res, 200, {
            title: "Confirm your subscription",
            body: `<p>One click to start getting the Travel Problem Radar digest by email${params.k ? " and turn on the password you chose" : ""}.</p>${hiddenForm("/api/confirm", params.id, params.t, "Confirm", "t", params.k)}`,
          });
        }
        // Only the press that moves it from pending signs in: a second press at the same moment
        // (or a Google sign-in) that finds it active gets the already-subscribed page.
        // The password chosen at sign-up comes on only with the key from the same request's link (see makeSubscribeHandler).
        const { record: active, changed } = await updateSubscriber(storage, record.id, (r) => {
          if (r.status !== "pending") return null;
          const { pendingPw, ...rest } = r;
          const pw = pwKeyOk(pendingPw, params.k) ? storedHash(pendingPw) : null;
          return { ...rest, status: "active", confirmedAt: new Date(t).toISOString(), ...(pw ? { pw } : {}) };
        });
        if (!changed) return active && active.status === "active" && tokenOk(active, params.t) ? already() : sendPage(res, 404, INVALID);
        await recordEvent(storage, "confirmed", { now: t, randomBytes, plan: active.plan === "pro" ? "pro" : "free" });
        // A Pro request ticked at sign-up counts from here, once the address is proven. With payments on they pay
        // for it themselves, so there's nothing for the owner to switch on.
        if (active.proRequestedAt && effectivePlan(active, t) !== "pro") {
          await recordEvent(storage, "prorequested", { now: t, randomBytes, plan: "free" });
          if (!paymentsReady(env)) await notifyOwnerProRequest({ env, fetchFn, at: t, source: "signup", log });
        }
        return done(active);
      },
    });
  };
}

export function makeUnsubscribeHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function unsubscribe(req, res) {
    return handleLink({
      req, res, env, storage, now,
      queryOnly: true,
      needsEnabled: false, // leaving must always work
      // 200, not 404: a repeat click or a second one-click delivery isn't an error, and it changes nothing.
      // The words claim nothing about the address: a link from before a re-subscribe has the same id
      // but an old token, and that person is still on the list.
      invalid: { code: 200, page: { title: "This link is no longer active", body: "<p>Nothing was changed. If you already unsubscribed, you're off the list. If you're still getting emails, use the Unsubscribe link in the most recent one.</p>" } },
      page: async ({ record, params, post, now: t }) => {
        // A Pro account outlives its emails (T17): unsubscribing turns them off and the account,
        // with the board, stays until it is deleted on the manage page. Free (and a lapsed Pro) is deleted.
        const keep = effectivePlan(record, t) === "pro";
        const manage = `<a href="${esc(managePath(params.id, params.t))}">manage page</a>`;
        if (keep && record.emailOff) {
          return sendPage(res, 200, { title: "Your emails are already off", body: `<p>Nothing more will be sent. Your Pro account stays; you can turn emails back on, or delete the account, on the ${manage}.</p>` });
        }
        if (!post) {
          const action = `/api/unsubscribe?id=${encodeURIComponent(params.id)}&t=${encodeURIComponent(params.t)}`;
          const what = keep
            ? `<p>You'll stop getting emails. Your Pro account stays: you can still sign in and read the board, and delete the account on the ${manage}.</p>`
            : "<p>You'll stop getting the digest, and your address will be deleted.</p>";
          return sendPage(res, 200, {
            title: "Unsubscribe from Travel Problem Radar?",
            body: `${what}<form method="post" action="${esc(action)}"><p><button type="submit">Unsubscribe</button></p></form>`,
          });
        }
        if (keep) {
          // A bounce or a complaint recorded in the meantime stays: it is the stronger reason.
          const { changed } = await updateSubscriber(storage, record.id, (r) => (r.emailOff ? null : { ...r, emailOff: "unsubscribed" }));
          if (changed) await recordEvent(storage, "emailoff", { now: t, randomBytes, plan: "pro" });
          return sendPage(res, 200, { title: "Your emails are off", body: `<p>Nothing more will be sent. Your Pro account stays; you can turn emails back on, or delete the account, on the ${manage}.</p>` });
        }
        // A Razorpay plan that won't cancel keeps the account, with emails off, rather than leave it charging.
        if (await deleteAccount(record, { env, fetchFn, storage })) {
          log("unsubscribe", "razorpay error; emails turned off instead");
          await updateSubscriber(storage, record.id, (r) => (r.emailOff ? null : { ...r, emailOff: "unsubscribed" }));
          await recordEvent(storage, "emailoff", { now: t, randomBytes, plan: effectivePlan(record, t) });
          return sendPage(res, 200, { title: "Your emails are off", body: `<p>Nothing more will be sent. We couldn&rsquo;t cancel your payment plan with Razorpay just now, so your account stays: delete it on the ${manage}, or write to pehchanthetraveller19@gmail.com.</p>` });
        }
        await recordEvent(storage, "unsubscribed", { now: t, randomBytes, plan: effectivePlan(record, t) });
        return sendPage(res, 200, { title: "You're unsubscribed", body: "<p>Your address has been deleted. Nothing more will be sent.</p>" });
      },
    });
  };
}

// ---- the manage page's data (/manage/, linked from every digest)

// What the manage page may show: the plan, never the address. `payments` says whether the page
// offers Checkout or the Request Pro button; for a paid Pro, proUntil is the renewal date. `billing`
// is "pending" while Razorpay retries a failed renewal and "halted" once it has given up, else null.
const RZP_BILLING = new Set(["pending", "halted"]);
const RZP_ENDED = new Set(["cancelled", "completed", "expired"]);
const RZP_CHARGES = new Set(["authenticated", "active", "pending", "halted"]);
// Deleting an account cancels its Razorpay subscriptions first (2026-10-27): the plan and any renewal set up to
// follow it (T34), at once rather than at the period end, so nothing more is charged and nothing is left running.
// One that could still charge must stop: if Razorpay refuses and doesn't report it as over, the error comes back
// and the caller keeps the account. One that can't (an unpaid checkout, or a plan already set to end) is cancelled
// as a courtesy, and a failure there is ignored. Returns null, or the error.
export async function stopRazorpay(record, { env, fetchFn }) {
  const rzp = rzpOf(record);
  const subs = [rzp, nextOf(record)].filter((x) => x && typeof x.subscriptionId === "string" && x.subscriptionId && !RZP_ENDED.has(x.status));
  for (const x of subs) {
    const charges = RZP_CHARGES.has(x.status) && !(x === rzp && x.cancelAtPeriodEnd === true);
    let done;
    try { done = await cancelSubscription({ env, fetchFn, subscriptionId: x.subscriptionId, atCycleEnd: false }); } catch (e) { done = { error: "network" }; }
    if (!done.error || !charges) continue;
    const live = await fetchSubscription({ env, fetchFn, subscriptionId: x.subscriptionId });
    if (live.error || !RZP_ENDED.has(live.status)) return done.error;
  }
  return null;
}

// Deletes an account: its Razorpay subscriptions are cancelled (stopRazorpay), then everything stored that names it
// goes (deleteSubscriberData). Returns null, or Razorpay's error, in which case nothing was deleted.
export async function deleteAccount(record, { env, fetchFn, storage }) {
  const stopped = await stopRazorpay(record, { env, fetchFn });
  if (stopped) return stopped;
  await deleteSubscriberData(storage, record.id);
  return null;
}
const rzpOf = (record) => (record.rzp && typeof record.rzp === "object" ? record.rzp : {});
const paidPro = (record, t) => record.proSource === "razorpay" && effectivePlan(record, t) === "pro";
// A renewal (T34) is a second subscription, rzp.next, that starts when the cancelled one ends.
const nextOf = (record) => (rzpOf(record).next && typeof rzpOf(record).next === "object" ? rzpOf(record).next : null);
const renewalOf = (record) => {
  const n = nextOf(record);
  return n && n.status === "authenticated" && n.choice ? { months: n.choice.months, price: n.choice.price, startsAt: n.startAt || null } : null;
};
const canRenew = (record, t) => paidPro(record, t) && rzpOf(record).cancelAtPeriodEnd === true && !renewalOf(record);
const lastPlanOf = (record) => {
  const c = rzpOf(record).choice;
  return c && typeof c === "object" ? { cats: c.cats || null, perDay: c.perDay, months: c.months } : null;
};
const accountView = (record, t, env) => ({
  status: record.status,
  plan: record.plan === "pro" ? "pro" : "free",
  effectivePlan: effectivePlan(record, t),
  proUntil: record.proUntil || null,
  proSource: record.proSource || null,
  proRequestedAt: record.proRequestedAt || null,
  cats: record.cats || null,
  // Emails a day (T32): the stored choice, or null for the default; the page offers 1 to the max.
  sweepsPerDay: normaliseSweepsPerDay(record.sweepsPerDay, sweepLimits(env).max).ok ? record.sweepsPerDay : null,
  sweepsPerDayDefault: DEFAULT_SWEEPS_PER_DAY,
  sweepsPerDayMax: sweepLimits(env).max,
  emailOff: record.emailOff || null,
  hasPassword: Boolean(record.pw),
  // The plan card's prices (T33): the price of each period on sale (months → rupees, from plan.json), the periods
  // on sale, and those that can be paid now (each needs a Razorpay plan). The page holds no price of its own.
  pricing: priceTable(),
  periods: periodsOf(),
  payPeriods: paymentsReady(env) ? periodsOf().filter((m) => razorpayPlans(env)[m]) : [],
  paidFor: record.paidFor || null,
  proRequest: record.proRequest || null,
  // Renewing (T34): the plan last chosen at checkout, to fill the card in again; a renewal already set up to start
  // when a cancelled plan ends; and whether one can be set up now.
  lastPlan: lastPlanOf(record),
  renewal: renewalOf(record),
  canRenew: canRenew(record, t),
  payments: paymentsReady(env),
  paymentPending: rzpOf(record).status === "authenticated" && effectivePlan(record, t) !== "pro",
  cancelAtPeriodEnd: paidPro(record, t) && rzpOf(record).cancelAtPeriodEnd === true,
  billing: RZP_BILLING.has(rzpOf(record).status) ? rzpOf(record).status : null,
});

// GET ?id&t: the plan. With no id and no token, the login cookie (T16) says whose plan; a POST
// signed in that way must come from this site (originOk). Replies add `signedIn`, whether this
// browser holds a valid login cookie. POST {id, t, action: "request-pro"}: ask for Pro, which the
// owner grants with the admin script; the page offers it while payments are off.
// POST {id, t, action: "set-cats", cats: [...]}: a Pro subscriber picks their categories (T14).
// POST {id, t, action: "set-freq", sweepsPerDay: n}: a Pro subscriber picks 1 to n emails a day,
// n being SWEEPS_PER_DAY_MAX (T32).
// POST action "email-on" turns emails back on after an unsubscribe (not after a bounce or a
// complaint), and "delete-account" deletes the record and signs this browser out (T17).
// POST {action: "set-password", password} or {action: "remove-password"}, signed in only (2026-10-27).
// With payments on (T20): "checkout" starts a Razorpay subscription and returns what Checkout
// needs, "checkout-return" records Checkout's signed reply (only the webhook, T21, grants Pro),
// and "cancel" stops a paid Pro renewing at the end of the period.
export function makeAccountHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function account(req, res) {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendJson(res, 503, { error: "subscriptions are paused" });
    let params;
    let action = "";
    let cats;
    let sweepsPerDay;
    let months;
    let password;
    try {
      params = await linkParams(req, { queryOnly: false });
      if (params.fields && typeof params.fields.action === "string") action = params.fields.action;
      if (params.fields) ({ cats, sweepsPerDay, months, password } = params.fields);
    } catch (e) {
      if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
      throw e;
    }
    try {
      const t = now();
      const session = await readSession(req, { env, storage, now: t });
      let record;
      if (params.id || params.t) {
        record = await getSubscriber(storage, params.id);
        // Unknown id and wrong token are the same answer, so ids can't be tested.
        if (!record || !tokenOk(record, params.t)) return sendJson(res, 404, { error: "this link isn't valid" });
      } else {
        if (!session) return sendJson(res, 401, { error: "not_signed_in" });
        if (req.method === "POST" && !originOk(req)) return sendJson(res, 403, { error: "wrong_origin" });
        record = session;
      }
      const view = (rec) => ({ ...accountView(rec, t, env), signedIn: Boolean(session) });
      if (req.method === "GET") return sendJson(res, 200, view(record));
      // Every change below is made with updateSubscriber, on the record as stored at that moment,
      // so a webhook or another tab writing at the same time isn't undone. Deleted meanwhile: 404.
      const gone = () => sendJson(res, 404, { error: "this link isn't valid" });
      const save = (change) => updateSubscriber(storage, record.id, change);

      if (action === "set-cats") {
        if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
        // A lapsed Pro is Free here too; what they chose before stays stored for when they renew.
        if (effectivePlan(record, t) !== "pro") return sendJson(res, 403, { error: "pro_only" });
        const chosen = normaliseCats(cats);
        if (!chosen.ok) return sendJson(res, 400, { error: "unknown category" });
        const { record: updated, changed } = await save((r) => (effectivePlan(r, t) === "pro" ? { ...r, cats: chosen.cats } : null));
        if (!updated) return gone();
        if (!changed) return sendJson(res, 403, { error: "pro_only" });
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      if (action === "set-freq") {
        if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
        if (effectivePlan(record, t) !== "pro") return sendJson(res, 403, { error: "pro_only" });
        const chosen = normaliseSweepsPerDay(sweepsPerDay, sweepLimits(env).max);
        if (!chosen.ok) return sendJson(res, 400, { error: chosen.error });
        const { record: updated, changed } = await save((r) => (effectivePlan(r, t) === "pro" ? { ...r, sweepsPerDay: chosen.value } : null));
        if (!updated) return gone();
        if (!changed) return sendJson(res, 403, { error: "pro_only" });
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      // POST action "set-plan" (T33): a Pro saves categories and emails a day together, from the one plan card.
      if (action === "set-plan") {
        if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
        if (effectivePlan(record, t) !== "pro") return sendJson(res, 403, { error: "pro_only" });
        if (cats === undefined || sweepsPerDay === undefined) return sendJson(res, 400, { error: "unknown category" });
        const c = readChoice({ cats, sweepsPerDay }, env);
        if (!c.ok) return sendJson(res, 400, { error: c.error });
        const { record: updated, changed } = await save((r) => (effectivePlan(r, t) === "pro" ? { ...r, cats: c.cats, sweepsPerDay: c.perDay } : null));
        if (!updated) return gone();
        if (!changed) return sendJson(res, 403, { error: "pro_only" });
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      if (action === "email-on") {
        // A bounce or a complaint can't be undone here: that would send to an address that refused mail.
        const { record: updated, changed } = await save((r) => {
          if (r.emailOff !== "unsubscribed") return null;
          const { emailOff, ...on } = r;
          return on;
        });
        if (!updated) return gone();
        if (!changed) return sendJson(res, 409, { error: updated.emailOff ? "email_blocked" : "already_on" });
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      if (action === "delete-account") {
        // Deleted at once (2026-10-27), paid Pro too: its Razorpay plan is cancelled now, so nothing more is charged,
        // and whatever is left of the paid period is given up. The one wait: paid, with Pro not started yet (neither
        // Checkout's return nor the webhook has landed), where cancelling would lose the payment.
        if (rzpOf(record).status === "authenticated" && effectivePlan(record, t) !== "pro") return sendJson(res, 409, { error: "payment_pending" });
        const stopped = await deleteAccount(record, { env, fetchFn, storage });
        if (stopped) {
          log("account", "delete-account: razorpay error " + stopped);
          return sendJson(res, 502, { error: "payment_provider" });
        }
        await recordEvent(storage, "deleted", { now: t, randomBytes, plan: effectivePlan(record, t) });
        res.setHeader("set-cookie", clearCookie());
        return sendJson(res, 200, { ok: true, deleted: true });
      }
      // Passwords (2026-10-27): set, change or remove one only when signed in on this browser, never through an
      // email's link, which a forwarded digest carries. Signing in by emailed link is how a forgotten password is
      // replaced, so the old one isn't asked for. A new password signs every other browser out (sessionVer).
      if (action === "set-password" || action === "remove-password") {
        if (!session || session.id !== record.id) return sendJson(res, 403, { error: "sign_in_first" });
        if (action === "remove-password") {
          const { record: updated } = await save((r) => { if (!r.pw) return null; const { pw, pwFails, ...rest } = r; return rest; });
          return updated ? sendJson(res, 200, { ok: true, ...view(updated) }) : gone();
        }
        const problem = passwordProblem(password);
        if (problem) return sendJson(res, 400, { error: problem });
        const pw = await hashPassword(password, { randomBytes });
        const { record: updated } = await save((r) => {
          const { pwFails, ...rest } = r;
          return { ...rest, pw, sessionVer: (Number.isInteger(r.sessionVer) && r.sessionVer >= 0 ? r.sessionVer : 0) + 1 };
        });
        if (!updated) return gone();
        res.setHeader("set-cookie", sessionCookie(signSession(updated, { secret: sessionSecret(env), now: t })));
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      if (action === "checkout" || action === "checkout-return" || action === "cancel") {
        if (!paymentsReady(env)) return sendJson(res, 503, { error: "payments_off" });
        const rzp = rzpOf(record);
        const keyId = String(env.RAZORPAY_KEY_ID).trim();
        if (action === "checkout") {
          if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
          // A paid Pro that has cancelled may set up a renewal that starts when the paid period ends (T34).
          if (effectivePlan(record, t) === "pro" && !canRenew(record, t)) {
            return sendJson(res, 409, { error: renewalOf(record) ? "already_renewed" : "already_pro" });
          }
          const renewing = effectivePlan(record, t) === "pro";
          // Paid, and the webhook hasn't arrived: a second checkout would charge twice.
          if (rzp.status === "authenticated") return sendJson(res, 409, { error: "payment_pending" });
          // Razorpay is still retrying a failed renewal: a new subscription could charge twice too.
          if (rzp.status === "pending") return sendJson(res, 409, { error: "payment_retrying" });
          // The plan chosen on the page (T33): its period picks the ₹1 Razorpay plan, its price the quantity.
          const choice = readChoice({ cats, sweepsPerDay, months }, env, { forPayment: true });
          if (!choice.ok) return sendJson(res, 400, { error: choice.error });
          const picked = { cats: choice.cats, perDay: choice.perDay, months: choice.months, price: choice.price };
          // A renewal's first charge is when the paid period ends, so there's no gap and nothing is charged twice.
          const startAt = renewing ? Math.floor(Date.parse(record.proUntil) / 1000) : null;
          // A checkout for the same plan, still unpaid, is reused for a while; a different plan gets its own.
          const open = renewing ? nextOf(record) || {} : rzp;
          const age = t - Date.parse(open.createdAt);
          if (open.status === "created" && open.subscriptionId && age >= 0 && age < CHECKOUT_REUSE_MINUTES * 60 * 1000
            && JSON.stringify(open.choice || null) === JSON.stringify(picked)) {
            return sendJson(res, 200, { ok: true, keyId, subscriptionId: open.subscriptionId, price: picked.price, months: picked.months, renewing });
          }
          const sub = await createSubscription({
            env, fetchFn, subscriberId: record.id, planId: razorpayPlans(env)[choice.months], quantity: choice.price,
            totalCount: cyclesFor(env, choice.months), startAt,
            extraNotes: { months: String(choice.months), perday: String(choice.perDay), cats: choice.cats ? choice.cats.join("+") : "all", ...(renewing ? { renews: "1" } : {}) },
          });
          if (sub.error) {
            log("account", "checkout: razorpay error " + sub.error);
            return sendJson(res, 502, { error: "payment_provider" });
          }
          await storage.set(KEY_RZPSUB_PREFIX + sub.id, JSON.stringify({ id: record.id }));
          // Checked again on the stored record: a payment that landed meanwhile keeps its subscription.
          const { record: updated, changed } = await save((r) => {
            const cur = rzpOf(r);
            if (renewing) {
              if (!canRenew(r, t) || cur.subscriptionId !== rzp.subscriptionId) return null;
              return { ...r, rzp: { ...cur, next: { subscriptionId: sub.id, status: "created", createdAt: new Date(t).toISOString(), startAt: r.proUntil, choice: picked } } };
            }
            if (effectivePlan(r, t) === "pro" || cur.status === "authenticated" || cur.status === "pending") return null;
            return { ...r, rzp: { subscriptionId: sub.id, status: "created", createdAt: new Date(t).toISOString(), currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null, choice: picked } };
          });
          if (!updated) return gone();
          if (!changed) {
            const error = renewing ? (renewalOf(updated) ? "already_renewed" : "not_paid_pro") : effectivePlan(updated, t) === "pro" ? "already_pro" : "payment_pending";
            return sendJson(res, 409, { error });
          }
          await recordEvent(storage, "checkoutstarted", { now: t, randomBytes, plan: renewing ? "pro" : "free" });
          return sendJson(res, 200, { ok: true, keyId, subscriptionId: sub.id, price: picked.price, months: picked.months, renewing });
        }
        if (action === "checkout-return") {
          const f = params.fields || {};
          // Checked against the subscription saved here, not only the one Checkout sends back: the plan's own, or a
          // renewal waiting to start (T34).
          const next = nextOf(record);
          const ours = next && f.subscriptionId === next.subscriptionId ? next.subscriptionId : rzp.subscriptionId;
          const good = ours && f.subscriptionId === ours && typeof f.paymentId === "string" && PAYMENT_ID.test(f.paymentId)
            && verifyCheckout({ paymentId: f.paymentId, subscriptionId: ours, signature: f.signature }, String(env.RAZORPAY_KEY_SECRET).trim());
          if (!good) return sendJson(res, 400, { error: "bad_signature" });
          if (next && ours === next.subscriptionId) {
            const { record: updated } = await save((r) => {
              const n = nextOf(r);
              return n && n.subscriptionId === ours && n.status === "created" ? { ...r, rzp: { ...rzpOf(r), next: { ...n, status: "authenticated" } } } : null;
            });
            if (!updated) return gone();
            return sendJson(res, 200, { ok: true, message: "Renewal set up; it starts when this period ends.", ...view(updated) });
          }
          // Checkout's signature proves the payment went through, and a plan that starts now is charged when it's
          // approved, so Pro starts here rather than when the webhook arrives. Razorpay is asked about the
          // subscription first: one that belongs to another record, or is in a state that says otherwise (halted,
          // cancelled…), is left to the webhook; if Razorpay can't be reached, the signature is enough. Pro runs to
          // the period end Razorpay reports, else for the months paid for, until the webhook brings the real one.
          // lastEventAt is left as it is, so no webhook event is taken for stale.
          const live = await fetchSubscription({ env, fetchFn, subscriptionId: rzp.subscriptionId });
          if (live.error) log("account", "checkout-return: razorpay error " + live.error + "; starting Pro on the signature");
          const startNow = live.error ? true : live.sid === record.id && !RETURN_NO_GRANT.has(live.status);
          let before = "free";
          // Only "created" or "authenticated" move on, judged on the stored record: if the webhook got here first,
          // even while this request was running, its status and its Pro stay.
          const { record: updated } = await save((r) => {
            const cur = rzpOf(r);
            before = effectivePlan(r, t);
            if (cur.subscriptionId !== rzp.subscriptionId || (cur.status !== "created" && cur.status !== "authenticated")) return null;
            const authed = { ...r, rzp: { ...cur, status: "authenticated" } };
            const c = cur.choice;
            if (!startNow || before === "pro" || !c || !Number.isInteger(c.months)) return cur.status === "created" ? authed : null;
            const end = !live.error && live.currentEnd && live.currentEnd * 1000 > t ? live.currentEnd : Math.floor((t + c.months * 31 * DAY_MS) / 1000);
            const status = !live.error && live.status === "active" ? "active" : "authenticated";
            return applyRzpEvent(authed, "activated", { status, current_end: end, remaining_count: live.error ? undefined : live.remainingCount }, cur.lastEventAt || null, t);
          });
          if (!updated) return gone();
          const now = effectivePlan(updated, t) === "pro";
          if (now && before !== "pro") {
            await recordEvent(storage, "progranted", { now: t, randomBytes, plan: "pro" });
            log("account", "checkout-return: Pro started");
          }
          return sendJson(res, 200, { ok: true, message: now ? "Payment received. Pro is on." : "Payment received; Pro starts in a minute or two.", ...view(updated) });
        }
        // cancel: a paid Pro stops renewing; Pro lasts until proUntil, and the webhook (T21) ends it.
        if (!paidPro(record, t) || !rzp.subscriptionId) return sendJson(res, 409, { error: "not_paid_pro" });
        if (rzp.cancelAtPeriodEnd === true) {
          // Cancelling again after setting up a renewal (T34) stops the renewal before it starts.
          const next = nextOf(record);
          if (!next) return sendJson(res, 200, { ok: true, ...view(record) });
          if (next.status === "authenticated") {
            const stop = await cancelSubscription({ env, fetchFn, subscriptionId: next.subscriptionId, atCycleEnd: false });
            if (stop.error) {
              log("account", "cancel: razorpay error " + stop.error);
              return sendJson(res, 502, { error: "payment_provider" });
            }
          }
          const { record: updated } = await save((r) => {
            const { next: gone_, ...cur } = rzpOf(r);
            return gone_ && gone_.subscriptionId === next.subscriptionId ? { ...r, rzp: cur } : null;
          });
          if (!updated) return gone();
          return sendJson(res, 200, { ok: true, ...view(updated) });
        }
        const done = await cancelSubscription({ env, fetchFn, subscriptionId: rzp.subscriptionId, atCycleEnd: true });
        if (done.error) {
          log("account", "cancel: razorpay error " + done.error);
          return sendJson(res, 502, { error: "payment_provider" });
        }
        const { record: updated } = await save((r) => {
          const cur = rzpOf(r);
          return cur.subscriptionId === rzp.subscriptionId ? { ...r, rzp: { ...cur, cancelAtPeriodEnd: true } } : null;
        });
        if (!updated) return gone();
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      if (action !== "request-pro") return sendJson(res, 400, { error: "unknown action" });
      if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
      if (effectivePlan(record, t) === "pro") return sendJson(res, 409, { error: "already_pro" });
      // The plan chosen on the page, if one was sent (T33), is kept with the request, so the owner's grant-pro
      // applies its categories and emails a day. A repeat request only updates the choice; the owner hears once.
      const sent = cats !== undefined || sweepsPerDay !== undefined || months !== undefined;
      const choice = sent ? readChoice({ cats, sweepsPerDay, months }, env) : null;
      if (choice && !choice.ok) return sendJson(res, 400, { error: choice.error });
      const proRequest = choice ? { cats: choice.cats, perDay: choice.perDay, months: choice.months } : null;
      if (record.proRequestedAt) {
        if (!proRequest) return sendJson(res, 200, { ok: true, ...view(record) }); // a repeat click
        const { record: again } = await save((r) => (r.proRequestedAt && effectivePlan(r, t) !== "pro" ? { ...r, proRequest } : null));
        return again ? sendJson(res, 200, { ok: true, ...view(again) }) : gone();
      }
      // Two clicks at once write one request and tell the owner once.
      const { record: updated, changed } = await save((r) => (r.proRequestedAt || effectivePlan(r, t) === "pro" ? null
        : { ...r, proRequestedAt: new Date(t).toISOString(), ...(proRequest ? { proRequest } : {}) }));
      if (!updated) return gone();
      if (changed) {
        await recordEvent(storage, "prorequested", { now: t, randomBytes, plan: "free" });
        await notifyOwnerProRequest({ env, fetchFn, at: t, source: "manage", log });
      }
      return sendJson(res, 200, { ok: true, ...view(updated) });
    } catch (e) {
      log("account", "error: " + ((e && e.name) || "Error"));
      return sendJson(res, 500, { error: "could not process the request; try again later" });
    }
  };
}

// ---- sign-in by emailed link (T16, docs/subscriptions/paid-website.md)

export const SIGNIN_MINUTES = 15;
export const SIGNIN_GAP_MINUTES = 5;
export const DEFAULT_MAX_SIGNINS_PER_DAY = 50;
const MINUTE_MS = 60 * 1000;

// The same words whether or not the address has an account, and whether or not a limit on that address
// (or the per-IP one) held the email back.
const SIGNIN_REPLY = { ok: true, message: "If that address has an account, a sign-in link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder. You can ask for a new link once every 5 minutes." };
// The day's MAX_SIGNINS_PER_DAY is shared by every address, so saying it was reached tells nothing about this one.
const SIGNIN_CAPPED = { ok: true, message: "Sign-in emails have hit today's limit. Try again after 00:00 UTC, or use the Manage link in any digest." };
const NOT_SET_UP = { title: "Sign-in isn't set up yet", body: `<p>Use the Manage link in any digest email instead.</p>` };
const SIGNIN_INVALID = { title: "This sign-in link isn't valid", body: `<p>It may have expired or been used already. <a href="/signin/">Get a new link</a>.</p>` };

const codeHash = (code) => createHash("sha256").update("radar-signin:" + code).digest("hex");

export const MAX_PW_FAILS_PER_IP_HOUR = 10;
export const MAX_PW_FAILS_PER_ACCOUNT_HOUR = 10;
const pwFailPrefix = (ip, t) => `${KEY_IPHIT_PREFIX}${utcHour(t)}-${createHash("sha256").update("radar-pw-ip:" + ip).digest("hex").slice(0, 16)}-`;
// An account's wrong passwords: { n, since }, counted from the first in the last hour.
const pwFailsNow = (f, t) => (f && Number.isInteger(f.n) && t - Date.parse(f.since) < HOUR_MS ? f : null);
const pwLocked = (record, t) => (pwFailsNow(record.pwFails, t)?.n ?? 0) >= MAX_PW_FAILS_PER_ACCOUNT_HOUR;
const nextPwFails = (f, t) => {
  const now = pwFailsNow(f, t);
  return now ? { n: now.n + 1, since: now.since } : { n: 1, since: new Date(t).toISOString() };
};

// Whether today's sign-in emails have reached MAX_SIGNINS_PER_DAY. A count we can't read counts as reached.
async function signinsCapped(env, storage, t) {
  const raw = String(env.MAX_SIGNINS_PER_DAY ?? "").trim();
  const maxPerDay = raw === "0" ? 0 : positiveInt(raw) ?? DEFAULT_MAX_SIGNINS_PER_DAY;
  let sentToday;
  try { sentToday = await countEvents(storage, { day: utcDay(t), type: "signinsent" }); } catch (e) { sentToday = Infinity; }
  return sentToday >= maxPerDay;
}

// Constant-time: the record's stored hash against the hash of the code given.
function signinOk(record, code, t) {
  const s = record && record.signin;
  if (!s || typeof s.hash !== "string" || typeof code !== "string" || !code) return false;
  if (!(Date.parse(s.exp) > t)) return false;
  const want = Buffer.from(s.hash);
  const got = Buffer.from(codeHash(code));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Emails an active record a sign-in link, unless one went in the last SIGNIN_GAP_MINUTES (the newest
// link replaces the last) or the day's MAX_SIGNINS_PER_DAY is reached. Returns "sent", "held", or
// how the send failed. The caller has already checked the per-IP limit. `already`: the address
// tried to sign up again (row 7), which changes the email's first line.
async function sendSignInLink({ record, env, storage, fetchFn, t, randomBytes, log, already = false }) {
  if (record.signin && t - Date.parse(record.signin.sentAt) < SIGNIN_GAP_MINUTES * MINUTE_MS) return "held";
  if (await signinsCapped(env, storage, t)) return "held";

  const site = siteUrl(env);
  const code = Buffer.from(randomBytes(32)).toString("base64url");
  // The gap is checked again on the stored record, so two requests at once send one link.
  const { changed } = await updateSubscriber(storage, record.id, (r) => (r.status !== "active" || (r.signin && t - Date.parse(r.signin.sentAt) < SIGNIN_GAP_MINUTES * MINUTE_MS) ? null : {
    ...r,
    signin: { hash: codeHash(code), exp: new Date(t + SIGNIN_MINUTES * MINUTE_MS).toISOString(), sentAt: new Date(t).toISOString() },
  }));
  if (!changed) return "held";
  await recordEvent(storage, "signinsent", { now: t, randomBytes, plan: effectivePlan(record, t) });
  const mail = buildSignInEmail({ signInUrl: `${site}/api/session?id=${record.id}&c=${code}`, siteUrl: site, already });
  const result = await sendOne({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, { to: record.email, ...mail }, {
    fetchFn,
    idempotencyKey: `signin-${record.id.slice(0, 24)}-${t}`,
  });
  if (result !== "sent") log(already ? "subscribe signin-email" : "session signin-email", result);
  return result;
}

// One endpoint, /api/session:
//   POST {action: "request", email, website}  emails a sign-in link to a confirmed address, or the
//                                              confirmation link again to one never confirmed
//   GET  ?id&c                                 the link: a Sign in button (mail scanners open links)
//   POST id, c                                 the button: uses the code, sets the cookie, 303 to /live/
//   GET  ?action=me                            {signedIn, plan, google} for the pages
//   GET  ?action=google[&pro=1]                "Continue with Google": off to Google (google.js)
//   GET  ?state&code (or ?state&error)         back from Google: signs in, or the Create account page
//   POST {action: "google-signup", wantsPro}   that page's button: makes the account and signs in
//   POST {action: "password", email, password} signs in with a password: {ok, next}, or 401 wrong_password,
//                                              403 not_confirmed, 429 too_many_tries
//   POST {action: "signout"}                   clears the cookie in this browser
// The code is random, stored only as a hash, works once and expires after SIGNIN_MINUTES.
export function makeSessionHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function session(req, res) {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    let q = req.query;
    if (!q || typeof q !== "object") q = Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
    const t = now();
    const secret = sessionSecret(env);

    if (req.method === "GET" && q.action === "me") {
      const rec = await readSession(req, { env, storage, now: t });
      return sendJson(res, 200, { signedIn: Boolean(rec), plan: rec ? effectivePlan(rec, t) : null, google: googleConfigured(env, { secret, site: siteUrl(env) }) });
    }
    if (req.method === "GET" && (q.action === "google" || q.state !== undefined)) {
      if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendPage(res, 503, PAUSED);
      const site = siteUrl(env);
      if (!googleConfigured(env, { secret, site })) return sendPage(res, 503, GOOGLE_OFF);
      if (q.action === "google") {
        const { url, cookie } = googleStart({ env, secret, site, now: t, randomBytes, pro: q.pro === "1" });
        res.statusCode = 302;
        res.setHeader("set-cookie", cookie);
        res.setHeader("location", url);
        res.setHeader("cache-control", "no-store");
        return res.end();
      }
      return googleReturn({ req, res, q, env, storage, fetchFn, t, randomBytes, log, secret, site });
    }

    let fields = {};
    if (req.method === "POST") {
      try {
        fields = await readFields(req, { limit: 4096 });
      } catch (e) {
        if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
        throw e;
      }
      if (!originOk(req)) return sendJson(res, 403, { error: "wrong_origin" });
      if (fields.action === "signout") {
        res.setHeader("set-cookie", clearCookie());
        return sendJson(res, 200, { ok: true });
      }
    }

    if (fields.action === "request") {
      const site = siteUrl(env);
      if (env.SUBSCRIPTIONS_ENABLED !== "1" || !secret || !env.RESEND_API_KEY || !senderOk(env.EMAIL_FROM) || !site) {
        return sendJson(res, 503, { error: "sign-in isn't set up yet" });
      }
      const reply = () => sendJson(res, 200, SIGNIN_REPLY);
      if (fields.website) return reply(); // the honeypot
      const email = normaliseEmail(fields.email);
      if (!email) return sendJson(res, 400, { error: "enter a valid email address" });
      try {
        if (await ipLimitReached({ req, env, storage, t, randomBytes })) return reply();
        // Checked before the address is looked up, so the reply is the same for every address.
        if (await signinsCapped(env, storage, t)) return sendJson(res, 200, SIGNIN_CAPPED);
        const record = await findSubscriber(storage, email);
        if (record && record.status === "active") await sendSignInLink({ record, env, storage, fetchFn, t, randomBytes, log });
        // Never confirmed: the confirmation link again (confirming signs you in), on sign-up's own
        // limits: CONFIRM_RESEND_MINUTES apart, MAX_CONFIRMS_PER_ADDRESS in all, within MAX_CONFIRMS_PER_DAY.
        if (record && record.status === "pending" && !confirmHeld(record, t)) {
          let sentToday;
          try { sentToday = await signupEmailsToday(storage, t); } catch (e) { sentToday = Infinity; }
          if (sentToday < maxConfirmsPerDay(env.MAX_CONFIRMS_PER_DAY)) {
            await sendConfirmation({ record: resent(record, t), isNew: false, env, storage, fetchFn, t, randomBytes, log, logAs: "session confirm-email" });
          }
        }
        return reply();
      } catch (e) {
        log("session", "error: " + ((e && e.name) || "Error"));
        return sendJson(res, 500, { error: "could not process the request; try again later" });
      }
    }
    // Email and password (2026-10-27). Wrong passwords are counted per IP and hour (beside the sign-up attempts, under
    // their own hash) and per account; with either limit reached, the answer is 429 for the rest of that hour. The
    // emailed link and Google still work then, and the link is the way back from a forgotten password.
    if (fields.action === "password") {
      if (env.SUBSCRIPTIONS_ENABLED !== "1" || !secret) return sendJson(res, 503, { error: "sign-in isn't set up yet" });
      const email = normaliseEmail(fields.email);
      const password = typeof fields.password === "string" ? fields.password : "";
      if (!email || !password) return sendJson(res, 400, { error: "enter your email address and password" });
      try {
        const ip = clientIp(req.headers);
        const prefix = ip ? pwFailPrefix(ip, t) : null;
        if (prefix) {
          let fails;
          try { fails = (await storage.list(prefix)).length; } catch (e) { fails = Infinity; }
          if (fails >= MAX_PW_FAILS_PER_IP_HOUR) return sendJson(res, 429, { error: "too_many_tries" });
        }
        const record = await findSubscriber(storage, email);
        if (record && pwLocked(record, t)) return sendJson(res, 429, { error: "too_many_tries" });
        // No account, or one without a password, takes as long to refuse (verifyPassword). A sign-up not confirmed
        // yet is checked against the password it was made with, so its owner is told to confirm first. The honeypot
        // gets the wrong-password answer.
        const active = Boolean(record) && record.status === "active";
        const ok = (await verifyPassword(password, active ? record.pw : record && record.status === "pending" ? record.pendingPw : null)) && !fields.website;
        if (!ok) {
          if (prefix) {
            try { await storage.set(prefix + Buffer.from(randomBytes(3)).toString("hex"), JSON.stringify({ at: new Date(t).toISOString() })); } catch (e) { /* best effort */ }
          }
          if (record && (record.pw || record.pendingPw)) await updateSubscriber(storage, record.id, (r) => ({ ...r, pwFails: nextPwFails(r.pwFails, t) }));
          return sendJson(res, 401, { error: "wrong_password" });
        }
        if (!active) return sendJson(res, 403, { error: "not_confirmed" });
        let rec = record;
        if (record.pwFails) {
          const out = await updateSubscriber(storage, record.id, (r) => { const { pwFails, ...rest } = r; return rest; });
          if (out.record) rec = out.record;
        }
        res.setHeader("set-cookie", sessionCookie(signSession(rec, { secret, now: t })));
        // Always the board: an account with a password is already confirmed, and the plan card was offered when it was
        // (the confirm link). A Free account that still wants Pro finds it on the board's "Go to your account".
        return sendJson(res, 200, { ok: true, next: "/live/" });
      } catch (e) {
        log("session password", "error: " + ((e && e.name) || "Error"));
        return sendJson(res, 500, { error: "could not process the request; try again later" });
      }
    }
    if (fields.action === "google-signup") {
      if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendPage(res, 503, PAUSED);
      if (!googleConfigured(env, { secret, site: siteUrl(env) })) return sendPage(res, 503, GOOGLE_OFF);
      return googleSignup({ req, res, fields, env, storage, fetchFn, t, randomBytes, log, secret });
    }
    if (req.method === "POST" && fields.action !== undefined) return sendJson(res, 400, { error: "unknown action" });

    // The link and its button. Unknown id, wrong code, used and expired all get the same page.
    if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendPage(res, 503, PAUSED);
    if (!secret) return sendPage(res, 503, NOT_SET_UP);
    const src = req.method === "POST" ? fields : q;
    const id = typeof src.id === "string" ? src.id : "";
    const code = typeof src.c === "string" ? src.c : "";
    try {
      const record = await getSubscriber(storage, id);
      if (!record || record.status !== "active" || !signinOk(record, code, t)) return sendPage(res, 400, SIGNIN_INVALID);
      if (req.method === "GET") {
        return sendPage(res, 200, { title: "Sign in to Travel Problem Radar", body: `<p>One click to sign in on this browser.</p>${hiddenForm("/api/session", id, code, "Sign in", "c")}` });
      }
      // The code is used once: checked again and cleared in one conditional write, so two presses
      // at the same moment can't both sign in.
      const { record: used, changed } = await updateSubscriber(storage, id, (r) => (r.status === "active" && signinOk(r, code, t) ? { ...r, signin: null } : null));
      if (!changed) return sendPage(res, 400, SIGNIN_INVALID);
      res.statusCode = 303;
      res.setHeader("set-cookie", sessionCookie(signSession(used, { secret, now: t })));
      res.setHeader("location", "/live/");
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      return res.end();
    } catch (e) {
      log("session", "error: " + ((e && e.name) || "Error"));
      return sendPage(res, 500, { title: "Something went wrong", body: "<p>Please try the link again in a minute.</p>" });
    }
  };
}

const GOOGLE_AGAIN = `<p><a href="/signin/">Try again</a>, or ask for a sign-in link by email instead.</p>`;
const GOOGLE_OFF = { title: "Google sign-in isn't set up yet", body: `<p><a href="/signin/">Sign in with a link by email</a> instead.</p>` };
const GOOGLE_CANCELLED = { title: "Google sign-in was cancelled", body: GOOGLE_AGAIN };
const GOOGLE_EXPIRED = { title: "This Google sign-in didn't finish", body: `<p>It took longer than ${OAUTH_MINUTES} minutes, or it was started in another browser.</p>${GOOGLE_AGAIN}` };
const GOOGLE_FAILED = { title: "Google sign-in didn't work", body: `<p>Google didn't confirm who you are.</p>${GOOGLE_AGAIN}` };
const GOOGLE_UNVERIFIED = { title: "Google hasn't verified this address", body: `<p>Use a Google account whose address is verified.</p>${GOOGLE_AGAIN}` };
const GOOGLE_SIGNUP_EXPIRED = { title: "This sign-up didn't finish", body: `<p>It took longer than ${OAUTH_MINUTES} minutes, or it was started in another browser. Nothing was created.</p><p><a href="/signup/">Start again</a>.</p>` };
const GOOGLE_CLOSED = { title: "New accounts are closed for now", body: "<p>We can't take new accounts at the moment. Please try again later.</p>" };
const GOOGLE_NOT_OPEN = { title: "Subscriptions are not open yet", body: "<p>New accounts can't be made yet. Please try again later.</p>" };
const GOOGLE_BUSY = { title: "Too many new accounts from this network", body: "<p>Please try again in an hour.</p>" };

// Back from Google. The address Google verified signs in its account; a pending one is activated
// (Google proved the address, as the confirm link would). A new address isn't made into an account
// here: it gets the "Create your account" page, and the cookie now holds that address until the
// person presses Create account (googleSignup). The "Pro" box counts only for a new or pending
// account, as at sign-up.
async function googleReturn({ req, res, q, env, storage, fetchFn, t, randomBytes, log, secret, site }) {
  const cookies = [clearOAuthCookie()];
  const page = (code, p) => { res.setHeader("set-cookie", cookies); return sendPage(res, code, p); };
  if (typeof q.error === "string") return page(400, GOOGLE_CANCELLED);
  const attempt = readOAuthCookie(parseCookies(req.headers && req.headers.cookie)[OAUTH_COOKIE], q.state, { secret, now: t });
  if (!attempt || typeof q.code !== "string" || !q.code) return page(400, GOOGLE_EXPIRED);
  const out = await googleFinish({ env, site, code: q.code, nonce: attempt.nonce, verifier: attempt.verifier, now: t, fetchFn });
  if (out.error) {
    log("session google", out.error);
    return page(out.error === "exchange" ? 502 : 400, out.error === "unverified" ? GOOGLE_UNVERIFIED : GOOGLE_FAILED);
  }
  try {
    const record = await findSubscriber(storage, out.email);
    if (!record) {
      const closed = await listClosed(env, storage);
      if (closed) return page(503, closed);
      res.setHeader("set-cookie", signupCookie({ email: out.email, secret, now: t }));
      return sendPage(res, 200, signupPage(out.email, attempt.pro));
    }
    return await googleSignIn({ res, record, pro: attempt.pro, env, storage, fetchFn, t, randomBytes, log, secret, cookies, page });
  } catch (e) {
    log("session google", "error: " + ((e && e.name) || "Error"));
    return page(500, { title: "Something went wrong", body: "<p>Please try again in a minute.</p>" });
  }
}

// The Create account button on that page: makes the Free account, active at once with no
// confirmation email (Google proved the address), under the same MAX_SUBSCRIBERS and per-IP limits
// as sign-up. If the address got an account meanwhile (a second press), it just signs in.
async function googleSignup({ req, res, fields, env, storage, fetchFn, t, randomBytes, log, secret }) {
  const cookies = [clearOAuthCookie()];
  const page = (code, p) => { res.setHeader("set-cookie", cookies); return sendPage(res, code, p); };
  const email = readSignupCookie(parseCookies(req.headers && req.headers.cookie)[OAUTH_COOKIE], { secret, now: t });
  if (!email) return page(400, GOOGLE_SIGNUP_EXPIRED);
  const pro = fields.wantsPro === "1" || fields.wantsPro === true;
  try {
    const record = await findSubscriber(storage, email);
    if (record) return await googleSignIn({ res, record, pro, env, storage, fetchFn, t, randomBytes, log, secret, cookies, page });
    if (await ipLimitReached({ req, env, storage, t, randomBytes })) return page(429, GOOGLE_BUSY);
    const closed = await listClosed(env, storage);
    if (closed) return page(503, closed);
    const made = newPending(email, { now: t, randomBytes });
    return await googleSignIn({ res, record: made, isNew: true, pro, env, storage, fetchFn, t, randomBytes, log, secret, cookies, page });
  } catch (e) {
    log("session google", "error: " + ((e && e.name) || "Error"));
    return page(500, { title: "Something went wrong", body: "<p>Please try again in a minute.</p>" });
  }
}

// The page for a new account that can't be made, or null. No cap set is a setup gap ("not open
// yet"); a full list, or a count that can't be read, is "closed for now".
const listClosed = async (env, storage) => {
  const maxSubs = positiveInt(env.MAX_SUBSCRIBERS);
  if (maxSubs === null) return GOOGLE_NOT_OPEN;
  const count = await readSubscriberCount(storage);
  return count === null || count >= maxSubs ? GOOGLE_CLOSED : null;
};

// Signs `record` in: an active account as it is; a pending one (or a new one, `isNew`) is made
// active first, with the subscribed/confirmed events and, with the Pro box, the Pro request.
async function googleSignIn({ res, record, isNew = false, pro, env, storage, fetchFn, t, randomBytes, log, secret, cookies, page }) {
  let activated = false; // made active by this sign-in, so a Pro box ticked at sign-up still waits to be paid for
  if (record.status === "pending") {
    const at = new Date(t).toISOString();
    record = isNew
      ? { ...record, status: "active", confirmSentAt: null, confirmSends: 0, confirmedAt: at }
      : { ...record, status: "active", confirmedAt: at };
    if (pro && !record.proRequestedAt) record.proRequestedAt = at;
    if (isNew) await putSubscriber(storage, record);
    else {
      // Confirmed by its link meanwhile: it just signs in, as an active account does.
      const made = record;
      // A password typed in at sign-up isn't turned on: only its own confirmation link does that.
      const out = await updateSubscriber(storage, record.id, (r) => {
        if (r.status !== "pending") return null;
        const { pendingPw, ...rest } = r;
        return { ...rest, status: "active", confirmedAt: at, proRequestedAt: r.proRequestedAt || made.proRequestedAt };
      });
      if (!out.record) return page(400, GOOGLE_FAILED);
      record = out.record;
      if (!out.changed) return signedIn();
    }
    activated = true;
    if (isNew) await recordEvent(storage, "subscribed", { now: t, randomBytes, plan: "free" });
    await recordEvent(storage, "confirmed", { now: t, randomBytes, plan: "free" });
    if (record.proRequestedAt && effectivePlan(record, t) !== "pro") {
      await recordEvent(storage, "prorequested", { now: t, randomBytes, plan: "free" });
      if (!paymentsReady(env)) await notifyOwnerProRequest({ env, fetchFn, at: t, source: "signup", log });
    }
  } else if (record.status !== "active") {
    return page(400, GOOGLE_FAILED); // anything unexpected
  }
  return signedIn();

  function signedIn() {
    if (record.status !== "active") return page(400, GOOGLE_FAILED);
    cookies.unshift(sessionCookie(signSession(record, { secret, now: t })));
    res.statusCode = 303;
    res.setHeader("set-cookie", cookies);
    // Pro ticked at the sign-up this completes, with payments on: straight to the plan card to pay. Any later
    // sign-in goes to the board, even if that Pro request was never paid for (the account page still offers Pro).
    res.setHeader("location", activated && record.proRequestedAt && paymentsReady(env) && effectivePlan(record, t) !== "pro" ? "/manage/?pay=1" : "/live/");
    res.setHeader("cache-control", "no-store");
    return res.end();
  }
}

const signupPage = (email, pro) => ({
  title: "Create your account",
  body: `<p>You&rsquo;re signing up with <b>${esc(email)}</b>, the address Google confirmed.</p>
<p>Your account includes the free daily summary: how many travel-industry problems were found in the last 24 hours, and their headlines. Unsubscribing from it deletes the account.</p>
<form method="post" action="/api/session"><input type="hidden" name="action" value="google-signup">
<p><label><input type="checkbox" name="wantsPro" value="1"${pro ? " checked" : ""}> I&rsquo;d also like Pro (the live board and 1 to 5 emails a day). You&rsquo;ll get the daily email until it&rsquo;s switched on.</label></p>
<p><button type="submit">Create account</button></p></form>
<p><small><a href="/">Cancel</a>: nothing is created. <a href="/legal/privacy/">Privacy policy</a></small></p>`,
});

// ---- bounces and complaints from Resend (T13 part A)

export const WEBHOOK_TOLERANCE_S = 300;
const WEBHOOK_MAX_BYTES = 64 * 1024;
const WEBHOOK_MAX_RECIPIENTS = 50;

// Resend signs webhooks the Svix way: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>",
// keyed with the base64 part of the secret after "whsec_", sent base64 in svix-signature as a
// space-separated list of "v1,<sig>". True only for a matching v1 signature on a timestamp
// within WEBHOOK_TOLERANCE_S of now (ms). Never throws.
export function verifySvix({ secret, id, timestamp, signature, raw, now }) {
  try {
    if (!secret || !id || !timestamp || !signature || typeof raw !== "string") return false;
    if (!/^\d{1,12}$/.test(timestamp)) return false;
    if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_S) return false;
    const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
    if (!key.length) return false;
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
    return String(signature).split(" ").some((part) => {
      const [version, sig] = part.split(",");
      if (version !== "v1" || !sig) return false;
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  } catch (e) { return false; }
}

const jsonResponse = (code, body) => new Response(JSON.stringify(body), {
  status: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

// The action a verified event asks for: "bounced" for a hard bounce, "complained" for a spam
// report, null for anything else (soft and undetermined bounces, other event types).
function webhookAction(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "email.complained") return "complained";
  if (event.type === "email.bounced" && event.data && event.data.bounce && event.data.bounce.type === "Permanent") return "bounced";
  return null;
}

// POST /api/resend-webhook, as a Web-standard handler: (Request) => Response. It reads the body
// with request.text() because the signature covers the exact bytes. A hard bounce or complaint
// deletes that subscriber's record, or for a Pro turns its emails off (T17: the account stays), and
// records an event with no address. Works while subscriptions are switched off, like unsubscribe:
// removing an address is always allowed.
export function makeResendWebhookHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function resendWebhook(request) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const secret = String(env.RESEND_WEBHOOK_SECRET || "").trim();
    if (!secret) {
      log("resend-webhook", "not configured");
      return jsonResponse(503, { error: "not configured" });
    }
    const declared = Number(request.headers.get("content-length"));
    if (declared > WEBHOOK_MAX_BYTES) return jsonResponse(413, { error: "request too large" });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > WEBHOOK_MAX_BYTES) return jsonResponse(413, { error: "request too large" });

    const t = now();
    const ok = verifySvix({
      secret, raw, now: t,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    });
    if (!ok) return jsonResponse(401, { error: "invalid signature" });

    let event;
    try { event = JSON.parse(raw); } catch (e) { return jsonResponse(400, { error: "malformed body" }); }
    const action = webhookAction(event);
    if (!action) return jsonResponse(200, { ok: true, ignored: true });

    const to = Array.isArray(event.data && event.data.to) ? event.data.to.slice(0, WEBHOOK_MAX_RECIPIENTS) : [];
    try {
      let matched = 0;
      for (const addr of to) {
        const email = normaliseEmail(addr);
        if (!email) continue;
        const record = await findSubscriber(storage, email);
        if (!record) continue; // not a subscriber, e.g. the owner's own EMAIL_TO
        const plan = effectivePlan(record, t);
        // A Free account goes, Razorpay first; one whose Razorpay plan won't cancel is kept with emails off, like Pro.
        if (plan === "pro" || await deleteAccount(record, { env, fetchFn, storage })) await updateSubscriber(storage, record.id, (r) => ({ ...r, emailOff: action }));
        await recordEvent(storage, action, { now: t, randomBytes, plan });
        matched++;
      }
      log("resend-webhook", `${action}: matched ${matched}`);
      return jsonResponse(200, { ok: true });
    } catch (e) {
      log("resend-webhook", "error: " + ((e && e.name) || "Error"));
      return jsonResponse(500, { error: "could not process the event; try again later" });
    }
  };
}

// ---- subscription events from Razorpay (T21)

// Razorpay delivers at least once and in no set order. Each applied event leaves a marker,
// radar:rzp-event:<YYYYMMDD-HHMM of the event>-<x-razorpay-event-id>, so a redelivery is a no-op; a
// redelivery has the same created_at, so its key is known without listing. The sweep deletes markers
// after RZP_EVENT_KEEP_DAYS (Razorpay stops retrying after 24 hours).
export const KEY_RZPEVENT_PREFIX = "radar:rzp-event:";
export const RZP_EVENT_KEEP_DAYS = 30;
const RZP_EVENT_ID = /^[A-Za-z0-9_]{1,64}$/;
const RZP_SUB_ID = /^sub_[A-Za-z0-9]{1,40}$/;
const RECORD_ID = /^[0-9a-f]{64}$/;
const RZP_STATUS = /^[a-z_]{1,20}$/;
const RZP_GRANT = new Set(["activated", "charged", "resumed"]);
const RZP_REVOKE = new Set(["halted", "paused"]);
const RZP_ENDING = new Set(["cancelled", "completed"]);
export const RENEW_GRACE_HOURS = 6;

// An event for a renewal waiting to start (T34). Approving it marks it authenticated; its first charge makes it the
// plan (the cancelled one is done with, and its later events are ignored); if it ends or fails first, it is dropped.
export function applyRenewalEvent(record, kind, entity, eventAt, t) {
  const rzp = rzpOf(record);
  const n = rzp.next;
  if (kind === "authenticated") return n.status === "created" ? { ...record, rzp: { ...rzp, next: { ...n, status: "authenticated" } } } : record;
  if (RZP_GRANT.has(kind) && secondsIso(entity.current_end)) {
    const promoted = { ...record, rzp: { subscriptionId: n.subscriptionId, status: n.status, createdAt: n.createdAt, currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null, choice: n.choice } };
    return applyRzpEvent(promoted, kind, entity, eventAt, t);
  }
  if (RZP_ENDING.has(kind) || RZP_REVOKE.has(kind)) {
    const { next: dropped, ...rest } = rzp;
    return { ...record, rzp: rest };
  }
  return record;
}
const secondsIso = (s) => (Number.isInteger(s) && s > 0 && s < 1e11 ? new Date(s * 1000).toISOString() : null);

// The record after one subscription event (kind: "activated", "halted", ...). Only a paid Pro
// (proSource "razorpay") is ever taken away, so an owner-granted Pro survives a failed payment;
// a paid activation takes an owner-granted Pro over. A Pro needs current_end, so it always ends.
export function applyRzpEvent(record, kind, entity, eventAt, t) {
  const rzp = rzpOf(record);
  const currentEnd = secondsIso(entity.current_end) || rzp.currentEnd || null;
  let status = typeof entity.status === "string" && RZP_STATUS.test(entity.status) ? entity.status : rzp.status || null;
  if (kind === "authenticated" && rzp.status && rzp.status !== "created") status = rzp.status; // never back from active
  // remaining_count 0 means this is the last cycle: the plan won't renew (T34's warning).
  const remaining = Number.isInteger(entity.remaining_count) && entity.remaining_count >= 0 ? entity.remaining_count : rzp.remaining ?? null;
  let next = { ...record, rzp: { ...rzp, status, currentEnd, lastEventAt: eventAt, remaining } };
  const paid = record.proSource === "razorpay";
  if (RZP_GRANT.has(kind) && currentEnd) {
    next = { ...next, plan: "pro", proSource: "razorpay", proUntil: currentEnd, proRequestedAt: null };
    // The first grant for a subscription applies the categories and emails a day chosen at checkout (T33) and
    // records the period paid for; later charges keep the member's own changes.
    const c = rzp.choice;
    if (c && typeof c === "object" && (!record.paidFor || record.paidFor.sub !== rzp.subscriptionId)) {
      next = { ...next, cats: c.cats || null, sweepsPerDay: c.perDay,
        paidFor: { sub: rzp.subscriptionId, months: c.months, price: c.price } };
      delete next.proRequest;
    }
  }
  else if (RZP_REVOKE.has(kind) && paid) next = { ...next, plan: "free", proSource: null, proUntil: null };
  else if (RZP_ENDING.has(kind) && paid) {
    // A renewal the member approved (T34) starts at this end; Pro holds for RENEW_GRACE_HOURS while its first charge lands.
    const waiting = rzp.next && rzp.next.status === "authenticated";
    const until = waiting ? new Date(Math.max(Date.parse(currentEnd) || 0, t) + RENEW_GRACE_HOURS * 3600_000).toISOString() : currentEnd;
    next = Date.parse(until) > t ? { ...next, proUntil: until } : { ...next, plan: "free", proSource: null, proUntil: null };
  }
  return next;
}

// The record a subscription belongs to: through the radar:rzpsub: index, else the sid that checkout
// put in the subscription's notes. A storage failure throws (so Razorpay retries); a record whose
// own subscription is a different one (an abandoned checkout) counts as not found.
async function findRzpRecord(storage, entity) {
  let id = null;
  const idx = await storage.get(KEY_RZPSUB_PREFIX + entity.id);
  if (idx !== null) { try { id = JSON.parse(idx).id; } catch (e) { /* unreadable index: try notes */ } }
  if (!id && entity.notes && typeof entity.notes.sid === "string") id = entity.notes.sid;
  if (typeof id !== "string" || !RECORD_ID.test(id)) return null;
  const v = await storage.get(KEY_SUB_PREFIX + id);
  if (v === null) return null;
  let record;
  try { record = JSON.parse(v); } catch (e) { return null; }
  return record && record.id === id && (rzpOf(record).subscriptionId === entity.id || (nextOf(record) || {}).subscriptionId === entity.id) ? record : null;
}

// POST /api/razorpay-webhook. Signed with RAZORPAY_WEBHOOK_SECRET (HMAC-SHA256 of the raw body, hex,
// in x-razorpay-signature). Answers 2xx for anything it has handled or chosen to ignore, and 500 only
// when storage fails, so Razorpay retries just those.
export function makeRazorpayWebhookHandler({ env, storage, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function razorpayWebhook(request) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const secret = String(env.RAZORPAY_WEBHOOK_SECRET || "").trim();
    if (!secret) {
      log("rzp-webhook", "not configured");
      return jsonResponse(503, { error: "not configured" });
    }
    const declared = Number(request.headers.get("content-length"));
    if (declared > WEBHOOK_MAX_BYTES) return jsonResponse(413, { error: "request too large" });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > WEBHOOK_MAX_BYTES) return jsonResponse(413, { error: "request too large" });
    if (!verifyWebhook(raw, request.headers.get("x-razorpay-signature"), secret)) return jsonResponse(401, { error: "invalid signature" });

    let event;
    try { event = JSON.parse(raw); } catch (e) { return jsonResponse(400, { error: "malformed body" }); }
    const name = event && typeof event.event === "string" ? event.event : "";
    const kind = name.startsWith("subscription.") ? name.slice("subscription.".length) : "";
    const entity = event && event.payload && event.payload.subscription && event.payload.subscription.entity;
    const eventAt = secondsIso(event && event.created_at);
    if (!kind || !entity || typeof entity !== "object" || !RZP_SUB_ID.test(String(entity.id)) || !eventAt) {
      log("rzp-webhook", "ignored: " + (RZP_STATUS.test(kind) ? kind : "not a subscription event"));
      return jsonResponse(200, { ok: true, ignored: true });
    }
    const eventId = String(request.headers.get("x-razorpay-event-id") || "");
    const marker = RZP_EVENT_ID.test(eventId) ? `${KEY_RZPEVENT_PREFIX}${eventAt.slice(0, 10).replace(/-/g, "")}-${eventAt.slice(11, 16).replace(":", "")}-${eventId}` : null;

    const t = now();
    try {
      if (marker && (await storage.get(marker)) !== null) {
        log("rzp-webhook", `${kind}: duplicate`);
        return jsonResponse(200, { ok: true, duplicate: true });
      }
      const record = await findRzpRecord(storage, entity);
      if (!record) {
        log("rzp-webhook", `${kind}: unknown subscription`);
        return jsonResponse(200, { ok: true, unknown: true });
      }
      // Applied to the record as stored at the moment of writing: another event (or Checkout's
      // return) that lands meanwhile makes this re-read and decide again, rather than be overwritten.
      let before = "free";
      let why = "unknown";
      const { record: next, changed } = await updateSubscriber(storage, record.id, (r) => {
        const cur = rzpOf(r);
        before = effectivePlan(r, t);
        why = "unknown";
        if (cur.next && cur.next.subscriptionId === entity.id && cur.subscriptionId !== entity.id) return applyRenewalEvent(r, kind, entity, eventAt, t);
        if (cur.subscriptionId !== entity.id) return null;
        const last = Date.parse(cur.lastEventAt);
        if (Number.isFinite(last) && Date.parse(eventAt) < last) { why = "stale"; return null; }
        return applyRzpEvent(r, kind, entity, eventAt, t);
      });
      if (!changed) {
        log("rzp-webhook", why === "stale" ? `${kind}: stale, a newer event was applied` : `${kind}: unknown subscription`);
        return jsonResponse(200, why === "stale" ? { ok: true, stale: true } : { ok: true, unknown: true });
      }
      const after = effectivePlan(next, t);
      if (before !== after) await recordEvent(storage, after === "pro" ? "progranted" : "prorevoked", { now: t, randomBytes, plan: after });
      if (marker) await storage.set(marker, JSON.stringify({ at: new Date(t).toISOString() }));
      log("rzp-webhook", `${kind}: plan ${before} -> ${after}`);
      return jsonResponse(200, { ok: true });
    } catch (e) {
      log("rzp-webhook", "error: " + ((e && e.name) || "Error"));
      return jsonResponse(500, { error: "could not process the event; try again later" });
    }
  };
}
