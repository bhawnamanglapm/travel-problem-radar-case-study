// Offline tests for the subscriber features (docs/subscriptions/tasks). No network, no API
// key: Blob storage and Resend are faked.
//   node scripts/test-subscriptions.mjs
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { blobStorage } from "../api/_lib/storage.js";
import {
  CONFIRM_RESEND_HOURS, PENDING_TTL_DAYS, countEvents, deleteSubscriber, effectivePlan, getSubscriber, listSubscribers,
  newPending, newToken, normaliseCats, normaliseEmail, putSubscriber, recordEvent, subscriberId, tokenOk, utcDay,
} from "../api/_lib/subscribers.js";
import { BodyTooLargeError, allowMethods, bearerOk, esc, parseForm, readBody, readFields, sendJson, sendPage } from "../api/_lib/http.js";
import { DEFAULT_FROM, buildConfirmEmail, buildDigestEmail, sendBatch, sendOne, withSubscriberFooter } from "../api/_lib/email.js";
import {
  KEY_IPHIT_PREFIX, KEY_SUBSCRIBER_COUNT, WEBHOOK_TOLERANCE_S, clientIp, makeConfirmHandler, makeResendWebhookHandler, makeSubscribeHandler, makeUnsubscribeHandler,
  siteUrl, utcHour, verifySvix,
} from "../api/_lib/subscription-handlers.js";
import { deliverToSubscribers, proCatsKey } from "../api/_lib/subscriber-delivery.js";
import { makeDataHandler } from "../api/_lib/handlers.js";
import { check, finish, memStorage, mockRes } from "./test-helpers.mjs";

// A repeatable random source: each call returns bytes that count up from a seed.
const seeded = (seed = 1) => { let n = seed; return (len) => Buffer.alloc(len, n++ % 256); };
const T0 = Date.UTC(2026, 9, 21, 8, 9, 10, 123);
const iso = (ms) => new Date(ms).toISOString();

// ---- T01: storage list(prefix)
{
  const st = memStorage();
  for (const k of ["radar:sub:b", "radar:sub:a", "radar:sweep:1", "radar:history", "radar:sub:c"]) st.m.set(k, "x");
  const ids = await st.list("radar:sub:");
  check(JSON.stringify(ids) === '["a","b","c"]', "memory store list: only keys under the prefix, as sorted suffixes");
  check(!ids.includes("1") && (await st.list("radar:sweep:")).join() === "1", "a key under another prefix is not returned");

  // blobStorage().list over a fake @vercel/blob client that answers in pages of two.
  const files = ["radar/radar-sub-e.json", "radar/radar-sub-a.json", "radar/radar-sub-d.json", "radar/radar-sub-c.json",
    "radar/radar-sub-b.json", "radar/radar-sweep-1.json", "radar/radar-sub-f.txt"];
  const calls = [];
  const fake = {
    list: async ({ prefix, cursor }) => {
      calls.push({ prefix, cursor });
      const all = files.filter((p) => p.startsWith(prefix));
      const from = cursor ? Number(cursor) : 0;
      const more = from + 2 < all.length;
      return { blobs: all.slice(from, from + 2).map((pathname) => ({ pathname })), hasMore: more, cursor: more ? String(from + 2) : undefined };
    },
  };
  const blob = blobStorage(fake);
  const got = await blob.list("radar:sub:");
  check(got.join() === "a,b,c,d,e", `blob list follows every page and returns sorted suffixes (${got.join()})`);
  check(calls.length === 3 && calls[0].prefix === "radar/radar-sub-" && calls[0].cursor === undefined, "blob list maps the prefix the way path() does, 3 pages of 2");
  let threw = false;
  try { await blob.list("radar"); } catch (e) { threw = true; }
  check(threw && calls.length === 3, "list without a trailing ':' throws before calling the service");
  let allRefused = true;
  for (const bad of ["sub:", "radar:", "radar", "radar:sub", ""]) {
    try { await blob.list(bad); allRefused = false; } catch (e) { /* refused, as it should be */ }
  }
  check(allRefused && calls.length === 3, "list refuses a prefix not under radar: or not ending in ':' or '-', before calling the service");

  // get() reads past Blob's CDN cache unless the caller opts in (a stale read would undo a recent write).
  const gets = [];
  const fakeGet = { get: async (p, opts) => { gets.push({ p, opts }); return { statusCode: 200, stream: new Blob(["{\"a\":1}"]).stream() }; } };
  const fresh = await blobStorage(fakeGet).get("radar:sub:x");
  await blobStorage(fakeGet, { cached: true }).get("radar:index");
  check(fresh === '{"a":1}' && gets[0].p === "radar/radar-sub-x.json" && gets[0].opts.useCache === false && gets[0].opts.access === "private", "blob get: skips the CDN cache by default (useCache: false)");
  check(gets[1].opts.useCache === true, "blob get: { cached: true } keeps the CDN cache (for /api/data only)");
  check(/blobStorage\(undefined, \{ cached: true \}\)/.test(readFileSync(new URL("../api/data.js", import.meta.url), "utf8")) &&
    ["account", "confirm", "resend-webhook", "subscribe", "sweep", "unsubscribe"].every((f) => !/cached/.test(readFileSync(new URL(`../api/${f}.js`, import.meta.url), "utf8"))),
    "only /api/data uses cached reads; every endpoint that writes reads fresh");

  // The prefix countEvents uses ends in "-", and a real day's events must be counted through blobStorage, not only the memory store.
  const evFiles = ["radar/radar-event-20261021-080910123-confirmsent-aabbcc.json", "radar/radar-event-20261021-090910123-confirmsent-ddeeff.json",
    "radar/radar-event-20261021-080910123-confirmed-112233.json", "radar/radar-event-20261022-080910123-confirmsent-445566.json"];
  const evBlob = blobStorage({ list: async ({ prefix }) => ({ blobs: evFiles.filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false }) });
  check(JSON.stringify(await evBlob.list("radar:event:20261021-")) === '["080910123-confirmed-112233","080910123-confirmsent-aabbcc","090910123-confirmsent-ddeeff"]', "blob list: a day's prefix ending in '-' works");
  check((await countEvents(evBlob, { day: "20261021", type: "confirmsent" })) === 2 && (await countEvents(evBlob, { day: "20261022", type: "confirmsent" })) === 1,
    "countEvents works through blobStorage (it listed with a '-' prefix that blobStorage used to refuse, which made every sign-up's confirm cap fail closed)");
}

// ---- T02: subscriber records
{
  check(normaliseEmail("  A@Example.COM ") === "a@example.com", "normaliseEmail trims and lowercases");
  const bad = ["a@b", "a b@c.com", "a@b.com,c@d.com", "a".repeat(250) + "@x.com", "", "@x.com", "a@", "a@@x.com", "a@x..com", "a@.x.com",
    "<a@x.com>", '"a"@x.com', null, undefined, 5];
  check(bad.every((x) => normaliseEmail(x) === null), "normaliseEmail rejects: no dot, space, two addresses, 255 chars, empty, missing part, quotes, non-strings");
  check(subscriberId("A@x.com") === subscriberId(" a@X.COM") && /^[0-9a-f]{64}$/.test(subscriberId("a@x.com")) && subscriberId("nope") === null,
    "subscriberId is a stable sha256 hex, the same for any casing; null for a bad address");

  const rec = { token: newToken(seeded()) };
  check(rec.token.length === 43 && /^[A-Za-z0-9_-]+$/.test(rec.token) && newToken(randomBytes) !== newToken(randomBytes), "newToken: 43 base64url characters, random");
  check(tokenOk(rec, rec.token) && !tokenOk(rec, rec.token.slice(0, 42) + "x") && !tokenOk(rec, "short") && !tokenOk(rec, undefined)
    && !tokenOk(rec, "") && !tokenOk(null, rec.token) && !tokenOk({}, rec.token), "tokenOk: right token true; wrong, short, missing, no record false");

  const act = (over) => ({ status: "active", plan: "pro", proUntil: null, ...over });
  check(effectivePlan(act(), T0) === "pro" && effectivePlan(act({ proUntil: iso(T0 + 1000) }), T0) === "pro", "effectivePlan: active Pro with no end or a future end is pro");
  check(effectivePlan(act({ proUntil: iso(T0 - 1000) }), T0) === "free" && effectivePlan(act({ proUntil: iso(T0) }), T0) === "free", "effectivePlan: Pro past its end date is free");
  check(effectivePlan(act({ status: "pending" }), T0) === "free" && effectivePlan(act({ plan: "free" }), T0) === "free"
    && effectivePlan(act({ plan: "gold" }), T0) === "free" && effectivePlan(act({ proUntil: "garbage" }), T0) === "free" && effectivePlan(null, T0) === "free",
    "effectivePlan: pending, free, unknown plan, unreadable date and no record are all free");

  const p = newPending("  Reader@Example.com ", { now: T0, randomBytes: seeded() });
  check(p.v === 1 && p.email === "reader@example.com" && p.id === subscriberId("reader@example.com") && p.status === "pending" && p.plan === "free"
    && p.proUntil === null && p.proSource === null && p.confirmedAt === null && p.cats === null && p.rzp === null
    && p.createdAt === iso(T0) && p.confirmSentAt === iso(T0) && p.token.length === 43, "newPending: the record shape in T02");
  check(PENDING_TTL_DAYS === 7 && CONFIRM_RESEND_HOURS === 24, "constants: 7-day pending life, 24-hour confirmation gap");

  const st = memStorage();
  let calls = 0;
  const spy = { get: async (k) => { calls++; return st.get(k); }, set: st.set, del: st.del, list: st.list };
  check((await getSubscriber(spy, "../x")) === null && (await getSubscriber(spy, "a".repeat(63))) === null && (await getSubscriber(spy, undefined)) === null && calls === 0,
    "getSubscriber with a path-like or 63-character id returns null without calling storage");
  await putSubscriber(st, p);
  check(st.m.has("radar:sub:" + p.id) && (await getSubscriber(st, p.id)).email === "reader@example.com", "putSubscriber then getSubscriber round-trips");
  let threw = false;
  try { await putSubscriber(st, { id: "../x" }); } catch (e) { threw = true; }
  check(threw && st.m.size === 1, "putSubscriber refuses a bad id and writes nothing");
  const q = newPending("two@example.com", { now: T0, randomBytes: seeded(9) });
  await putSubscriber(st, q);
  st.m.set("radar:sub:" + "b".repeat(64), "{not json");
  st.m.set("radar:sub:" + "c".repeat(64), JSON.stringify({ id: "d".repeat(64) })); // the id inside doesn't match the file
  st.m.set("radar:sub:notanid", "{}");
  const all = await listSubscribers(st, { concurrency: 2 });
  check(all.records.length === 2 && all.skipped === 2, `listSubscribers returns every readable record and counts the skipped (${all.records.length} read, ${all.skipped} skipped)`);
  await deleteSubscriber(st, p.id);
  check(!st.m.has("radar:sub:" + p.id) && st.m.has("radar:sub:" + q.id), "deleteSubscriber removes that record and no other");
  const failing = { ...st, list: async () => { throw new Error("blob down"); } };
  let listThrew = false;
  try { await listSubscribers(failing); } catch (e) { listThrew = true; }
  check(listThrew, "listSubscribers lets a failing list() throw, so the caller can stop");
}

// ---- T02: event records
{
  const st = memStorage();
  check(utcDay(T0) === "20261021", "utcDay gives YYYYMMDD");
  await recordEvent(st, "subscribed", { now: T0, randomBytes: seeded() });
  await recordEvent(st, "confirmed", { now: T0 + 5, randomBytes: seeded(5) });
  await recordEvent(st, "confirmed", { now: T0 + 6, randomBytes: seeded(7), plan: "pro" });
  await recordEvent(st, "confirmed", { now: T0 + 86400000, randomBytes: seeded(7) }); // next day
  const keys = [...st.m.keys()];
  check(keys.length === 4 && keys.every((k) => /^radar:event:\d{8}-\d{9}-[a-z]+-[0-9a-f]{6}$/.test(k)), "recordEvent keys match radar:event:<YYYYMMDD>-<HHMMSSmmm>-<type>-<6 hex>");
  check(keys[0].startsWith("radar:event:20261021-080910123-subscribed-") && [...st.m.values()].every((v) => !v.includes("@")), "event keys carry the time and type; values hold no address");
  check(JSON.stringify(JSON.parse(st.m.get(keys[2]))) === JSON.stringify({ type: "confirmed", at: iso(T0 + 6), plan: "pro" }), "event value is { type, at, plan }");
  check((await countEvents(st, { day: "20261021", type: "confirmed" })) === 2 && (await countEvents(st, { day: "20261021", type: "subscribed" })) === 1
    && (await countEvents(st, { day: "20261022", type: "confirmed" })) === 1 && (await countEvents(st, { day: "20261021", type: "unsubscribed" })) === 0,
    "countEvents counts only that day and type");
  check((await recordEvent(st, "made-up", { now: T0, randomBytes: seeded() })) === false && st.m.size === 4, "an unknown event type is ignored");
  const throwing = { set: async () => { throw new Error("blob down"); } };
  check((await recordEvent(throwing, "subscribed", { now: T0, randomBytes: seeded() })) === false, "a storage failure doesn't make recordEvent throw");
}

// ---- T03: HTTP helpers
{
  const stream = (...parts) => ({ headers: {}, async *[Symbol.asyncIterator]() { for (const p of parts) yield p; } });
  const J = "application/json", F = "application/x-www-form-urlencoded";
  check(JSON.stringify(parseForm('{"email":"a@x.com"}', J)) === '{"email":"a@x.com"}', "parseForm: JSON body");
  check(parseForm("email=a%40x.com&website=", F + "; charset=UTF-8").email === "a@x.com", "parseForm: form-encoded body, content type with a charset");
  check(JSON.stringify(parseForm("a=1", "text/plain")) === "{}" && JSON.stringify(parseForm("a=1", undefined)) === "{}", "parseForm: unknown or missing content type gives {}");
  check(JSON.stringify(parseForm("{broken", J)) === "{}" && JSON.stringify(parseForm("[1,2]", J)) === "{}" && JSON.stringify(parseForm("null", J)) === "{}", "parseForm: malformed, array or null JSON gives {} without throwing");

  check((await readBody({ body: "hello" })) === "hello" && (await readBody({ body: Buffer.from("hi") })) === "hi" && (await readBody({ body: { a: 1 } })) === '{"a":1}',
    "readBody: uses a body the platform already read (string, Buffer, object)");
  check((await readBody(stream(Buffer.from("ab"), "cd"))) === "abcd", "readBody: reads a stream");
  check((await readBody(stream())) === "", "readBody: an empty stream is an empty string");
  const tooBig = async (req, opts) => { try { await readBody(req, opts); return false; } catch (e) { return e instanceof BodyTooLargeError && e.statusCode === 413; } };
  check(await tooBig(stream(Buffer.alloc(5000), Buffer.alloc(4000))), "readBody: a 9,000-byte stream with the default limit raises the too-large error");
  check(await tooBig({ body: "x".repeat(9000) }) && await tooBig({ body: { a: "x".repeat(9000) } }), "readBody: a pre-read body over the limit is refused too");
  check(!(await tooBig(stream(Buffer.alloc(8192)))) && (await tooBig(stream(Buffer.alloc(11)), { limit: 10 })), "readBody: exactly the limit passes, one over does not; limit is configurable");

  check((await readFields({ body: { email: "a@x.com" }, headers: {} })).email === "a@x.com", "readFields: a body the platform parsed into an object is used as is");
  check((await readFields({ ...stream("email=a%40x.com"), headers: { "content-type": F } })).email === "a@x.com", "readFields: form text read from the stream");
  check((await readFields({ body: '{"email":"b@x.com"}', headers: { "content-type": J } })).email === "b@x.com", "readFields: JSON text the platform left as a string");

  const page = mockRes();
  sendPage(page, 200, { title: "<script>alert(1)</script>", body: "<p>ok</p>" });
  check(page.code === 200 && !page.body.includes("<script>") && page.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && page.body.startsWith("<!doctype html>"),
    "sendPage escapes the title and starts with a doctype");
  check(page.headers["content-type"] === "text/html; charset=utf-8" && page.headers["cache-control"] === "no-store"
    && page.headers["x-robots-tag"] === "noindex" && page.headers["referrer-policy"] === "no-referrer", "sendPage sets the four headers");
  check(/<meta name="viewport"/.test(page.body) && /<meta charset="utf-8">/.test(page.body), "sendPage has the charset and viewport metas");

  const r405 = mockRes();
  check(allowMethods({ method: "PUT" }, r405, ["GET", "POST"]) === false && r405.code === 405 && r405.headers.allow === "GET, POST", "allowMethods: 405 with an Allow header for another method");
  const rOk = mockRes();
  check(allowMethods({ method: "POST" }, rOk, ["GET", "POST"]) === true && rOk.code === 0, "allowMethods: a listed method passes and writes nothing");

  const j = mockRes();
  sendJson(j, 201, { a: 1 });
  check(j.code === 201 && j.headers["cache-control"] === "no-store" && j.json().a === 1, "sendJson: status, no-store, JSON body");
  check(bearerOk("Bearer s3", "s3") && !bearerOk("Bearer s4", "s3") && !bearerOk("", "s3") && !bearerOk("Bearer s3", ""), "bearerOk still works from its new home");
  check(esc(`<a href="x">&'`) === "&lt;a href=&quot;x&quot;&gt;&amp;&#39;" && esc() === "", "esc escapes & < > \" ' and defaults to an empty string");
}

// ---- T04: subscriber emails and batch sending
{
  const at = "2026-10-21T08:09:10.123Z";
  const problems = [
    { cat: "airlines", severity: "High", isNew: true, title: "Strike <b>", summary: "s", source: "X", region: "EU", date: "2026-10-20", link: "https://example.com/a" },
    { cat: "airlines", severity: "Low", isNew: false, title: "Delay", summary: "", source: "Y", region: "", date: "", link: "" },
  ];
  const owner = buildDigestEmail({ at, problems, perCat: {}, manual: false }, "https://live.example");
  const sameAgain = buildDigestEmail({ at, problems, perCat: {}, manual: false }, "https://live.example", {});
  check(owner.subject === sameAgain.subject && owner.html === sameAgain.html && owner.text === sameAgain.text, "buildDigestEmail: no third argument gives exactly the owner's digest");
  check(owner.subject.startsWith("Travel Problem Radar · 2026-10-21 08:09 UTC"), "buildDigestEmail: owner subject unchanged");

  const sub = buildDigestEmail({ at, problems, perCat: {} }, "https://live.example", { heading: "Your daily Travel Problem Radar", subjectLead: "daily" });
  check(sub.subject === "Travel Problem Radar daily · 2026-10-21 · 2 problems, 1 new", "buildDigestEmail: subscriber subject uses the lead and the date");
  check(sub.html.includes("Your daily Travel Problem Radar") && sub.text.startsWith("Your daily Travel Problem Radar"), "buildDigestEmail: heading replaces the title");

  const U = "https://site.example/api/unsubscribe?id=" + "a".repeat(64) + "&t=tok";
  const M = "https://site.example/subscribe/";
  const f = withSubscriberFooter(sub, { unsubscribeUrl: U, manageUrl: M, plan: "free" });
  check(f.text.includes("Unsubscribe: " + U) && f.text.includes("one email a day") && f.text.includes("Manage subscription: " + M), "footer (free): text has the unsubscribe link, plan line and manage link");
  check(f.html.includes(esc(U)) && f.html.includes("Unsubscribe</a>") && f.html.trimEnd().endsWith("</div>"), "footer: html has the link and stays inside the wrapper");
  check(f.headers["List-Unsubscribe"] === `<${U}>` && f.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "footer: List-Unsubscribe headers per RFC 8058");
  check(withSubscriberFooter(sub, { unsubscribeUrl: U, plan: "pro" }).text.includes("after every sweep"), "footer (pro): different plan line");
  check(!withSubscriberFooter(sub, { unsubscribeUrl: U }).text.includes("Manage subscription"), "footer: no manage line without a manage link");
  check(sub.headers === undefined && !sub.text.includes("Unsubscribe"), "footer: the shared digest is not modified");
  let bad = 0;
  for (const u of ["", "javascript:alert(1)", "https://x.example/a b", 'https://x.example/"><script>']) {
    try { withSubscriberFooter(sub, { unsubscribeUrl: u }); } catch (e) { bad++; }
  }
  check(bad === 4, "footer: refuses a missing or unsafe unsubscribe link");

  const C = "https://site.example/api/confirm?id=" + "b".repeat(64) + "&t=tok2";
  const ce = buildConfirmEmail({ confirmUrl: C, siteUrl: "https://site.example" });
  check(ce.subject === "Confirm your Travel Problem Radar subscription" && ce.text.includes(C) && ce.html.includes(esc(C)), "buildConfirmEmail: subject and confirm link in both parts");
  check(/ignore this email/.test(ce.text) && /Unsubscribing deletes it/.test(ce.text), "buildConfirmEmail: says what to do if unasked and what is kept");
  let badC = 0;
  try { buildConfirmEmail({ confirmUrl: "ftp://x" }); } catch (e) { badC++; }
  check(badC === 1, "buildConfirmEmail: refuses a bad link");

  // A fake Resend. `script` is a list of replies, consumed one per request (the last repeats).
  const fakeResend = (script) => {
    const calls = [];
    const fn = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (step === "throw") throw new Error("socket hang up secret-detail");
      const h = new Map(Object.entries(step.headers || {}));
      return { ok: step.status >= 200 && step.status < 300, status: step.status, headers: { get: (k) => h.get(k) ?? null },
        json: async () => (step.body !== undefined ? step.body : { data: body.map((_, i) => ({ id: "m" + i })) }) };
    };
    return { fn, calls };
  };
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ to: `user${i}@example.com`, subject: "S", html: "<p>h</p>", text: "t", headers: { "List-Unsubscribe": "<https://x.example/u>" } }));
  const creds = { apiKey: "re_secretkey", from: "Radar <hello@pehchanthetraveller.com>" };
  const noSleep = async () => {};

  let r = fakeResend([{ status: 200 }]);
  let out = await sendBatch(creds, msgs(250), { fetchFn: r.fn, sleep: noSleep, idempotencyKey: "deliver-20261021" });
  check(r.calls.length === 3 && r.calls.map((c) => c.body.length).join() === "100,100,50", "sendBatch: 250 messages go in chunks of 100, 100, 50");
  check(out.sent === 250 && out.failed === 0 && out.stopped === null && out.sentIndexes.length === 250 && out.sentIndexes[249] === 249, "sendBatch: all sent, with positions");
  check(r.calls[0].url === "https://api.resend.com/emails/batch" && r.calls[0].headers.authorization === "Bearer re_secretkey" && r.calls[0].headers["user-agent"], "sendBatch: batch endpoint, bearer key, user agent");
  check(r.calls[0].headers["idempotency-key"] === "deliver-20261021-0" && r.calls[2].headers["idempotency-key"] === "deliver-20261021-2", "sendBatch: one idempotency key per chunk");
  check(r.calls[0].body[0].to.length === 1 && r.calls[0].body[0].from === creds.from && r.calls[0].body[0].headers["List-Unsubscribe"], "sendBatch: one recipient per message, sender and per-email headers carried");

  r = fakeResend([{ status: 200 }]);
  out = await sendBatch(creds, [], { fetchFn: r.fn });
  check(r.calls.length === 0 && out.sent === 0 && out.stopped === null, "sendBatch: nothing to send makes no request");

  for (const [label, c] of [["no key", { apiKey: "", from: creds.from }], ["default sender", { apiKey: "k", from: DEFAULT_FROM }], ["resend.dev sender", { apiKey: "k", from: "R <x@resend.dev>" }], ["no sender", { apiKey: "k" }]]) {
    r = fakeResend([{ status: 200 }]);
    out = await sendBatch(c, msgs(2), { fetchFn: r.fn });
    check(r.calls.length === 0 && /^not configured/.test(out.stopped), `sendBatch: ${label} sends nothing and says not configured`);
  }

  r = fakeResend([{ status: 429, headers: { "retry-after": "1" }, body: { name: "rate_limit_exceeded", message: "slow down" } }, { status: 200 }]);
  let slept = [];
  out = await sendBatch(creds, msgs(3), { fetchFn: r.fn, sleep: async (ms) => { slept.push(ms); } });
  check(out.sent === 3 && r.calls.length === 2 && slept[0] === 1000 && r.calls[0].headers["idempotency-key"] === undefined, "sendBatch: a rate limit waits retry-after and retries once");

  r = fakeResend([{ status: 429, body: { name: "daily_quota_exceeded", message: "x" } }]);
  out = await sendBatch(creds, msgs(250), { fetchFn: r.fn, sleep: noSleep });
  check(r.calls.length === 1 && out.stopped === "quota" && out.sent === 0 && out.failed === 0, "sendBatch: a quota error stops, and the rest are neither sent nor failed");

  r = fakeResend([{ status: 200 }, { status: 429, body: { name: "monthly_quota_exceeded" } }]);
  out = await sendBatch(creds, msgs(250), { fetchFn: r.fn, sleep: noSleep });
  check(out.sent === 100 && out.stopped === "quota" && out.sentIndexes.length === 100, "sendBatch: chunks sent before a quota stop still count");

  r = fakeResend([{ status: 401, body: { name: "restricted_api_key", message: "re_secretkey is bad" } }]);
  out = await sendBatch(creds, msgs(250), { fetchFn: r.fn, sleep: noSleep });
  check(r.calls.length === 1 && out.stopped === "http 401 restricted_api_key" && !JSON.stringify(out).includes("re_secretkey"), "sendBatch: an auth error stops and does not leak the key");

  r = fakeResend([{ status: 422, body: { name: "validation_error", message: "bad@ address" } }, { status: 200 }, { status: 422, body: { name: "validation_error" } }, { status: 200 }]);
  out = await sendBatch(creds, msgs(3), { fetchFn: r.fn, sleep: noSleep, idempotencyKey: "k" });
  check(r.calls.length === 4 && out.sent === 2 && out.failed === 1 && out.sentIndexes.join() === "0,2" && out.stopped === null, "sendBatch: a rejected chunk is retried one by one so only the bad message fails");
  check(!JSON.stringify(out).includes("@"), "sendBatch: the result holds no address or Resend message text");

  r = fakeResend([{ status: 500, body: { name: "internal_server_error" } }]);
  out = await sendBatch(creds, msgs(250), { fetchFn: r.fn, sleep: noSleep });
  check(out.sent === 0 && out.failed === 250 && out.stopped === null && out.reason === "http 500 internal_server_error", "sendBatch: a server error fails the chunks and carries on");

  r = fakeResend(["throw"]);
  out = await sendBatch(creds, msgs(2), { fetchFn: r.fn, sleep: noSleep });
  check(out.failed === 2 && out.reason === "network error" && !JSON.stringify(out).includes("secret-detail"), "sendBatch: a network error is reported without its detail");

  r = fakeResend([{ status: 200, body: { data: [{ id: "a" }] } }]);
  out = await sendBatch(creds, msgs(3), { fetchFn: r.fn, sleep: noSleep });
  check(out.sent === 1 && out.failed === 2 && out.reason === "short reply", "sendBatch: a reply with fewer ids than messages counts the rest as failed");

  r = fakeResend([{ status: 200 }]);
  let allowed = 1;
  out = await sendBatch(creds, msgs(250), { fetchFn: r.fn, sleep: noSleep, shouldStop: () => allowed-- <= 0 });
  check(r.calls.length === 1 && out.sent === 100 && out.stopped === "deadline", "sendBatch: shouldStop() ends the run between chunks");

  r = fakeResend([{ status: 200 }]);
  const seen = [];
  await sendBatch(creds, msgs(150), { fetchFn: r.fn, sleep: noSleep, onChunk: async ({ sentIndexes }) => { seen.push(sentIndexes.length); throw new Error("save failed"); } });
  check(seen.join() === "100,50", "sendBatch: onChunk gets each chunk's sent positions, and its failure doesn't stop the run");

  r = fakeResend([{ status: 200 }]);
  check((await sendOne(creds, msgs(1)[0], { fetchFn: r.fn })) === "sent", "sendOne: sent");
  r = fakeResend([{ status: 500, body: { name: "internal_server_error" } }]);
  check((await sendOne(creds, msgs(1)[0], { fetchFn: r.fn })) === "failed: http 500 internal_server_error", "sendOne: failed with a reason");
  check(/^not configured/.test(await sendOne({ apiKey: "" }, msgs(1)[0], { fetchFn: r.fn })), "sendOne: not configured");
}

// ---- T05: POST /api/subscribe
{
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example/", MAX_SUBSCRIBERS: "5000" };
  // `opts.count` seeds radar:subscriberCount (stored under storage.js's file name); `opts.t0` sets the clock.
  const world = (envOver = {}, opts = {}) => {
    const st = memStorage();
    if (opts.count !== undefined) st.m.set("radar:subscriberCount", String(opts.count));
    const sent = [];
    const logs = [];
    let resendStatus = opts.resendStatus || 200;
    let clock = opts.t0 || T0;
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      if (resendStatus === 200) sent.push(...body);
      return { ok: resendStatus === 200, status: resendStatus, headers: { get: () => null }, json: async () => (resendStatus === 200 ? { data: body.map((_, i) => ({ id: "m" + i })) } : { name: "internal_server_error" }) };
    };
    const env = { ...ENV, ...envOver };
    const handler = makeSubscribeHandler({ env, storage: st, fetchFn, now: () => clock, randomBytes: seeded(7), log: (...a) => logs.push(a.join(" ")) });
    const post = async (fields, { type = "application/json", method = "POST" } = {}) => {
      const res = mockRes();
      const req = { method, headers: { "content-type": type }, body: typeof fields === "string" ? undefined : fields };
      if (typeof fields === "string") req[Symbol.asyncIterator] = async function* () { yield Buffer.from(fields); };
      await handler(req, res);
      return res;
    };
    return { st, sent, logs, post, tick: (ms) => { clock += ms; }, setResend: (c) => { resendStatus = c; }, env };
  };
  const OK = '{"ok":true,"message":"If that address can be subscribed, a confirmation link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder."}';
  const subKeys = (w) => [...w.st.m.keys()].filter((k) => k.startsWith("radar:sub:"));
  const evKeys = (w, type) => [...w.st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
  const DAY = 24 * 3600 * 1000;

  // rows 1-4
  let w = world();
  let r = await w.post({ email: "a@example.com" }, { method: "GET" });
  check(r.code === 405 && r.headers.allow === "POST", "subscribe row 1: GET gets 405 with Allow: POST");
  w = world({ SUBSCRIPTIONS_ENABLED: "" });
  r = await w.post({ email: "a@example.com" });
  check(r.code === 503 && r.json().error === "subscriptions are not open yet" && w.st.m.size === 0, "subscribe row 2: switch off gives 503 and nothing is written");
  let reads = 0;
  w = world({ SUBSCRIPTIONS_ENABLED: "0" });
  const get0 = w.st.get;
  w.st.get = async (k) => { reads++; return get0(k); };
  await w.post({ email: "a@example.com" });
  check(reads === 0, "subscribe row 2: no storage read when switched off");
  for (const [label, over] of [["no API key", { RESEND_API_KEY: "" }], ["unset sender", { EMAIL_FROM: "" }], ["shared sender", { EMAIL_FROM: "Radar <onboarding@resend.dev>" }], ["no site url", { SITE_URL: "" }]]) {
    w = world(over);
    r = await w.post({ email: "a@example.com" });
    check(r.code === 503 && r.json().error === "subscriptions are not open yet" && w.logs.includes("subscribe not configured") && w.st.m.size === 0 && w.sent.length === 0, `subscribe row 3: ${label} gives 503 and logs "subscribe not configured"`);
  }
  w = world({ SITE_URL: "", VERCEL_PROJECT_PRODUCTION_URL: "radar.vercel.app" }, { count: 0 });
  r = await w.post({ email: "a@example.com" });
  check(r.code === 200 && w.sent[0].text.includes("https://radar.vercel.app/api/confirm?id="), "subscribe: SITE_URL falls back to the Vercel production URL");
  check(siteUrl({ SITE_URL: "javascript:x" }) === "" && siteUrl({ SITE_URL: "https://s.example///" }) === "https://s.example", "siteUrl: rejects a non-http link and trims slashes");
  w = world();
  r = await w.post("email=" + "x".repeat(9000), { type: "application/x-www-form-urlencoded" });
  check(r.code === 413, "subscribe row 4: a body over 8 KB gets 413");

  // rows 5 and 6
  w = world({}, { count: 0 });
  r = await w.post({ email: "a@example.com", website: "http://spam" });
  check(r.code === 200 && r.body === OK && subKeys(w).length === 0 && w.sent.length === 0, "subscribe row 5: honeypot filled gives the OK reply and stores nothing");
  let badOk = true;
  for (const bad of ["", "not-an-email", "a b@example.com", null]) {
    r = await w.post({ email: bad });
    if (!(r.code === 400 && r.json().error === "enter a valid email address")) badOk = false;
  }
  check(badOk, "subscribe row 6: bad addresses get 400 \"enter a valid email address\"");
  r = await w.post("not json at all");
  check(r.code === 400 && subKeys(w).length === 0, "subscribe row 6: an unreadable body gets 400 and stores nothing");

  // row 12: a new address
  w = world({}, { count: 3 });
  r = await w.post({ email: "  New.Person@Example.COM " });
  const newBody = r.body;
  const subs = subKeys(w);
  const rec = JSON.parse(w.st.m.get(subs[0]));
  check(r.code === 200 && newBody === OK && subs.length === 1, "subscribe row 12: a new address gets the OK reply and one pending record");
  check(rec.status === "pending" && rec.plan === "free" && rec.email === "new.person@example.com" && rec.id === subscriberId("new.person@example.com"), "subscribe row 12: the record is pending, free, with the normalised address");
  check(w.sent.length === 1 && w.sent[0].to[0] === "new.person@example.com" && w.sent[0].text.includes(`https://site.example/api/confirm?id=${rec.id}&t=${rec.token}`), "subscribe row 12: the confirmation link has the record's id and token and the SITE_URL");
  check(evKeys(w, "subscribed").length === 1 && evKeys(w, "confirmsent").length === 1, "subscribe row 12: subscribed and confirmsent events recorded");
  check([...w.st.m.entries()].filter(([k]) => k.startsWith("radar:event:")).every(([k, v]) => !/@|[0-9a-f]{64}/.test(k + v)), "subscribe: event records hold no address or id");
  check(!w.logs.some((l) => /@|[0-9a-f]{64}/.test(l) || l.includes(rec.token)), "subscribe: no log line holds the address, id or token");
  check(w.sent[0].headers === undefined, "subscribe: the confirmation email carries no unsubscribe header");

  // row 7: already active, in another case
  w.st.m.set(subs[0], JSON.stringify({ ...rec, status: "active", confirmedAt: iso(T0) }));
  const before = w.st.m.size;
  r = await w.post({ email: "NEW.PERSON@example.com" });
  check(r.code === 200 && r.json().already === true && /already subscribed\. We've emailed it/.test(r.json().message) && subKeys(w).length === 1 && w.st.m.size === before + 1,
    "subscribe row 7: an active address (any case) is told it is already subscribed; no new record, one noticesent event");
  check(w.sent.length === 2 && w.sent[1].to[0] === "new.person@example.com" && /already subscribed/.test(w.sent[1].subject) && !/confirm\?id=/.test(w.sent[1].text),
    "subscribe row 7: the inbox gets one already-subscribed notice, not a confirmation link");

  // rows 8 and 9: pending
  w = world({}, { count: 0 });
  await w.post({ email: "p@example.com" });
  const pk = subKeys(w)[0];
  const tok = JSON.parse(w.st.m.get(pk)).token;
  w.tick(23 * 3600 * 1000);
  r = await w.post({ email: "p@example.com" });
  check(r.code === 200 && /already sent to this address in the last 24 hours/.test(r.json().message) && !r.json().already && w.sent.length === 1, "subscribe row 8: pending, confirmation sent 23 h ago: says a link was already sent; no new email");
  w.tick(2 * 3600 * 1000);
  r = await w.post({ email: "P@example.com" });
  const after9 = JSON.parse(w.st.m.get(pk));
  check(r.body === OK && w.sent.length === 2 && after9.token === tok && after9.confirmSentAt === iso(T0 + 25 * 3600 * 1000), "subscribe row 9: pending 25 h on: new email, same token, confirmSentAt updated");
  check(w.sent[1].text.includes(`t=${tok}`) && subKeys(w).length === 1, "subscribe row 9: the new email carries the same token; still one record");

  // row 10: the list cap
  w = world({ MAX_SUBSCRIBERS: "" }, { count: 0 });
  r = await w.post({ email: "a@example.com" });
  check(r.body === OK && subKeys(w).length === 0 && w.sent.length === 0, "subscribe row 10: MAX_SUBSCRIBERS unset means closed; nothing stored");
  w = world({ MAX_SUBSCRIBERS: "abc" }, { count: 0 });
  await w.post({ email: "a@example.com" });
  check(subKeys(w).length === 0, "subscribe row 10: MAX_SUBSCRIBERS not a number means closed");
  w = world({ MAX_SUBSCRIBERS: "100" }, { count: 100 });
  r = await w.post({ email: "a@example.com" });
  check(r.body === OK && subKeys(w).length === 0 && w.sent.length === 0, "subscribe row 10: count at the cap: nothing stored, identical reply");
  w = world({ MAX_SUBSCRIBERS: "100" }, { count: 99 });
  await w.post({ email: "a@example.com" });
  check(subKeys(w).length === 1, "subscribe row 10: one below the cap still stores");
  w = world({}, { count: '{"count":5000,"at":"x"}' });
  await w.post({ email: "a@example.com" });
  check(subKeys(w).length === 0, "subscribe: the count file may hold {count, at}");
  w = world({}, { count: "garbage" });
  await w.post({ email: "a@example.com" });
  check(subKeys(w).length === 0, "subscribe: an unreadable count file counts as full");
  w = world();
  await w.post({ email: "a@example.com" });
  check(subKeys(w).length === 1, "subscribe: no count file yet (before the first sweep) counts as 0");
  check(KEY_SUBSCRIBER_COUNT === "radar:subscriberCount", "subscribe: the count key is radar:subscriberCount");

  // row 11: the daily confirmation cap
  w = world({ MAX_CONFIRMS_PER_DAY: "10" }, { count: 0 });
  for (let i = 0; i < 11; i++) await w.post({ email: `user${i}@example.com` });
  check(w.sent.length === 10 && subKeys(w).length === 10, "subscribe row 11: eleven new addresses with the cap at 10 give ten emails and ten records");
  r = await w.post({ email: "user10@example.com" });
  check(r.body === OK, "subscribe row 11: the capped reply is identical");
  w.tick(DAY);
  await w.post({ email: "user10@example.com" });
  check(w.sent.length === 11, "subscribe row 11: the next UTC day starts a fresh count");
  w = world({}, { count: 0 });
  for (let i = 0; i < 11; i++) await w.post({ email: `u${i}@example.com` });
  check(w.sent.length === 10, "subscribe: MAX_CONFIRMS_PER_DAY unset defaults to 10");
  w = world({ MAX_CONFIRMS_PER_DAY: "0" }, { count: 0 });
  await w.post({ email: "u@example.com" });
  check(w.sent.length === 0 && subKeys(w).length === 0, "subscribe: MAX_CONFIRMS_PER_DAY=0 stops all confirmations");
  // q signs up at 00:00 UTC; at 00:00:01 the next day r signs up (the cap of 1 is spent), so q's re-send is held back
  w = world({ MAX_CONFIRMS_PER_DAY: "1" }, { count: 0, t0: Date.UTC(2026, 9, 21, 0, 0, 0) });
  await w.post({ email: "q@example.com" });
  w.tick(DAY + 1000);
  await w.post({ email: "r@example.com" });
  await w.post({ email: "q@example.com" });
  check(w.sent.length === 2 && w.sent[1].to[0] === "r@example.com", "subscribe: a re-send also counts against the daily cap");

  // Resend fails
  w = world({}, { count: 0, resendStatus: 500 });
  r = await w.post({ email: "fail@example.com" });
  check(r.code === 200 && r.body === OK && subKeys(w).length === 1, "subscribe: Resend failing still replies OK and keeps the record");
  check(w.logs.some((l) => l.startsWith("subscribe confirm-email failed: ")) && !w.logs.some((l) => l.includes("@")), "subscribe: the failure is logged without the address");
  w.setResend(200);
  w.tick(25 * 3600 * 1000);
  await w.post({ email: "fail@example.com" });
  check(w.sent.length === 1 && w.sent[0].to[0] === "fail@example.com", "subscribe: a later sign-up after 24 h retries the confirmation");

  // storage failure
  w = world({}, { count: 0 });
  w.st.set = async () => { throw new Error("blob down for fail@example.com"); };
  r = await w.post({ email: "fail@example.com" });
  check(r.code === 500 && !r.body.includes("@") && !w.logs.some((l) => l.includes("@")) && w.sent.length === 0, "subscribe: a storage failure gives 500, sends nothing, and leaks nothing");

  // body formats
  w = world({}, { count: 0 });
  await w.post("email=form%40example.com&website=", { type: "application/x-www-form-urlencoded" });
  await w.post({ email: "json@example.com" });
  check(subKeys(w).length === 2 && w.sent.map((m) => m.to[0]).sort().join() === "form@example.com,json@example.com", "subscribe: form-encoded and JSON bodies both work");
  r = await w.post('{"email":"streamed@example.com"}', { type: "text/plain" });
  check(r.code === 400 && subKeys(w).length === 2, "subscribe: a body with an unsupported content type has no fields (400)");

  // the rows that reply OK are byte-identical, headers included
  w = world({}, { count: 0 });
  const replies = [
    await w.post({ email: "x1@example.com" }), // new
    await w.post({ email: "x2@example.com", website: "bot" }), // honeypot
  ];
  check(replies.every((x) => x.body === OK && x.code === 200 && JSON.stringify(x.headers) === JSON.stringify(replies[0].headers)), "subscribe: new and honeypot replies are byte-identical, headers included");
}

// ---- T06: GET and POST /api/confirm
{
  const DAY = 24 * 3600 * 1000;
  const setup = async ({ enabled = "1", status = "pending", createdAt = T0, email = "c.person@example.com", t = T0 } = {}) => {
    const st = memStorage();
    let rec = newPending(email, { now: createdAt, randomBytes: seeded(40) });
    if (status === "active") rec = { ...rec, status: "active", confirmedAt: iso(createdAt) };
    await putSubscriber(st, rec);
    let clock = t;
    const handler = makeConfirmHandler({ env: { SUBSCRIPTIONS_ENABLED: enabled }, storage: st, now: () => clock, randomBytes: seeded(9) });
    const call = async (method, { id = rec.id, t: tok = rec.token, form } = {}) => {
      const res = mockRes();
      const qs = new URLSearchParams(Object.entries({ id, t: tok }).filter(([, v]) => v !== null)).toString();
      const req = { method, url: "/api/confirm?" + (method === "GET" ? qs : ""), headers: { "content-type": "application/x-www-form-urlencoded" } };
      if (method === "POST") req[Symbol.asyncIterator] = async function* () { yield Buffer.from(form !== undefined ? form : qs); };
      await handler(req, res);
      return res;
    };
    return { st, rec, call, tick: (ms) => { clock += ms; }, stored: () => JSON.parse(st.m.get("radar:sub:" + rec.id)) };
  };
  const evCount = (st, type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`)).length;

  let c = await setup();
  let r = await c.call("GET");
  check(r.code === 200 && r.body.includes('action="/api/confirm"') && r.body.includes("Confirm") && r.body.includes(`value="${c.rec.id}"`) && r.body.includes(`value="${c.rec.token}"`), "confirm GET: a page with a form that POSTs the id and token");
  check(c.stored().status === "pending" && evCount(c.st, "confirmed") === 0, "confirm GET: the record is unchanged");
  check(r.headers["cache-control"] === "no-store" && r.headers["x-robots-tag"] === "noindex" && r.headers["referrer-policy"] === "no-referrer", "confirm: pages carry the no-store, noindex and no-referrer headers");
  check(!r.body.includes("@") && !r.body.includes("c.person"), "confirm GET: the page holds no address");

  r = await c.call("POST");
  const after = c.stored();
  check(r.code === 200 && r.body.includes("You&#39;re subscribed") && r.body.includes("05:47 IST") && r.body.includes('href="/live/"'), "confirm POST: the success page with the first-digest time and a link to /live/");
  check(after.status === "active" && after.confirmedAt === iso(T0) && after.token === c.rec.token && after.email === c.rec.email, "confirm POST: active, confirmedAt set, token not rotated");
  check(evCount(c.st, "confirmed") === 1 && !r.body.includes("@"), "confirm POST: a confirmed event written; the page holds no address");
  const eventsBefore = c.st.m.size;
  const r2 = await c.call("POST");
  check(r2.code === 200 && r2.body === r.body && c.st.m.size === eventsBefore && c.stored().confirmedAt === iso(T0), "confirm POST twice: the second is a no-op with the same success page");
  r = await c.call("GET");
  check(r.code === 200 && r.body.includes("already subscribed") && !r.body.includes("<form"), "confirm GET after confirming: \"You're already subscribed\"");

  // wrong or missing credentials: identical 404s, record unchanged
  c = await setup();
  const bads = [];
  bads.push(await c.call("GET", { t: "wrong-token" }));
  bads.push(await c.call("POST", { t: "wrong-token" }));
  bads.push(await c.call("GET", { t: c.rec.token.slice(0, 10) })); // different length
  bads.push(await c.call("GET", { t: null }));
  bads.push(await c.call("POST", { t: null }));
  bads.push(await c.call("GET", { id: "f".repeat(64) })); // unknown id
  bads.push(await c.call("GET", { id: "nope" }));
  bads.push(await c.call("GET", { id: null, t: null }));
  bads.push(await c.call("POST", { form: "id=" + c.rec.id + "&t=" })); // empty token
  check(bads.every((x) => x.code === 404 && x.body === bads[0].body) && bads[0].body.includes("isn&#39;t valid"), "confirm: wrong token, other length, missing t, unknown or malformed id all give the identical 404 page");
  check(c.stored().status === "pending" && evCount(c.st, "confirmed") === 0, "confirm: the record is unchanged by all of them");

  // expiry
  c = await setup();
  c.tick(7 * DAY - 1000);
  r = await c.call("GET");
  check(r.code === 200 && c.st.m.has("radar:sub:" + c.rec.id), "confirm: a pending record just under 7 days old is still valid");
  c.tick(2000);
  r = await c.call("GET", { t: "wrong-token" });
  check(r.code === 404 && c.st.m.has("radar:sub:" + c.rec.id) && evCount(c.st, "expired") === 0, "confirm: an expired record is not deleted by a wrong token");
  r = await c.call("GET");
  check(r.code === 404 && r.body === bads[0].body && !c.st.m.has("radar:sub:" + c.rec.id) && evCount(c.st, "expired") === 1, "confirm: an expired pending record is deleted on its own link, with an expired event and the same 404");
  c = await setup();
  c.tick(8 * DAY);
  r = await c.call("POST");
  check(r.code === 404 && !c.st.m.has("radar:sub:" + c.rec.id), "confirm POST: an expired record cannot be confirmed");
  c = await setup({ status: "active" });
  c.tick(30 * DAY);
  r = await c.call("GET");
  check(r.code === 200 && c.st.m.has("radar:sub:" + c.rec.id), "confirm: an old active record is never expired");

  // switch, methods, size
  c = await setup({ enabled: "" });
  r = await c.call("POST");
  check(r.code === 503 && r.body.includes("paused") && c.stored().status === "pending", "confirm: switch off gives a 503 \"paused\" page and changes nothing");
  c = await setup();
  r = await c.call("PUT");
  check(r.code === 405 && r.headers.allow === "GET, POST", "confirm: other methods get 405");
  r = await c.call("POST", { form: "id=" + "x".repeat(5000) });
  check(r.code === 413, "confirm POST: an oversized body gets 413");
  c = await setup();
  r = await c.call("GET", { id: '"><script>alert(1)</script>', t: '"><b>' });
  check(r.code === 404 && !r.body.includes("<script>alert"), "confirm: hostile query values never reach the page");
  c.st.set = async () => { throw new Error("blob down for c.person@example.com"); };
  r = await c.call("POST");
  check(r.code === 500 && !r.body.includes("@") && r.body.includes("try the link again"), "confirm: a storage failure gives a plain 500 page without detail");
}

// ---- T07: GET and POST /api/unsubscribe
{
  const setup = async ({ enabled = "1", status = "active", plan = "free", proSource = null, proUntil = null, email = "u.person@example.com" } = {}) => {
    const st = memStorage();
    const rec = { ...newPending(email, { now: T0, randomBytes: seeded(60) }), status, plan, proSource, proUntil };
    await putSubscriber(st, rec);
    const handler = makeUnsubscribeHandler({ env: { SUBSCRIPTIONS_ENABLED: enabled }, storage: st, now: () => T0 + 1000, randomBytes: seeded(5) });
    // The id and token always travel in the query string, on GET and POST alike.
    const call = async (method, { id = rec.id, t = rec.token, body = "" } = {}) => {
      const res = mockRes();
      const qs = new URLSearchParams(Object.entries({ id, t }).filter(([, v]) => v !== null)).toString();
      const req = { method, url: "/api/unsubscribe?" + qs, headers: { "content-type": "application/x-www-form-urlencoded" } };
      if (method === "POST") req[Symbol.asyncIterator] = async function* () { if (body) yield Buffer.from(body); };
      await handler(req, res);
      return res;
    };
    return { st, rec, call, has: () => st.m.has("radar:sub:" + rec.id) };
  };
  const events = (st, type) => [...st.m.entries()].filter(([k]) => k.startsWith("radar:event:") && k.includes(`-${type}-`));

  let u = await setup();
  let r = await u.call("GET");
  check(r.code === 200 && r.body.includes("Unsubscribe from Travel Problem Radar?") && r.body.includes('method="post"') && r.body.includes("/api/unsubscribe?id=") && u.has(), "unsubscribe GET: a confirm page with a POST form, record still there");
  check(!r.body.includes("@") && r.headers["cache-control"] === "no-store" && r.headers["referrer-policy"] === "no-referrer", "unsubscribe GET: no address on the page; no-store and no-referrer");
  r = await u.call("POST", { body: "List-Unsubscribe=One-Click" });
  check(r.code === 200 && r.body.includes("unsubscribed") && !u.has(), "unsubscribe POST one-click (id and token in the query, fixed body): record deleted, 200");
  const ev = events(u.st, "unsubscribed");
  check(ev.length === 1 && JSON.parse(ev[0][1]).plan === "free" && !/@|[0-9a-f]{64}/.test(ev[0][0] + ev[0][1]), "unsubscribe: the event holds the plan, not the address or id");
  check([...u.st.m.keys()].every((k) => !k.startsWith("radar:sub:")) && ![...u.st.m.values()].some((v) => v.includes("u.person")), "unsubscribe: nothing about the address is left in storage");
  const again = await u.call("POST", { body: "List-Unsubscribe=One-Click" });
  check(again.code === 200 && again.body.includes("no longer active") && events(u.st, "unsubscribed").length === 1, "unsubscribe POST again: 200 \"no longer active\", no second event");

  u = await setup();
  r = await u.call("POST");
  check(r.code === 200 && !u.has(), "unsubscribe POST from the page form (no one-click body): deleted");
  u = await setup({ status: "pending" });
  await u.call("POST");
  check(!u.has(), "unsubscribe: a pending record is deleted too");

  u = await setup();
  const wrong = [await u.call("GET", { t: "nope" }), await u.call("POST", { t: "nope" }), await u.call("POST", { t: null }), await u.call("POST", { id: "e".repeat(64) }), await u.call("GET", { id: "bad", t: null })];
  check(wrong.every((x) => x.code === 200 && x.body === wrong[0].body) && wrong[0].body.includes("no longer active") && u.has(), "unsubscribe: wrong token, missing token, unknown id: 200 \"no longer active\" (identical), record kept");
  check(!/not on the list|isn't on the list|not subscribed/i.test(wrong[0].body) && wrong[0].body.includes("most recent one"), "unsubscribe: an old link says nothing about the address and points to the most recent email (a re-subscribed person is still on the list)");

  u = await setup({ enabled: "" });
  r = await u.call("POST");
  check(r.code === 200 && !u.has(), "unsubscribe: works with SUBSCRIPTIONS_ENABLED unset");
  u = await setup();
  r = await u.call("DELETE");
  check(r.code === 405, "unsubscribe: other methods get 405");

  // Pro
  u = await setup({ plan: "pro", proSource: "owner" });
  await u.call("POST");
  check(!u.has() && JSON.parse(events(u.st, "unsubscribed")[0][1]).plan === "pro", "unsubscribe: owner-granted Pro unsubscribes like Free, and the event says pro");
  u = await setup({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * 24 * 3600 * 1000) });
  r = await u.call("POST");
  check(r.code === 200 && u.has() && r.body.includes("Cancel your Pro plan first") && r.body.includes('href="/manage/?id=') && events(u.st, "unsubscribed").length === 0, "unsubscribe: a still-paid Razorpay Pro is kept, with a page pointing to the manage page");
  u = await setup({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 - 1000) });
  await u.call("POST");
  check(!u.has(), "unsubscribe: a lapsed Razorpay Pro unsubscribes like Free");
  u = await setup({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * 24 * 3600 * 1000) });
  r = await u.call("GET");
  check(r.body.includes("Unsubscribe from Travel Problem Radar?") && u.has(), "unsubscribe GET: a paid Pro sees the normal page; the explanation comes on POST");

  // storage failure
  u = await setup();
  u.st.del = async () => { throw new Error("blob down for u.person@example.com"); };
  r = await u.call("POST");
  check(r.code === 500 && !r.body.includes("@"), "unsubscribe: a storage failure gives a plain 500 page without detail");

  // the links T04 puts in the emails resolve here
  u = await setup();
  const mail = withSubscriberFooter({ subject: "s", text: "t", html: "<div>h</div>" }, { unsubscribeUrl: `https://site.example/api/unsubscribe?id=${u.rec.id}&t=${u.rec.token}` });
  const link = new URL(mail.headers["List-Unsubscribe"].slice(1, -1));
  r = await u.call("POST", { id: link.searchParams.get("id"), t: link.searchParams.get("t"), body: "List-Unsubscribe=One-Click" });
  check(!u.has() && r.code === 200, "unsubscribe: the List-Unsubscribe link built by withSubscriberFooter works as a one-click POST");
}

// ---- T09: delivery engine
{
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" };
  const prob = (id, over = {}) => ({ id, cat: "traveler_pain", title: "Item " + id, summary: "", source: "S", link: "https://example.com/" + id, region: "EU", date: "2026-10-20", severity: "Medium", opportunity: "", isNew: false, ...over });

  const world = ({ t0 = T0, env = {} } = {}) => {
    const st = memStorage();
    const logs = [];
    const mails = []; // every message Resend accepted: { to, subject, text, headers }
    let clock = t0;
    const bad = new Set(); // addresses Resend rejects
    let callNo = 0;
    let script = () => null; // (callNo, body) => { status, body } | null for a normal reply
    let tickPerCall = 0;
    const fetchFn = async (url, init) => {
      callNo++;
      clock += tickPerCall;
      const body = JSON.parse(init.body);
      const forced = script(callNo, body);
      const h = { get: () => null };
      if (forced) return { ok: forced.status < 300, status: forced.status, headers: h, json: async () => forced.body || {} };
      if (body.some((m) => bad.has(m.to[0]))) return { ok: false, status: 422, headers: h, json: async () => ({ name: "validation_error" }) };
      mails.push(...body);
      return { ok: true, status: 200, headers: h, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) };
    };
    const deps = (over = {}) => ({ env: { ...ENV, ...env }, storage: st, fetchFn, now: () => clock, randomBytes: seeded(3), log: (...a) => logs.push(a.join(" ")), ...over });
    const addSub = async (n, { plan = "free", status = "active", proUntil = null, proSource = null, createdAt = t0 } = {}) => {
      const rec = { ...newPending(`s${n}@example.com`, { now: createdAt, randomBytes: seeded(100 + n) }), token: "tok" + n, status, plan, proUntil, proSource };
      await putSubscriber(st, rec);
      return rec;
    };
    const addSweep = async (id, at, problems, manual = false) => {
      const hist = JSON.parse(st.m.get("radar:history") || "[]");
      hist.push({ id, at: iso(at), total: problems.length, newCount: problems.filter((p) => p.isNew).length, ...(manual ? { manual: true } : {}) });
      st.m.set("radar:history", JSON.stringify(hist));
      st.m.set("radar:sweep:" + id, JSON.stringify({ at: iso(at), problems }));
      return { id, at: iso(at), problems, perCat: {}, newCount: problems.filter((p) => p.isNew).length };
    };
    const run = (sweep, { scheduled = true, deadlineAt, over = {} } = {}) => deliverToSubscribers({ ...deps(over), sweep, scheduled, deadlineAt });
    return { st, logs, mails, bad, addSub, addSweep, run, deps, tick: (ms) => { clock += ms; }, setClock: (v) => { clock = v; }, setScript: (f) => { script = f; }, setTickPerCall: (v) => { tickPerCall = v; }, now: () => clock };
  };
  const deliveries = (w, day = "20261021") => JSON.parse(w.st.m.get("radar:deliveries:" + day) || "null");
  const count = (w, to) => w.mails.filter((m) => m.to[0] === to).length;

  // 1. not configured
  for (const [label, env] of [["switch off", { SUBSCRIPTIONS_ENABLED: "" }], ["no API key", { RESEND_API_KEY: "" }], ["no sender", { EMAIL_FROM: "" }], ["shared sender", { EMAIL_FROM: "R <onboarding@resend.dev>" }], ["no site url", { SITE_URL: "" }]]) {
    const w = world({ env });
    await w.addSub(1);
    const sw = await w.addSweep("1792570150123", T0, [prob("a")]);
    let touched = 0;
    for (const m of ["get", "set", "del", "list"]) { const f = w.st[m]; w.st[m] = async (...a) => { touched++; return f(...a); }; }
    const out = await w.run(sw);
    check(out === "not configured" && touched === 0 && w.mails.length === 0, `delivery: ${label} gives "not configured" and touches nothing`);
  }

  // 2. 2 Pro + 3 Free over two sweeps in one day
  let w = world();
  await w.addSub(1, { plan: "pro", proSource: "owner" });
  await w.addSub(2, { plan: "pro", proSource: "owner", proUntil: iso(T0 + 30 * DAY) });
  for (const n of [3, 4, 5]) await w.addSub(n);
  const p1 = [prob("a", { isNew: true, severity: "High" }), prob("b")];
  let sw = await w.addSweep("1792570150123", T0, p1);
  let out = await w.run(sw);
  check(w.mails.length === 5 && out.pro.sent === 2 && out.free.sent === 3 && out.free.due === 3 && out.stopped === null, "delivery: 2 Pro + 3 Free, first sweep of the day: 5 emails");
  check(out.pro.failed === 0 && out.pro.deferred === 0 && out.free.alreadySent === 0 && out.pending === 0 && out.expired === 0, "delivery: the summary has the task's shape");
  check(w.mails.filter((m) => /Pro update/.test(m.text)).length === 2 && w.mails.filter((m) => /daily digest/.test(m.text)).length === 3, "delivery: Pro and Free get their own heading");
  check(w.mails.filter((m) => /^Travel Problem Radar daily · /.test(m.subject)).length === 3, "delivery: the Free subject is the daily one");
  check(JSON.stringify(deliveries(w)) === JSON.stringify({ free: [...deliveries(w).free] }) && deliveries(w).free.length === 3, "delivery: the three Free ids are recorded for today");
  check(JSON.parse(w.st.m.get("radar:subscriberCount")).count === 5, "delivery: radar:subscriberCount written (active + pending)");
  w.tick(5 * HOUR);
  const sw2 = await w.addSweep("1792588150123", w.now(), [prob("c", { isNew: true })]);
  out = await w.run(sw2);
  check(w.mails.length === 7 && out.pro.sent === 2 && out.free.due === 0 && out.free.alreadySent === 3, "delivery: the second sweep of the day: Pro only (2 more emails)");
  check(count(w, "s3@example.com") === 1 && count(w, "s1@example.com") === 2, "delivery: Free once a day, Pro once per sweep");
  const logged = [...w.logs, JSON.stringify(out)].join("\n");
  check(!/@|[0-9a-f]{64}|tok\d/.test(logged), "delivery: no address, id or token in the result or the log");
  check(w.logs.some((l) => l.startsWith("subscribers {")), "delivery: one `subscribers` line is logged per run");

  // 9. per-recipient email
  const m3 = w.mails.find((m) => m.to[0] === "s3@example.com");
  const rec3 = JSON.parse(w.st.m.get("radar:sub:" + subscriberId("s3@example.com")));
  check(m3.to.length === 1 && m3.text.includes(`https://site.example/api/unsubscribe?id=${rec3.id}&t=tok3`) && m3.headers["List-Unsubscribe"] === `<https://site.example/api/unsubscribe?id=${rec3.id}&t=tok3>`, "delivery: each email has one recipient and its own unsubscribe link with the right id and token");
  check(m3.text.includes("Live board: https://site.example/live/"), "delivery: the digest links to the live board");

  // 3. manual run
  w = world();
  await w.addSub(1, { plan: "pro", proSource: "owner" });
  await w.addSub(2);
  sw = await w.addSweep("1792570150123", T0, [prob("a")], true);
  out = await w.run(sw, { scheduled: false });
  check(out.pro.skipped === "manual run" && out.free.sent === 1 && count(w, "s1@example.com") === 0 && count(w, "s2@example.com") === 1, "delivery: a manual run skips Pro; Free is still sent if not yet sent today");
  out = await w.run(await w.addSweep("1792571150123", T0 + 60000, [prob("b")], true), { scheduled: false });
  check(out.free.due === 0 && w.mails.length === 1, "delivery: a second manual run sends nobody a second Free digest");

  // 4. next UTC day
  w = world({ t0: Date.UTC(2026, 9, 21, 20, 17, 0) });
  await w.addSub(1);
  await w.run(await w.addSweep("1792570150123", w.now(), [prob("a")]));
  w.setClock(Date.UTC(2026, 9, 22, 0, 17, 0));
  out = await w.run(await w.addSweep("1792570150124", w.now(), [prob("b")]));
  check(w.mails.length === 2 && out.free.sent === 1 && deliveries(w, "20261022").free.length === 1, "delivery: next UTC day, Free is sent again and recorded under the new date");

  // someone confirms at 12:00
  w = world({ t0: Date.UTC(2026, 9, 21, 0, 17, 0) });
  await w.addSub(1);
  await w.run(await w.addSweep("1792570150123", w.now(), [prob("a")]));
  await w.addSub(2, { createdAt: Date.UTC(2026, 9, 21, 12, 0, 0) });
  w.setClock(Date.UTC(2026, 9, 21, 15, 17, 0));
  out = await w.run(await w.addSweep("1792588150123", w.now(), [prob("b")]));
  check(out.free.due === 1 && out.free.sent === 1 && count(w, "s2@example.com") === 1 && count(w, "s1@example.com") === 1, "delivery: someone who confirmed at 12:00 gets that day's digest at the next saved sweep, and nobody gets two");

  // 5. deadline
  w = world();
  await w.addSub(1, { plan: "pro", proSource: "owner" });
  for (const n of [2, 3]) await w.addSub(n);
  w.setTickPerCall(10);
  sw = await w.addSweep("1792570150123", T0, [prob("a")]);
  out = await w.run(sw, { deadlineAt: T0 + 5 });
  check(out.pro.sent === 1 && out.free.sent === 0 && out.free.deferred === 2 && out.stopped === "deadline" && w.mails.length === 1, "delivery: deadline reached after the Pro chunk: Free all deferred, stopped: deadline");
  check(deliveries(w) === null, "delivery: nothing deferred is recorded as sent");
  w.setTickPerCall(0);
  w.tick(5 * HOUR);
  out = await w.run(await w.addSweep("1792588150123", w.now(), [prob("b")]));
  check(out.free.sent === 2 && count(w, "s2@example.com") === 1 && count(w, "s3@example.com") === 1, "delivery: the next sweep sends the deferred Free digests, once each");

  // 6. quota stop in the middle of the Free list
  w = world();
  for (let n = 1; n <= 150; n++) await w.addSub(n);
  w.setScript((no) => (no === 2 ? { status: 429, body: { name: "daily_quota_exceeded" } } : null));
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.free.sent === 100 && out.free.deferred === 50 && out.stopped === "quota" && deliveries(w).free.length === 100, "delivery: quota stop mid-list: the sent ones are recorded, the rest deferred");
  w.setScript(() => null);
  w.tick(5 * HOUR);
  const before6 = w.mails.length;
  out = await w.run(await w.addSweep("1792588150123", w.now(), [prob("b")]));
  check(out.free.due === 50 && out.free.sent === 50 && w.mails.length === before6 + 50 && deliveries(w).free.length === 150, "delivery: the next sweep sends only the 50 who were missed");
  w = world();
  await w.addSub(1, { plan: "pro", proSource: "owner" });
  await w.addSub(2);
  w.setScript(() => ({ status: 429, body: { name: "monthly_quota_exceeded" } }));
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.stopped === "quota" && out.pro.sent === 0 && out.free.deferred === 1 && w.mails.length === 0, "delivery: a quota stop in the Pro group stops the Free group too");

  // 7. one recipient in a failed chunk
  w = world();
  for (const n of [1, 2, 3]) await w.addSub(n);
  w.bad.add("s2@example.com");
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.free.sent === 2 && out.free.failed === 1 && out.free.deferred === 0 && deliveries(w).free.length === 2, "delivery: a rejected recipient is counted failed and left out of the deliveries file");
  w.bad.clear();
  w.tick(5 * HOUR);
  out = await w.run(await w.addSweep("1792588150123", w.now(), [prob("b")]));
  check(out.free.due === 1 && out.free.sent === 1 && count(w, "s2@example.com") === 1 && count(w, "s1@example.com") === 1, "delivery: the failed one is retried at the next sweep; the others are not resent");

  // 8. roll-up
  w = world();
  await w.addSub(1);
  await w.addSweep("1792500000001", T0 - 25 * HOUR, [prob("old", { isNew: true, severity: "High", title: "Too old" })]);
  await w.addSweep("1792510000002", T0 - 10 * HOUR, [prob("x", { isNew: true, title: "X first copy" }), prob("y", { severity: "Low" })]);
  await w.addSweep("1792520000003", T0 - 5 * HOUR, [prob("x", { isNew: false, title: "X newest copy" }), prob("z", { severity: "High" })], true);
  sw = await w.addSweep("1792530000004", T0, [prob("y", { severity: "Low" }), prob("w", { isNew: true, severity: "Low" })]);
  await w.run(sw);
  const text = w.mails[0].text;
  const titleOrder = ["Item w", "X newest copy", "Item z", "Item y"].map((s) => text.indexOf(s));
  check(!text.includes("Too old") && text.includes("Item z") && text.includes("Item w") && text.includes("Item y") && text.includes("X newest copy") && !text.includes("X first copy"), "delivery roll-up: a sweep older than 24 h is left out, overlaps are merged to the newest copy");
  check(/\[Medium\] NEW X newest copy/.test(text) && !/NEW Item z/.test(text) && /NEW Item w/.test(text), "delivery roll-up: New if any sweep said New");
  check(titleOrder.every((i) => i >= 0) && text.indexOf("Item w") < text.indexOf("Item z") && text.indexOf("X newest copy") < text.indexOf("Item z") && text.indexOf("Item z") < text.indexOf("Item y"), "delivery roll-up: New first, then severity");
  check(!/Failed this run/.test(text) && w.mails[0].subject === "Travel Problem Radar daily · 2026-10-21 · 4 problems, 2 new", "delivery roll-up: no 'Failed this run' line; the subject counts the merged list");
  // if history is unreadable the current sweep still goes out
  w = world();
  await w.addSub(1);
  w.st.m.set("radar:history", "{not json");
  out = await w.run({ id: "1792530000004", at: iso(T0), problems: [prob("q", { title: "Only current" })], perCat: {} });
  check(out.free.sent === 1 && w.mails[0].text.includes("Only current"), "delivery roll-up: an unreadable history falls back to this sweep's problems");

  // 10. expiry and pending
  w = world();
  await w.addSub(1);
  await w.addSub(2, { status: "pending", createdAt: T0 - 8 * DAY });
  await w.addSub(3, { status: "pending", createdAt: T0 - 6 * DAY });
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.expired === 1 && out.pending === 1 && !w.st.m.has("radar:sub:" + subscriberId("s2@example.com")) && w.st.m.has("radar:sub:" + subscriberId("s3@example.com")), "delivery: a pending record over 7 days is deleted and counted; a 6-day one is kept");
  check([...w.st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes("-expired-")).length === 1 && JSON.parse(w.st.m.get("radar:subscriberCount")).count === 2 && w.mails.length === 1, "delivery: one expired event; the count is active + remaining pending; pending get no digest");

  // 11. never throws
  w = world();
  await w.addSub(1);
  w.st.list = async () => { throw new Error("blob down for s1@example.com " + subscriberId("s1@example.com")); };
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(typeof out.error === "string" && !/@|[0-9a-f]{40}/.test(out.error) && w.mails.length === 0, "delivery: a failing list() gives { error } without an address or id, and does not throw");
  w = world();
  await w.addSub(1);
  w.st.set = async () => { throw new Error("write failed"); };
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.free.sent === 1 && out.countSaveFailed === true && out.deliveriesSaveFailed === true, "delivery: failed writes are flagged in the result, and the send still happened");
  w = world();
  await w.addSub(1);
  w.setScript(() => { throw new Error("socket closed"); });
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.free.failed === 1 && out.free.sent === 0 && deliveries(w) === null, "delivery: a network error counts failed and records nothing");

  // 12. Pro that has lapsed goes to the Free group
  w = world();
  await w.addSub(1, { plan: "pro", proSource: "owner", proUntil: iso(T0 - 1000) });
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.pro.due === 0 && out.free.sent === 1 && /daily digest/.test(w.mails[0].text), "delivery: a Pro whose proUntil has passed is in the Free group");

  // old delivery files
  w = world();
  await w.addSub(1);
  for (const d of ["20261010", "20261013", "20261014", "20261020"]) w.st.m.set("radar:deliveries:" + d, JSON.stringify({ free: [] }));
  await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(!w.st.m.has("radar:deliveries:20261010") && !w.st.m.has("radar:deliveries:20261013") && w.st.m.has("radar:deliveries:20261014") && w.st.m.has("radar:deliveries:20261020") && w.st.m.has("radar:deliveries:20261021"), "delivery: delivery files older than 7 days are deleted");

  // unreadable records and a record with no token
  w = world();
  await w.addSub(1);
  w.st.m.set("radar:sub:" + "d".repeat(64), "{broken");
  const noTok = await w.addSub(2);
  await putSubscriber(w.st, { ...noTok, token: "" });
  out = await w.run(await w.addSweep("1792570150123", T0, [prob("a")]));
  check(out.free.sent === 1 && out.unreadable === 2, "delivery: an unreadable record and a record with no token are skipped and counted");

  // the data endpoint does not serve the new prefixes
  const dataHandler = makeDataHandler({ storage: w.st });
  let allBlocked = true;
  for (const key of ["radar:sub:" + "a".repeat(64), "radar:event:20261021-080910123-subscribed-aabbcc", "radar:deliveries:20261021", "radar:subscriberCount"]) {
    const res = mockRes();
    await dataHandler({ method: "GET", url: "/api/data?key=" + encodeURIComponent(key) }, res);
    if (res.code !== 400) allBlocked = false;
  }
  check(allBlocked, "/api/data refuses the subscriber, event, deliveries and count keys");
}

// ---- T10: delivery wired into the sweep
{
  const { makeSweepHandler, SUBSCRIBER_DEADLINE_MS } = await import("../api/_lib/handlers.js");
  const { CATS } = await import("../api/_lib/radar.js");
  const ENV = {
    CRON_SECRET: "abc123", ANTHROPIC_API_KEY: "k", RESEND_API_KEY: "re_k", EMAIL_TO: "owner@example.com",
    EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SUBSCRIPTIONS_ENABLED: "1", SITE_URL: "https://site.example",
  };
  const PROBS = [{ title: "Problem 1", summary: "s", source: "Src", link: "https://example.com/1", region: "Global", date: "Oct 2026", severity: "High", opportunity: "o" }];
  const answer = JSON.stringify(PROBS);
  const SCHEDULED = { authorization: "Bearer abc123", "x-sweep-trigger": "scheduled" };

  // One fetch for every service the sweep talks to: Anthropic, Resend single (owner) and Resend batch (subscribers).
  const world = ({ env = {}, resend = {}, tickPerAnthropicCall = 0, byCat = null } = {}) => {
    const st = memStorage();
    const calls = []; // { kind, body }
    const logs = [];
    let clock = Date.UTC(2026, 9, 21, 8, 9, 10);
    const fetchFn = async (url, init) => {
      const h = { get: () => null };
      if (String(url).includes("anthropic")) {
        calls.push({ kind: "anthropic" });
        clock += tickPerAnthropicCall;
        const prompt = JSON.parse(init.body).messages[0].content;
        const cat = CATS.find((c) => prompt.includes(`"${c.label}"`));
        const text = byCat ? byCat(cat.key) : (cat.key === "traveler_pain" ? answer : "[]");
        return { ok: true, status: 200, headers: h, json: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 1 } } }) };
      }
      const body = JSON.parse(init.body);
      const kind = String(url).endsWith("/emails/batch") ? "batch" : "owner";
      calls.push({ kind, body });
      const forced = resend[kind];
      if (forced === "throw") throw new Error("socket hang up for sub@example.com");
      if (forced) return { ok: false, status: forced.status, headers: h, json: async () => forced.body || {} };
      return { ok: true, status: 200, headers: h, json: async () => ({ data: Array.isArray(body) ? body.map((_, i) => ({ id: "m" + i })) : { id: "o" }, id: "o" }) };
    };
    const handler = makeSweepHandler({ env: { ...ENV, ...env }, storage: st, fetchFn, now: () => clock, randomBytes: seeded(9), log: (...a) => logs.push(a.join(" ")) });
    const call = async (headers = SCHEDULED) => { const res = mockRes(); await handler({ headers }, res); return res; };
    const addSub = async (n, plan) => {
      const rec = { ...newPending(`s${n}@example.com`, { now: clock, randomBytes: seeded(100 + n) }), token: "tok" + n, status: "active", plan, proSource: plan === "pro" ? "owner" : null };
      await putSubscriber(st, rec);
      return rec;
    };
    return { st, calls, logs, call, addSub, kinds: () => calls.filter((c) => c.kind !== "anthropic").map((c) => c.kind) };
  };

  // 1. saved scheduled sweep, 1 Pro + 1 Free: the owner first, then one batch per audience
  let w = world();
  await w.addSub(1, "pro");
  await w.addSub(2, "free");
  let res = await w.call();
  let body = res.json();
  check(res.code === 200 && body.status === "saved" && body.email === "sent", "sweep: a saved scheduled sweep still answers 200 saved with the owner's email sent");
  check(w.kinds().join() === "owner,batch,batch", `sweep: Resend sees the owner's email first, then the Pro batch and the Free batch (${w.kinds().join()})`);
  const proBatch = w.calls.filter((c) => c.kind === "batch")[0].body;
  check(proBatch.length === 1 && proBatch[0].to[0] === "s1@example.com" && /Pro update/.test(proBatch[0].text), "sweep: the Pro batch has the Pro subscriber");
  check(body.subscribers && body.subscribers.pro.sent === 1 && body.subscribers.free.sent === 1 && body.subscribers.stopped === null, "sweep: the reply's subscribers field has the counts");
  check(!res.body.includes("@") && !/tok1|tok2/.test(res.body), "sweep: the reply holds no address or token");
  check(w.logs.every((l) => !/s[12]@example\.com|tok[12]/.test(l)), "sweep: the log holds no subscriber address or token");

  // 2. manual run: Free once a day, Pro only for scheduled sweeps -> pro skipped
  w = world();
  await w.addSub(1, "pro");
  res = await w.call({ authorization: "Bearer abc123" });
  check(res.code === 200 && res.json().trigger === "manual" && res.json().subscribers.pro.skipped === "manual run" && res.json().subscribers.free.sent === 0, "sweep: a manual run sends Pro nothing (scheduled only) and reports it");

  // 3. subscriptions off: not configured, the sweep is untouched
  w = world({ env: { SUBSCRIPTIONS_ENABLED: "" } });
  await w.addSub(1, "pro");
  res = await w.call();
  check(res.code === 200 && res.json().subscribers === "not configured" && w.kinds().join() === "owner", "sweep: switch off gives subscribers: \"not configured\" and sends only the owner's email");

  // 4. the owner's Resend call is out of quota: owner reply shows it, the subscriber send stops without looping
  w = world({ resend: { owner: { status: 429, body: { name: "daily_quota_exceeded" } }, batch: { status: 429, body: { name: "daily_quota_exceeded" } } } });
  await w.addSub(1, "pro");
  await w.addSub(2, "free");
  res = await w.call();
  body = res.json();
  check(res.code === 200 && body.status === "saved" && /^failed: http 429 daily_quota_exceeded/.test(body.email), "sweep: owner email over quota shows failed: http 429 and the sweep is still saved");
  check(body.subscribers.stopped === "quota" && body.subscribers.pro.sent === 0 && w.kinds().filter((k) => k === "batch").length === 1, "sweep: the subscriber send stops on quota after one request, with no loop and no Free attempt");

  // 5. the deadline: the clock is past start + 240 s before delivery -> everything deferred, sweep still 200
  w = world({ tickPerAnthropicCall: 70_000 });
  await w.addSub(1, "pro");
  await w.addSub(2, "free");
  res = await w.call();
  body = res.json();
  check(SUBSCRIBER_DEADLINE_MS === 240_000, "sweep: the subscriber deadline is 240 s");
  check(res.code === 200 && body.status === "saved" && w.kinds().filter((k) => k === "batch").length === 0, "sweep: past the deadline, no subscriber batch is sent");
  check(body.subscribers.pro.deferred === 1 && body.subscribers.pro.sent === 0 && body.subscribers.free.deferred === 1, "sweep: past the deadline, everything is reported as deferred");

  // 6. a delivery that throws never fails the sweep
  w = world();
  await w.addSub(1, "pro");
  const realList = w.st.list;
  w.st.list = async (...a) => { throw new Error("blob down for s1@example.com"); };
  res = await w.call();
  check(res.code === 200 && res.json().status === "saved" && res.json().subscribers.error && !res.body.includes("@"), "sweep: a storage failure while delivering still gives 200 saved, with an error field and no address");
  w.st.list = realList;

  // 7. a network error from Resend for subscribers
  w = world({ resend: { batch: "throw" } });
  await w.addSub(1, "pro");
  res = await w.call();
  check(res.code === 200 && res.json().subscribers.pro.sent === 0 && res.json().subscribers.pro.failed + res.json().subscribers.pro.deferred === 1 && !res.body.includes("@") && w.logs.every((l) => !l.includes("sub@example.com")), "sweep: a Resend network error for subscribers is counted, not thrown, and leaks nothing");

  // 8. skipped / empty / error replies carry no subscribers field
  w = world();
  await w.addSub(1, "pro");
  await w.call();
  const again = await w.call(); // a second scheduled call within 2 h
  check(again.code === 200 && again.json().status === "skipped" && !("subscribers" in again.json()), "sweep: a skipped reply has no subscribers field");
  const e = world({ byCat: () => "not json" });
  e.st.m.clear();
  const emptyRes = await e.call();
  check(emptyRes.code === 502 && !("subscribers" in emptyRes.json()), "sweep: an empty (502) reply has no subscribers field");
  const noKey = world({ env: { ANTHROPIC_API_KEY: "" } });
  const nk = await noKey.call();
  check(nk.code === 500 && !("subscribers" in nk.json()) && noKey.kinds().length === 0, "sweep: a missing API key gives 500 without subscribers and no Resend call");

  // 9. subscriber data is not readable through /api/data (the T09 block checks the same keys; this one uses the keys a sweep just wrote)
  w = world();
  await w.addSub(1, "free");
  await w.call();
  const dh = makeDataHandler({ storage: w.st });
  const keys = [...w.st.m.keys()].filter((k) => /^radar:(sub|deliveries|subscriberCount)/.test(k));
  let refused = 0;
  for (const k of keys) { const r = mockRes(); await dh({ method: "GET", url: "/api/data?key=" + encodeURIComponent(k), headers: {} }, r); if (r.code === 400) refused++; }
  check(keys.length >= 3 && refused === keys.length, `sweep: every subscriber key a sweep wrote is refused by /api/data (${refused}/${keys.length})`);
}

// ---- T11: owner admin script (scripts/subscribers.mjs)
{
  const admin = await import("./subscribers.mjs");
  const DAY = 24 * 3600 * 1000;
  const world = async () => {
    const st = memStorage();
    const mk = async (n, over = {}) => {
      const rec = { ...newPending(`p${n}@example.com`, { now: T0 - 5 * DAY, randomBytes: seeded(40 + n) }), token: "secret-token-" + n, status: "active", confirmedAt: iso(T0 - 4 * DAY), ...over };
      await putSubscriber(st, rec);
      return rec;
    };
    return { st, mk };
  };
  const run = async (st, argv, { now = T0 } = {}) => {
    const out = []; const err = [];
    const code = await admin.main(argv, { storage: st, now, rb: seeded(70), out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n"), all: out.concat(err).join("\n") };
  };
  const rec = async (st, n) => JSON.parse(st.m.get("radar:sub:" + subscriberId(`p${n}@example.com`)));
  const eventsOf = (st, type) => [...st.m.entries()].filter(([k]) => k.startsWith("radar:event:") && k.includes(`-${type}-`));

  // grant-pro
  let { st, mk } = await world();
  await mk(1); await mk(2, { status: "pending", confirmedAt: null }); await mk(3, { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 20 * DAY) });
  let r = await run(st, ["grant-pro", "p1@example.com"]);
  check(r.code === 1 && /add --yes/.test(r.all) && (await rec(st, 1)).plan === "free" && eventsOf(st, "progranted").length === 0, "grant-pro without --yes: says what it would change, changes nothing, exit 1");
  r = await run(st, ["grant-pro", "P1@Example.com", "--yes"]);
  let a = await rec(st, 1);
  check(r.code === 0 && a.plan === "pro" && a.proSource === "owner" && a.proUntil === null && a.status === "active", "grant-pro --yes on an active record: Pro, source owner, no end date");
  const ev = eventsOf(st, "progranted");
  check(ev.length === 1 && JSON.parse(ev[0][1]).plan === "pro" && !/@|[0-9a-f]{64}/.test(ev[0][0] + ev[0][1]), "grant-pro: a progranted event with no address or id");
  check(!r.all.includes("secret-token"), "grant-pro: never prints the token");
  r = await run(st, ["grant-pro", "p2@example.com", "--yes"]);
  check(r.code === 1 && /pending/.test(r.err) && (await rec(st, 2)).plan === "free", "grant-pro on a pending record: refused");
  r = await run(st, ["grant-pro", "nobody@example.com", "--yes"]);
  check(r.code === 1 && /not found/.test(r.err), "grant-pro on an unknown address: not found, exit 1");
  r = await run(st, ["grant-pro", "p3@example.com", "--yes"]);
  check(r.code === 1 && /Razorpay/.test(r.err) && (await rec(st, 3)).proUntil === iso(T0 + 20 * DAY), "grant-pro on a paid Razorpay Pro: refused, record unchanged");
  r = await run(st, ["grant-pro", "p1@example.com", "--until", "2027-01-31", "--yes"]);
  a = await rec(st, 1);
  check(r.code === 0 && a.proUntil === "2027-01-31T23:59:59.999Z" && effectivePlan(a, T0) === "pro" && effectivePlan(a, Date.UTC(2027, 1, 1)) === "free", "grant-pro --until: Pro through the end of that UTC day, Free after");
  const badUntil = [];
  for (const bad of ["2027-02-30", "tomorrow", "2027-1-5"]) badUntil.push((await run(st, ["grant-pro", "p1@example.com", "--until", bad, "--yes"])).code);
  check(badUntil.every((c) => c === 2) && (await rec(st, 1)).proUntil === "2027-01-31T23:59:59.999Z", `grant-pro --until with an impossible or malformed date: usage error, exit 2, record unchanged (${badUntil.join(",")})`);

  // the next scheduled sweep gives a granted address the Pro email, and a past --until makes them Free
  {
    const sent = [];
    const fetchFn = async (url, init) => { const b = JSON.parse(init.body); sent.push(...b); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: b.map(() => ({ id: "x" })) }) }; };
    const w = await world();
    await w.mk(1); await w.mk(2); await w.mk(3);
    await run(w.st, ["grant-pro", "p1@example.com", "--yes"]);
    await run(w.st, ["grant-pro", "p2@example.com", "--until", "2026-10-01", "--yes"]);
    const sweep = { id: "1792570150123", at: iso(T0), problems: [{ id: "a", cat: "traveler_pain", title: "T", summary: "", source: "S", link: "https://example.com/a", region: "EU", date: "2026-10-20", severity: "High", opportunity: "", isNew: true }], perCat: {} };
    await deliverToSubscribers({ env: { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" },
      storage: w.st, fetchFn, now: () => T0, randomBytes: seeded(3), sweep, scheduled: true, log: () => {} });
    const proMail = sent.filter((m) => /Pro update/.test(m.text)).map((m) => m.to[0]);
    const freeMail = sent.filter((m) => /daily digest/.test(m.text)).map((m) => m.to[0]).sort();
    check(proMail.join() === "p1@example.com" && freeMail.join() === "p2@example.com,p3@example.com", "grant-pro then a scheduled sweep: the granted address gets the Pro email; one with a past --until gets the Free digest");
  }

  // revoke-pro
  ({ st, mk } = await world());
  await mk(1, { plan: "pro", proSource: "owner", proUntil: iso(T0 + 9 * DAY) }); await mk(2, { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 9 * DAY) }); await mk(3);
  r = await run(st, ["revoke-pro", "p1@example.com"]);
  check(r.code === 1 && (await rec(st, 1)).plan === "pro" && eventsOf(st, "prorevoked").length === 0, "revoke-pro without --yes: changes nothing");
  r = await run(st, ["revoke-pro", "p1@example.com", "--yes"]);
  a = await rec(st, 1);
  check(r.code === 0 && a.plan === "free" && a.proUntil === null && a.proSource === null && eventsOf(st, "prorevoked").length === 1, "revoke-pro --yes: Free, no source, no end date, a prorevoked event");
  r = await run(st, ["revoke-pro", "p2@example.com", "--yes"]);
  check(r.code === 1 && /Razorpay/.test(r.err) && (await rec(st, 2)).plan === "pro", "revoke-pro on a Razorpay record: refused, record unchanged");
  r = await run(st, ["revoke-pro", "p3@example.com", "--yes"]);
  check(r.code === 1 && /already/.test(r.err), "revoke-pro on a Free record: nothing to do");
  r = await run(st, ["revoke-pro", "nobody@example.com", "--yes"]);
  check(r.code === 1 && /not found/.test(r.err), "revoke-pro on an unknown address: not found");

  // delete removes the record and nothing else
  ({ st, mk } = await world());
  await mk(1); await mk(2);
  st.m.set("radar:history", "[]"); st.m.set("radar:event:20261021-080910123-subscribed-aabbcc", "{}"); st.m.set("radar:deliveries:20261021", '{"free":[]}');
  const keysBefore = [...st.m.keys()].sort();
  r = await run(st, ["delete", "p1@example.com"]);
  check(r.code === 1 && st.m.size === keysBefore.length, "delete without --yes: nothing deleted");
  r = await run(st, ["delete", "p1@example.com", "--yes"]);
  const gone = keysBefore.filter((k) => !st.m.has(k));
  check(r.code === 0 && gone.length === 1 && gone[0] === "radar:sub:" + subscriberId("p1@example.com") && st.m.size === keysBefore.length - 1, "delete --yes: removes that record and nothing else");
  r = await run(st, ["delete", "p1@example.com", "--yes"]);
  check(r.code === 1 && /not found/.test(r.err), "delete again: not found");

  // show and list
  ({ st, mk } = await world());
  await mk(1); await mk(2, { plan: "pro", proSource: "owner", proUntil: iso(T0 + 3 * DAY) }); await mk(3, { plan: "pro", proSource: "owner", proUntil: iso(T0 - DAY) }); await mk(4, { status: "pending", confirmedAt: null });
  r = await run(st, ["show", "p2@example.com"]);
  check(r.code === 0 && r.out.includes("p2@example.com") && r.out.includes('"plan": "pro"') && !r.out.includes("token") && !r.out.includes("secret-token"), "show: the record, without the token");
  r = await run(st, ["show", "nobody@example.com"]);
  check(r.code === 1, "show an unknown address: exit 1");
  r = await run(st, ["list", "--plan", "pro"]);
  check(r.code === 0 && r.out.includes("p2@example.com") && !r.out.includes("p3@example.com") && !r.out.includes("p1@example.com") && !r.out.includes("secret-token"), "list --plan pro: only effective Pro, no token");
  r = await run(st, ["list", "--plan", "free"]);
  check(r.out.includes("p1@example.com") && r.out.includes("p3@example.com") && r.out.includes("(lapsed)") && !r.out.includes("p4@example.com"), "list --plan free: includes a lapsed Pro, marked lapsed, not pending");
  r = await run(st, ["list", "--plan", "pending"]);
  check(r.out.includes("p4@example.com") && !r.out.includes("p1@example.com"), "list --plan pending");
  r = await run(st, ["list"]);
  check(r.out.split("\n").length === 1 + 4 + 1, "list: header, all 4 records, a count");
  r = await run(st, ["list", "--plan", "gold"]);
  check(r.code === 2, "list with an unknown plan: usage error");

  // stats
  ({ st, mk } = await world());
  await mk(1); await mk(2, { plan: "pro", proSource: "owner", proUntil: iso(T0 + 3 * DAY) }); await mk(3, { plan: "pro", proSource: "owner" });
  await mk(4, { plan: "pro", proSource: "owner", proUntil: iso(T0 - DAY) }); await mk(5, { status: "pending", confirmedAt: null });
  let n = 0;
  const ev1 = (day, type, plan = null) => st.m.set(`radar:event:${day}-${String(80910000 + n).padStart(9, "0")}-${type}-${(0xaa0000 + n++).toString(16)}`, JSON.stringify({ type, at: "x", plan }));
  for (const [day, type, k, plan] of [["20261019", "subscribed", 2], ["20261019", "confirmsent", 2], ["20261019", "confirmed", 1], ["20261020", "subscribed", 1], ["20261020", "confirmsent", 1],
    ["20261020", "confirmed", 2], ["20261020", "unsubscribed", 1, "free"], ["20261021", "subscribed", 1], ["20261021", "unsubscribed", 1, "pro"], ["20261021", "expired", 1], ["20261021", "bounced", 2], ["20261020", "complained", 1],
    ["20261018", "subscribed", 5], ["20261018", "bounced", 4]]) {
    for (let i = 0; i < k; i++) ev1(day, type, plan);
  }
  st.m.set("radar:deliveries:20261020", JSON.stringify({ free: ["a", "b", "c"] }));
  const s = await admin.computeStats(st, { now: T0, days: 3 });
  check(s.now.pending === 1 && s.now.free === 2 && s.now.pro === 2 && s.now.proExpiring7d === 1, `stats: counts now (1 pending, 2 Free incl. a lapsed Pro, 2 Pro, 1 ending within 7 days) (${JSON.stringify(s.now)})`);
  const d = Object.fromEntries(s.perDay.map((x) => [x.day, x]));
  check(s.perDay.length === 3 && d["20261019"].subscribed === 2 && d["20261019"].confirmed === 1 && d["20261020"].confirmed === 2 && d["20261020"].unsubscribedFree === 1 && d["20261021"].unsubscribedPro === 1 && d["20261021"].expired === 1 && d["20261020"].freeDelivered === 3,
    "stats: per-day counts, unsubscribes split by plan, Free sends from the deliveries file");
  check(s.totals.subscribed === 4 && s.totals.confirmed === 3 && s.totals.confirmsent === 3 && s.totals.unsubscribed === 2 && s.confirmRate === 0.75, "stats: totals leave out days before the period; confirm rate is confirmed / subscribed (3/4)");
  check(d["20261021"].bounced === 2 && d["20261020"].complained === 1 && s.totals.bounced === 2 && s.totals.complained === 1,
    "stats: bounces and complaints from the Resend webhook, per day and in total (days before the period left out)");
  r = await run(st, ["stats", "--days", "3"]);
  check(r.code === 0 && r.out.includes("75.0%") && !/@/.test(r.out) && !r.out.includes("secret-token"), "stats: prints the confirm rate and no address or token");
  check(/ bounced  complained /.test(r.out) && /2 bounced, 1 complained/.test(r.out), "stats: prints the bounced and complained columns and totals");
  r = await run(st, ["stats", "--days", "0"]);
  check(r.code === 2, "stats --days 0: usage error");
  const empty = await admin.computeStats(memStorage(), { now: T0, days: 7 });
  check(empty.confirmRate === null && /n\/a/.test(admin.formatStats(empty)), "stats with no events: confirm rate n/a, no division by zero");

  // prune-events
  ({ st } = await world());
  for (const k of ["radar:event:20250101-080910123-subscribed-aaaaaa", "radar:event:20260101-080910123-confirmed-bbbbbb", "radar:event:20261020-080910123-confirmed-cccccc"]) st.m.set(k, "{}");
  st.m.set("radar:history", "[]");
  r = await run(st, ["prune-events", "--older-than", "400"]);
  check(r.code === 1 && st.m.size === 4 && /would delete 1 /.test(r.err), "prune-events without --yes: reports the count, deletes nothing");
  r = await run(st, ["prune-events", "--older-than", "400", "--yes"]);
  check(r.code === 0 && st.m.size === 3 && !st.m.has("radar:event:20250101-080910123-subscribed-aaaaaa") && st.m.has("radar:history"), "prune-events --older-than 400 --yes: deletes only events older than that");
  r = await run(st, ["prune-events", "--yes"]);
  check(r.code === 2, "prune-events without --older-than: usage error");

  // usage and failures
  const bads = [[], ["nope"], ["show"], ["show", "a@b.com", "extra"], ["show", "not an email"], ["stats", "--wat"], ["stats", "--yes"], ["grant-pro", "a@b.com", "--until"], ["list", "--plan"]];
  const codes = [];
  for (const argv of bads) codes.push((await run(memStorage(), argv)).code);
  check(codes.every((c) => c === 2), `bad usage exits 2 (${codes.join(",")})`);
  const broken = memStorage();
  broken.list = async () => { throw new Error("blob down"); };
  r = await run(broken, ["stats"]);
  check(r.code === 1 && /blob down/.test(r.err), "a storage failure is reported with exit 1, not a stack trace");

  // the script is kept out of the deployment
  check(readFileSync(new URL("../.vercelignore", import.meta.url), "utf8").split(/\r?\n/).includes("scripts"), ".vercelignore keeps scripts/ (and so this tool) out of the deployment");
}

// ---- Pro requests: the sign-up box, the confirm step, /api/account (the manage page) and the admin script
{
  const { makeAccountHandler, managePath } = await import("../api/_lib/subscription-handlers.js");
  const { buildProRequestEmail } = await import("../api/_lib/email.js");
  const admin = await import("./subscribers.mjs");
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", EMAIL_TO: "owner@example.com", SITE_URL: "https://site.example", MAX_SUBSCRIBERS: "5000" };
  const world = (envOver = {}, { resendStatus = 200 } = {}) => {
    const st = memStorage();
    const mails = []; // every Resend call: { url, body }
    const logs = [];
    const fetchFn = async (url, init) => {
      mails.push({ url: String(url), body: JSON.parse(init.body) });
      const ok = resendStatus === 200;
      return { ok, status: resendStatus, headers: { get: () => null }, json: async () => (ok ? { data: [{ id: "m" }], id: "m" } : { name: "internal_server_error" }) };
    };
    const deps = { env: { ...ENV, ...envOver }, storage: st, fetchFn, now: () => T0, randomBytes: seeded(5), log: (...a) => logs.push(a.join(" ")) };
    const sub = makeSubscribeHandler(deps), conf = makeConfirmHandler(deps), acct = makeAccountHandler(deps);
    const call = async (h, req) => { const res = mockRes(); await h({ headers: { "content-type": "application/json" }, ...req }, res); return res; };
    return {
      st, mails, logs,
      owner: () => mails.filter((m) => m.url === "https://api.resend.com/emails" && m.body.subject === "Travel Problem Radar: Pro request"),
      subscribe: (fields) => call(sub, { method: "POST", body: fields }),
      confirm: (rec) => call(conf, { method: "POST", body: { id: rec.id, t: rec.token } }),
      get: (id, t) => call(acct, { method: "GET", query: { id, t } }),
      post: (body) => call(acct, { method: "POST", body }),
    };
  };
  const recOf = (w, email) => getSubscriber(w.st, subscriberId(email));
  const evCount = (w, type) => [...w.st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`)).length;
  const active = async (w, email, over = {}) => {
    const r = { ...newPending(email, { now: T0 - 3600_000, randomBytes: seeded(90) }), status: "active", confirmedAt: iso(T0 - 1800_000), ...over };
    await putSubscriber(w.st, r);
    return r;
  };

  // the sign-up box: stored on the pending record, counted only at confirm
  let w = world();
  const withBox = await w.subscribe({ email: "keen@example.com", wantsPro: "1" });
  const without = await w.subscribe({ email: "plain@example.com" });
  check(withBox.code === 200 && withBox.body === without.body, "pro request: the sign-up reply is byte-identical with or without the Pro box");
  let keen = await recOf(w, "keen@example.com");
  const plain = await recOf(w, "plain@example.com");
  check(keen.status === "pending" && keen.proRequestedAt === iso(T0) && plain.proRequestedAt === null, "pro request: the box sets proRequestedAt on the pending record; no box leaves it null");
  check(evCount(w, "prorequested") === 0 && w.owner().length === 0, "pro request: nothing is counted and the owner isn't told until the address is confirmed");
  const ticked = await world().subscribe({ email: "x@example.com", wantsPro: "on" });
  check(ticked.code === 200, "pro request: a no-JavaScript form's \"on\" is accepted too");

  let r = await w.confirm(keen);
  keen = await recOf(w, "keen@example.com");
  check(r.code === 200 && keen.status === "active" && /You asked for Pro/.test(r.body) && evCount(w, "prorequested") === 1, "pro request: confirming a ticked sign-up activates it, records one prorequested event and says so on the page");
  const om = w.owner();
  check(om.length === 1 && JSON.stringify(om[0].body.to) === '["owner@example.com"]' && /ticked/.test(om[0].body.text), "pro request: the owner gets one email at EMAIL_TO saying it came from the sign-up box");
  check(!JSON.stringify(om[0].body).includes("keen@example.com") && !JSON.stringify(om[0].body).includes(keen.token), "pro request: the owner email names nobody and holds no token");
  r = await w.confirm(plain);
  check(r.code === 200 && r.body.includes(`href="${esc(managePath(plain.id, plain.token))}"`) && w.owner().length === 1, "pro request: confirming without the box links to the manage page and tells the owner nothing");

  // GET /api/account
  r = await w.get(plain.id, plain.token);
  let a = r.json();
  check(r.code === 200 && a.status === "active" && a.effectivePlan === "free" && a.proRequestedAt === null && r.headers["cache-control"] === "no-store", "account GET: the plan, not cached");
  check(!r.body.includes("@") && !r.body.includes(plain.token) && !("email" in a), "account GET: no address and no token in the reply");
  const bad = await w.get(plain.id, "wrong-token");
  const unknown = await w.get("f".repeat(64), plain.token);
  check(bad.code === 404 && unknown.code === 404 && bad.body === unknown.body, "account GET: a wrong token and an unknown id get the same 404");
  check((await world({ SUBSCRIPTIONS_ENABLED: "" }).get(plain.id, plain.token)).code === 503, "account: switch off gives 503");
  const put = await world().post({ id: plain.id, t: plain.token, action: "request-pro" });
  check(put.code === 404, "account POST: a record that isn't there gets 404");

  // POST request-pro
  r = await w.post({ id: plain.id, t: plain.token, action: "request-pro" });
  a = r.json();
  check(r.code === 200 && a.ok === true && a.proRequestedAt === iso(T0) && (await recOf(w, "plain@example.com")).proRequestedAt === iso(T0), "request-pro: 200, and proRequestedAt is stored");
  check(evCount(w, "prorequested") === 2 && w.owner().length === 2 && /manage page/.test(w.owner()[1].body.text), "request-pro: one more prorequested event and one owner email saying it came from the manage page");
  r = await w.post({ id: plain.id, t: plain.token, action: "request-pro" });
  check(r.code === 200 && evCount(w, "prorequested") === 2 && w.owner().length === 2, "request-pro: a repeat click is 200 and sends nothing more");
  check((await w.post({ id: plain.id, t: plain.token, action: "nope" })).code === 400, "account POST: an unknown action is 400");
  check((await w.post({ id: plain.id, t: "wrong", action: "request-pro" })).code === 404, "account POST: a wrong token is 404");
  const pend = { ...newPending("wait@example.com", { now: T0, randomBytes: seeded(91) }) };
  await putSubscriber(w.st, pend);
  r = await w.post({ id: pend.id, t: pend.token, action: "request-pro" });
  check(r.code === 409 && r.json().error === "not_confirmed" && (await recOf(w, "wait@example.com")).proRequestedAt === null, "request-pro: a pending address gets 409 not_confirmed and nothing is stored");
  const pro = await active(w, "pro@example.com", { plan: "pro", proSource: "owner" });
  r = await w.post({ id: pro.id, t: pro.token, action: "request-pro" });
  check(r.code === 409 && r.json().error === "already_pro", "request-pro: a Pro subscriber gets 409 already_pro");
  const lapsed = await active(w, "lapsed@example.com", { plan: "pro", proSource: "owner", proUntil: iso(T0 - 1000) });
  r = await w.post({ id: lapsed.id, t: lapsed.token, action: "request-pro" });
  check(r.code === 200 && r.json().effectivePlan === "free", "request-pro: a lapsed Pro (end date passed) can ask again");

  // a failed owner email never fails the request
  const wf = world({}, { resendStatus: 500 });
  const f1 = await active(wf, "f1@example.com");
  r = await wf.post({ id: f1.id, t: f1.token, action: "request-pro" });
  check(r.code === 200 && (await recOf(wf, "f1@example.com")).proRequestedAt === iso(T0) && wf.logs.some((l) => /^pro-request owner-email failed: http 500/.test(l)), "request-pro: an owner email that fails still gives 200, and the log says why");
  check(wf.logs.every((l) => !l.includes("f1@example.com") && !l.includes(f1.token)), "request-pro: the log holds no address or token");
  const wn = world({ EMAIL_TO: "" });
  const n1 = await active(wn, "n1@example.com");
  check((await wn.post({ id: n1.id, t: n1.token, action: "request-pro" })).code === 200 && wn.mails.length === 0, "request-pro: with no EMAIL_TO the request is still stored, and nothing is sent");

  // the email builder and the digest footer
  const pm = buildProRequestEmail({ at: iso(T0), source: "manage" });
  check(pm.subject === "Travel Problem Radar: Pro request" && /list --plan requested/.test(pm.text) && /grant-pro <email> --yes/.test(pm.text) && /grant-pro &lt;email&gt; --yes/.test(pm.html), "owner email: names the two admin commands, escaped in the HTML");
  const wd = world();
  const d1 = await active(wd, "d1@example.com");
  const batches = [];
  await deliverToSubscribers({
    env: ENV, storage: wd.st, now: () => T0, randomBytes: seeded(3), scheduled: true, log: () => {},
    fetchFn: async (url, init) => { batches.push(JSON.parse(init.body)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ id: "m" }] }) }; },
    sweep: { id: "s1", at: iso(T0), perCat: {}, problems: [{ id: "p1", title: "Problem 1", summary: "s", source: "Src", link: "https://example.com/1", region: "Global", date: "Oct 2026", severity: "High", opportunity: "o" }] },
  });
  const mlink = `https://site.example/manage/?id=${d1.id}&t=${encodeURIComponent(d1.token)}`;
  check(batches.length === 1 && batches[0][0].text.includes("Manage subscription: " + mlink) && batches[0][0].html.includes(esc(mlink)), "digest footer: every subscriber email links to their manage page");

  // the admin script: the waiting list, the stats line, and grant-pro clearing the request
  const run = async (argv) => { const out = []; const code = await admin.main(argv, { storage: w.st, now: T0, rb: seeded(70), out: (s) => out.push(s), err: (s) => out.push(s) }); return { code, out: out.join("\n") }; };
  r = await run(["list", "--plan", "requested"]);
  check(r.code === 0 && r.out.includes("keen@example.com") && r.out.includes("plain@example.com") && r.out.includes("lapsed@example.com") && !r.out.includes("wait@example.com") && !r.out.includes("pro@example.com\t") && /3 shown/.test(r.out), "admin list --plan requested: the active Free subscribers who asked, and nobody else");
  check(/proRequestedAt/.test((await run(["list"])).out), "admin list: has a proRequestedAt column");
  r = await run(["stats", "--days", "1"]);
  check(r.code === 0 && /3 waiting for Pro/.test(r.out) && /pro asked/.test(r.out) && /3 Pro requests/.test(r.out), "admin stats: how many are waiting, and the day's Pro requests");
  r = await run(["grant-pro", "keen@example.com", "--yes"]);
  keen = await recOf(w, "keen@example.com");
  check(r.code === 0 && keen.plan === "pro" && keen.proRequestedAt === null && !(await run(["list", "--plan", "requested"])).out.includes("keen@example.com"), "admin grant-pro: Pro on, and the request leaves the waiting list");
  check((await w.get(keen.id, keen.token)).json().effectivePlan === "pro", "account GET: shows Pro once the owner grants it");
}

// ---- T13 part A: POST /api/resend-webhook (bounces and complaints)
{
  const KEY = Buffer.from("test-webhook-key-0123456789abcdef");
  const SECRET = "whsec_" + KEY.toString("base64");
  const NOW = T0;
  const TS = String(Math.floor(NOW / 1000));
  const sign = (id, ts, raw, key = KEY) => "v1," + createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");

  // verifySvix on its own
  const raw0 = '{"type":"email.complained"}';
  const good = { secret: SECRET, id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, raw0), raw: raw0, now: NOW };
  check(verifySvix(good), "verifySvix: a valid v1 signature is accepted");
  check(verifySvix({ ...good, signature: "v1,AAAA " + good.signature }), "verifySvix: a match anywhere in a space-separated list is accepted");
  check(!verifySvix({ ...good, raw: raw0.replace("complained", "bounced") }), "verifySvix: a changed body is refused");
  check(!verifySvix({ ...good, signature: sign("msg_1", TS, raw0, Buffer.from("another-key")) }), "verifySvix: a signature made with another secret is refused");
  check(!verifySvix({ ...good, id: "msg_2" }), "verifySvix: a changed svix-id is refused");
  const old = String(Number(TS) - WEBHOOK_TOLERANCE_S - 1);
  const ahead = String(Number(TS) + WEBHOOK_TOLERANCE_S + 1);
  check(!verifySvix({ ...good, timestamp: old, signature: sign("msg_1", old, raw0) }) && !verifySvix({ ...good, timestamp: ahead, signature: sign("msg_1", ahead, raw0) }),
    "verifySvix: a correctly signed message more than 5 minutes old or ahead is refused (replay)");
  const edge = String(Number(TS) - WEBHOOK_TOLERANCE_S);
  check(verifySvix({ ...good, timestamp: edge, signature: sign("msg_1", edge, raw0) }), "verifySvix: exactly 5 minutes old is still accepted");
  check(!verifySvix({ ...good, signature: good.signature.replace("v1,", "v2,") }) && !verifySvix({ ...good, timestamp: "12.5" }) && !verifySvix({ ...good, secret: "" }) &&
    !verifySvix({ ...good, id: null }) && !verifySvix({ ...good, signature: null }) && !verifySvix({ ...good, signature: "v1," }),
    "verifySvix: other versions, a non-integer timestamp, and missing parts are refused");

  // the handler
  const world = (envOver = {}) => {
    const st = memStorage();
    const logs = [];
    const handler = makeResendWebhookHandler({ env: { RESEND_WEBHOOK_SECRET: SECRET, ...envOver }, storage: st, now: () => NOW, randomBytes: seeded(40), log: (...a) => logs.push(a.join(" ")) });
    let n = 0;
    const send = async (event, { id = "msg_" + ++n, ts = TS, sig, method = "POST", raw, headers = {} } = {}) => {
      const body = raw ?? JSON.stringify(event);
      const h = { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": sig ?? sign(id, ts, body), ...headers };
      const res = await handler(new Request("https://site.example/api/resend-webhook", method === "GET" ? { method, headers: h } : { method, headers: h, body }));
      const text = await res.text();
      return { code: res.status, text, json: () => JSON.parse(text), headers: res.headers };
    };
    const add = async (email, over = {}) => { const r = { ...newPending(email, { now: NOW, randomBytes: seeded(email.length) }), status: "active", ...over }; await putSubscriber(st, r); return r; };
    const evs = (type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    return { st, logs, send, add, evs };
  };
  const bounce = (to, type = "Permanent") => ({ type: "email.bounced", created_at: iso(NOW), data: { email_id: "e1", from: "Radar <hello@pehchanthetraveller.com>", to: [to], subject: "x", bounce: { message: "m", subType: "General", type } } });
  const complaint = (to) => ({ type: "email.complained", created_at: iso(NOW), data: { email_id: "e2", to: [to], subject: "x" } });
  const replies = [];
  const allLogs = [];
  const keep = (r) => { replies.push(r.text); return r; };

  let w = world();
  const hard = await w.add("hard@example.com", { plan: "pro", proSource: "owner" });
  let r = keep(await w.send(bounce("Hard@Example.com")));
  check(r.code === 200 && r.json().ok === true && !(await getSubscriber(w.st, hard.id)), "webhook: a Permanent bounce deletes the record (address matched case-insensitively)");
  const bouncedEv = w.evs("bounced");
  check(bouncedEv.length === 1 && JSON.parse(w.st.m.get(bouncedEv[0])).plan === "pro" && !w.st.m.get(bouncedEv[0]).includes("@"), "webhook: one 'bounced' event, with the plan and no address");
  allLogs.push(...w.logs);

  w = world();
  const spam = await w.add("spam@example.com");
  r = keep(await w.send(complaint("spam@example.com")));
  check(r.code === 200 && !(await getSubscriber(w.st, spam.id)) && w.evs("complained").length === 1, "webhook: a complaint deletes the record and records one 'complained' event");
  allLogs.push(...w.logs);

  w = world();
  const pend = await w.add("pending@example.com", { status: "pending" });
  r = keep(await w.send(bounce("pending@example.com")));
  check(r.code === 200 && !(await getSubscriber(w.st, pend.id)), "webhook: a hard bounce on a pending (unconfirmed) record deletes it too");

  w = world();
  const soft = await w.add("soft@example.com");
  for (const type of ["Transient", "Undetermined", null]) {
    r = keep(await w.send(bounce("soft@example.com", type)));
    check(r.code === 200 && r.json().ignored === true && Boolean(await getSubscriber(w.st, soft.id)) && w.evs("bounced").length === 0, `webhook: a ${type || "typeless"} bounce is ignored and the record kept`);
  }
  r = keep(await w.send({ type: "email.delivered", data: { to: ["soft@example.com"] } }));
  check(r.code === 200 && r.json().ignored === true && Boolean(await getSubscriber(w.st, soft.id)), "webhook: other event types are ignored");

  w = world();
  r = keep(await w.send(bounce("stranger@example.com")));
  check(r.code === 200 && r.json().ok === true && w.evs("bounced").length === 0, "webhook: an unknown address (e.g. the owner's EMAIL_TO) gets 200 and records nothing");
  r = keep(await w.send({ type: "email.bounced", data: { to: "not-a-list", bounce: { type: "Permanent" } } }));
  const r2 = keep(await w.send({ type: "email.complained", data: { to: ["not an address", 42, null] } }));
  check(r.code === 200 && r2.code === 200, "webhook: a missing or malformed recipient list gets 200 and does nothing");
  allLogs.push(...w.logs);

  w = world();
  const two = [await w.add("one@example.com"), await w.add("two@example.com")];
  r = keep(await w.send({ ...complaint("one@example.com"), data: { to: ["one@example.com", "two@example.com"] } }));
  check(r.code === 200 && !(await getSubscriber(w.st, two[0].id)) && !(await getSubscriber(w.st, two[1].id)) && w.evs("complained").length === 2, "webhook: every recipient in data.to is handled");

  // Replay inside the window: the same signed message again changes nothing more.
  w = world();
  await w.add("again@example.com");
  const rawEv = JSON.stringify(complaint("again@example.com"));
  r = keep(await w.send(null, { id: "msg_same", raw: rawEv }));
  const again = keep(await w.send(null, { id: "msg_same", raw: rawEv }));
  check(r.code === 200 && again.code === 200 && w.evs("complained").length === 1, "webhook: a replay inside 5 minutes is harmless (record already gone, no second event)");

  // Refusals: nothing is read or written for an unsigned or badly signed request.
  w = world();
  const victim = await w.add("victim@example.com");
  let reads = 0;
  const get0 = w.st.get;
  w.st.get = async (k) => { reads++; return get0(k); };
  const forged = JSON.stringify(complaint("victim@example.com"));
  const results = [
    ["no signature headers", await w.send(null, { raw: forged, headers: { "svix-id": "", "svix-timestamp": "", "svix-signature": "" } })],
    ["a changed body", await w.send(null, { raw: forged, sig: sign("m", TS, forged.replace("victim", "victin")), id: "m" })],
    ["a wrong secret", await w.send(null, { raw: forged, sig: sign("m", TS, forged, Buffer.from("guess")), id: "m" })],
    ["an old timestamp", await w.send(null, { raw: forged, ts: old, id: "m", sig: sign("m", old, forged) })],
  ];
  for (const [label, res] of results) { keep(res); check(res.code === 401 && res.json().error === "invalid signature", `webhook: ${label} gets 401`); }
  w.st.get = get0;
  check(reads === 0 && Boolean(await getSubscriber(w.st, victim.id)), "webhook: refused requests read nothing and the record stays");

  w = world({ RESEND_WEBHOOK_SECRET: "" });
  r = keep(await w.send(complaint("x@example.com")));
  check(r.code === 503 && w.logs.includes("resend-webhook not configured"), "webhook: no RESEND_WEBHOOK_SECRET gives 503 and logs 'not configured'");
  w = world({ SUBSCRIPTIONS_ENABLED: "" });
  const off = await w.add("off@example.com");
  r = keep(await w.send(complaint("off@example.com")));
  check(r.code === 200 && !(await getSubscriber(w.st, off.id)), "webhook: works while subscriptions are switched off (removal is always allowed)");
  w = world();
  r = keep(await w.send(null, { method: "GET", raw: "" }));
  check(r.code === 405 && r.headers.get("allow") === "POST", "webhook: GET gets 405 with Allow: POST");
  const big = JSON.stringify({ type: "email.complained", data: { to: [], pad: "x".repeat(70 * 1024) } });
  r = keep(await w.send(null, { raw: big }));
  check(r.code === 413, "webhook: a body over 64 KB gets 413");
  r = keep(await w.send(null, { raw: "{not json" }));
  check(r.code === 400, "webhook: a correctly signed but malformed body gets 400");

  w = world();
  await w.add("fail@example.com");
  w.st.del = async () => { throw new Error("blob down"); };
  r = keep(await w.send(complaint("fail@example.com")));
  check(r.code === 500 && !r.text.includes("blob down") && w.logs.some((l) => l === "resend-webhook error: Error"), "webhook: a storage failure gives 500 (so Resend retries) with a generic message");
  allLogs.push(...w.logs);

  check(replies.length > 15 && replies.every((t) => !t.includes("@")), `webhook: no reply contains an address (${replies.length} replies checked)`);
  check(allLogs.length > 0 && allLogs.every((l) => !l.includes("@")), "webhook: no log line contains an address");
}

// ---- T13 part B: per-IP sign-up limit (Blob counters; the firewall rule is configuration)
{
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example", MAX_SUBSCRIBERS: "5000", MAX_CONFIRMS_PER_DAY: "1000" };
  const HOUR = 3600 * 1000;
  const OK = '{"ok":true,"message":"If that address can be subscribed, a confirmation link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder."}';
  const world = (envOver = {}) => {
    const st = memStorage();
    st.m.set("radar:subscriberCount", "0");
    const sent = [];
    let clock = T0;
    const fetchFn = async (url, init) => { const body = JSON.parse(init.body); sent.push(...body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) }; };
    const handler = makeSubscribeHandler({ env: { ...ENV, ...envOver }, storage: st, fetchFn, now: () => clock, randomBytes: seeded(9), log: () => {} });
    const post = async (email, headers = {}) => {
      const res = mockRes();
      await handler({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: { email } }, res);
      return res;
    };
    const subs = () => [...st.m.keys()].filter((k) => k.startsWith("radar:sub:")).length;
    const hits = () => [...st.m.keys()].filter((k) => k.startsWith(KEY_IPHIT_PREFIX));
    return { st, sent, post, subs, hits, tick: (ms) => { clock += ms; }, now: () => clock };
  };
  const IP = { "x-forwarded-for": "203.0.113.7" };

  check(clientIp({ "x-vercel-forwarded-for": "198.51.100.1", "x-forwarded-for": "203.0.113.7" }) === "198.51.100.1", "clientIp: prefers x-vercel-forwarded-for");
  check(clientIp({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) === "203.0.113.7" && clientIp({ "x-real-ip": "2001:db8::1" }) === "2001:db8::1", "clientIp: the first x-forwarded-for value, else x-real-ip (IPv6 too)");
  check(clientIp({}) === null && clientIp({ "x-forwarded-for": "<script>" }) === null, "clientIp: none, or not an IP, gives null");
  check(utcHour(T0) === "2026102108", "utcHour: YYYYMMDDHH in UTC");

  let w = world();
  const codes = [];
  for (let i = 1; i <= 5; i++) codes.push((await w.post(`p${i}@example.com`, IP)).body);
  check(codes.every((b) => b === OK) && w.subs() === 5 && w.sent.length === 5 && w.hits().length === 5, "per-IP: 5 sign-ups from one IP in an hour are processed (5 records, 5 confirmation emails)");
  const storedBefore = w.st.m.size;
  let r = await w.post("p6@example.com", IP);
  check(r.code === 200 && r.body === OK, "per-IP: the 6th attempt gets the identical OK reply");
  check(w.subs() === 5 && w.sent.length === 5 && w.st.m.size === storedBefore, "per-IP: the 6th attempt stores nothing (no record, no event, no hit) and sends nothing");
  r = await w.post("other@example.com", { "x-forwarded-for": "198.51.100.9" });
  check(r.body === OK && w.subs() === 6, "per-IP: another IP is still allowed");
  w.tick(HOUR);
  r = await w.post("p7@example.com", IP);
  check(r.body === OK && w.subs() === 7, "per-IP: the same IP is allowed again in the next UTC hour");
  check(w.hits().every((k) => !k.includes("203.0.113.7") && !k.includes("198.51.100.9") && /^radar:iphit:\d{10}-[0-9a-f]{16}-[0-9a-f]{6}$/.test(k)) &&
    [...w.st.m.values()].every((v) => !String(v).includes("203.0.113")), "per-IP: no raw IP in any stored key or value; keys are radar:iphit:<hour>-<hash16>-<hex6>");

  w = world();
  for (let i = 1; i <= 8; i++) await w.post(`n${i}@example.com`);
  check(w.subs() === 8 && w.hits().length === 0, "per-IP: no IP header (local runs) means no limit and no hit files");

  w = world({ MAX_SIGNUPS_PER_IP_HOUR: "2" });
  for (let i = 1; i <= 3; i++) await w.post(`m${i}@example.com`, IP);
  check(w.subs() === 2, "per-IP: MAX_SIGNUPS_PER_IP_HOUR sets the limit");
  w = world({ MAX_SIGNUPS_PER_IP_HOUR: "lots" });
  for (let i = 1; i <= 6; i++) await w.post(`q${i}@example.com`, IP);
  check(w.subs() === 5, "per-IP: an unreadable MAX_SIGNUPS_PER_IP_HOUR falls back to 5");

  w = world();
  const list0 = w.st.list;
  w.st.list = async (p) => { if (p.startsWith(KEY_IPHIT_PREFIX)) throw new Error("blob down"); return list0(p); };
  r = await w.post("fail@example.com", IP);
  check(r.body === OK && w.subs() === 0 && w.sent.length === 0, "per-IP: a count that can't be read counts as reached (OK reply, nothing stored or sent)");

  // The sweep deletes counters older than 2 hours and keeps the rest.
  w = world();
  const hours = [0, 1, 2, 3, 26].map((h) => utcHour(T0 - h * HOUR));
  for (const h of hours) w.st.m.set(`${KEY_IPHIT_PREFIX}${h}-${"a".repeat(16)}-abcdef`, "{}");
  w.st.m.set(KEY_IPHIT_PREFIX + "junk", "{}");
  await deliverToSubscribers({ env: ENV, storage: w.st, fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [] }) }), now: () => T0, randomBytes: seeded(5), scheduled: true, log: () => {}, sweep: { id: "s1", at: iso(T0), perCat: {}, problems: [] } });
  const left = w.hits().map((k) => k.slice(KEY_IPHIT_PREFIX.length, KEY_IPHIT_PREFIX.length + 10));
  check(left.includes(hours[0]) && left.includes(hours[1]) && left.includes(hours[2]) && !left.includes(hours[3]) && !left.includes(hours[4]) && w.st.m.has(KEY_IPHIT_PREFIX + "junk"),
    `sweep: deletes per-IP counters older than 2 hours, keeps newer ones and anything it doesn't recognise (${left.length} left)`);

  // /api/data never serves them.
  const dh = makeDataHandler({ storage: w.st });
  const res = mockRes();
  await dh({ method: "GET", url: "/api/data?key=" + encodeURIComponent(w.hits()[0]), headers: {} }, res);
  check(res.code === 400, "per-IP: /api/data refuses radar:iphit: keys");
}

// ---- T14: Pro subscribers choose categories
{
  const { makeAccountHandler } = await import("../api/_lib/subscription-handlers.js");
  const ALL = ["traveler_pain", "gov_policy", "web_app", "industry"];

  // normaliseCats
  const n = normaliseCats(["web_app", "gov_policy", "gov_policy"]);
  check(n.ok && JSON.stringify(n.cats) === '["gov_policy","web_app"]', "normaliseCats: keeps CATS order and drops repeats");
  check(normaliseCats([...ALL].reverse()).ok && normaliseCats([...ALL].reverse()).cats === null, "normaliseCats: all four is stored as null");
  check([[], "gov_policy", null, undefined, ["nope"], ["gov_policy", 3], [...ALL, "gov_policy"], { 0: "gov_policy" }].every((x) => normaliseCats(x).ok === false),
    "normaliseCats: refuses an empty list, a non-list, an unknown key, a non-string and more than four");
  check(proCatsKey(null) === "all" && proCatsKey(["web_app", "gov_policy"]) === "gov_policy+web_app" && proCatsKey(["bogus"]) === "all" && proCatsKey(ALL) === "all",
    "proCatsKey: \"all\", or the chosen keys joined with +; a stored value that isn't valid counts as all");

  // POST /api/account action set-cats
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", EMAIL_TO: "owner@example.com", SITE_URL: "https://site.example" };
  const st = memStorage();
  const sent = [];
  const acct = makeAccountHandler({ env: ENV, storage: st, fetchFn: async (u, i) => { sent.push(i); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m" }) }; }, now: () => T0, randomBytes: seeded(4), log: () => {} });
  const call = async (req) => { const res = mockRes(); await acct({ headers: { "content-type": "application/json" }, ...req }, res); return res; };
  const post = (rec, cats, t = rec.token) => call({ method: "POST", body: { id: rec.id, t, action: "set-cats", cats } });
  const add = async (email, over = {}) => {
    const r = { ...newPending(email, { now: T0 - 3600_000, randomBytes: seeded(200 + email.length) }), status: "active", confirmedAt: iso(T0 - 1800_000), ...over };
    await putSubscriber(st, r);
    return r;
  };
  const stored = async (rec) => (await getSubscriber(st, rec.id)).cats;
  const pro = await add("pro@example.com", { plan: "pro", proSource: "owner" });
  const free = await add("free@example.com");
  const lapsed = await add("lapsed@example.com", { plan: "pro", proSource: "owner", proUntil: iso(T0 - 1000), cats: ["industry"] });
  const pend = { ...newPending("pend@example.com", { now: T0, randomBytes: seeded(250) }) };
  await putSubscriber(st, pend);
  const replies = [];

  let r = await post(pro, ["gov_policy"]);
  replies.push(r.body);
  check(r.code === 200 && r.json().ok === true && JSON.stringify(r.json().cats) === '["gov_policy"]' && JSON.stringify(await stored(pro)) === '["gov_policy"]', "set-cats: a Pro subscriber saves [gov_policy] and it is stored");
  r = await call({ method: "GET", query: { id: pro.id, t: pro.token } });
  replies.push(r.body);
  check(r.code === 200 && JSON.stringify(r.json().cats) === '["gov_policy"]', "account GET: returns the chosen categories");
  r = await post(pro, ALL);
  check(r.code === 200 && r.json().cats === null && (await stored(pro)) === null, "set-cats: choosing all four stores null");
  r = await call({ method: "GET", query: { id: free.id, t: free.token } });
  check(r.json().cats === null, "account GET: cats is null for someone who never chose");
  r = await post(free, ["gov_policy"]);
  replies.push(r.body);
  check(r.code === 403 && r.json().error === "pro_only" && (await stored(free)) === null, "set-cats: Free gets 403 pro_only and nothing is stored");
  r = await post(lapsed, ["gov_policy"]);
  check(r.code === 403 && r.json().error === "pro_only" && JSON.stringify(await stored(lapsed)) === '["industry"]', "set-cats: a lapsed Pro gets 403 and keeps what they chose before");
  r = await post(pend, ["gov_policy"]);
  check(r.code === 409 && r.json().error === "not_confirmed", "set-cats: a pending address gets 409 not_confirmed");
  for (const bad of [["nope"], [], "gov_policy", undefined]) {
    r = await post(pro, bad);
    replies.push(r.body);
    check(r.code === 400 && r.json().error === "unknown category" && (await stored(pro)) === null, `set-cats: ${JSON.stringify(bad) || "no list"} is refused with 400 and nothing changes`);
  }
  r = await post(pro, ["gov_policy"], "wrong-token");
  check(r.code === 404, "set-cats: a wrong token is 404");
  check(replies.every((b) => !b.includes("@") && !b.includes(pro.token)), "set-cats: no address or token in any reply");
  check(sent.length === 0, "set-cats: sends no email");
  r = await call({ method: "POST", body: { id: free.id, t: free.token, action: "request-pro" } });
  check(r.code === 200 && r.json().proRequestedAt === iso(T0), "account: request-pro still works next to set-cats");

  // delivery: one body per distinct set of categories
  const DENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" };
  const prob = (id, cat, over = {}) => ({ id, cat, title: "Item " + id, summary: "", source: "S", link: "https://example.com/" + id, region: "EU", date: "2026-10-20", severity: "Medium", opportunity: "", isNew: false, ...over });
  const problems = [prob("t1", "traveler_pain", { isNew: true }), prob("t2", "traveler_pain"), prob("g1", "gov_policy", { severity: "High", isNew: true }), prob("w1", "web_app")];
  const sweep = { id: "1792570150123", at: iso(T0), problems, perCat: { traveler_pain: "2 items", gov_policy: "1 item", web_app: "1 item", industry: "failed: timeout" }, newCount: 2 };
  const dw = async (subs) => {
    const ds = memStorage();
    for (const [i, s] of subs.entries()) {
      await putSubscriber(ds, {
        ...newPending(s.email, { now: T0 - 3600_000, randomBytes: seeded(300 + i) }), token: "tok" + i, status: "active",
        plan: s.plan || "pro", proSource: s.plan === "free" ? null : "owner", proUntil: s.proUntil || null, cats: s.cats || null,
      });
    }
    const calls = [];
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ key: init.headers["idempotency-key"], body });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) };
    };
    const out = await deliverToSubscribers({ env: DENV, storage: ds, fetchFn, now: () => T0, randomBytes: seeded(9), sweep, scheduled: true, log: () => {} });
    const mails = calls.flatMap((c) => c.body);
    return { out, calls, mails, to: (e) => mails.filter((m) => m.to[0] === e) };
  };

  const d = await dw([
    { email: "gov1@example.com", cats: ["gov_policy"] },
    { email: "gov2@example.com", cats: ["gov_policy"] },
    { email: "all@example.com" },
    { email: "ind@example.com", cats: ["industry"] },
    { email: "free@example.com", plan: "free", cats: ["gov_policy"] },
    { email: "lapsed@example.com", proUntil: iso(T0 - 1000), cats: ["gov_policy"] },
  ]);
  const gov = d.to("gov1@example.com")[0];
  check(gov && /Item g1/.test(gov.text) && !/Item t1|Item t2|Item w1/.test(gov.text) && /GOV & POLICY \(1\)/.test(gov.text) && !/TRAVELER PAIN|WEBSITE & APP/.test(gov.text),
    "pro cats: [gov_policy] gets only the Gov & policy items");
  check(/· 1 problems, 1 new$/.test(gov.subject) && /1 problems · 1 new · 1 high severity/.test(gov.text) && /Your categories: Gov & policy/.test(gov.text) && /Your categories: Gov &amp; policy/.test(gov.html),
    "pro cats: the subject and heading counts are for their categories, and the email names them");
  check(!/Failed this run/.test(gov.text), "pro cats: a failed category they didn't choose isn't mentioned");
  const all = d.to("all@example.com")[0];
  check(all && /4 problems, 2 new$/.test(all.subject) && /Item t1/.test(all.text) && /Item w1/.test(all.text) && /Failed this run: Industry/.test(all.text) && !/Your categories/.test(all.text),
    "pro cats: no choice (null) gets every category, as before");
  const govCall = d.calls.find((c) => c.body.some((m) => m.to[0] === "gov1@example.com"));
  check(govCall.body.length === 2 && govCall.body.some((m) => m.to[0] === "gov2@example.com") && govCall.body[0].subject === govCall.body[1].subject
    && govCall.body[0].text.split("\n--\n")[0] === govCall.body[1].text.split("\n--\n")[0],
  "pro cats: two subscribers with the same set share one body and one batch call");
  const proKeys = d.calls.filter((c) => c.body.some((m) => /Pro update/.test(m.text))).map((c) => c.key);
  check(proKeys.length === 2 && proKeys.includes(`${sweep.id}-pro-0`) && proKeys.includes(`${sweep.id}-pro-gov_policy-0`),
    "pro cats: \"all\" keeps the old idempotency key; another set gets its own");
  check(d.to("ind@example.com").length === 0 && d.out.pro.emptyForCats === 1 && d.out.pro.due === 4 && d.out.pro.sent === 3 && d.out.pro.deferred === 0,
    "pro cats: a set with nothing this sweep is not sent and is counted as emptyForCats");
  for (const e of ["free@example.com", "lapsed@example.com"]) {
    const m = d.to(e);
    check(m.length === 1 && /daily digest/.test(m[0].text) && /Item t1/.test(m[0].text) && /Item w1/.test(m[0].text) && !/Your categories/.test(m[0].text),
      `pro cats: ${e.split("@")[0]} gets every category in the daily digest; cats is ignored`);
  }

  // a stop in one group defers the groups after it
  const ds2 = memStorage();
  for (const [i, c] of [[0, null], [1, ["gov_policy"]]]) {
    await putSubscriber(ds2, { ...newPending(`q${i}@example.com`, { now: T0 - 3600_000, randomBytes: seeded(400 + i) }), token: "q" + i, status: "active", plan: "pro", proSource: "owner", cats: c });
  }
  const out2 = await deliverToSubscribers({
    env: DENV, storage: ds2, now: () => T0, randomBytes: seeded(9), sweep, scheduled: true, log: () => {},
    fetchFn: async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ name: "daily_quota_exceeded" }) }),
  });
  check(out2.stopped === "quota" && out2.pro.sent === 0 && out2.pro.deferred === 2, "pro cats: a quota stop in the first group defers the next group instead of trying it");
}

// ---- One inbox, one subscriber: canonicalEmail and findSubscriber
{
  const { canonicalEmail, findSubscriber, legacySubscriberId } = await import("../api/_lib/subscribers.js");
  const admin = await import("./subscribers.mjs");
  const cases = [
    ["M.E+radar@Gmail.com", "me@gmail.com"], ["m.e@googlemail.com", "me@gmail.com"], ["me@gmail.com", "me@gmail.com"],
    ["me+news@outlook.com", "me@outlook.com"], ["me+x@icloud.com", "me@icloud.com"], ["m.e+x@hotmail.com", "m.e@hotmail.com"],
    ["first.last+x@example.com", "first.last+x@example.com"], ["+x@gmail.com", "+x@gmail.com"], ["not an email", null],
  ];
  const bad = cases.filter(([a, b]) => canonicalEmail(a) !== b);
  check(bad.length === 0, `canonicalEmail: Gmail drops dots and +tag, googlemail is gmail, listed providers drop +tag, other domains and an empty result are kept${bad.length ? " (wrong: " + bad.map((c) => c[0]).join(", ") + ")" : ""}`);
  check(subscriberId("me+radar@gmail.com") === subscriberId("M.E@googlemail.com") && subscriberId("me@gmail.com") === legacySubscriberId("me@gmail.com"),
    "subscriberId: variants of one inbox share an id; an ordinary address keeps the id it had before");
  check(newPending("M.E+radar@gmail.com", { now: T0, randomBytes: seeded(3) }).email === "m.e+radar@gmail.com", "newPending: stores the address as typed (normalised), so mail goes where it was asked");

  // A record made before this change under a variant keeps its old id.
  const st = memStorage();
  const legacy = { ...newPending("m.e@gmail.com", { now: T0 - 86400_000, randomBytes: seeded(5) }), status: "active", confirmedAt: iso(T0) };
  legacy.id = legacySubscriberId("m.e@gmail.com");
  await putSubscriber(st, legacy);
  check(legacy.id !== subscriberId("m.e@gmail.com") && (await findSubscriber(st, "M.E@gmail.com"))?.id === legacy.id, "findSubscriber: finds a record stored under its pre-change id");
  check((await findSubscriber(st, "nobody@gmail.com")) === null && (await findSubscriber(st, "bad")) === null, "findSubscriber: null for an unknown or invalid address");

  // Sign-up
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example/", MAX_SUBSCRIBERS: "5000" };
  const signup = (store, clock = T0) => {
    const sent = [];
    const fetchFn = async (url, init) => { const body = JSON.parse(init.body); sent.push(...body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) }; };
    const handler = makeSubscribeHandler({ env: ENV, storage: store, fetchFn, now: () => clock, randomBytes: seeded(7), log: () => {} });
    const post = async (email) => { const res = mockRes(); await handler({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100." + sent.length }, body: { email } }, res); return res; };
    return { sent, post };
  };
  const subCount = (store) => [...store.m.keys()].filter((k) => k.startsWith("radar:sub:")).length;
  const s1 = memStorage();
  s1.m.set("radar:subscriberCount", "0");
  let u = signup(s1);
  await u.post("me@gmail.com");
  const first = JSON.parse(s1.m.get("radar:sub:" + subscriberId("me@gmail.com")));
  await putSubscriber(s1, { ...first, status: "active", confirmedAt: iso(T0) });
  u = signup(s1, T0 + 3600_000);
  for (const v of ["m.e+radar@gmail.com", "ME@googlemail.com"]) await u.post(v);
  check(subCount(s1) === 1 && !u.sent.some((m) => /confirm\?id=/.test(m.text)), "sign-up: variants of a confirmed Gmail address make no second record and no confirmation email");
  const s2 = memStorage();
  s2.m.set("radar:subscriberCount", "0");
  u = signup(s2);
  await u.post("me+a@outlook.com");
  await u.post("me+b@outlook.com");
  check(subCount(s2) === 1 && u.sent.length === 1, "sign-up: a +tag variant of a pending address inside 24 h makes no second record and no second email");
  u = signup(st, T0 + 3600_000);
  await u.post("m.e@gmail.com");
  check(subCount(st) === 1 && !u.sent.some((m) => /confirm\?id=/.test(m.text)), "sign-up: a pre-change record is found, so signing up again makes no second record");

  // Webhook: a bounce for the pre-change record removes it.
  const KEY = Buffer.from("test-webhook-key-0123456789abcdef");
  const TS = String(Math.floor(T0 / 1000));
  const hook = makeResendWebhookHandler({ env: { RESEND_WEBHOOK_SECRET: "whsec_" + KEY.toString("base64") }, storage: st, now: () => T0, randomBytes: seeded(40), log: () => {} });
  const raw = JSON.stringify({ type: "email.bounced", created_at: iso(T0), data: { email_id: "e1", to: ["M.E@gmail.com"], bounce: { type: "Permanent" } } });
  const sig = "v1," + createHmac("sha256", KEY).update(`msg_x.${TS}.${raw}`).digest("base64");
  const res = await hook(new Request("https://site.example/api/resend-webhook", { method: "POST", headers: { "content-type": "application/json", "svix-id": "msg_x", "svix-timestamp": TS, "svix-signature": sig }, body: raw }));
  check(res.status === 200 && !(await getSubscriber(st, legacy.id)), "webhook: a bounce removes a record stored under its pre-change id");

  // Admin: show and delete find a pre-change record; delete removes the id it found.
  await putSubscriber(st, legacy);
  const run = async (argv) => { const out = []; const code = await admin.main(argv, { storage: st, now: T0, rb: seeded(70), out: (s) => out.push(s), err: (s) => out.push(s) }); return { code, all: out.join("\n") }; };
  let a = await run(["show", "m.e@gmail.com"]);
  check(a.code === 0 && /active/.test(a.all), "admin show: finds a pre-change record");
  a = await run(["delete", "M.E@gmail.com", "--yes"]);
  check(a.code === 0 && !(await getSubscriber(st, legacy.id)), "admin delete: removes a pre-change record by the id it was found under");
}

// ---- Already subscribed: the reply says so, and the inbox gets a notice with its manage link
{
  const { buildAlreadySubscribedEmail } = await import("../api/_lib/email.js");
  const { NOTICE_HOURS } = await import("../api/_lib/subscription-handlers.js");
  const admin = await import("./subscribers.mjs");
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example/", MAX_SUBSCRIBERS: "5000" };
  const HOUR = 3600_000;
  const world = async (envOver = {}, { status = "active" } = {}) => {
    const st = memStorage();
    st.m.set("radar:subscriberCount", "1");
    const rec = { ...newPending("me@gmail.com", { now: T0 - 48 * HOUR, randomBytes: seeded(11) }), token: "tok-secret-1", status, confirmedAt: status === "active" ? iso(T0 - 47 * HOUR) : null };
    if (status === "pending") rec.confirmSentAt = iso(T0 - HOUR);
    await putSubscriber(st, rec);
    const sent = []; const logs = [];
    let clock = T0; let code = 200;
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      if (code === 200) sent.push(...body);
      return { ok: code === 200, status: code, headers: { get: () => null }, json: async () => (code === 200 ? { data: body.map((_, i) => ({ id: "m" + i })) } : { name: "internal_server_error" }) };
    };
    const handler = makeSubscribeHandler({ env: { ...ENV, ...envOver }, storage: st, fetchFn, now: () => clock, randomBytes: seeded(7), log: (...a) => logs.push(a.join(" ")) });
    let ipN = 0;
    const post = async (fields, ip) => { const res = mockRes(); await handler({ method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip || "203.0.113." + ++ipN }, body: fields }, res); return res; };
    const evs = (type) => [...st.m.entries()].filter(([k]) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    const now = () => getSubscriber(st, rec.id);
    return { st, rec, sent, logs, post, evs, now, tick: (ms) => { clock += ms; }, setResend: (c) => { code = c; } };
  };
  const EMAILED = "This address is already subscribed. We've emailed it a link to manage the subscription.";
  const NOT_EMAILED = "This address is already subscribed. Use the Manage link in any digest email to change it.";

  // the email on its own
  const m = buildAlreadySubscribedEmail({ manageUrl: "https://s.example/manage/?id=a&t=b", unsubscribeUrl: "https://s.example/api/unsubscribe?id=a&t=b", siteUrl: "https://s.example" });
  check(m.subject === "You're already subscribed to Travel Problem Radar" && m.text.includes("Manage subscription: https://s.example/manage/?id=a&t=b") && m.text.includes("Unsubscribe: https://s.example/api/unsubscribe?id=a&t=b") && /If this wasn't you, ignore this email/.test(m.text) && m.html.includes('href="https://s.example/manage/?id=a&amp;t=b"'),
    "buildAlreadySubscribedEmail: subject, manage and unsubscribe links, and an ignore line");
  let threw = 0;
  for (const bad of [{ manageUrl: "javascript:x", unsubscribeUrl: "https://s.example/u" }, { manageUrl: "https://s.example/m", unsubscribeUrl: "" }]) { try { buildAlreadySubscribedEmail(bad); } catch (e) { threw++; } }
  check(threw === 2, "buildAlreadySubscribedEmail: refuses a missing or non-http link");

  // a variant of a confirmed address
  let w = await world();
  let r = await w.post({ email: "M.E+radar@gmail.com" });
  let body = r.json();
  check(r.code === 200 && body.ok === true && body.already === true && body.message === EMAILED, "already subscribed: a variant of a confirmed address is told so, and that an email went");
  check(w.sent.length === 1 && w.sent[0].to[0] === "me@gmail.com" && w.sent[0].subject === "You're already subscribed to Travel Problem Radar" &&
    w.sent[0].text.includes(`https://site.example/manage/?id=${w.rec.id}&t=tok-secret-1`) && w.sent[0].text.includes(`https://site.example/api/unsubscribe?id=${w.rec.id}&t=tok-secret-1`),
    "already subscribed: one notice to the stored address, with its manage and unsubscribe links");
  check(!r.body.includes("tok-secret") && !r.body.includes(w.rec.id) && !r.body.includes("@"), "already subscribed: the reply holds no token, id or address");
  const after = await w.now();
  check(after.noticeSentAt === iso(T0) && after.token === "tok-secret-1" && after.status === "active" && [...w.st.m.keys()].filter((k) => k.startsWith("radar:sub:")).length === 1,
    "already subscribed: noticeSentAt is stored; the record is otherwise unchanged and still the only one");
  const ev = w.evs("noticesent");
  check(ev.length === 1 && JSON.parse(ev[0][1]).plan === "free" && !/@|[0-9a-f]{64}/.test(ev[0][0] + ev[0][1]), "already subscribed: one noticesent event with the plan and no address or id");
  check(!w.logs.some((l) => /@|tok-secret|[0-9a-f]{64}/.test(l)), "already subscribed: no log line holds the address, token or id");

  // once a day
  w.tick(HOUR);
  r = await w.post({ email: "me@gmail.com" });
  check(r.json().message === NOT_EMAILED && r.json().already === true && w.sent.length === 1 && w.evs("noticesent").length === 1, "already subscribed: a second try within 24 h sends nothing and says to use a digest's Manage link");
  w.tick((NOTICE_HOURS - 1) * HOUR);
  r = await w.post({ email: "me@gmail.com" });
  check(r.json().message === EMAILED && w.sent.length === 2 && w.evs("noticesent").length === 2, "already subscribed: 24 h after the last notice, another one is sent");

  // the daily cap covers notices, and notices count towards it
  w = await world({ MAX_CONFIRMS_PER_DAY: "2" });
  for (let i = 0; i < 2; i++) await recordEvent(w.st, "confirmsent", { now: T0 - 60_000, randomBytes: seeded(200 + i), plan: "free" });
  r = await w.post({ email: "me@gmail.com" });
  check(r.json().message === NOT_EMAILED && w.sent.length === 0 && !(await w.now()).noticeSentAt, "already subscribed: with the day's cap reached, no notice is sent or stored");
  w = await world({ MAX_CONFIRMS_PER_DAY: "1" });
  await w.post({ email: "me@gmail.com" });
  r = await w.post({ email: "someone.new@example.com" });
  check(w.sent.length === 1 && r.json().message === JSON.parse('{"m":"If that address can be subscribed, a confirmation link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder."}').m,
    "already subscribed: a notice counts towards MAX_CONFIRMS_PER_DAY, so the next new address gets no confirmation that day");

  // a failed send
  w = await world();
  w.setResend(500);
  r = await w.post({ email: "me@gmail.com" });
  check(r.code === 200 && r.json().message === NOT_EMAILED && !(await w.now()).noticeSentAt && w.evs("noticesent").length === 0, "already subscribed: a failed send stores nothing and says to use a digest's Manage link");
  check(w.logs.some((l) => /^subscribe notice-email failed/.test(l)) && !w.logs.some((l) => /@|tok-secret/.test(l)), "already subscribed: the failure is logged without the address or token");
  w.setResend(200);
  r = await w.post({ email: "me@gmail.com" });
  check(r.json().message === EMAILED && w.sent.length === 1, "already subscribed: after a failed send, the next try sends");

  // the cases that still get the generic reply
  w = await world();
  r = await w.post({ email: "me@gmail.com", website: "bot" });
  check(!r.json().already && /confirmation link is on its way/.test(r.json().message) && w.sent.length === 0, "already subscribed: the honeypot still gets the generic reply");
  w = await world({ MAX_SIGNUPS_PER_IP_HOUR: "1" });
  await w.post({ email: "a@example.com" }, "198.51.100.9");
  r = await w.post({ email: "me@gmail.com" }, "198.51.100.9");
  check(!r.json().already && /confirmation link is on its way/.test(r.json().message) && !w.sent.some((x) => x.to[0] === "me@gmail.com"), "already subscribed: over the per-IP limit, the generic reply and no notice");

  // a pending address
  w = await world({}, { status: "pending" });
  r = await w.post({ email: "m.e@gmail.com" });
  check(r.json().message === "A confirmation link was already sent to this address in the last 24 hours. Check your inbox and spam or junk folder." && !r.json().already && w.sent.length === 0,
    "pending: a confirmation sent within 24 h is mentioned; nothing is sent");

  // stats
  w = await world();
  await w.post({ email: "me@gmail.com" });
  const out = [];
  await admin.main(["stats", "--days", "1"], { storage: w.st, now: T0, rb: seeded(70), out: (s) => out.push(s), err: (s) => out.push(s) });
  check(/1 already-subscribed notices/.test(out.join("\n")) && / notices /.test(out.join("\n")), "stats: already-subscribed notices per day and in the totals");
}

// ---- T16: accounts and sign-in (the login cookie, /api/session, Confirm signs in, /manage/ by cookie)
{
  const { makeSessionHandler, makeAccountHandler, SIGNIN_MINUTES, SIGNIN_GAP_MINUTES } = await import("../api/_lib/subscription-handlers.js");
  const { SESSION_DAYS, clearCookie, originOk, parseCookies, readSession, sessionCookie, signSession } = await import("../api/_lib/session.js");
  const { buildSignInEmail } = await import("../api/_lib/email.js");
  const admin = await import("./subscribers.mjs");
  const SECRET = "test-session-secret-0123456789abcdef";
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example", MAX_SUBSCRIBERS: "5000", SESSION_SECRET: SECRET };
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const world = async (envOver = {}, { status = "active", plan = "free" } = {}) => {
    const st = memStorage();
    const rec = { ...newPending("me@gmail.com", { now: T0 - 48 * HOUR, randomBytes: seeded(11) }), token: "tok-secret-1", status, plan, confirmedAt: status === "active" ? iso(T0 - 47 * HOUR) : null };
    await putSubscriber(st, rec);
    const sent = []; const logs = [];
    let clock = T0;
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push(...(Array.isArray(body) ? body : [body]));
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: [{ id: "m0" }], id: "m0" }) };
    };
    const env = { ...ENV, ...envOver };
    const deps = { env, storage: st, fetchFn, now: () => clock, randomBytes: seeded(7), log: (...a) => logs.push(a.join(" ")) };
    const handlers = { sess: makeSessionHandler(deps), acct: makeAccountHandler(deps), conf: makeConfirmHandler(deps), sub: makeSubscribeHandler(deps) };
    let ipN = 0;
    const call = async (name, { method = "GET", query = {}, body, cookie, origin, ip } = {}) => {
      const headers = { host: "site.example", "content-type": "application/json", "x-forwarded-for": ip || "203.0.113." + ++ipN };
      if (cookie) headers.cookie = cookie;
      if (origin !== undefined) headers.origin = origin;
      const res = mockRes();
      await handlers[name]({ method, headers, query, body }, res);
      return res;
    };
    const ask = (email, opts = {}) => call("sess", { method: "POST", body: { action: "request", email, ...(opts.body || {}) }, ip: opts.ip });
    const signUp = (email, opts = {}) => call("sub", { method: "POST", body: { email, ...(opts.body || {}) }, ip: opts.ip });
    const codeIn = (mail) => { const m = /[?&]c=([A-Za-z0-9_-]+)/.exec(mail.text); return m ? m[1] : ""; };
    const evs = (type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    return { st, rec, env, sent, logs, call, ask, signUp, codeIn, evs, now: () => getSubscriber(st, rec.id), tick: (ms) => { clock += ms; } };
  };
  const cookieOf = (res) => { const m = /^tpr_session=([^;]*)/.exec(res.headers["set-cookie"] || ""); return m && m[1] ? `tpr_session=${m[1]}` : ""; };
  const REPLY = "If that address has an account, a sign-in link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder.";

  // the cookie on its own
  {
    const w = await world();
    const value = signSession(w.rec, { secret: SECRET, now: T0 });
    const read = (v, { now = T0, env = w.env } = {}) => readSession({ headers: { cookie: `other=1; tpr_session=${v}` } }, { env, storage: w.st, now });
    check((await read(value))?.id === w.rec.id, "cookie: a valid one gives the record");
    const [id, exp, ver, sig] = value.split(".");
    check(await read(`${id}.${exp}.${ver}.${(sig[0] === "A" ? "B" : "A") + sig.slice(1)}`) === null, "cookie: a changed signature is refused");
    check(await read(`${id}.${Number(exp) + 999}.${ver}.${sig}`) === null && await read(`${id}.${exp}.1.${sig}`) === null, "cookie: a changed expiry or version is refused");
    check(await read(value, { now: T0 + SESSION_DAYS * DAY + 1000 }) === null && await read(value, { now: T0 + (SESSION_DAYS - 1) * DAY }) !== null, `cookie: refused after ${SESSION_DAYS} days, accepted before`);
    check(await read(value, { env: {} }) === null && await read(value, { env: { SESSION_SECRET: "short" } }) === null, "cookie: no secret, or one under 32 characters, signs nobody in");
    check(await read(signSession(w.rec, { secret: "another-secret-of-enough-length-000", now: T0 })) === null, "cookie: one signed with another secret (say, Preview's) is refused");
    await putSubscriber(w.st, { ...w.rec, sessionVer: 1 });
    check(await read(value) === null, "cookie: bumping sessionVer ends the session");
    await putSubscriber(w.st, { ...w.rec, status: "pending" });
    check(await read(value) === null, "cookie: a record that isn't active is refused");
    await putSubscriber(w.st, { ...w.rec, createdAt: iso(T0 - HOUR) });
    check(await read(value) === null, "cookie: a record made again for the same address (new createdAt) refuses the old cookie");
    await deleteSubscriber(w.st, w.rec.id);
    check(await read(value) === null, "cookie: a deleted record is refused");
    check(await read("garbage") === null && await readSession({ headers: {} }, { env: w.env, storage: w.st, now: T0 }) === null, "cookie: a malformed or missing cookie is refused");
    check(!value.includes("@") && !value.includes("tok-secret") && !value.includes("free"), "cookie: holds no address, token or plan");
    check(sessionCookie("v") === `tpr_session=v; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax` && /^tpr_session=; Max-Age=0; .*HttpOnly; Secure; SameSite=Lax$/.test(clearCookie()),
      "cookie: HttpOnly, Secure, SameSite=Lax, Path=/, 30 days; sign-out sets Max-Age=0");
    check(JSON.stringify(parseCookies("a=1; tpr_session=x.y; a=2; junk")) === '{"a":"1","tpr_session":"x.y"}', "parseCookies: name=value pairs, the first of a repeated name wins");
    const o = (origin) => originOk({ headers: { host: "site.example", ...(origin === undefined ? {} : { origin }) } });
    check(o(undefined) && o("https://site.example") && !o("https://evil.example") && !o("null") && !o("https://site.example.evil.example"), "originOk: no Origin or this host passes; another host or \"null\" doesn't");
  }

  // the email on its own
  {
    const m = buildSignInEmail({ signInUrl: "https://s.example/api/session?id=a&c=b", siteUrl: "https://s.example" });
    check(m.subject === "Your Travel Problem Radar sign-in link" && m.text.includes("Sign in: https://s.example/api/session?id=a&c=b") && /expires in 15 minutes/.test(m.text) && /If you didn't ask for this, ignore this email/.test(m.text) && m.html.includes('href="https://s.example/api/session?id=a&amp;c=b"'),
      "buildSignInEmail: subject, the link, the 15 minutes, and an ignore line");
    let threw = 0;
    for (const bad of ["", "javascript:alert(1)"]) { try { buildSignInEmail({ signInUrl: bad }); } catch (e) { threw++; } }
    check(threw === 2, "buildSignInEmail: refuses a missing or non-http link");
    const a = buildSignInEmail({ signInUrl: "https://s.example/api/session?id=a&c=b", already: true });
    check(/tried to sign up .* already has an account, so here is a sign-in link instead/.test(a.text) && a.text.includes("Sign in: https://s.example/api/session?id=a&c=b") && /expires in 15 minutes/.test(a.text) && a.subject === m.subject,
      "buildSignInEmail({ already }): says the address already has an account; same subject, link and expiry");
  }

  // asking for a link
  {
    let w = await world();
    let r = await w.ask("nobody@example.com");
    check(r.code === 200 && r.json().message === REPLY && w.sent.length === 0, "sign-in request: an unknown address gets the usual reply and no email");
    r = await w.ask("M.E+x@gmail.com");
    check(r.code === 200 && r.json().message === REPLY && w.sent.length === 1 && w.sent[0].to[0] === "me@gmail.com" && w.sent[0].subject === "Your Travel Problem Radar sign-in link",
      "sign-in request: a confirmed address (any variant of it) gets the same reply and one email to the stored address");
    const code = w.codeIn(w.sent[0]);
    const after = await w.now();
    check(code.length === 43 && w.sent[0].text.includes(`https://site.example/api/session?id=${w.rec.id}&c=${code}`) && after.signin.hash.length === 64 && !JSON.stringify(after).includes(code),
      "sign-in request: the link carries a 43-character code; the record keeps only its hash");
    check(after.signin.exp === iso(T0 + SIGNIN_MINUTES * MIN) && after.token === "tok-secret-1" && after.status === "active" && w.evs("signinsent").length === 1,
      "sign-in request: the code expires in 15 minutes; the token is untouched; a signinsent event is recorded");
    check(!r.body.includes(code) && !r.body.includes(w.rec.id) && !r.body.includes("@") && !w.logs.some((l) => l.includes(code) || /@/.test(l)), "sign-in request: no code, id or address in the reply or the logs");
    w.tick((SIGNIN_GAP_MINUTES - 1) * MIN);
    r = await w.ask("me@gmail.com");
    check(r.json().message === REPLY && w.sent.length === 1 && (await w.now()).signin.hash === after.signin.hash, "sign-in request: a second ask within 5 minutes sends nothing and keeps the first code");
    w.tick(2 * MIN);
    r = await w.ask("me@gmail.com");
    check(w.sent.length === 2 && (await w.now()).signin.hash !== after.signin.hash, "sign-in request: after 5 minutes a new link replaces the old one");

    w = await world({}, { status: "pending" });
    r = await w.ask("me@gmail.com");
    check(r.json().message === REPLY && w.sent.length === 0 && !(await w.now()).signin, "sign-in request: an unconfirmed address gets the same reply and no email");
    w = await world();
    r = await w.ask("me@gmail.com", { body: { website: "bot" } });
    check(r.json().message === REPLY && w.sent.length === 0, "sign-in request: the honeypot gets the usual reply and no email");
    r = await w.ask("not-an-address");
    check(r.code === 400, "sign-in request: a malformed address is a 400");
    w = await world({ MAX_SIGNINS_PER_DAY: "1" });
    await w.st.set(`radar:event:${utcDay(T0)}-000000000-signinsent-aaaaaa`, "{}");
    r = await w.ask("me@gmail.com");
    check(r.json().message === REPLY && w.sent.length === 0, "sign-in request: MAX_SIGNINS_PER_DAY reached, the usual reply and no email");
    w = await world({ MAX_SIGNINS_PER_DAY: "0" });
    await w.ask("me@gmail.com");
    check(w.sent.length === 0, "sign-in request: MAX_SIGNINS_PER_DAY=0 sends none");
    w = await world({ MAX_SIGNUPS_PER_IP_HOUR: "1" });
    await w.ask("nobody@example.com", { ip: "198.51.100.7" });
    r = await w.ask("me@gmail.com", { ip: "198.51.100.7" });
    check(r.json().message === REPLY && w.sent.length === 0 && (await w.st.list(KEY_IPHIT_PREFIX)).length === 1, "sign-in request: the per-IP hourly limit (shared with sign-up) holds the email back");
    for (const [over, label] of [[{ SESSION_SECRET: "" }, "no SESSION_SECRET"], [{ SUBSCRIPTIONS_ENABLED: "0" }, "subscriptions switched off"]]) {
      w = await world(over);
      r = await w.ask("me@gmail.com");
      check(r.code === 503 && w.sent.length === 0, `sign-in request: ${label} is a 503 and sends nothing`);
    }
  }

  // the link and its button
  {
    const w = await world();
    await w.ask("me@gmail.com");
    const code = w.codeIn(w.sent[0]);
    const before = await w.now();
    let r = await w.call("sess", { query: { id: w.rec.id, c: code } });
    check(r.code === 200 && /<button type="submit">Sign in<\/button>/.test(r.body) && r.body.includes('name="c"') && r.body.includes('action="/api/session"') && !r.headers["set-cookie"],
      "sign-in link: GET shows a Sign in button that posts the code, and sets no cookie");
    check(JSON.stringify(await w.now()) === JSON.stringify(before) && r.headers["cache-control"] === "no-store" && r.headers["referrer-policy"] === "no-referrer", "sign-in link: GET changes nothing; the page isn't cached and sends no Referer");
    r = await w.call("sess", { method: "POST", body: { id: w.rec.id, c: code }, origin: "https://evil.example" });
    check(r.code === 403 && !r.headers["set-cookie"] && (await w.now()).signin, "sign-in link: a POST from another site is a 403 and uses nothing");
    r = await w.call("sess", { method: "POST", body: { id: w.rec.id, c: code }, origin: "https://site.example" });
    const cookie = cookieOf(r);
    check(r.code === 303 && r.headers.location === "/live/" && /HttpOnly; Secure; SameSite=Lax/.test(r.headers["set-cookie"]) && cookie, "sign-in link: the button sets the login cookie and goes to /live/");
    check((await w.now()).signin === null, "sign-in link: the code is deleted once used");
    check((await readSession({ headers: { cookie } }, { env: w.env, storage: w.st, now: T0 }))?.id === w.rec.id, "sign-in link: the cookie it set signs the browser in");
    r = await w.call("sess", { method: "POST", body: { id: w.rec.id, c: code } });
    check(r.code === 400 && /This sign-in link isn(&#39;|')t valid/.test(r.body) && r.body.includes('href="/signin/"') && !r.headers["set-cookie"], "sign-in link: a used code is refused and offers a new link");
    r = await w.call("sess", { query: { id: w.rec.id, c: code } });
    check(r.code === 400, "sign-in link: a used link's GET says so too");

    w.tick(SIGNIN_GAP_MINUTES * MIN);
    await w.ask("me@gmail.com");
    const code2 = w.codeIn(w.sent[1]);
    r = await w.call("sess", { method: "POST", body: { id: w.rec.id, c: code2.slice(0, -1) + (code2.endsWith("A") ? "B" : "A") } });
    check(r.code === 400 && (await w.now()).signin, "sign-in link: a wrong code is refused and the real one still stands");
    r = await w.call("sess", { method: "POST", body: { id: "f".repeat(64), c: code2 } });
    check(r.code === 400, "sign-in link: an unknown id is refused the same way");
    w.tick(SIGNIN_MINUTES * MIN + 1000);
    r = await w.call("sess", { method: "POST", body: { id: w.rec.id, c: code2 } });
    check(r.code === 400 && !r.headers["set-cookie"], "sign-in link: refused after 15 minutes");

    const off = await world({ SESSION_SECRET: "" });
    r = await off.call("sess", { query: { id: off.rec.id, c: "x" } });
    check(r.code === 503 && /isn(&#39;|')t set up yet/.test(r.body), "sign-in link: with no SESSION_SECRET, a 503 page");
  }

  // signing up again with an existing account gets a sign-in link (account-flows #4)
  {
    const SENT = "This address already has an account. We've emailed it a sign-in link. Not in your inbox within a few minutes? Check your spam or junk folder.";
    const HELD = "This address already has an account. Sign in with a link from the sign-in page, or use the Manage link in any digest email.";
    let w = await world();
    let r = await w.signUp("M.E+x@gmail.com");
    check(r.code === 200 && r.json().already === true && r.json().message === SENT, "sign up again: an existing account is told a sign-in link was emailed");
    check(w.sent.length === 1 && w.sent[0].to[0] === "me@gmail.com" && w.sent[0].subject === "Your Travel Problem Radar sign-in link" && /already has an account/.test(w.sent[0].text) && !/manage\/\?id=|tok-secret/.test(w.sent[0].text),
      "sign up again: one sign-in email to the stored address, with no manage link or token");
    check((await w.now()).signin && w.evs("signinsent").length === 1 && w.evs("noticesent").length === 0 && w.evs("confirmsent").length === 0 && !(await w.now()).noticeSentAt,
      "sign up again: counted as a sign-in email (signinsent), not a notice or a confirmation");
    check(!r.body.includes(w.rec.id) && !r.body.includes("@") && !w.logs.some((l) => /@|tok-secret/.test(l)), "sign up again: no id or address in the reply or the logs");
    const code = w.codeIn(w.sent[0]);
    r = await w.call("sess", { method: "POST", body: { id: w.rec.id, c: code } });
    check(r.code === 303 && r.headers.location === "/live/" && cookieOf(r), "sign up again: the emailed link signs the browser in");
    w = await world();
    await w.signUp("me@gmail.com");
    w.tick((SIGNIN_GAP_MINUTES - 1) * MIN);
    r = await w.signUp("me@gmail.com");
    const r2 = await w.ask("me@gmail.com");
    check(r.json().message === HELD && r2.json().message === REPLY && w.sent.length === 1, "sign up again: within 5 minutes of a sign-in link, nothing more is sent, from either form");
    w = await world({ MAX_SIGNINS_PER_DAY: "1" });
    await w.st.set(`radar:event:${utcDay(T0)}-000000000-signinsent-aaaaaa`, "{}");
    r = await w.signUp("me@gmail.com");
    check(r.json().message === HELD && w.sent.length === 0, "sign up again: MAX_SIGNINS_PER_DAY reached, no email and the held reply");
    w = await world({ SESSION_SECRET: "" });
    r = await w.signUp("me@gmail.com");
    check(r.json().already === true && /already subscribed/.test(r.json().message) && w.sent.length === 1 && /already subscribed/.test(w.sent[0].subject) && w.evs("signinsent").length === 0,
      "sign up again: with no SESSION_SECRET, the manage-link notice as before");
  }

  // Confirm signs you in
  {
    let w = await world({}, { status: "pending" });
    let r = await w.call("conf", { query: { id: w.rec.id, t: "tok-secret-1" } });
    check(r.code === 200 && !r.headers["set-cookie"], "confirm: the GET page sets no cookie");
    r = await w.call("conf", { method: "POST", body: { id: w.rec.id, t: "tok-secret-1" } });
    const cookie = cookieOf(r);
    check(r.code === 200 && /You(&#39;|')re subscribed/.test(r.body) && cookie && (await readSession({ headers: { cookie } }, { env: w.env, storage: w.st, now: T0 }))?.status === "active",
      "confirm: pressing Confirm also signs this browser in");
    check(/you(&#39;|')re signed in on this browser/.test(r.body), "confirm: the page says this browser is now signed in");
    w = await world({ SESSION_SECRET: "" }, { status: "pending" });
    r = await w.call("conf", { method: "POST", body: { id: w.rec.id, t: "tok-secret-1" } });
    check(r.code === 200 && !r.headers["set-cookie"] && (await w.now()).status === "active", "confirm: with no SESSION_SECRET it confirms as before and sets no cookie");
    check(!/signed in/.test(r.body), "confirm: with no SESSION_SECRET the page doesn't claim you're signed in");
  }

  // /api/account by cookie, me and sign-out
  {
    const w = await world();
    const cookie = `tpr_session=${signSession(w.rec, { secret: SECRET, now: T0 })}`;
    let r = await w.call("acct");
    check(r.code === 401 && r.json().error === "not_signed_in", "account: no link and no cookie is a 401");
    r = await w.call("acct", { cookie });
    const b = r.json();
    check(r.code === 200 && b.signedIn === true && b.status === "active" && b.effectivePlan === "free" && !r.body.includes("@") && !r.body.includes("tok-secret") && !r.body.includes(w.rec.id),
      "account: by cookie, the plan and signedIn, and no address, token or id");
    r = await w.call("acct", { query: { id: w.rec.id, t: "tok-secret-1" } });
    check(r.code === 200 && r.json().signedIn === false, "account: the email link still works, with signedIn false when there's no cookie");
    r = await w.call("acct", { query: { id: w.rec.id, t: "wrong" }, cookie });
    check(r.code === 404, "account: a bad link is refused even with a valid cookie");
    r = await w.call("acct", { method: "POST", body: { action: "request-pro" }, cookie, origin: "https://evil.example" });
    check(r.code === 403 && !(await w.now()).proRequestedAt, "account: a cookie POST from another site is a 403 and changes nothing");
    r = await w.call("acct", { method: "POST", body: { action: "request-pro" }, cookie, origin: "https://site.example" });
    check(r.code === 200 && r.json().signedIn === true && (await w.now()).proRequestedAt === iso(T0), "account: a cookie POST from this site works (Request Pro)");
    r = await w.call("acct", { method: "POST", body: { id: w.rec.id, t: "tok-secret-1", action: "request-pro" }, origin: "https://evil.example" });
    check(r.code === 200, "account: a POST with the email link's token works as before, whatever its Origin");

    r = await w.call("sess", { query: { action: "me" } });
    check(r.code === 200 && r.body === '{"signedIn":false,"plan":null}', "me: not signed in");
    r = await w.call("sess", { query: { action: "me" }, cookie });
    check(r.code === 200 && r.body === '{"signedIn":true,"plan":"free"}', "me: signed in, Free, and nothing else");
    await putSubscriber(w.st, { ...(await w.now()), plan: "pro" });
    r = await w.call("sess", { query: { action: "me" }, cookie });
    check(r.json().plan === "pro", "me: a Pro account says pro");
    r = await w.call("sess", { method: "POST", body: { action: "signout" }, cookie, origin: "https://evil.example" });
    check(r.code === 403 && !r.headers["set-cookie"], "sign-out: from another site, a 403");
    r = await w.call("sess", { method: "POST", body: { action: "signout" }, cookie });
    check(r.code === 200 && /^tpr_session=; Max-Age=0;/.test(r.headers["set-cookie"]), "sign-out: clears the cookie");
    r = await w.call("sess", { method: "POST", body: { action: "nope" } });
    check(r.code === 400, "session: an unknown action is a 400");
    r = await w.call("sess", { method: "DELETE" });
    check(r.code === 405, "session: other methods are a 405");
  }

  // stats count sign-in emails
  {
    const w = await world();
    await w.ask("me@gmail.com");
    const out = [];
    await admin.main(["stats", "--days", "1"], { storage: w.st, now: T0, rb: seeded(70), out: (s) => out.push(s), err: (s) => out.push(s) });
    check(/ sign-ins /.test(out.join("\n")) && /1 sign-in emails/.test(out.join("\n")), "stats: sign-in emails per day and in the totals");
  }
}

finish("subscription tests");
