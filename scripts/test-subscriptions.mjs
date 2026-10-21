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

finish("subscription tests");
