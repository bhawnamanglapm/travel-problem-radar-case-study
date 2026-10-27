// Passwords (2026-10-27): optional, beside the emailed sign-in link and Google. Only a scrypt hash is stored, on the
// subscriber record as `pw`; a password is never logged, stored as typed or put in a reply.
import { createHash, randomBytes as cryptoRandomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;
// OWASP's scrypt setting for 32 MiB (N=2^15, r=8, p=3). Each hash keeps its own setting, so raising it later
// leaves the old hashes readable.
export const PW_COST = { N: 2 ** 15, r: 8, p: 3 };
const KEYLEN = 32;
const SALT_BYTES = 16;

// Why a new password can't be used, or null. Length only (NIST SP 800-63B): no rules about kinds of characters.
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw === "") return "enter a password";
  const n = [...pw].length;
  if (n < MIN_PASSWORD) return `use at least ${MIN_PASSWORD} characters`;
  if (n > MAX_PASSWORD) return `use at most ${MAX_PASSWORD} characters`;
  return null;
}

// NFKC so the same password typed on another keyboard or phone gives the same hash.
const derive = (pw, salt, { N, r, p }) => new Promise((resolve, reject) => {
  scrypt(pw.normalize("NFKC"), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r }, (e, key) => (e ? reject(e) : resolve(key)));
});

export async function hashPassword(pw, { randomBytes = cryptoRandomBytes, cost = PW_COST } = {}) {
  const salt = Buffer.from(randomBytes(SALT_BYTES));
  const key = await derive(pw, salt, cost);
  return { alg: "scrypt", N: cost.N, r: cost.r, p: cost.p, salt: salt.toString("base64url"), hash: key.toString("base64url") };
}

// A stored hash's setting, or null for anything this code didn't write (bounded, so a bad record can't ask for gigabytes).
const costOf = (s) => {
  if (!s || typeof s !== "object" || s.alg !== "scrypt" || typeof s.salt !== "string" || typeof s.hash !== "string") return null;
  const ok = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
  return ok(s.N, 2 ** 17) && (s.N & (s.N - 1)) === 0 && ok(s.r, 16) && ok(s.p, 16) ? { N: s.N, r: s.r, p: s.p } : null;
};
const DUMMY_SALT = createHash("sha256").update("radar-no-password").digest().subarray(0, SALT_BYTES);

// Whether `pw` matches the stored hash. With no usable hash (no account, or no password set) it still derives one,
// so the answer takes as long either way. Never throws.
export async function verifyPassword(pw, stored) {
  try {
    if (typeof pw !== "string" || pw === "" || [...pw].length > MAX_PASSWORD) return false;
    const cost = costOf(stored);
    if (!cost) { await derive(pw, DUMMY_SALT, PW_COST); return false; }
    const want = Buffer.from(stored.hash, "base64url");
    const got = await derive(pw, Buffer.from(stored.salt, "base64url"), cost);
    return want.length === KEYLEN && timingSafeEqual(got, want);
  } catch (e) { return false; }
}

// The hash alone, as stored in `pw`: what a pending sign-up's `pendingPw` holds, less its link key.
export const storedHash = (s) => (costOf(s) ? { alg: s.alg, N: s.N, r: s.r, p: s.p, salt: s.salt, hash: s.hash } : null);
