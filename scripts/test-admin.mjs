// Offline tests for the admin dashboard's endpoint (api/_lib/admin.js, /admin/).
import { check, finish, memStorage, mockRes } from "./test-helpers.mjs";
import {
  ADMIN_FAIL_DELAY_MS, ADMIN_HOURS, ADMIN_MAX_FAILS_PER_HOUR, adminCreds, adminRow, credsOk, makeAdminHandler, summarize,
} from "../api/_lib/admin.js";
import { newPending, putSubscriber, recordEvent } from "../api/_lib/subscribers.js";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const DAY = 24 * 3600 * 1000;
const ENV = { ADMIN_USER: "owner", ADMIN_PASSWORD: "correct horse battery staple" };
const seeded = (n) => (k) => Buffer.alloc(k, n++);

// ---- credentials
{
  check(adminCreds({}) === null && adminCreds({ ADMIN_USER: "owner", ADMIN_PASSWORD: "short" }) === null && adminCreds({ ADMIN_PASSWORD: ENV.ADMIN_PASSWORD }) === null,
    "admin: no credentials, a password under 16 characters, or no user: not set up");
  const c = adminCreds(ENV);
  check(credsOk(c, "owner", ENV.ADMIN_PASSWORD) && !credsOk(c, "owner", ENV.ADMIN_PASSWORD + "x") && !credsOk(c, "Owner", ENV.ADMIN_PASSWORD) &&
    !credsOk(c, undefined, undefined) && !credsOk(null, "owner", ENV.ADMIN_PASSWORD), "admin: credsOk needs both, exactly");
}

// A world with a few subscribers and a handler whose clock, sleep and log the test controls.
async function world(env = ENV) {
  const st = memStorage();
  const w = { st, clock: T0, slept: [], logs: [], env };
  const add = async (email, over) => {
    const r = { ...newPending(email, { now: T0 - 10 * DAY, randomBytes: seeded(email.length) }), ...over };
    await putSubscriber(st, r);
    return r;
  };
  await add("pending@example.com", {});
  await add("free@example.com", { status: "active", confirmedAt: iso(T0 - 9 * DAY), proRequestedAt: iso(T0 - DAY) });
  await add("monthly@example.com", { status: "active", confirmedAt: iso(T0 - 9 * DAY), plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 20 * DAY),
    cats: ["gov_policy", "industry"], sweepsPerDay: 3, paidFor: { sub: "sub_A", months: 1, price: 150 },
    rzp: { subscriptionId: "sub_A", status: "active", cancelAtPeriodEnd: false, choice: { cats: ["gov_policy", "industry"], perDay: 3, months: 1, price: 150 } },
    signin: { hash: "f".repeat(64), exp: iso(T0 + 600_000) } });
  await add("yearly@example.com", { status: "active", confirmedAt: iso(T0 - 9 * DAY), plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 300 * DAY),
    paidFor: { sub: "sub_B", months: 12, price: 1500 }, rzp: { subscriptionId: "sub_B", status: "active", cancelAtPeriodEnd: true } });
  await add("owner@example.com", { status: "active", confirmedAt: iso(T0 - 9 * DAY), plan: "pro", proSource: "owner", proUntil: null, cats: ["industry"] });
  await add("lapsed@example.com", { status: "active", confirmedAt: iso(T0 - 9 * DAY), plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY), emailOff: "unsubscribed" });
  await recordEvent(st, "subscribed", { now: T0 - DAY, randomBytes: seeded(1) });
  await recordEvent(st, "confirmed", { now: T0 - DAY, randomBytes: seeded(2) });
  w.handler = makeAdminHandler({ env, storage: st, now: () => w.clock, randomBytes: seeded(9), log: (...a) => w.logs.push(a.join(" ")), sleep: async (ms) => { w.slept.push(ms); } });
  w.call = async ({ method = "GET", body, cookie, origin, ip = "203.0.113.5", query = {} } = {}) => {
    const headers = { host: "site.example", "content-type": "application/json", "x-forwarded-for": ip };
    if (cookie) headers.cookie = cookie;
    if (origin !== undefined) headers.origin = origin;
    const res = mockRes();
    await w.handler({ method, headers, query, body }, res);
    return res;
  };
  w.login = (user = "owner", password = ENV.ADMIN_PASSWORD, opts = {}) => w.call({ method: "POST", body: { action: "login", user, password }, ...opts });
  w.cookieOf = (res) => String(res.headers["set-cookie"] || "").split(";")[0];
  return w;
}

// ---- not set up, not signed in, wrong origin
{
  const w = await world({});
  check((await w.call()).code === 503 && (await w.login()).code === 503, "admin: 503 without ADMIN_USER and ADMIN_PASSWORD");
  const w2 = await world();
  const r = await w2.call();
  check(r.code === 401 && r.json().error === "not_signed_in" && !r.body.includes("@"), "admin: GET without the cookie is 401 and shows nothing");
  check((await w2.login("owner", ENV.ADMIN_PASSWORD, { origin: "https://evil.example" })).code === 403, "admin: a login posted from another site is 403");
  check((await w2.call({ method: "PUT" })).code === 405, "admin: only GET and POST");
  check((await w2.call({ method: "POST", body: { action: "nope" } })).code === 400, "admin: an unknown action is 400");
}

// ---- wrong logins: a wait each, then 429 per IP and hour
{
  const w = await world();
  const r = await w.login("owner", "wrong password, quite long");
  check(r.code === 401 && r.json().error === "wrong_login" && !r.headers["set-cookie"] && w.slept[0] === ADMIN_FAIL_DELAY_MS, "admin: a wrong password is 401 after a one-second wait, no cookie");
  check(w.logs.some((l) => l === "admin login refused") && !w.logs.join(" ").includes("wrong password") && !w.logs.join(" ").includes("203.0.113"),
    "admin: the refusal is logged without the password or the IP");
  for (let i = 1; i < ADMIN_MAX_FAILS_PER_HOUR; i++) await w.login("owner", "wrong password, quite long");
  const blocked = await w.login();
  check(blocked.code === 429 && blocked.json().error === "too_many_tries" && !blocked.headers["set-cookie"], `admin: after ${ADMIN_MAX_FAILS_PER_HOUR} wrong tries the IP is refused, even with the right password`);
  check((await w.login("owner", ENV.ADMIN_PASSWORD, { ip: "198.51.100.7" })).code === 200, "admin: another IP can still sign in");
  w.clock = T0 + 3600_000;
  check((await w.login()).code === 200, "admin: the next hour the IP can try again");
  check([...w.st.m.keys()].filter((k) => k.startsWith("radar:iphit:")).every((k) => /^radar:iphit:\d{10}-[0-9a-f]{16}-[0-9a-f]{6}$/.test(k)),
    "admin: wrong tries are kept as radar:iphit: keys, which the sweep tidies");
}

// ---- signing in and the data
{
  const w = await world();
  const r = await w.login();
  const set = String(r.headers["set-cookie"] || "");
  check(r.code === 200 && /^tpr_admin=\d+\.[A-Za-z0-9_-]{43}; Path=\/api\/admin; HttpOnly; Secure; SameSite=Strict$/.test(set), `admin: login sets a strict, HttpOnly cookie for /api/admin only (${set})`);
  const cookie = w.cookieOf(r);
  const d = await w.call({ cookie });
  const j = d.json();
  check(d.code === 200 && d.headers["cache-control"] === "no-store" && j.subscribers.length === 6, "admin: with the cookie, every subscriber, not cached");
  check(!/"token"|"signin"|"hash"/.test(d.body), "admin: no token or sign-in code in the reply");
  const by = Object.fromEntries(j.subscribers.map((s) => [s.email, s]));
  check(by["monthly@example.com"].plan === "pro" && by["monthly@example.com"].period === "monthly" && by["monthly@example.com"].price === 150 &&
    by["monthly@example.com"].billing === "renews" && by["monthly@example.com"].cats.join() === "gov_policy,industry" && by["monthly@example.com"].sweepsPerDay === 3,
    "admin: a monthly Pro shows its period, price, categories, emails a day and that it renews");
  check(by["yearly@example.com"].period === "yearly" && by["yearly@example.com"].billing === "cancelled" && by["yearly@example.com"].cats === null,
    "admin: a yearly Pro that was cancelled shows so; no categories chosen means all");
  check(by["owner@example.com"].proSource === "owner" && by["owner@example.com"].period === null && by["owner@example.com"].price === null,
    "admin: an owner-granted Pro has no period or price");
  check(by["lapsed@example.com"].plan === "free" && by["lapsed@example.com"].lapsed && by["lapsed@example.com"].billing === null && by["pending@example.com"].status === "pending",
    "admin: a Pro whose end has passed is Free and marked lapsed; pending stays pending");
  check(by["free@example.com"].createdAt === iso(T0 - 10 * DAY) && by["free@example.com"].confirmedAt === iso(T0 - 9 * DAY), "admin: sign-up and confirmation dates");
  const s = j.summary;
  check(s.total === 6 && s.pending === 1 && s.free === 2 && s.pro === 3 && s.lapsed === 1 && s.waitingForPro === 1 && s.emailOff === 1, `admin: summary counts (${JSON.stringify(s)})`);
  check(s.proBySource.razorpay === 2 && s.proBySource.owner === 1 && s.proByPeriod.monthly === 1 && s.proByPeriod.yearly === 1 &&
    s.billing.renews === 1 && s.billing.cancelled === 1, "admin: Pro by source, period and billing");
  check(s.cats.industry === 2 && s.cats.gov_policy === 1 && s.cats.traveler_pain === 0 && s.allCats === 1 && s.perDay[3] === 1 && s.perDay.default === 2,
    "admin: categories and emails a day over Pro members");
  check(s.paid.monthly === 150 && s.paid.yearly === 1500 && s.monthlyValue === 275, "admin: paid totals, yearly counted as a twelfth a month");
  check(j.stats.days === 30 && j.stats.totals.subscribed === 1 && j.stats.totals.confirmed === 1 && j.stats.perDay.length === 30, "admin: the per-day stats, 30 days by default");
  check((await w.call({ cookie, query: { days: "7" } })).json().stats.perDay.length === 7 && (await w.call({ cookie, query: { days: "500" } })).json().stats.days === 30,
    "admin: ?days= from 1 to 90, else 30");

  w.clock = T0 + ADMIN_HOURS * 3600_000 + 1000;
  check((await w.call({ cookie })).code === 401, `admin: the cookie expires after ${ADMIN_HOURS} hours`);
  w.clock = T0;
  const [name, value] = cookie.split("=");
  check((await w.call({ cookie: `${name}=${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}` })).code === 401, "admin: a changed signature is refused");
  check((await w.call({ cookie: `${name}=${Number(value.split(".")[0]) + 3600}.${value.split(".")[1]}` })).code === 401, "admin: a later expiry with the old signature is refused");
  const moved = makeAdminHandler({ env: { ...ENV, ADMIN_PASSWORD: ENV.ADMIN_PASSWORD + "!" }, storage: w.st, now: () => T0, randomBytes: seeded(1), log: () => {} });
  const res = mockRes();
  await moved({ method: "GET", headers: { host: "site.example", cookie }, query: {} }, res);
  check(res.code === 401, "admin: changing ADMIN_PASSWORD signs the admin out");
  const out = await w.call({ method: "POST", body: { action: "logout" }, cookie });
  check(out.code === 200 && /^tpr_admin=; Max-Age=0; Path=\/api\/admin/.test(String(out.headers["set-cookie"])), "admin: logout clears the cookie");
  check(w.logs.every((l) => !l.includes("@")), "admin: no address in the logs");
}

// ---- rows from odd records
{
  const odd = adminRow({ id: "x", status: "weird", plan: "pro", proSource: "razorpay", paidFor: { months: 3, price: "x" }, rzp: "nope" }, T0);
  check(odd.status === "unknown" && odd.plan === "free" && odd.period === null && odd.price === null && odd.email === "", "admin: a malformed record gives a safe row");
  check(summarize([odd]).total === 1 && summarize([]).monthlyValue === 0, "admin: summarize copes with odd and empty lists");
}

finish("admin tests");
