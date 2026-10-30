// The owner's dashboard (/admin/): every subscriber with their plan, a summary, and the per-day counts that
// scripts/subscribers.mjs stats prints. Signing in takes ADMIN_USER and ADMIN_PASSWORD (Vercel variables, never
// the repo) and gives an admin cookie signed with a key made from both, so changing the password signs the admin
// out everywhere. Each load reads every subscriber record and lists the events and delivery files: 3 Blob
// advanced operations, plus one simple read per record. Nothing here logs an address or a credential.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { allowMethods, BodyTooLargeError, readFields, sendJson } from "./http.js";
import { CATS } from "./radar.js";
import { originOk, parseCookies } from "./session.js";
import { KEY_EVENT_PREFIX, areaChoices, effectivePlan, listSubscribers, normaliseAreas, readAreas, utcDay } from "./subscribers.js";
import { KEY_IPHIT_PREFIX, clientIp, paymentsCheck, utcHour } from "./subscription-handlers.js";

const DAY_MS = 24 * 3600 * 1000;
const KEY_DELIVERIES_PREFIX = "radar:deliveries:";
const EVENT_RE = /^(\d{8})-\d{9}-([a-z]+)-[0-9a-f]{6}$/; // suffix after "radar:event:"

export const ADMIN_COOKIE = "tpr_admin";
// The admin cookie lasts until the browser closes, and its signed expiry is a backstop.
export const ADMIN_HOURS = 8;
export const MIN_ADMIN_PASSWORD = 16;
// Wrong logins from one IP in a UTC hour before the endpoint stops checking them; each one also waits a second.
export const ADMIN_MAX_FAILS_PER_HOUR = 5;
export const ADMIN_FAIL_DELAY_MS = 1000;

const sha = (s) => createHash("sha256").update(s).digest();

// { user, password }, or null when either is unset or the password is shorter than MIN_ADMIN_PASSWORD.
export function adminCreds(env) {
  const user = String((env && env.ADMIN_USER) || "").trim();
  const password = String((env && env.ADMIN_PASSWORD) || "");
  return user && password.length >= MIN_ADMIN_PASSWORD ? { user, password } : null;
}

// Both compared in constant time, as hashes so the lengths don't show, and both always compared.
export function credsOk(creds, user, password) {
  if (!creds || typeof user !== "string" || typeof password !== "string") return false;
  const u = timingSafeEqual(sha("u:" + user), sha("u:" + creds.user));
  const p = timingSafeEqual(sha("p:" + password), sha("p:" + creds.password));
  return u && p;
}

const COOKIE_RE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
const mac = (creds, exp) => createHmac("sha256", sha(`radar-admin:${creds.user}\n${creds.password}`)).update(`admin.${exp}`).digest("base64url");

export function signAdmin(creds, now) {
  const exp = Math.floor(now / 1000) + ADMIN_HOURS * 3600;
  return `${exp}.${mac(creds, exp)}`;
}

// True for a valid, unexpired admin cookie made with today's credentials. Never throws.
export function readAdmin(req, { env, now }) {
  try {
    const creds = adminCreds(env);
    const m = creds && COOKIE_RE.exec(parseCookies(req.headers && req.headers.cookie)[ADMIN_COOKIE] || "");
    if (!m || Number(m[1]) * 1000 <= now) return false;
    const want = Buffer.from(mac(creds, m[1]));
    const got = Buffer.from(m[2]);
    return got.length === want.length && timingSafeEqual(got, want);
  } catch (e) { return false; }
}

// Strict and only for /api/admin: the cookie goes nowhere else, and never on a request another site starts.
const ATTRS = "Path=/api/admin; HttpOnly; Secure; SameSite=Strict";
export const adminCookie = (value) => `${ADMIN_COOKIE}=${value}; ${ATTRS}`;
export const clearAdminCookie = () => `${ADMIN_COOKIE}=; Max-Age=0; ${ATTRS}`;

// Wrong logins are counted per IP and hour beside the sign-up attempts (radar:iphit:, which the sweep tidies),
// under their own hash so the two limits don't share a count.
const failPrefix = (ip, t) => `${KEY_IPHIT_PREFIX}${utcHour(t)}-${createHash("sha256").update("radar-admin-ip:" + ip).digest("hex").slice(0, 16)}-`;

// ---- what the dashboard shows

const PERIODS = { 1: "monthly", 12: "yearly" };
const obj = (v) => (v && typeof v === "object" ? v : null);

// One subscriber as the dashboard shows them: the address and plan, never the token or sign-in code.
export function adminRow(r, t) {
  const rzp = obj(r.rzp) || {};
  const paid = obj(r.paidFor);
  const choice = obj(rzp.choice);
  const next = obj(rzp.next);
  const pro = effectivePlan(r, t) === "pro";
  const months = (paid && paid.months) || (choice && choice.months) || null;
  const areas = normaliseAreas(readAreas(r)); // as delivery reads it: a stored value that isn't valid means all areas
  return {
    email: typeof r.email === "string" ? r.email : "",
    status: r.status === "active" || r.status === "pending" ? r.status : "unknown",
    plan: effectivePlan(r, t),
    lapsed: r.status === "active" && r.plan === "pro" && !pro,
    proSource: r.proSource === "razorpay" || r.proSource === "owner" ? r.proSource : null,
    period: r.proSource === "razorpay" ? PERIODS[months] || null : null,
    price: r.proSource === "razorpay" && paid && Number.isFinite(paid.price) ? paid.price : null,
    cats: Array.isArray(r.cats) ? r.cats : null,
    areas: areas.ok ? areas.areas : null,
    sweepsPerDay: Number.isInteger(r.sweepsPerDay) ? r.sweepsPerDay : null,
    createdAt: r.createdAt || null,
    confirmedAt: r.confirmedAt || null,
    proUntil: r.proUntil || null,
    proRequestedAt: r.proRequestedAt || null,
    // A paid Pro: "renews", "cancelled" (ends at proUntil) or Razorpay's retry states.
    billing: r.proSource === "razorpay" && pro ? (rzp.cancelAtPeriodEnd === true ? "cancelled" : rzp.status === "pending" || rzp.status === "halted" ? rzp.status : "renews") : null,
    renewal: next && next.status === "authenticated" && obj(next.choice) ? { period: PERIODS[next.choice.months] || null, startsAt: next.startAt || null } : null,
    emailOff: r.emailOff || null,
  };
}

// Totals over the rows. Categories, areas and emails a day count Pro members only (Free gets every category and
// area, once a day).
export function summarize(rows) {
  const s = {
    total: rows.length, pending: 0, free: 0, pro: 0, lapsed: 0, waitingForPro: 0, emailOff: 0,
    proBySource: { razorpay: 0, owner: 0 }, proByPeriod: { monthly: 0, yearly: 0 }, billing: { renews: 0, cancelled: 0, pending: 0, halted: 0 },
    cats: Object.fromEntries(CATS.map((c) => [c.key, 0])), allCats: 0, perDay: {},
    areas: Object.fromEntries(areaChoices().map((a) => [a, 0])), allAreas: 0,
    paid: { monthly: 0, yearly: 0 }, monthlyValue: 0,
  };
  for (const r of rows) {
    if (r.status === "pending") { s.pending++; continue; }
    if (r.status !== "active") continue;
    if (r.emailOff) s.emailOff++;
    if (r.plan !== "pro") {
      s.free++;
      if (r.lapsed) s.lapsed++;
      if (r.proRequestedAt) s.waitingForPro++;
      continue;
    }
    s.pro++;
    if (r.proSource) s.proBySource[r.proSource]++;
    if (r.period) s.proByPeriod[r.period]++;
    if (r.billing) s.billing[r.billing]++;
    if (r.cats) for (const k of r.cats) { if (k in s.cats) s.cats[k]++; } else s.allCats++;
    if (r.areas) for (const a of r.areas) { if (a in s.areas) s.areas[a]++; } else s.allAreas++;
    const d = r.sweepsPerDay || "default";
    s.perDay[d] = (s.perDay[d] || 0) + 1;
    if (r.period && r.price) { s.paid[r.period] += r.price; s.monthlyValue += r.period === "yearly" ? r.price / 12 : r.price; }
  }
  s.monthlyValue = Math.round(s.monthlyValue);
  return s;
}

// Counts now, from the records, and per UTC day, from event records and delivery files. No addresses.
// `list` is listSubscribers' answer when the caller already has it, so the records aren't read twice.
export async function computeStats(storage, { now, days = 30, list = null }) {
  const { records, skipped } = list || await listSubscribers(storage);
  const cur = { pending: 0, free: 0, pro: 0, proExpiring7d: 0, proRequested: 0, unreadable: skipped };
  for (const r of records) {
    if (r.status === "pending") cur.pending++;
    else if (r.status === "active") {
      if (effectivePlan(r, now) === "pro") {
        cur.pro++;
        if (r.proUntil != null && Date.parse(r.proUntil) <= now + 7 * DAY_MS) cur.proExpiring7d++;
      } else {
        cur.free++;
        if (r.proRequestedAt) cur.proRequested++; // asked for Pro, not granted yet
      }
    } else cur.unreadable++;
  }

  const first = utcDay(now - (days - 1) * DAY_MS);
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(utcDay(now - i * DAY_MS));
  const perDay = new Map(dayList.map((d) => [d, { day: d, subscribed: 0, confirmsent: 0, noticesent: 0, confirmed: 0, unsubscribedFree: 0, unsubscribedPro: 0, expired: 0, bounced: 0, complained: 0, prorequested: 0, signinsent: 0, freeDelivered: 0 }]));
  const totals = { subscribed: 0, confirmsent: 0, noticesent: 0, confirmed: 0, unsubscribed: 0, expired: 0, bounced: 0, complained: 0, prorequested: 0, signinsent: 0 };

  for (const suffix of await storage.list(KEY_EVENT_PREFIX)) {
    const m = EVENT_RE.exec(suffix);
    if (!m || m[1] < first || m[1] > dayList[dayList.length - 1]) continue;
    const [, day, type] = m;
    const row = perDay.get(day);
    if (!row) continue;
    if (type === "emailoff") {
      // A Pro who unsubscribes keeps the account (T17), so its unsubscribe is recorded as emailoff.
      row.unsubscribedPro++;
      totals.unsubscribed++;
    } else if (type === "unsubscribed") {
      let plan = null;
      try { plan = JSON.parse(await storage.get(KEY_EVENT_PREFIX + suffix)).plan; } catch (e) { /* counted as free below */ }
      if (plan === "pro") row.unsubscribedPro++; else row.unsubscribedFree++;
      totals.unsubscribed++;
    } else if (type in totals) {
      row[type]++;
      totals[type]++;
    }
  }
  for (const suffix of await storage.list(KEY_DELIVERIES_PREFIX)) {
    const row = perDay.get(suffix);
    if (!row) continue;
    try {
      const f = JSON.parse(await storage.get(KEY_DELIVERIES_PREFIX + suffix));
      row.freeDelivered = Array.isArray(f && f.free) ? f.free.length : 0;
    } catch (e) { /* an unreadable file counts as 0 */ }
  }
  return {
    now: cur, days, totals, perDay: dayList.map((d) => perDay.get(d)),
    confirmRate: totals.subscribed > 0 ? totals.confirmed / totals.subscribed : null,
  };
}

// ---- the endpoint

// GET ?days=N (1 to 90, default 30): the dashboard's data, for a signed-in admin; 401 otherwise. `payments` says
// whether Razorpay payments are on for this deployment and, if not, which variables are missing (names only).
// POST {action: "login", user, password}: sets the admin cookie, or 401 after a one-second wait; 429 once an IP
// has had ADMIN_MAX_FAILS_PER_HOUR wrong tries this hour. POST {action: "logout"} clears it. A POST must come from
// this site (originOk). With ADMIN_USER or ADMIN_PASSWORD unset or too short, every request is 503.
export function makeAdminHandler({ env, storage, now, randomBytes, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  return async function admin(req, res) {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    const creds = adminCreds(env);
    if (!creds) return sendJson(res, 503, { error: "admin_not_set_up" });
    const t = now();
    if (req.method === "POST") {
      if (!originOk(req)) return sendJson(res, 403, { error: "wrong_origin" });
      let f;
      try { f = await readFields(req, { limit: 2048 }); } catch (e) {
        if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
        throw e;
      }
      if (f.action === "logout") return sendJson(res, 200, { ok: true }, { "set-cookie": clearAdminCookie() });
      if (f.action !== "login") return sendJson(res, 400, { error: "unknown_action" });
      const ip = clientIp(req.headers);
      const prefix = ip ? failPrefix(ip, t) : null;
      if (prefix) {
        let fails;
        try { fails = (await storage.list(prefix)).length; } catch (e) { fails = Infinity; }
        if (fails >= ADMIN_MAX_FAILS_PER_HOUR) return sendJson(res, 429, { error: "too_many_tries" });
      }
      if (!credsOk(creds, f.user, f.password)) {
        if (prefix) {
          try { await storage.set(prefix + Buffer.from(randomBytes(3)).toString("hex"), JSON.stringify({ at: new Date(t).toISOString() })); } catch (e) { /* best effort */ }
        }
        log("admin", "login refused");
        await sleep(ADMIN_FAIL_DELAY_MS);
        return sendJson(res, 401, { error: "wrong_login" });
      }
      log("admin", "signed in");
      return sendJson(res, 200, { ok: true }, { "set-cookie": adminCookie(signAdmin(creds, t)) });
    }
    if (!readAdmin(req, { env, now: t })) return sendJson(res, 401, { error: "not_signed_in" });
    let q = req.query;
    if (!q || typeof q !== "object") q = Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
    const days = /^\d{1,2}$/.test(String(q.days || "")) && Number(q.days) >= 1 && Number(q.days) <= 90 ? Number(q.days) : 30;
    const list = await listSubscribers(storage);
    const rows = list.records.map((r) => adminRow(r, t)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const stats = await computeStats(storage, { now: t, days, list });
    return sendJson(res, 200, { generatedAt: new Date(t).toISOString(), payments: paymentsCheck(env), summary: summarize(rows), unreadable: list.skipped, subscribers: rows, stats },
      { "x-robots-tag": "noindex" });
  };
}
