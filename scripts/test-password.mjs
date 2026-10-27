// Offline tests for passwords (api/_lib/password.js and the password parts of sign-up, confirm, /api/session and
// /api/account). Blob storage and Resend are faked.
//   node scripts/test-password.mjs
import { check, finish, memStorage, mockRes } from "./test-helpers.mjs";
import { MAX_PASSWORD, MIN_PASSWORD, PW_COST, hashPassword, passwordProblem, verifyPassword } from "../api/_lib/password.js";
import {
  MAX_PW_FAILS_PER_ACCOUNT_HOUR, MAX_PW_FAILS_PER_IP_HOUR, makeAccountHandler, makeConfirmHandler, makeSessionHandler, makeSubscribeHandler,
} from "../api/_lib/subscription-handlers.js";
import { readSession } from "../api/_lib/session.js";
import { getSubscriber, newPending, putSubscriber, subscriberId } from "../api/_lib/subscribers.js";

const seeded = (seed = 1) => { let n = seed; return (len) => Buffer.alloc(len, n++ % 256); };
const T0 = Date.UTC(2026, 9, 27, 8, 9, 10, 123);
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN;
const SECRET = "test-session-secret-0123456789abcdef";
const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example", MAX_SUBSCRIBERS: "5000", SESSION_SECRET: SECRET };
const GOOD = "correct horse battery";
const OTHER = "another long password";

// ---- the module on its own
{
  check(passwordProblem(undefined) === "enter a password" && passwordProblem("") === "enter a password" && passwordProblem(123) === "enter a password",
    "passwordProblem: a missing or non-text password");
  check(passwordProblem("x".repeat(MIN_PASSWORD - 1)) === `use at least ${MIN_PASSWORD} characters` && passwordProblem("x".repeat(MIN_PASSWORD)) === null,
    `passwordProblem: at least ${MIN_PASSWORD} characters`);
  check(passwordProblem("x".repeat(MAX_PASSWORD + 1)) === `use at most ${MAX_PASSWORD} characters` && passwordProblem("é".repeat(MAX_PASSWORD)) === null,
    `passwordProblem: at most ${MAX_PASSWORD}, counted in characters, not bytes`);
  const h = await hashPassword(GOOD, { randomBytes: seeded(3) });
  check(h.alg === "scrypt" && h.N === PW_COST.N && h.r === PW_COST.r && h.p === PW_COST.p && /^[A-Za-z0-9_-]{22}$/.test(h.salt) && /^[A-Za-z0-9_-]{43}$/.test(h.hash),
    "hashPassword: scrypt, its setting, a 16-byte salt and a 32-byte hash");
  check(!JSON.stringify(h).includes(GOOD) && !JSON.stringify(h).includes(Buffer.from(GOOD).toString("base64url")), "hashPassword: the password isn't in what's stored");
  check(await verifyPassword(GOOD, h) && !(await verifyPassword(GOOD + "x", h)) && !(await verifyPassword("", h)), "verifyPassword: the right one only");
  const h2 = await hashPassword(GOOD, { randomBytes: seeded(4) });
  check(h2.hash !== h.hash && await verifyPassword(GOOD, h2), "hashPassword: another salt, another hash; both verify");
  const nfc = await hashPassword("café au lait!!", { randomBytes: seeded(5) });
  check(await verifyPassword("café au lait!!", nfc), "verifyPassword: the same text typed as composed or combining characters matches");
  check(!(await verifyPassword(GOOD, null)) && !(await verifyPassword(GOOD, { ...h, alg: "md5" })) && !(await verifyPassword(GOOD, { ...h, N: 2 ** 30 }))
    && !(await verifyPassword(GOOD, { ...h, N: 1000 })) && !(await verifyPassword(GOOD, { ...h, hash: "short" })),
    "verifyPassword: no hash, another algorithm, an oversized or odd setting, or a damaged hash is false, never a throw");
  const timed = async (stored) => { const a = performance.now(); await verifyPassword(GOOD + "!", stored); return performance.now() - a; };
  const withHash = await timed(h), without = await timed(null);
  check(without > withHash / 3, `verifyPassword: refusing with no hash still does the work (${without.toFixed(0)} ms vs ${withHash.toFixed(0)} ms)`);
}

// A world: an in-memory store, a fake Resend that keeps what was sent, and the four handlers.
async function world(envOver = {}) {
  const st = memStorage();
  const sent = [], logs = [], replies = [];
  const w = { st, sent, logs, replies, clock: T0, env: { ...ENV, ...envOver } };
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(...(Array.isArray(body) ? body : [body]));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ id: "m0" }], id: "m0" }) };
  };
  const deps = { env: w.env, storage: st, fetchFn, now: () => w.clock, randomBytes: seeded(7), log: (...a) => logs.push(a.join(" ")) };
  const handlers = { sess: makeSessionHandler(deps), acct: makeAccountHandler(deps), conf: makeConfirmHandler(deps), sub: makeSubscribeHandler(deps) };
  let ipN = 0;
  w.call = async (name, { method = "POST", query = {}, body, cookie, origin, ip } = {}) => {
    const headers = { host: "site.example", "content-type": "application/json", "x-forwarded-for": ip || "203.0.113." + (++ipN % 250) };
    if (cookie) headers.cookie = cookie;
    if (origin !== undefined) headers.origin = origin;
    const res = mockRes();
    await handlers[name]({ method, headers, query, body }, res);
    replies.push(String(res.body || ""));
    return res;
  };
  w.signUp = (email, extra = {}, opts = {}) => w.call("sub", { body: { email, ...extra }, ...opts });
  w.login = (email, password, { body, ...opts } = {}) => w.call("sess", { body: { action: "password", email, password, ...body }, ...opts });
  w.rec = (email) => getSubscriber(st, subscriberId(email));
  // The confirm link in the newest email to `email`: { id, t, k }.
  w.link = (email) => {
    const m = [...sent].reverse().find((x) => (x.to[0] || x.to) === email);
    const u = new URL(/Confirm: (\S+)/.exec(m.text)[1]);
    return { id: u.searchParams.get("id"), t: u.searchParams.get("t"), k: u.searchParams.get("k"), mail: m };
  };
  w.confirm = (l) => w.call("conf", { body: { id: l.id, t: l.t, ...(l.k ? { k: l.k } : {}) } });
  return w;
}
const cookieOf = (res) => { const m = /^tpr_session=([^;]*)/.exec(res.headers["set-cookie"] || ""); return m && m[1] ? `tpr_session=${m[1]}` : ""; };
const active = async (w, email, over = {}) => {
  const r = { ...newPending(email, { now: T0 - 48 * HOUR, randomBytes: seeded(email.length) }), status: "active", confirmedAt: iso(T0 - 47 * HOUR), ...over };
  await putSubscriber(w.st, r);
  return r;
};

// ---- sign-up with a password, then confirm
{
  const w = await world();
  let r = await w.signUp("new@example.com", { password: "short" });
  check(r.code === 400 && r.json().error === `use at least ${MIN_PASSWORD} characters` && w.sent.length === 0 && !(await w.rec("new@example.com")),
    "sign-up: a too-short password is refused before anything is stored or sent");
  r = await w.signUp("new@example.com", { password: GOOD });
  const pending = await w.rec("new@example.com");
  check(r.code === 200 && pending.status === "pending" && !pending.pw && pending.pendingPw && /^[0-9a-f]{64}$/.test(pending.pendingPw.k),
    "sign-up: the record is pending, with the password's hash waiting beside its link key's hash");
  check(!w.st.m.get("radar:sub:" + pending.id).includes(GOOD), "sign-up: the password isn't stored as typed");
  const l = w.link("new@example.com");
  check(/^[A-Za-z0-9_-]{43}$/.test(l.k) && pending.pendingPw.k !== l.k && /Confirming also turns on the password you chose/.test(l.mail.text) && /no account or password is made/.test(l.mail.text),
    "sign-up: the confirmation link carries the key (only its hash is stored), and the email says confirming turns the password on");
  r = await w.login("new@example.com", GOOD);
  check(r.code === 403 && r.json().error === "not_confirmed" && !cookieOf(r), "sign-in: the right password before confirming is told to confirm first, and not signed in");
  r = await w.call("conf", { method: "GET", query: { id: l.id, t: l.t, k: l.k } });
  check(r.code === 200 && r.body.includes(`name="k" value="${l.k}"`) && /turn on the password you chose/.test(r.body), "confirm page: carries the key into its Confirm button");
  r = await w.confirm(l);
  const done = await w.rec("new@example.com");
  check(r.code === 200 && done.status === "active" && done.pw && !("pendingPw" in done) && /sign in with your email address and the password/.test(r.body),
    "confirm: with the key, the account is active and the password is on");
  r = await w.login("NEW@example.com", GOOD);
  check(r.code === 200 && r.json().next === "/live/" && cookieOf(r), "sign-in: the password works after confirming (any case of the address), cookie set, on to the board");
  const me = await readSession({ headers: { cookie: cookieOf(r) } }, { env: w.env, storage: w.st, now: w.clock });
  check(me && me.id === done.id, "sign-in: the cookie signs in that account");
  check(w.replies.every((b) => !b.includes(GOOD) && !b.includes(done.pw.hash) && !b.includes(done.pw.salt)), "no reply holds the password, its hash or its salt");
  check(w.logs.every((x) => !x.includes(GOOD) && !x.includes("@")), "no log line holds the password or an address");
}

// ---- a password only comes on through its own link
{
  const w = await world();
  await w.signUp("plain@example.com", { password: GOOD });
  const l = w.link("plain@example.com");
  await w.confirm({ id: l.id, t: l.t }); // the link without its key
  check((await w.rec("plain@example.com")).status === "active" && !(await w.rec("plain@example.com")).pw && !("pendingPw" in await w.rec("plain@example.com")),
    "confirm: without the key the account is made, with no password, and the waiting one is dropped");
  check((await w.login("plain@example.com", GOOD)).code === 401, "sign-in: so that password doesn't work");

  // Someone types the victim's address and their own password; the victim later signs up without one and confirms
  // whichever email they open.
  await w.signUp("victim@example.com", { password: OTHER });
  const attackers = w.link("victim@example.com");
  w.clock += 11 * MIN;
  await w.signUp("victim@example.com");
  check((await w.rec("victim@example.com")).pendingPw === null, "sign-up again without a password: the waiting one is dropped");
  await w.confirm(attackers);
  check(!(await w.rec("victim@example.com")).pw && (await w.login("victim@example.com", OTHER)).code === 401,
    "confirm: the earlier email's key no longer turns anything on; the other person's password can't sign in");

  // The newest sign-up's password is the one its link turns on.
  await w.signUp("twice@example.com", { password: OTHER });
  const first = w.link("twice@example.com");
  w.clock += 11 * MIN;
  await w.signUp("twice@example.com", { password: GOOD });
  const second = w.link("twice@example.com");
  await w.confirm(first);
  check(!(await w.rec("twice@example.com")).pw, "confirm: an older link's key doesn't match the newer password");
  w.clock = T0;
  const w2 = await world();
  await w2.signUp("twice@example.com", { password: OTHER });
  w2.clock += 11 * MIN;
  await w2.signUp("twice@example.com", { password: GOOD });
  await w2.confirm(w2.link("twice@example.com"));
  check((await w2.login("twice@example.com", GOOD)).code === 200 && (await w2.login("twice@example.com", OTHER)).code === 401, "confirm: the newest link turns on the newest password");
  check(second.k !== first.k, "each sign-up's link has its own key");

  // An account that exists already keeps its password: signing up again only emails a sign-in link.
  const acc = await active(w, "has@example.com", { pw: await hashPassword(GOOD, { randomBytes: seeded(9) }) });
  const r = await w.signUp("has@example.com", { password: OTHER });
  check(r.code === 200 && r.json().already && (await w.rec("has@example.com")).pw.hash === acc.pw.hash && !("pendingPw" in await w.rec("has@example.com")),
    "sign-up for an existing account: the password typed in changes nothing");
}

// ---- signing in with a password
{
  const w = await world();
  await active(w, "me@example.com", { pw: await hashPassword(GOOD, { randomBytes: seeded(9) }) });
  await active(w, "nopw@example.com");
  let r = await w.login("me@example.com", OTHER);
  check(r.code === 401 && r.json().error === "wrong_password" && !cookieOf(r), "sign-in: a wrong password is 401, no cookie");
  check((await w.login("nobody@example.com", GOOD)).json().error === "wrong_password" && (await w.login("nopw@example.com", GOOD)).json().error === "wrong_password",
    "sign-in: no account, or one with no password, gets the same answer");
  check((await w.login("me@example.com", GOOD, { body: { website: "x" } })).code === 401, "sign-in: the honeypot field gets the wrong-password answer");
  check((await w.login("me@example.com", "")).code === 400 && (await w.login("not-an-address", GOOD)).code === 400, "sign-in: a missing password or a bad address is 400");
  check((await w.login("me@example.com", GOOD, { origin: "https://evil.example" })).code === 403, "sign-in: a POST from another site is refused");
  const off = await world({ SESSION_SECRET: "" });
  check((await off.login("me@example.com", GOOD)).code === 503, "sign-in: without SESSION_SECRET it isn't set up (503)");
  const paused = await world({ SUBSCRIPTIONS_ENABLED: "0" });
  check((await paused.login("me@example.com", GOOD)).code === 503, "sign-in: closed while subscriptions are paused");
  const fails = (await w.rec("me@example.com")).pwFails;
  check(fails && fails.n === 2, `sign-in: the account counts its wrong passwords (${fails && fails.n})`);
  r = await w.login("me@example.com", GOOD);
  check(r.code === 200 && !("pwFails" in await w.rec("me@example.com")), "sign-in: the right password clears the count");

  // Per IP: MAX_PW_FAILS_PER_IP_HOUR wrong tries, then 429 for the hour, even with the right password.
  const ip = "198.51.100.7";
  for (let i = 0; i < MAX_PW_FAILS_PER_IP_HOUR; i++) await w.login(`x${i}@example.com`, OTHER, { ip });
  r = await w.login("me@example.com", GOOD, { ip });
  check(r.code === 429 && r.json().error === "too_many_tries", `sign-in: after ${MAX_PW_FAILS_PER_IP_HOUR} wrong tries from one IP, 429`);
  check((await w.login("me@example.com", GOOD)).code === 200, "sign-in: another IP isn't held");
  w.clock += HOUR;
  check((await w.login("me@example.com", GOOD, { ip })).code === 200, "sign-in: the next hour, that IP can try again");
  check([...w.st.m.keys()].filter((k) => k.startsWith("radar:iphit:")).every((k) => !k.includes(ip)), "sign-in: the IP is stored only as a hash");

  // Per account: MAX_PW_FAILS_PER_ACCOUNT_HOUR wrong tries from any IPs, then 429 for an hour from the first.
  const start = w.clock;
  for (let i = 0; i < MAX_PW_FAILS_PER_ACCOUNT_HOUR; i++) await w.login("me@example.com", OTHER);
  check((await w.login("me@example.com", GOOD)).code === 429, `sign-in: after ${MAX_PW_FAILS_PER_ACCOUNT_HOUR} wrong tries on one account, 429 even for the right one`);
  w.clock = start + HOUR + 1;
  check((await w.login("me@example.com", GOOD)).code === 200, "sign-in: an hour after the first wrong try, the account opens again");
}

// ---- setting, changing and removing a password on /api/account
{
  const w = await world();
  const rec = await active(w, "acct@example.com", { token: "tok-acct-secret" });
  const setPw = (body, opts) => w.call("acct", { body: { action: "set-password", ...body }, ...opts });
  let r = await setPw({ id: rec.id, t: rec.token, password: GOOD });
  check(r.code === 403 && r.json().error === "sign_in_first" && !(await w.rec("acct@example.com")).pw,
    "account: the manage link from an email (which a forwarded digest carries) can't set a password");
  r = await w.call("acct", { method: "GET", query: { id: rec.id, t: rec.token } });
  check(r.json().hasPassword === false, "account: the view says there's no password");
  // Sign in the way someone with no password does: the cookie a sign-in link would set.
  const { signSession, sessionCookie } = await import("../api/_lib/session.js");
  const cookie = sessionCookie(signSession(rec, { secret: SECRET, now: w.clock })).split(";")[0];
  const other = await active(w, "other@example.com");
  const otherCookie = sessionCookie(signSession(other, { secret: SECRET, now: w.clock })).split(";")[0];
  r = await setPw({ id: rec.id, t: rec.token, password: GOOD }, { cookie: otherCookie });
  check(r.code === 403 && !(await w.rec("acct@example.com")).pw, "account: signed in as someone else, this account's link can't set a password");
  r = await setPw({ password: "short" }, { cookie });
  check(r.code === 400 && r.json().error === `use at least ${MIN_PASSWORD} characters`, "account: a too-short password is refused");
  r = await setPw({ password: GOOD }, { cookie, origin: "https://evil.example" });
  check(r.code === 403 && !(await w.rec("acct@example.com")).pw, "account: a POST from another site is refused");
  r = await setPw({ password: GOOD }, { cookie });
  const after = await w.rec("acct@example.com");
  check(r.code === 200 && r.json().hasPassword === true && after.pw && after.sessionVer === 1 && cookieOf(r), "account: signed in, the password is set and this browser gets a new cookie");
  const read = (c) => readSession({ headers: { cookie: c } }, { env: w.env, storage: w.st, now: w.clock });
  check(await read(cookie) === null && (await read(cookieOf(r)))?.id === rec.id, "account: setting a password signs other browsers out, not this one");
  check((await w.login("acct@example.com", GOOD)).code === 200, "account: the new password signs in");
  r = await setPw({ password: OTHER }, { cookie: cookieOf(r) });
  check(r.code === 200 && (await w.login("acct@example.com", OTHER)).code === 200 && (await w.login("acct@example.com", GOOD)).code === 401,
    "account: changing it (no old password needed: an emailed sign-in link is the way back) replaces it");
  const now = cookieOf(r);
  r = await w.call("acct", { body: { action: "remove-password" }, cookie: now });
  check(r.code === 200 && r.json().hasPassword === false && !("pw" in await w.rec("acct@example.com")) && (await w.login("acct@example.com", OTHER)).code === 401,
    "account: removing it leaves sign-in by link or Google only");
  check(w.replies.every((b) => !b.includes(GOOD) && !b.includes(OTHER)), "account: no reply holds a password");
}

finish("password tests");
