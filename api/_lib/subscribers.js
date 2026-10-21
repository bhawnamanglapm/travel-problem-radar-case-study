// Subscriber records and event records (docs/subscriptions/tasks/T02). One small file per
// subscriber, so two sign-ups at the same moment can't overwrite each other. The record holds
// the address because sending needs it: it is never logged, and only getSubscriber and
// listSubscribers hand it back, to their caller.
// Times are milliseconds since the epoch (what the handlers' injected now() returns).
import { createHash, timingSafeEqual } from "node:crypto";
import { CATS } from "./radar.js";

export const KEY_SUB_PREFIX = "radar:sub:";
export const KEY_EVENT_PREFIX = "radar:event:";
export const PENDING_TTL_DAYS = 7;
export const CONFIRM_RESEND_HOURS = 24;

// Letters only, so an event's key round-trips through storage.js's path().
export const EVENT_TYPES = ["subscribed", "confirmsent", "confirmed", "unsubscribed", "expired",
  "bounced", "complained", "progranted", "prorevoked", "prorequested"];

const ID_RE = /^[0-9a-f]{64}$/;

// Deliberately simple: the confirmation email is the real check.
export function normaliseEmail(s) {
  if (typeof s !== "string") return null;
  const e = s.trim().toLowerCase();
  if (!e || e.length > 254 || /[\s,<>"'`;()\\]/.test(e)) return null;
  const parts = e.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const domain = parts[1];
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  return e;
}

// One inbox, one subscriber: the address the id is made from. Gmail ignores dots and anything after
// "+", and treats googlemail.com as gmail.com; the other providers listed ignore anything after "+".
// Any other domain is left as typed, because a company's mail server may treat both differently.
const PLUS_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "fastmail.com"]);
export function canonicalEmail(s) {
  const e = normaliseEmail(s);
  if (!e) return null;
  let [local, domain] = e.split("@");
  if (domain === "googlemail.com") domain = "gmail.com";
  if (PLUS_DOMAINS.has(domain)) {
    let l = local.split("+")[0];
    if (domain === "gmail.com") l = l.replace(/\./g, "");
    if (l) local = l; // "+x@gmail.com" or ".@gmail.com": keep what was typed
  }
  return local + "@" + domain;
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function subscriberId(email) {
  const e = canonicalEmail(email);
  return e ? sha256(e) : null;
}

// The id from before canonicalEmail (the address only trimmed and lowercased). Records made then
// keep that id, because the links in their emails carry it.
export function legacySubscriberId(email) {
  const e = normaliseEmail(email);
  return e ? sha256(e) : null;
}

// The record for an address: by its id, else by the id it would have had before canonicalEmail.
export async function findSubscriber(storage, email) {
  const id = subscriberId(email);
  if (!id) return null;
  const r = await getSubscriber(storage, id);
  if (r) return r;
  const old = legacySubscriberId(email);
  return old !== id ? getSubscriber(storage, old) : null;
}

// 32 random bytes from the injected source, base64url: 43 characters.
export const newToken = (randomBytes) => Buffer.from(randomBytes(32)).toString("base64url");

// Constant-time, length checked first, like bearerOk() in handlers.js.
export function tokenOk(record, token) {
  if (!record || typeof record.token !== "string" || typeof token !== "string" || !token) return false;
  const want = Buffer.from(record.token);
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function getSubscriber(storage, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  try {
    const v = await storage.get(KEY_SUB_PREFIX + id);
    if (v == null) return null;
    const r = JSON.parse(v);
    return r && typeof r === "object" ? r : null;
  } catch (e) { return null; }
}

export async function putSubscriber(storage, record) {
  if (!record || typeof record.id !== "string" || !ID_RE.test(record.id)) throw new Error("putSubscriber: bad id");
  await storage.set(KEY_SUB_PREFIX + record.id, JSON.stringify(record));
}

export async function deleteSubscriber(storage, id) {
  if (typeof id !== "string" || !ID_RE.test(id)) return;
  await storage.del(KEY_SUB_PREFIX + id);
}

// Every record, read with at most `concurrency` reads at once. A record that can't be read or
// parsed is skipped and counted, so one bad file never stops a sweep. A failing list() throws.
export async function listSubscribers(storage, { concurrency = 8 } = {}) {
  const ids = (await storage.list(KEY_SUB_PREFIX)).filter((id) => ID_RE.test(id));
  const records = [];
  let skipped = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      const r = await getSubscriber(storage, id);
      if (r && r.id === id) records.push(r); else skipped++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { records, skipped };
}

// "pro" only for a confirmed Pro record whose end date, if it has one, is still ahead.
// Anything unexpected (pending, unknown plan, unreadable date) is "free".
export function effectivePlan(record, now) {
  if (!record || record.status !== "active" || record.plan !== "pro") return "free";
  if (record.proUntil == null) return "pro";
  const until = Date.parse(record.proUntil);
  return Number.isFinite(until) && until > now ? "pro" : "free";
}

// A Pro subscriber's chosen categories (T14). Takes the list the manage page sent and returns
// { ok: true, cats } with cats in CATS order and without repeats, or null when all four are chosen,
// so "all" is stored one way only. Anything else (not a list, empty, an unknown key) is { ok: false }.
export function normaliseCats(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > CATS.length) return { ok: false };
  if (!input.every((k) => typeof k === "string" && CATS.some((c) => c.key === k))) return { ok: false };
  const cats = CATS.map((c) => c.key).filter((k) => input.includes(k));
  return { ok: true, cats: cats.length === CATS.length ? null : cats };
}

export function newPending(email, { now, randomBytes }) {
  const e = normaliseEmail(email);
  if (!e) throw new Error("newPending: bad address");
  const at = new Date(now).toISOString();
  return {
    v: 1,
    id: subscriberId(e),
    email: e,
    status: "pending",
    plan: "free",
    proUntil: null,
    proSource: null,
    token: newToken(randomBytes),
    createdAt: at,
    confirmSentAt: at,
    confirmedAt: null,
    proRequestedAt: null, // set when the subscriber asks for Pro; the owner grants it (until payments exist)
    cats: null,
    rzp: null,
  };
}

// ---- event records: sign-up metrics with no address and no id

export const utcDay = (now) => new Date(now).toISOString().slice(0, 10).replace(/-/g, "");

// Never throws: a failed metric must not fail a sign-up.
export async function recordEvent(storage, type, { now, randomBytes, plan = null } = {}) {
  try {
    if (!EVENT_TYPES.includes(type)) return false;
    const iso = new Date(now).toISOString(); // 2026-10-21T08:09:10.123Z
    const stamp = iso.slice(11, 23).replace(/[:.]/g, ""); // HHMMSSmmm
    const key = `${KEY_EVENT_PREFIX}${utcDay(now)}-${stamp}-${type}-${Buffer.from(randomBytes(3)).toString("hex")}`;
    await storage.set(key, JSON.stringify({ type, at: iso, plan: plan === "free" || plan === "pro" ? plan : null }));
    return true;
  } catch (e) { return false; }
}

// How many events of one type were recorded on one UTC day (day = "YYYYMMDD"). Reads no file
// contents. Throws if listing fails: a caller using the count as a cap should treat that as "full".
export async function countEvents(storage, { day, type }) {
  const suffixes = await storage.list(`${KEY_EVENT_PREFIX}${day}-`);
  return suffixes.filter((s) => s.includes(`-${type}-`)).length;
}
