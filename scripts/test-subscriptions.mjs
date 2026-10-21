// Offline tests for the subscriber features (docs/subscriptions/tasks). No network, no API
// key: Blob storage and Resend are faked.
//   node scripts/test-subscriptions.mjs
import { randomBytes } from "node:crypto";
import { blobStorage } from "../api/_lib/storage.js";
import {
  CONFIRM_RESEND_HOURS, PENDING_TTL_DAYS, countEvents, deleteSubscriber, effectivePlan, getSubscriber, listSubscribers,
  newPending, newToken, normaliseEmail, putSubscriber, recordEvent, subscriberId, tokenOk, utcDay,
} from "../api/_lib/subscribers.js";
import { BodyTooLargeError, allowMethods, bearerOk, esc, parseForm, readBody, readFields, sendJson, sendPage } from "../api/_lib/http.js";
import { DEFAULT_FROM, buildConfirmEmail, buildDigestEmail, sendBatch, sendOne, withSubscriberFooter } from "../api/_lib/email.js";
import { KEY_SUBSCRIBER_COUNT, makeSubscribeHandler, siteUrl, makeConfirmHandler, makeUnsubscribeHandler } from "../api/_lib/subscription-handlers.js";
import { deliverToSubscribers } from "../api/_lib/subscriber-delivery.js";
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
  const OK = '{"ok":true,"message":"If that address can be subscribed, a confirmation link is on its way."}';
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
  check(r.body === newBody && w.sent.length === 1 && w.st.m.size === before, "subscribe row 7: an active address (any case) gets the identical reply; nothing is sent or stored");

  // rows 8 and 9: pending
  w = world({}, { count: 0 });
  await w.post({ email: "p@example.com" });
  const pk = subKeys(w)[0];
  const tok = JSON.parse(w.st.m.get(pk)).token;
  w.tick(23 * 3600 * 1000);
  r = await w.post({ email: "p@example.com" });
  check(r.body === OK && w.sent.length === 1, "subscribe row 8: pending, confirmation sent 23 h ago: identical reply, no new email");
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
    await w.post({ email: "x1@example.com" }), // pending, recent
    await w.post({ email: "x2@example.com", website: "bot" }), // honeypot
  ];
  check(replies.every((x) => x.body === OK && x.code === 200 && JSON.stringify(x.headers) === JSON.stringify(replies[0].headers)), "subscribe: new, pending-recent and honeypot replies are byte-identical, headers included");
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
  check(again.code === 200 && again.body.includes("not subscribed") && events(u.st, "unsubscribed").length === 1, "unsubscribe POST again: 200 \"not subscribed\", no second event");

  u = await setup();
  r = await u.call("POST");
  check(r.code === 200 && !u.has(), "unsubscribe POST from the page form (no one-click body): deleted");
  u = await setup({ status: "pending" });
  await u.call("POST");
  check(!u.has(), "unsubscribe: a pending record is deleted too");

  u = await setup();
  const wrong = [await u.call("GET", { t: "nope" }), await u.call("POST", { t: "nope" }), await u.call("POST", { t: null }), await u.call("POST", { id: "e".repeat(64) }), await u.call("GET", { id: "bad", t: null })];
  check(wrong.every((x) => x.code === 200 && x.body === wrong[0].body) && wrong[0].body.includes("not subscribed") && u.has(), "unsubscribe: wrong token, missing token, unknown id: 200 \"not subscribed\" (identical), record kept");

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
  check(r.code === 200 && u.has() && r.body.includes("Cancel your Pro plan first") && r.body.includes('href="/subscribe/"') && events(u.st, "unsubscribed").length === 0, "unsubscribe: a still-paid Razorpay Pro is kept, with a page pointing to the manage page");
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

finish("subscription tests");
