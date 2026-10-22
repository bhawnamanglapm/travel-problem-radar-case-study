// The login cookie (docs/subscriptions/paid-website.md, T16). It holds a subscriber id, an expiry
// and a session version, signed with SESSION_SECRET; the plan is always read from the record.
// The signature also covers the record's createdAt (not in the cookie), so a record deleted and
// made again for the same address doesn't accept cookies from before. Nothing here logs.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSubscriber } from "./subscribers.js";

export const SESSION_COOKIE = "tpr_session";
export const SESSION_DAYS = 30;
export const MIN_SECRET_LENGTH = 32;

const COOKIE_RE = /^([0-9a-f]{64})\.(\d{1,12})\.(\d{1,9})\.([A-Za-z0-9_-]{43})$/;

// The secret, or "" when it is unset or too short to trust (then nobody can sign in).
export const sessionSecret = (env) => {
  const s = String((env && env.SESSION_SECRET) || "").trim();
  return s.length >= MIN_SECRET_LENGTH ? s : "";
};

const sessionVer = (record) => (Number.isInteger(record.sessionVer) && record.sessionVer >= 0 ? record.sessionVer : 0);

const mac = (secret, payload, createdAt) => createHmac("sha256", secret).update(`${payload}.${createdAt}`).digest("base64url");

// The cookie's value for this record, valid SESSION_DAYS from now (ms).
export function signSession(record, { secret, now }) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = `${record.id}.${exp}.${sessionVer(record)}`;
  return `${payload}.${mac(secret, payload, record.createdAt)}`;
}

// name=value pairs from a Cookie header. The first of a repeated name wins.
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

// The signed-in subscriber's record, or null: no cookie, a bad signature, expired, a record that
// is gone or not active, a sessionVer that has moved on, or no usable secret. Never throws.
export async function readSession(req, { env, storage, now }) {
  try {
    const secret = sessionSecret(env);
    if (!secret) return null;
    const m = COOKIE_RE.exec(parseCookies(req.headers && req.headers.cookie)[SESSION_COOKIE] || "");
    if (!m) return null;
    const [, id, exp, ver, sig] = m;
    if (Number(exp) * 1000 <= now) return null;
    const record = await getSubscriber(storage, id);
    if (!record || record.id !== id || record.status !== "active" || sessionVer(record) !== Number(ver)) return null;
    const want = Buffer.from(mac(secret, `${id}.${exp}.${ver}`, record.createdAt));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want) ? record : null;
  } catch (e) { return null; }
}

const ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax";
export const sessionCookie = (value) => `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_DAYS * 24 * 3600}; ${ATTRS}`;
export const clearCookie = () => `${SESSION_COOKIE}=; Max-Age=0; ${ATTRS}`;

// For a POST that a cookie authenticates: an Origin header, when the browser sends one, must name
// this host. On top of SameSite=Lax, so another site can't make a signed-in browser act.
export function originOk(req) {
  const h = req.headers || {};
  const origin = h.origin;
  if (origin === undefined) return true;
  try {
    return new URL(String(origin)).host === String(h.host || "");
  } catch (e) { return false; }
}
