// "Continue with Google" (docs/subscriptions/account-flows.md): OpenID Connect's code flow with PKCE,
// without a library. The start puts a state, a nonce and the PKCE verifier in a short cookie signed
// with SESSION_SECRET. The return checks that cookie, swaps the code at Google's token endpoint and
// reads the ID token from that reply. The token comes straight from Google over TLS, which OpenID
// Connect (Core 3.1.3.7) accepts in place of checking its signature. Only the verified address is
// used; the Google account id, name and tokens are never stored. Nothing here logs.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { normaliseEmail } from "./subscribers.js";

export const OAUTH_COOKIE = "tpr_oauth";
export const OAUTH_MINUTES = 10;
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TOKEN_TIMEOUT_MS = 10_000;

const clientId = (env) => String(env.GOOGLE_CLIENT_ID || "").trim();
const clientSecret = (env) => String(env.GOOGLE_CLIENT_SECRET || "").trim();

// Google sign-in needs its two values, a sign-in secret and a site URL (Google sends people back to
// `${site}/api/session`, which must match the redirect URI registered with Google exactly).
export const googleConfigured = (env, { secret, site }) => Boolean(clientId(env) && clientSecret(env) && secret && site);
export const redirectUri = (site) => `${site}/api/session`;

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const mac = (secret, payload) => createHmac("sha256", secret).update("radar-oauth:" + payload).digest("base64url");
const ATTRS = "Path=/api/session; HttpOnly; Secure; SameSite=Lax";
export const clearOAuthCookie = () => `${OAUTH_COOKIE}=; Max-Age=0; ${ATTRS}`;

// The redirect to Google and the cookie that remembers this attempt for OAUTH_MINUTES.
// `pro`: the sign-up tab's "I'd also like Pro" box.
export function googleStart({ env, secret, site, now, randomBytes, pro = false }) {
  const state = b64u(randomBytes(32));
  const nonce = b64u(randomBytes(32));
  const verifier = b64u(randomBytes(32));
  const exp = Math.floor(now / 1000) + OAUTH_MINUTES * 60;
  const payload = `${state}.${nonce}.${verifier}.${pro ? 1 : 0}.${exp}`;
  const q = new URLSearchParams({
    client_id: clientId(env),
    redirect_uri: redirectUri(site),
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: b64u(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account", // pick the account every time; the last choice isn't assumed
  });
  return {
    url: `${GOOGLE_AUTH_URL}?${q}`,
    cookie: `${OAUTH_COOKIE}=${payload}.${mac(secret, payload)}; Max-Age=${OAUTH_MINUTES * 60}; ${ATTRS}`,
  };
}

const COOKIE_RE = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.([01])\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

// The attempt's { nonce, verifier, pro }, or null: no cookie, a bad signature, expired, or a state
// that isn't the one Google sent back. Never throws.
export function readOAuthCookie(value, state, { secret, now }) {
  try {
    const m = COOKIE_RE.exec(String(value || ""));
    if (!m || typeof state !== "string") return null;
    const [, want, nonce, verifier, pro, exp, sig] = m;
    const good = Buffer.from(mac(secret, `${want}.${nonce}.${verifier}.${pro}.${exp}`));
    const got = Buffer.from(sig);
    if (got.length !== good.length || !timingSafeEqual(got, good)) return null;
    if (Number(exp) * 1000 <= now) return null;
    const a = Buffer.from(state);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { nonce, verifier, pro: pro === "1" };
  } catch (e) { return null; }
}

// Swaps the code for an ID token and checks it. Returns { email } or { error }: "exchange" (Google
// didn't answer or refused the code), "token" (the ID token isn't for us, is stale or doesn't match
// this attempt) or "unverified" (Google hasn't verified the address). Never throws.
export async function googleFinish({ env, site, code, nonce, verifier, now, fetchFn }) {
  let reply;
  try {
    const r = await fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId(env), client_secret: clientSecret(env), redirect_uri: redirectUri(site),
        grant_type: "authorization_code", code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!r.ok) return { error: "exchange" };
    reply = await r.json();
  } catch (e) { return { error: "exchange" }; }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(String(reply.id_token).split(".")[1], "base64url").toString("utf8"));
  } catch (e) { return { error: "token" }; }
  if (!claims || typeof claims !== "object") return { error: "token" };
  if (!ISSUERS.includes(claims.iss) || claims.aud !== clientId(env)) return { error: "token" };
  if (!(Number(claims.exp) * 1000 > now) || claims.nonce !== nonce) return { error: "token" };
  if (claims.email_verified !== true && claims.email_verified !== "true") return { error: "unverified" };
  const email = normaliseEmail(claims.email);
  return email ? { email } : { error: "token" };
}
