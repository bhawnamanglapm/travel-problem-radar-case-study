// Offline tests for the subscriber features (docs/subscriptions/tasks). No network, no API
// key: Blob storage and Resend are faked.
//   node scripts/test-subscriptions.mjs
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { blobStorage } from "../api/_lib/storage.js";
import {
  CONFIRM_RESEND_MINUTES, MAX_CONFIRMS_PER_ADDRESS, PENDING_TTL_DAYS, countEvents, deleteSubscriber, effectivePlan, getSubscriber, listSubscribers,
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
import { RAZORPAY_API, cancelSubscription, createSubscription, fetchSubscription, isTestKey, razorpayConfigured, verifyCheckout, verifyWebhook } from "../api/_lib/razorpay.js";
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
  const files = ["radar/subscribers/e.json", "radar/subscribers/a.json", "radar/subscribers/d.json", "radar/subscribers/c.json",
    "radar/subscribers/b.json", "radar/sweeps/1.json", "radar/subscribers/f.txt"];
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
  check(calls.length === 3 && calls[0].prefix === "radar/subscribers/" && calls[0].cursor === undefined, "blob list maps the prefix the way path() does, 3 pages of 2");
  let threw = false;
  try { await blob.list("radar"); } catch (e) { threw = true; }
  check(threw && calls.length === 3, "list without a trailing ':' throws before calling the service");
  let allRefused = true;
  for (const bad of ["sub:", "radar:", "radar", "radar:sub", "radar:nofolder:", ""]) {
    try { await blob.list(bad); allRefused = false; } catch (e) { /* refused, as it should be */ }
  }
  check(allRefused && calls.length === 3, "list refuses a prefix not under a known folder or not ending in ':' or '-', before calling the service");

  // get() reads past Blob's CDN cache unless the caller opts in (a stale read would undo a recent write).
  const gets = [];
  const fakeGet = { get: async (p, opts) => { gets.push({ p, opts }); return { statusCode: 200, stream: new Blob(["{\"a\":1}"]).stream() }; } };
  const fresh = await blobStorage(fakeGet).get("radar:sub:x");
  await blobStorage(fakeGet, { cached: true }).get("radar:index");
  check(fresh === '{"a":1}' && gets[0].p === "radar/subscribers/x.json" && gets[0].opts.useCache === false && gets[0].opts.access === "private", "blob get: skips the CDN cache by default (useCache: false)");
  check(gets[1].opts.useCache === true, "blob get: { cached: true } keeps the CDN cache (for /api/data only)");
  check(/blobStorage\(undefined, \{ cached: true \}\)/.test(readFileSync(new URL("../api/data.js", import.meta.url), "utf8")) &&
    ["account", "confirm", "resend-webhook", "subscribe", "sweep", "unsubscribe"].every((f) => !/cached/.test(readFileSync(new URL(`../api/${f}.js`, import.meta.url), "utf8"))),
    "only /api/data uses cached reads; every endpoint that writes reads fresh");

  // Each kind of key has its own folder under radar/.
  const where = [];
  const fakePut = { put: async (p) => { where.push(p); } };
  const keys = ["radar:history", "radar:seenIds", "radar:lastScheduled", "radar:subscriberCount", "radar:sweep:1792948701207",
    "radar:llmlog:1792948701207", "radar:sub:abc", "radar:event:20261021-080910123-confirmed-112233", "radar:deliveries:20261021",
    "radar:iphit:2026102112-0123456789abcdef-aabbcc", "radar:rzpsub:sub_ABC", "radar:rzp-event:20261021-evt_X", "radar:mystery"];
  for (const k of keys) await blobStorage(fakePut).set(k, "{}");
  const want = ["radar/history/index.json", "radar/history/seen-ids.json", "radar/state/last-scheduled.json", "radar/state/subscriber-count.json",
    "radar/sweeps/sweep-2026-10-25-17-18-1792948701207.json", "radar/logs/llm-log-2026-10-25-17-18-1792948701207.json", "radar/subscribers/abc.json",
    "radar/events/event-2026-10-21-08-09-10-123-confirmed-112233.json", "radar/deliveries/deliveries-2026-10-21.json",
    "radar/ip-hits/ip-hit-2026-10-21-12-0123456789abcdef-aabbcc.json", "radar/razorpay/subscriptions/sub-ABC.json",
    "radar/razorpay/events/razorpay-event-2026-10-21-evt-X.json", "radar/other/radar-mystery.json"];
  check(JSON.stringify(where) === JSON.stringify(want), `blob paths: one folder per kind of key, timestamped names (${where.join(", ")})`);
  await blobStorage(fakePut).set("radar:rzp-event:20261021-1405-evt_Y", "{}");
  await blobStorage(fakePut).set("radar:sweep:s1", "{}");
  check(where.at(-2) === "radar/razorpay/events/razorpay-event-2026-10-21-14-05-evt-Y.json" && where.at(-1) === "radar/sweeps/sweep-s1.json",
    "blob paths: a Razorpay marker carries its minute; an id that isn't a time is used as it is");

  // list() turns the dated file names back into the logical suffixes, for every prefix the code lists with.
  const stored = new Set();
  const store = {
    put: async (p) => { stored.add(p); },
    list: async ({ prefix }) => ({ blobs: [...stored].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false }),
  };
  const st2 = blobStorage(store);
  const written = ["radar:llmlog:1792948701207", "radar:llmlog:1790000000000", "radar:sweep:1792948701207", "radar:deliveries:20261021",
    "radar:iphit:2026102112-0123456789abcdef-aabbcc", "radar:iphit:2026102113-0123456789abcdef-ddeeff", "radar:rzp-event:20261021-1405-evtY",
    "radar:rzp-event:20261021-evtOLD", "radar:event:20261021-080910123-confirmed-112233", "radar:sub:abc"];
  for (const k of written) await st2.set(k, "{}");
  const roundTrip = [
    ["radar:llmlog:", "1790000000000,1792948701207"], ["radar:deliveries:", "20261021"],
    ["radar:iphit:", "2026102112-0123456789abcdef-aabbcc,2026102113-0123456789abcdef-ddeeff"], ["radar:iphit:2026102112-0123456789abcdef-", "aabbcc"],
    ["radar:rzp-event:", "20261021-1405-evtY,20261021-evtOLD"], ["radar:event:20261021-", "080910123-confirmed-112233"], ["radar:sub:", "abc"],
  ];
  const bad = [];
  for (const [prefix, want2] of roundTrip) { const got2 = (await st2.list(prefix)).join(); if (got2 !== want2) bad.push(`${prefix} -> ${got2}`); }
  check(!bad.length, `blob list: dated file names map back to the key suffixes (${bad.join("; ") || "all " + roundTrip.length})`);

  // The prefix countEvents uses ends in "-", and a real day's events must be counted through blobStorage, not only the memory store.
  const evFiles = ["radar/events/event-2026-10-21-08-09-10-123-confirmsent-aabbcc.json", "radar/events/event-2026-10-21-09-09-10-123-confirmsent-ddeeff.json",
    "radar/events/event-2026-10-21-08-09-10-123-confirmed-112233.json", "radar/events/event-2026-10-22-08-09-10-123-confirmsent-445566.json"];
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
  check(PENDING_TTL_DAYS === 7 && CONFIRM_RESEND_MINUTES === 10 && MAX_CONFIRMS_PER_ADDRESS === 5, "constants: 7-day pending life, 10-minute confirmation gap, 5 confirmations per address");

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
    && page.headers["x-robots-tag"] === "noindex" && page.headers["referrer-policy"] === "same-origin", "sendPage sets the four headers");
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
  check(withSubscriberFooter(sub, { unsubscribeUrl: U, plan: "pro" }).text.includes("1 to 5 emails a day"), "footer (pro): different plan line");
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
  const pv = { VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "radar.vercel.app" };
  check(siteUrl({ ...pv, VERCEL_BRANCH_URL: "radar-git-staging-team.vercel.app" }) === "https://radar-git-staging-team.vercel.app", "siteUrl on a Preview: the branch's own URL, not production");
  check(siteUrl(pv) === "" && siteUrl({ ...pv, VERCEL_BRANCH_URL: "bad url/x" }) === "", "siteUrl on a Preview without a usable branch URL: nothing (so no email), never production");
  check(siteUrl({ ...pv, SITE_URL: "https://set.example" }) === "https://set.example", "siteUrl on a Preview: SITE_URL still wins when set");
  check(siteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "radar.vercel.app", VERCEL_BRANCH_URL: "radar-git-main-team.vercel.app" }) === "https://radar.vercel.app", "siteUrl in production: the production URL, never the branch URL");
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
  const MIN = 60 * 1000;
  check(JSON.parse(w.st.m.get(pk)).confirmSends === 1, "subscribe: a new pending record counts one confirmation sent");
  w.tick(9 * MIN);
  r = await w.post({ email: "p@example.com" }, "198.51.100.21");
  check(r.code === 200 && /sent to this address in the last 10 minutes/.test(r.json().message) && !r.json().already && w.sent.length === 1, "subscribe row 8: pending, confirmation sent 9 min ago: says so and when to ask again; no new email");
  w.tick(2 * MIN);
  r = await w.post({ email: "P@example.com" }, "198.51.100.22");
  const after9 = JSON.parse(w.st.m.get(pk));
  check(r.body === OK && w.sent.length === 2 && after9.token === tok && after9.confirmSentAt === iso(T0 + 11 * MIN) && after9.confirmSends === 2, "subscribe row 9: pending 11 min on: new email, same token, confirmSentAt updated, confirmSends 2");
  check(w.sent[1].text.includes(`t=${tok}`) && subKeys(w).length === 1, "subscribe row 9: the new email carries the same token; still one record");
  for (let i = 3; i <= 5; i++) { w.tick(11 * MIN); await w.post({ email: "p@example.com" }, `198.51.100.${20 + i * 2}`); }
  check(w.sent.length === 5 && JSON.parse(w.st.m.get(pk)).confirmSends === 5, "subscribe row 9: re-sends 11 minutes apart reach five confirmations");
  w.tick(11 * MIN);
  r = await w.post({ email: "p@example.com" }, "198.51.100.40");
  check(r.code === 200 && /already sent to this address several times/.test(r.json().message) && !r.json().already && w.sent.length === 5 && JSON.parse(w.st.m.get(pk)).confirmSends === 5,
    "subscribe row 8: after MAX_CONFIRMS_PER_ADDRESS confirmations, nothing more is sent and the reply says so");
  w = world({}, { count: 0 });
  await w.post({ email: "old@example.com" });
  const ok = subKeys(w)[0];
  const { confirmSends: _drop, ...older } = JSON.parse(w.st.m.get(ok));
  w.st.m.set(ok, JSON.stringify(older));
  w.tick(11 * MIN);
  r = await w.post({ email: "old@example.com" }, "198.51.100.41");
  check(r.body === OK && w.sent.length === 2 && JSON.parse(w.st.m.get(ok)).confirmSends === 2, "subscribe row 9: a record from before confirmSends counts as one and is re-sent");

  // row 10: the list cap
  w = world({ MAX_SUBSCRIBERS: "" }, { count: 0 });
  r = await w.post({ email: "a@example.com" });
  check(r.code === 503 && r.json().error === "subscriptions are not open yet" && w.logs.includes("subscribe not configured") && w.st.m.size === 1 && w.sent.length === 0,
    "subscribe row 10: MAX_SUBSCRIBERS unset is not set up: 503, not \"a link is on its way\"; nothing stored or sent");
  await putSubscriber(w.st, { ...newPending("b@example.com", { now: T0 - DAY, randomBytes: seeded(3) }), status: "active", confirmedAt: iso(T0 - DAY) });
  const known = await w.post({ email: "b@example.com" });
  check(known.code === r.code && known.body === r.body && w.sent.length === 0, "subscribe row 10: with MAX_SUBSCRIBERS unset, a subscribed address gets the identical 503");
  w = world({ MAX_SUBSCRIBERS: "abc" }, { count: 0 });
  r = await w.post({ email: "a@example.com" });
  check(r.code === 503 && subKeys(w).length === 0, "subscribe row 10: MAX_SUBSCRIBERS not a number is not set up either: 503");
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
  check(r.headers["cache-control"] === "no-store" && r.headers["x-robots-tag"] === "noindex" && r.headers["referrer-policy"] === "same-origin", "confirm: pages carry the no-store, noindex and same-origin referrer headers");
  check(!r.body.includes("@") && !r.body.includes("c.person"), "confirm GET: the page holds no address");

  r = await c.call("POST");
  const after = c.stored();
  check(r.code === 200 && r.body.includes("You&#39;re subscribed") && r.body.includes("05:47 IST") && r.body.includes('href="/live/"'), "confirm POST: the success page with the first-digest time and a link to /live/");
  check(after.status === "active" && after.confirmedAt === iso(T0) && after.token === c.rec.token && after.email === c.rec.email, "confirm POST: active, confirmedAt set, token not rotated");
  check(evCount(c.st, "confirmed") === 1 && !r.body.includes("@"), "confirm POST: a confirmed event written; the page holds no address");
  const eventsBefore = c.st.m.size;
  const r2 = await c.call("POST");
  check(r2.code === 200 && r2.body.includes("already subscribed") && !r2.body.includes("<form") && c.st.m.size === eventsBefore && c.stored().confirmedAt === iso(T0), "confirm POST twice: the second is a no-op that says \"You're already subscribed\"");
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
  check(!r.body.includes("@") && r.headers["cache-control"] === "no-store" && r.headers["referrer-policy"] === "same-origin", "unsubscribe GET: no address on the page; no-store and same-origin referrer");
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

  // Pro (T17): the account stays and only the emails stop
  const stored = (x) => JSON.parse(x.st.m.get("radar:sub:" + x.rec.id));
  u = await setup({ plan: "pro", proSource: "owner" });
  r = await u.call("GET");
  check(r.body.includes("Your Pro account stays") && r.body.includes('href="/manage/?id=') && r.body.includes('method="post"') && !r.body.includes("will be deleted"), "unsubscribe GET: a Pro is told the account stays, with the manage page linked");
  r = await u.call("POST");
  check(r.code === 200 && u.has() && stored(u).emailOff === "unsubscribed" && stored(u).plan === "pro" && r.body.includes("Your emails are off"), "unsubscribe POST: a Pro is kept with emailOff \"unsubscribed\"");
  check(events(u.st, "unsubscribed").length === 0 && events(u.st, "emailoff").length === 1 && JSON.parse(events(u.st, "emailoff")[0][1]).plan === "pro", "unsubscribe: a Pro records an emailoff event, not unsubscribed");
  r = await u.call("POST", { body: "List-Unsubscribe=One-Click" });
  check(r.code === 200 && r.body.includes("already off") && events(u.st, "emailoff").length === 1 && u.has(), "unsubscribe again: \"already off\", no second event");
  r = await u.call("GET");
  check(r.body.includes("already off") && !r.body.includes('method="post"'), "unsubscribe GET with emails off: no form, says they're already off");
  u = await setup({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * 24 * 3600 * 1000) });
  r = await u.call("POST", { body: "List-Unsubscribe=One-Click" });
  check(r.code === 200 && u.has() && stored(u).emailOff === "unsubscribed" && !r.body.includes("Cancel your Pro plan first"), "unsubscribe: a paid Razorpay Pro one-click POST turns emails off (no cancel-first page)");
  u = await setup({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 - 1000) });
  r = await u.call("GET");
  check(r.body.includes("will be deleted") && !r.body.includes("Pro account stays"), "unsubscribe GET: a lapsed Pro sees the Free page");
  await u.call("POST");
  check(!u.has() && JSON.parse(events(u.st, "unsubscribed")[0][1]).plan === "free", "unsubscribe: a lapsed Pro is deleted like Free");

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
    // Pro here is on 5 a day, so every scheduled sweep is one of its slots, as before T32; the
    // T32 block below tests the other choices.
    const addSub = async (n, { plan = "free", status = "active", proUntil = null, proSource = null, createdAt = t0, sweepsPerDay = plan === "pro" ? 5 : null } = {}) => {
      const rec = { ...newPending(`s${n}@example.com`, { now: createdAt, randomBytes: seeded(100 + n) }), token: "tok" + n, status, plan, proUntil, proSource, sweepsPerDay };
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
    SWEEPS_PER_DAY_MIN: "5", // every slot sweeps, with or without Pro members (the T32 block tests skipping)
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
    // Pro on 5 a day, so the 08:09 run (slot 05) sweeps and delivers, as before T32.
    const addSub = async (n, plan) => {
      const rec = { ...newPending(`s${n}@example.com`, { now: clock, randomBytes: seeded(100 + n) }), token: "tok" + n, status: "active", plan, proSource: plan === "pro" ? "owner" : null, sweepsPerDay: plan === "pro" ? 5 : null };
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
  // Razorpay is faked: each call is kept in adminRzp, and `rzpReply(url, init)` may answer instead of the usual reply.
  const adminRzp = [];
  let rzpReply = null;
  const ADMIN_RZP_ENV = { RAZORPAY_KEY_ID: "rzp_test_admin", RAZORPAY_KEY_SECRET: "admin-secret" };
  const adminFetch = async (url, init) => {
    adminRzp.push({ url, ...init });
    const given = rzpReply && rzpReply(url, init);
    if (given) return given;
    const id = url.split("/").at(url.endsWith("/cancel") ? -2 : -1);
    return { ok: true, status: 200, json: async () => ({ id, status: "cancelled" }) };
  };
  const run = async (st, argv, { now = T0, env = ADMIN_RZP_ENV } = {}) => {
    const out = []; const err = [];
    const code = await admin.main(argv, { storage: st, now, rb: seeded(70), out: (s) => out.push(s), err: (s) => err.push(s), env, fetchFn: adminFetch });
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
    // 10:09 UTC: slot 10, one of the default 2 a day (T32)
    const at10 = T0 + 2 * 3600_000;
    const sweep = { id: "1792570150123", at: iso(at10), problems: [{ id: "a", cat: "traveler_pain", title: "T", summary: "", source: "S", link: "https://example.com/a", region: "EU", date: "2026-10-20", severity: "High", opportunity: "", isNew: true }], perCat: {} };
    await deliverToSubscribers({ env: { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" },
      storage: w.st, fetchFn, now: () => at10, randomBytes: seeded(3), sweep, scheduled: true, log: () => {} });
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

  // delete and Razorpay (2026-10-27): every subscription is cancelled at once, then the record and its index go
  {
    const RZPSUB = "radar:rzpsub:";
    ({ st, mk } = await world());
    const rzp = (n, over) => ({ subscriptionId: "sub_ADMIN0000000" + n, status: "active", currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null, ...over });
    const paid = { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 9 * DAY) };
    const recs = [
      await mk(1, { ...paid, rzp: rzp(1) }),
      await mk(2, { ...paid, rzp: rzp(2, { cancelAtPeriodEnd: true }) }),
      await mk(3, { rzp: rzp(3, { status: "authenticated" }) }),
      await mk(4, { ...paid, proUntil: iso(T0 - DAY), rzp: rzp(4, { status: "cancelled" }) }),
    ];
    for (const x of recs) await st.set(RZPSUB + x.rzp.subscriptionId, JSON.stringify({ id: x.id }));
    adminRzp.length = 0;
    r = await run(st, ["delete", "p1@example.com"]);
    check(r.code === 1 && /would cancel Razorpay subscription sub_ADMIN00000001 at once and delete/.test(r.err) && st.m.has("radar:sub:" + recs[0].id) && adminRzp.length === 0,
      "delete without --yes on a renewing Pro: names the subscription it would cancel; nothing called or deleted");
    r = await run(st, ["delete", "p1@example.com", "--yes"]);
    check(r.code === 0 && adminRzp.length === 1 && adminRzp[0].url.endsWith("/subscriptions/sub_ADMIN00000001/cancel") && adminRzp[0].body === '{"cancel_at_cycle_end":false}'
      && !st.m.has("radar:sub:" + recs[0].id) && !st.m.has(RZPSUB + recs[0].rzp.subscriptionId) && /Razorpay subscriptions cancelled/.test(r.out),
      "delete --yes on a renewing Razorpay Pro: the subscription is cancelled at once, then record and index deleted");
    rzpReply = (url) => ({ ok: false, status: 500, json: async () => ({}) });
    r = await run(st, ["delete", "p3@example.com", "--yes"]);
    check(r.code === 1 && /Razorpay didn't cancel sub_ADMIN00000003/.test(r.err) && st.m.has("radar:sub:" + recs[2].id) && !/admin-secret/.test(r.all),
      "delete: Razorpay unreachable for a plan that could charge (authenticated): refused, nothing deleted, no key printed");
    r = await run(st, ["delete", "p3@example.com", "--yes"], { env: {} });
    check(r.code === 1 && st.m.has("radar:sub:" + recs[2].id), "delete: with no Razorpay keys in the shell, a plan that could charge is refused");
    rzpReply = null;
    r = await run(st, ["delete", "p2@example.com", "--yes"]);
    check(r.code === 0 && !st.m.has("radar:sub:" + recs[1].id) && !st.m.has(RZPSUB + recs[1].rzp.subscriptionId), "delete --yes on a Pro set to end: cancelled at once, record and index deleted");
    adminRzp.length = 0;
    r = await run(st, ["delete", "p4@example.com", "--yes"], { env: {} });
    check(r.code === 0 && adminRzp.length === 0 && !st.m.has("radar:sub:" + recs[3].id) && !st.m.has(RZPSUB + recs[3].rzp.subscriptionId),
      "delete --yes on a record whose plan is already over at Razorpay: no call needed, record and index deleted");
  }

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

  // recount
  ({ st, mk } = await world());
  await mk(1); await mk(2, { status: "pending", confirmedAt: null }); await mk(3, { plan: "pro", proSource: "owner", emailOff: "bounced" }); await mk(4, { status: "unsubscribed" });
  r = await run(st, ["recount"]);
  check(r.code === 1 && /none -> 3/.test(r.err) && /add --yes/.test(r.err) && !st.m.has(KEY_SUBSCRIBER_COUNT), "recount without --yes: reports the count, writes nothing");
  r = await run(st, ["recount", "--yes"]);
  const cnt = JSON.parse(st.m.get(KEY_SUBSCRIBER_COUNT));
  check(r.code === 0 && cnt.count === 3 && cnt.at === iso(T0) && Object.keys(cnt).sort().join() === "at,count", "recount --yes: writes {count, at} counting pending and active records (emails off too), like the sweep");
  st.m.set(KEY_SUBSCRIBER_COUNT, JSON.stringify({ count: 40, at: iso(T0 - DAY) }));
  r = await run(st, ["recount", "--yes"]);
  check(r.code === 0 && /40 -> 3/.test(r.out) && JSON.parse(st.m.get(KEY_SUBSCRIBER_COUNT)).count === 3, "recount --yes: corrects a stale count and says what it was");
  check(!/@|secret-token/.test(r.all), "recount: prints no address or token");
  {
    const st2 = memStorage();
    for (const [n, over] of [[1, {}], [2, { status: "pending", confirmedAt: null }], [3, { emailOff: "unsubscribed", plan: "pro", proSource: "owner" }]]) await putSubscriber(st2, { ...newPending(`c${n}@example.com`, { now: T0 - DAY, randomBytes: seeded(300 + n) }), token: "t" + n, status: "active", confirmedAt: iso(T0 - DAY), ...over });
    await admin.recount(st2, { apply: true, now: T0 });
    const mine = JSON.parse(st2.m.get(KEY_SUBSCRIBER_COUNT)).count;
    await deliverToSubscribers({ env: { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" }, storage: st2, fetchFn: async (u, init) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: JSON.parse(init.body).map((_, i) => ({ id: "m" + i })) }) }), now: () => T0, randomBytes: seeded(9), sweep: null, scheduled: true, log: () => {} });
    check(mine === 3 && JSON.parse(st2.m.get(KEY_SUBSCRIBER_COUNT)).count === mine, "recount: gives the same count a sweep writes");
  }

  // usage and failures
  const bads = [[], ["nope"], ["show"], ["show", "a@b.com", "extra"], ["show", "not an email"], ["stats", "--wat"], ["stats", "--yes"], ["grant-pro", "a@b.com", "--until"], ["list", "--plan"], ["recount", "extra"], ["recount", "--days", "3"]];
  const codes = [];
  for (const argv of bads) codes.push((await run(memStorage(), argv)).code);
  check(codes.every((c) => c === 2), `bad usage exits 2 (${codes.join(",")})`);
  const broken = memStorage();
  broken.list = async () => { throw new Error("blob down"); };
  r = await run(broken, ["stats"]);
  check(r.code === 1 && /blob down/.test(r.err), "a storage failure is reported with exit 1, not a stack trace");

  // the script is kept out of the deployment
  const ignored = readFileSync(new URL("../.vercelignore", import.meta.url), "utf8").split(/\r?\n/);
  check(ignored.includes("scripts/*") && ignored.filter((l) => l.startsWith("!scripts/")).every((l) => ["!scripts/fill-legal.mjs", "!scripts/fill-plan.mjs"].includes(l)),
    ".vercelignore keeps scripts/ (and so this tool) out of the deployment; only the build's fill-legal.mjs and fill-plan.mjs are let back in");
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

  // Payments on: the confirm page sends a ticked sign-up straight to the plan card to pay, and the owner isn't asked
  // to switch anything on.
  {
    const PAY = { RAZORPAY_KEY_ID: "rzp_test_Fixture000001", RAZORPAY_KEY_SECRET: "ks", RAZORPAY_WEBHOOK_SECRET: "wh", RAZORPAY_PLANS: JSON.stringify({ 1: "plan_00000000000001", 12: "plan_00000000000012" }), RAZORPAY_TOTAL_COUNT: "12" };
    const wp = world(PAY);
    await wp.subscribe({ email: "payer@example.com", wantsPro: "1", months: "12" });
    await wp.subscribe({ email: "maybe@example.com" });
    await wp.subscribe({ email: "odd@example.com", wantsPro: "1", months: "3" });
    await wp.subscribe({ email: "plainpick@example.com", months: "12" });
    const payer = await recOf(wp, "payer@example.com"), maybe = await recOf(wp, "maybe@example.com");
    check(JSON.stringify(payer.proRequest) === JSON.stringify({ cats: null, perDay: 2, months: 12 }) && !(await recOf(wp, "odd@example.com")).proRequest && !(await recOf(wp, "plainpick@example.com")).proRequest,
      "payments on: the period picked at sign-up is kept as the Pro request (a period not on sale, or no Pro box, keeps nothing)");
    const rp = await wp.confirm(payer);
    check(rp.code === 303 && rp.headers.location === managePath(payer.id, payer.token) + "&pay=1" && rp.headers["cache-control"] === "no-store",
      "payments on: confirming a ticked sign-up goes straight to the manage page with ?pay=1, to pay");
    check(evCount(wp, "prorequested") === 1 && wp.owner().length === 0, "payments on: the Pro request is counted, but the owner gets no email to switch it on");
    const rm = await wp.confirm(maybe);
    check(rm.code === 200 && rm.body.includes(`href="${esc(managePath(maybe.id, maybe.token) + "&pay=1")}"`) && /Upgrade to Pro/.test(rm.body) && !/Request Pro/.test(rm.body),
      "payments on: confirming without the box offers Upgrade to Pro, not Request Pro");
  }

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
  const hard = await w.add("hard@example.com");
  let r = keep(await w.send(bounce("Hard@Example.com")));
  check(r.code === 200 && r.json().ok === true && !(await getSubscriber(w.st, hard.id)), "webhook: a Permanent bounce deletes a Free record (address matched case-insensitively)");
  const bouncedEv = w.evs("bounced");
  check(bouncedEv.length === 1 && JSON.parse(w.st.m.get(bouncedEv[0])).plan === "free" && !w.st.m.get(bouncedEv[0]).includes("@"), "webhook: one 'bounced' event, with the plan and no address");
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
  // 10:09 UTC: slot 10, one of the default 2 a day, so these members (no choice made) get it (T32)
  const AT10 = T0 + 2 * 3600_000;
  const sweep = { id: "1792570150123", at: iso(AT10), problems, perCat: { traveler_pain: "2 items", gov_policy: "1 item", web_app: "1 item", industry: "failed: timeout" }, newCount: 2 };
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
    const out = await deliverToSubscribers({ env: DENV, storage: ds, fetchFn, now: () => AT10, randomBytes: seeded(9), sweep, scheduled: true, log: () => {} });
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

// ---- T32: each Pro member's emails a day. Delivery by slot, and POST /api/account set-freq
{
  const { makeAccountHandler } = await import("../api/_lib/subscription-handlers.js");
  const H = 3600_000;
  const DAY0 = Date.UTC(2026, 9, 21); // today, 00:00 UTC
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" };
  const prob = (id, cat = "traveler_pain") => ({ id, cat, title: "Item " + id, summary: "", source: "S", link: "https://example.com/" + id, region: "EU", date: "2026-10-20", severity: "Medium", opportunity: "", isNew: true });
  const world = async (members) => {
    const st = memStorage();
    for (const [i, m] of members.entries()) {
      await putSubscriber(st, {
        ...newPending(m.email, { now: DAY0 - 3 * 24 * H, randomBytes: seeded(500 + i) }), token: "tok" + i, status: "active",
        plan: "pro", proSource: "owner", cats: m.cats || null, sweepsPerDay: m.f ?? null,
      });
    }
    const calls = [];
    const fetchFn = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ key: init.headers["idempotency-key"], body });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) };
    };
    // A saved scheduled sweep at hour h of day d (0 today, -1 yesterday), 17 minutes into its slot.
    const save = (d, h, problems, { manual = false } = {}) => {
      const at = DAY0 + d * 24 * H + h * H + 17 * 60_000;
      const id = String(at);
      const slot = manual ? {} : { slot: Math.floor(h / 5) * 5, slotAt: iso(DAY0 + d * 24 * H + Math.floor(h / 5) * 5 * H) };
      const hist = JSON.parse(st.m.get("radar:history") || "[]");
      hist.push({ id, at: iso(at), total: problems.length, newCount: problems.length, ...slot, ...(manual ? { manual: true } : {}) });
      st.m.set("radar:history", JSON.stringify(hist));
      st.m.set("radar:sweep:" + id, JSON.stringify({ at: iso(at), ...slot, problems }));
      return { id, at: iso(at), ...slot, problems, perCat: { traveler_pain: problems.length + " items" } };
    };
    const deliver = async (sweep, env = {}) => {
      const from = calls.length;
      const out = await deliverToSubscribers({ env: { ...ENV, ...env }, storage: st, fetchFn, now: () => Date.parse(sweep.at) + 60_000, randomBytes: seeded(9), sweep, scheduled: true, log: () => {} });
      const mine = calls.slice(from);
      const to = (e) => mine.flatMap((c) => c.body).filter((m) => m.to[0] === e);
      return { out, keys: mine.map((c) => c.key), to };
    };
    return { st, save, deliver };
  };
  const has = (m, ids) => ids.every((id) => m.text.includes("Item " + id));
  const lacks = (m, ids) => ids.every((id) => !m.text.includes("Item " + id));

  const w = await world([{ email: "one@example.com", f: 1 }, { email: "two@example.com", f: 2 }, { email: "dflt@example.com" }, { email: "five@example.com", f: 5 }]);
  w.save(-1, 0, [prob("y00")]);
  w.save(-1, 5, [prob("y05")]);
  w.save(-1, 10, [prob("y10")]);
  w.save(-1, 15, [prob("y15")]);
  w.save(-1, 20, [prob("y20")]);
  w.save(-1, 21, [prob("man")], { manual: true });
  let d = await w.deliver(w.save(0, 0, [prob("t00")]));
  const one = d.to("one@example.com")[0];
  check(one && has(one, ["y05", "y10", "y15", "y20", "t00"]) && lacks(one, ["y00", "man"]), "T32 delivery: at slot 00, a 1-a-day member's roll-up has yesterday's 05 to 20 and today's 00, no manual run");
  const two = d.to("two@example.com")[0];
  check(two && has(two, ["y15", "y20", "t00"]) && lacks(two, ["y05", "y10", "man"]), "T32 delivery: at slot 00, a 2-a-day member gets everything since yesterday's slot 10");
  const five = d.to("five@example.com")[0];
  check(five && has(five, ["t00"]) && lacks(five, ["y20", "y15"]) && /· 1 problems, 1 new$/.test(five.subject), "T32 delivery: on the site's number (5), only this sweep, as before");
  check(d.to("dflt@example.com").length === 1 && d.to("dflt@example.com")[0].text.split("\n--\n")[0] === two.text.split("\n--\n")[0], "T32 delivery: no choice is 2 a day, and shares the 2-a-day body");
  check(d.keys.includes(`${d.keys[0].split("-")[0]}-pro-0`) && d.keys.some((k) => /-pro-f1-0$/.test(k)) && d.keys.some((k) => /-pro-f5-0$/.test(k)) && d.keys.length === 3,
    "T32 delivery: all categories on the default 2 keep the old key; 1 and 5 a day get -f1 and -f5");
  check(d.out.pro.slot === 0 && d.out.pro.sent === 4 && d.out.pro.notThisSlot === 0, "T32 delivery: slot 00 reaches every member");

  w.save(0, 5, [prob("t05")]);
  d = await w.deliver(w.save(0, 10, [prob("t10")]));
  check(d.to("one@example.com").length === 0 && d.out.pro.notThisSlot === 1, "T32 delivery: at slot 10, a 1-a-day member gets nothing, counted as notThisSlot");
  check(d.to("two@example.com").length === 1 && has(d.to("two@example.com")[0], ["t05", "t10"]) && lacks(d.to("two@example.com")[0], ["t00"]), "T32 delivery: at slot 10, 2 a day gets 05 and 10, not 00 (already sent)");
  check(d.to("five@example.com").length === 1 && has(d.to("five@example.com")[0], ["t10"]) && lacks(d.to("five@example.com")[0], ["t05"]), "T32 delivery: at slot 10, 5 a day gets only 10");
  check(d.out.pro.sent === 3 && d.out.pro.due === 4, "T32 delivery: the counts add up");

  // A sweep with no slot saved (from before T32) is placed by its time.
  const w2 = await world([{ email: "two@example.com", f: 2 }]);
  const old = w2.save(-1, 20, [prob("old")]);
  const hist = JSON.parse(w2.st.m.get("radar:history")).map(({ slot, slotAt, ...e }) => e);
  w2.st.m.set("radar:history", JSON.stringify(hist));
  const cur = w2.save(0, 0, [prob("cur")]);
  d = await w2.deliver({ id: cur.id, at: cur.at, problems: cur.problems, perCat: cur.perCat });
  check(old && d.to("two@example.com").length === 1 && has(d.to("two@example.com")[0], ["old", "cur"]), "T32 delivery: sweeps without a saved slot are placed by their time");

  // Categories and the number a day together, and the cap lowering a choice.
  const w3 = await world([{ email: "gov5@example.com", f: 5, cats: ["gov_policy"] }, { email: "gov3@example.com", f: 3, cats: ["gov_policy"] }]);
  w3.save(0, 10, [prob("g10", "gov_policy")]);
  d = await w3.deliver(w3.save(0, 15, [prob("g15", "gov_policy"), prob("t15")]));
  const g3 = d.to("gov3@example.com")[0];
  check(g3 && has(g3, ["g15"]) && lacks(g3, ["g10", "t15"]) && d.keys.some((k) => /-pro-gov_policy-f3-0$/.test(k)) && d.keys.some((k) => /-pro-gov_policy-f5-0$/.test(k)),
    "T32 delivery: categories and the number a day are grouped together, each with its own key");
  d = await w3.deliver(w3.save(0, 20, [prob("g20", "gov_policy")]), { SWEEPS_PER_DAY_MAX: "3" });
  check(d.to("gov5@example.com").length === 0 && d.to("gov3@example.com").length === 0 && d.out.pro.notThisSlot === 2, "T32 delivery: with SWEEPS_PER_DAY_MAX=3, a choice of 5 is treated as 3");

  // POST /api/account action set-freq
  const st = memStorage();
  const sent = [];
  const mk = (env) => makeAccountHandler({ env, storage: st, fetchFn: async (u, i) => { sent.push(i); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m" }) }; }, now: () => T0, randomBytes: seeded(4), log: () => {} });
  let acct = mk(ENV);
  const call = async (req) => { const res = mockRes(); await acct({ headers: { "content-type": "application/json" }, ...req }, res); return res; };
  const post = (rec, sweepsPerDay, t = rec.token) => call({ method: "POST", body: { id: rec.id, t, action: "set-freq", sweepsPerDay } });
  const add = async (email, over = {}) => {
    const r = { ...newPending(email, { now: T0 - 3600_000, randomBytes: seeded(600 + email.length) }), status: "active", confirmedAt: iso(T0 - 1800_000), ...over };
    await putSubscriber(st, r);
    return r;
  };
  const stored = async (rec) => (await getSubscriber(st, rec.id)).sweepsPerDay;
  const pro = await add("fpro@example.com", { plan: "pro", proSource: "owner" });
  const free = await add("ffree@example.com");
  const lapsed = await add("flapsed@example.com", { plan: "pro", proSource: "owner", proUntil: iso(T0 - 1000), sweepsPerDay: 4 });
  const pend = { ...newPending("fpend@example.com", { now: T0, randomBytes: seeded(650) }) };
  await putSubscriber(st, pend);
  const replies = [];

  let r = await call({ method: "GET", query: { id: pro.id, t: pro.token } });
  check(r.code === 200 && r.json().sweepsPerDay === null && r.json().sweepsPerDayDefault === 2 && r.json().sweepsPerDayMax === 5, "account GET: no choice is null, with the default 2 and the max 5");
  r = await post(pro, 3);
  replies.push(r.body);
  check(r.code === 200 && r.json().ok === true && r.json().sweepsPerDay === 3 && (await stored(pro)) === 3, "set-freq: a Pro member saves 3 and it is stored");
  r = await post(free, 3);
  replies.push(r.body);
  check(r.code === 403 && r.json().error === "pro_only" && (await stored(free)) === null, "set-freq: Free gets 403 pro_only and nothing is stored");
  r = await post(lapsed, 1);
  check(r.code === 403 && (await stored(lapsed)) === 4, "set-freq: a lapsed Pro gets 403 and keeps what they chose before");
  r = await post(pend, 2);
  check(r.code === 409 && r.json().error === "not_confirmed", "set-freq: a pending address gets 409 not_confirmed");
  for (const bad of [0, 6, 2.5, "3", null, undefined]) {
    r = await post(pro, bad);
    replies.push(r.body);
    check(r.code === 400 && r.json().error === "unknown frequency" && (await stored(pro)) === 3, `set-freq: ${JSON.stringify(bad) ?? "nothing"} is refused with 400 and nothing changes`);
  }
  acct = mk({ ...ENV, SWEEPS_PER_DAY_MAX: "3" });
  r = await post(pro, 4);
  check(r.code === 400 && r.json().error === "over the limit" && (await stored(pro)) === 3, "set-freq: above SWEEPS_PER_DAY_MAX is 400 over the limit");
  r = await call({ method: "GET", query: { id: pro.id, t: pro.token } });
  check(r.json().sweepsPerDayMax === 3 && r.json().sweepsPerDay === 3, "account GET: the max follows SWEEPS_PER_DAY_MAX");
  acct = mk({ ...ENV, SWEEPS_PER_DAY_MAX: "2" });
  r = await call({ method: "GET", query: { id: pro.id, t: pro.token } });
  check(r.json().sweepsPerDay === null && (await stored(pro)) === 3, "account GET: a stored choice above a lowered max shows as no choice, and stays stored");
  acct = mk(ENV);
  r = await post(pro, 2, "wrong-token");
  check(r.code === 404, "set-freq: a wrong token is 404");
  check(replies.every((b) => !b.includes("@") && !b.includes(pro.token)) && sent.length === 0, "set-freq: no address or token in any reply, and no email sent");
  check(newPending("x@example.com", { now: T0, randomBytes: seeded(3) }).sweepsPerDay === null, "newPending: sweepsPerDay starts as null (the default)");
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
  await putSubscriber(w.st, { ...w.rec, confirmSentAt: iso(T0 - 5 * 60 * 1000) });
  r = await w.post({ email: "m.e@gmail.com" });
  check(r.json().message === "A confirmation link was sent to this address in the last 10 minutes. Check your inbox and spam or junk folder. Nothing there after 10 minutes? Ask again here." && !r.json().already && w.sent.length === 0,
    "pending: a confirmation sent within 10 minutes is mentioned; nothing is sent");

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
  const { SESSION_HOURS, clearCookie, originOk, parseCookies, readSession, sessionCookie, signSession } = await import("../api/_lib/session.js");
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
  const REPLY = "If that address has an account, a sign-in link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder. You can ask for a new link once every 5 minutes.";

  // the cookie on its own
  {
    const w = await world();
    const value = signSession(w.rec, { secret: SECRET, now: T0 });
    const read = (v, { now = T0, env = w.env } = {}) => readSession({ headers: { cookie: `other=1; tpr_session=${v}` } }, { env, storage: w.st, now });
    check((await read(value))?.id === w.rec.id, "cookie: a valid one gives the record");
    const [id, exp, ver, sig] = value.split(".");
    check(await read(`${id}.${exp}.${ver}.${(sig[0] === "A" ? "B" : "A") + sig.slice(1)}`) === null, "cookie: a changed signature is refused");
    check(await read(`${id}.${Number(exp) + 999}.${ver}.${sig}`) === null && await read(`${id}.${exp}.1.${sig}`) === null, "cookie: a changed expiry or version is refused");
    check(await read(value, { now: T0 + SESSION_HOURS * HOUR + 1000 }) === null && await read(value, { now: T0 + (SESSION_HOURS - 1) * HOUR }) !== null, `cookie: refused after ${SESSION_HOURS} hours, accepted before`);
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
    check(sessionCookie("v") === "tpr_session=v; Path=/; HttpOnly; Secure; SameSite=Lax" && /^tpr_session=; Max-Age=0; .*HttpOnly; Secure; SameSite=Lax$/.test(clearCookie()),
      "cookie: HttpOnly, Secure, SameSite=Lax, Path=/, no Max-Age (ends when the browser closes); sign-out sets Max-Age=0");
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

    // never confirmed: the confirmation link again, on sign-up's limits (account-flows #5)
    w = await world({}, { status: "pending" });
    r = await w.ask("me@gmail.com");
    let p = await w.now();
    check(r.json().message === REPLY && w.sent.length === 1 && w.sent[0].to[0] === "me@gmail.com" && w.sent[0].text.includes(`https://site.example/api/confirm?id=${w.rec.id}&t=tok-secret-1`) && !p.signin,
      "sign-in request: an address never confirmed (last link over 10 minutes ago) gets the same reply and its confirmation link again, not a sign-in link");
    check(p.confirmSentAt === iso(T0) && p.confirmSends === 2 && p.status === "pending" && w.evs("confirmsent").length === 1 && w.evs("subscribed").length === 0 && w.evs("signinsent").length === 0,
      "sign-in request: the re-send moves confirmSentAt and counts as confirmsent");
    r = await w.call("conf", { method: "POST", body: { id: w.rec.id, t: "tok-secret-1" } });
    check(r.code === 200 && cookieOf(r) && (await w.now()).status === "active", "sign-in request: confirming that link activates the account and signs the browser in");
    w = await world({}, { status: "pending" });
    await w.ask("me@gmail.com");
    w.tick(9 * 60 * 1000);
    r = await w.ask("me@gmail.com");
    check(r.json().message === REPLY && w.sent.length === 1, "sign-in request: a never-confirmed address gets at most one confirmation every 10 minutes");
    w = await world({}, { status: "pending" });
    await putSubscriber(w.st, { ...w.rec, confirmSends: 5 });
    r = await w.ask("me@gmail.com");
    check(r.json().message === REPLY && w.sent.length === 0, "sign-in request: after MAX_CONFIRMS_PER_ADDRESS confirmations, no more are sent and the reply is the same");
    w = await world({ MAX_CONFIRMS_PER_DAY: "1" }, { status: "pending" });
    await w.st.set(`radar:event:${utcDay(T0)}-000000000-confirmsent-aaaaaa`, "{}");
    r = await w.ask("me@gmail.com");
    check(r.json().message === REPLY && w.sent.length === 0 && (await w.now()).confirmSentAt === w.rec.confirmSentAt, "sign-in request: MAX_CONFIRMS_PER_DAY reached, no confirmation re-sent and nothing stored");
    w = await world();
    r = await w.ask("me@gmail.com", { body: { website: "bot" } });
    check(r.json().message === REPLY && w.sent.length === 0, "sign-in request: the honeypot gets the usual reply and no email");
    r = await w.ask("not-an-address");
    check(r.code === 400, "sign-in request: a malformed address is a 400");
    w = await world({ MAX_SIGNINS_PER_DAY: "1" });
    await w.st.set(`radar:event:${utcDay(T0)}-000000000-signinsent-aaaaaa`, "{}");
    r = await w.ask("me@gmail.com");
    const CAPPED = "Sign-in emails have hit today's limit. Try again after 00:00 UTC, or use the Manage link in any digest.";
    check(r.code === 200 && r.json().message === CAPPED && w.sent.length === 0, "sign-in request: MAX_SIGNINS_PER_DAY reached says so (not \"a link is on its way\") and sends no email");
    const stranger = await w.ask("nobody@example.com");
    check(stranger.code === r.code && stranger.body === r.body, "sign-in request: the day's limit reply is identical for an address with no account");
    w = await world({ MAX_SIGNINS_PER_DAY: "1" }, { status: "pending" });
    await w.st.set(`radar:event:${utcDay(T0)}-000000000-signinsent-aaaaaa`, "{}");
    r = await w.ask("me@gmail.com");
    check(r.json().message === CAPPED && w.sent.length === 0, "sign-in request: the day's limit is checked before the lookup, so a pending address gets the same reply");
    w = await world({ MAX_SIGNINS_PER_DAY: "0" });
    r = await w.ask("me@gmail.com");
    check(w.sent.length === 0 && r.json().message === CAPPED, "sign-in request: MAX_SIGNINS_PER_DAY=0 sends none, with the limit reply");
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
    check(JSON.stringify(await w.now()) === JSON.stringify(before) && r.headers["cache-control"] === "no-store" && r.headers["referrer-policy"] === "same-origin", "sign-in link: GET changes nothing; the page isn't cached and sends no Referer to other sites");
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
    // A forwarded digest carries the same id and token: on an active record they never sign anyone in.
    r = await w.call("conf", { method: "POST", body: { id: w.rec.id, t: "tok-secret-1" } });
    check(r.code === 200 && !r.headers["set-cookie"] && /already subscribed/.test(r.body) && /href="\/signin\/"/.test(r.body),
      "confirm: once active, POSTing the digest's id and token sets no cookie and points to sign-in");
    w = await world();
    r = await w.call("conf", { method: "POST", body: { id: w.rec.id, t: "tok-secret-1" } });
    check(r.code === 200 && !r.headers["set-cookie"] && (await w.now()).status === "active", "confirm: an account confirmed long ago can't be signed into with its digest token");
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
    check(r.code === 200 && r.body === '{"signedIn":false,"plan":null,"google":false}', "me: not signed in; no Google sign-in set up");
    r = await w.call("sess", { query: { action: "me" }, cookie });
    check(r.code === 200 && r.body === '{"signedIn":true,"plan":"free","google":false}', "me: signed in, Free, and nothing else");
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

  // "Continue with Google" (account-flows.md, the Google row). Google's token endpoint is faked: it
  // answers with an ID token for `claims`, by default a verified me@gmail.com with this attempt's nonce.
  {
    const { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, OAUTH_MINUTES, readOAuthCookie, readSignupCookie, signupCookie } = await import("../api/_lib/google.js");
    const { ipHitPrefix } = await import("../api/_lib/subscription-handlers.js");
    const { createHash } = await import("node:crypto");
    const GENV = { ...ENV, EMAIL_TO: "owner@example.com", GOOGLE_CLIENT_ID: "cid-1.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret-xyz" };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const gw = async ({ envOver = {}, status = "active", existing = true, claims = {}, tokenStatus = 200 } = {}) => {
      const st = memStorage();
      const rec = { ...newPending("me@gmail.com", { now: T0 - 48 * HOUR, randomBytes: seeded(11) }), token: "tok-secret-1", status, confirmedAt: status === "active" ? iso(T0 - 47 * HOUR) : null };
      if (existing) await putSubscriber(st, rec);
      const w = { st, rec, sent: [], logs: [], tokenCalls: [], clock: T0 };
      const fetchFn = async (url, init) => {
        if (url === GOOGLE_TOKEN_URL) {
          w.tokenCalls.push(Object.fromEntries(new URLSearchParams(init.body)));
          const idc = { iss: "https://accounts.google.com", aud: GENV.GOOGLE_CLIENT_ID, exp: Math.floor(w.clock / 1000) + 3600, nonce: w.nonce, email: "me@gmail.com", email_verified: true, ...claims };
          return { ok: tokenStatus === 200, status: tokenStatus, json: async () => ({ id_token: `h.${b64(idc)}.sig`, access_token: "at-secret" }) };
        }
        w.sent.push(JSON.parse(init.body));
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m0" }) };
      };
      w.env = { ...GENV, ...envOver };
      const sess = makeSessionHandler({ env: w.env, storage: st, fetchFn, now: () => w.clock, randomBytes: seeded(7), log: (...a) => w.logs.push(a.join(" ")) });
      w.call = async (query, { cookie, ip = "203.0.113.9", method = "GET", body, origin } = {}) => {
        const res = mockRes();
        const headers = { host: "site.example", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(origin ? { origin, "content-type": "application/json" } : {}) };
        await sess({ method, headers, query: method === "GET" ? query : {}, body }, res);
        return res;
      };
      // Off to Google: remembers the state, nonce and cookie the redirect carried.
      w.start = async (query = {}) => {
        const r = await w.call({ action: "google", ...query });
        if (r.code === 302) {
          const u = new URL(r.headers.location);
          w.state = u.searchParams.get("state");
          w.nonce = u.searchParams.get("nonce");
          w.cookie = r.headers["set-cookie"].split(";")[0];
        }
        return r;
      };
      // Back from Google with a code (or `query` instead).
      w.back = async (query, opts = {}) => {
        const r = await w.call(query || { state: w.state, code: "code-1" }, { cookie: w.cookie, ...opts });
        if (r.code === 200 && typeof r.headers["set-cookie"] === "string") w.step2 = r.headers["set-cookie"].split(";")[0];
        return r;
      };
      // The Create account button on that page.
      w.create = (fields = {}, { origin = "https://site.example" } = {}) =>
        w.call({}, { method: "POST", body: { action: "google-signup", ...fields }, cookie: w.step2, origin });
      w.now = () => getSubscriber(st, rec.id);
      w.evs = (type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
      return w;
    };
    const sessionOf = (r) => { const c = [].concat(r.headers["set-cookie"] || []).find((s) => /^tpr_session=[^;]/.test(s)); return c ? c.split(";")[0] : ""; };
    const clearsOAuth = (r) => [].concat(r.headers["set-cookie"] || []).some((s) => /^tpr_oauth=; Max-Age=0; Path=\/api\/session; HttpOnly; Secure; SameSite=Lax$/.test(s));
    const signedInAs = async (w, r) => (await readSession({ headers: { cookie: sessionOf(r) } }, { env: w.env, storage: w.st, now: w.clock }))?.id;

    // set up or not
    let w = await gw();
    let r = await w.call({ action: "me" });
    check(r.json().google === true, "google: me says google:true when the client id and secret, SESSION_SECRET and the site URL are set");
    for (const [over, label] of [[{ GOOGLE_CLIENT_ID: "" }, "no client id"], [{ GOOGLE_CLIENT_SECRET: " " }, "no client secret"], [{ SESSION_SECRET: "" }, "no SESSION_SECRET"], [{ SITE_URL: "" }, "no site URL"]]) {
      w = await gw({ envOver: over });
      const me = await w.call({ action: "me" });
      const s = await w.start();
      const b = await w.call({ state: "x", code: "y" });
      check(me.json().google === false && s.code === 503 && b.code === 503 && !s.headers["set-cookie"] && /isn(&#39;|')t set up yet/.test(s.body) && w.tokenCalls.length === 0,
        `google: ${label} gives google:false, and the start and return are a 503 page`);
    }
    w = await gw({ envOver: { SUBSCRIPTIONS_ENABLED: "0" } });
    r = await w.start();
    check(r.code === 503 && /paused/.test(r.body) && !r.headers["set-cookie"], "google: subscriptions switched off, a 503 page");

    // the start
    w = await gw();
    r = await w.start();
    const u = new URL(r.headers.location);
    const p = Object.fromEntries(u.searchParams);
    const [cState, cNonce, cVerifier, cPro, cExp] = w.cookie.slice("tpr_oauth=".length).split(".");
    check(r.code === 302 && r.headers.location.startsWith(GOOGLE_AUTH_URL + "?") && r.headers["cache-control"] === "no-store", "google start: a 302 to Google, not cached");
    check(p.client_id === GENV.GOOGLE_CLIENT_ID && p.redirect_uri === "https://site.example/api/session" && p.response_type === "code" && p.scope === "openid email" && p.prompt === "select_account",
      "google start: our client id, the /api/session redirect, the code flow, openid email only, and the account picker every time");
    check(p.state.length === 43 && p.nonce.length === 43 && p.state !== p.nonce && p.code_challenge_method === "S256" && p.code_challenge === createHash("sha256").update(cVerifier).digest("base64url"),
      "google start: a random state and nonce, and a PKCE S256 challenge of the cookie's verifier");
    check(!r.headers.location.includes("gsecret") && !r.headers.location.includes(cVerifier), "google start: the client secret and the verifier stay off the URL");
    check(cState === p.state && cNonce === p.nonce && cPro === "0" && Number(cExp) === Math.floor(T0 / 1000) + OAUTH_MINUTES * 60
      && new RegExp(`^tpr_oauth=[^;]+; Max-Age=${OAUTH_MINUTES * 60}; Path=/api/session; HttpOnly; Secure; SameSite=Lax$`).test(r.headers["set-cookie"]),
      "google start: the cookie holds this state, nonce and verifier for 10 minutes; HttpOnly, Secure, Lax, only sent to /api/session");
    const value = w.cookie.slice("tpr_oauth=".length);
    const ro = (v, state, now = T0) => readOAuthCookie(v, state, { secret: SECRET, now });
    check(ro(value, p.state)?.verifier === cVerifier && ro(value, p.state).pro === false, "google cookie: read back with its state");
    check(ro(value, "x".repeat(43)) === null && ro(value, undefined) === null, "google cookie: refused for another state");
    check(ro(value.replace(/\.0\./, ".1."), p.state) === null && ro(value.slice(0, -1) + (value.endsWith("A") ? "B" : "A"), p.state) === null, "google cookie: a changed Pro flag or signature is refused");
    check(ro(value, p.state, T0 + OAUTH_MINUTES * 60_000) === null && ro(value, p.state, T0 + OAUTH_MINUTES * 60_000 - 1000) !== null, "google cookie: refused after 10 minutes");
    check(readOAuthCookie(value, p.state, { secret: "another-secret-of-enough-length-000", now: T0 }) === null && ro("", p.state) === null && ro("a.b", p.state) === null,
      "google cookie: one signed with another secret, or a malformed one, is refused");
    await w.start({ pro: "1" });
    check(w.cookie.split(".")[3] === "1", "google start: ?pro=1 (the sign-up tab's Pro box) is kept in the cookie");

    // back from Google: an existing account
    w = await gw();
    await w.start();
    let before = JSON.stringify(await w.now());
    r = await w.back();
    check(r.code === 303 && r.headers.location === "/live/" && r.headers["cache-control"] === "no-store" && await signedInAs(w, r) === w.rec.id && clearsOAuth(r),
      "google return: an existing account is signed in, sent to /live/, and the attempt's cookie cleared");
    check(/^tpr_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax$/.test(r.headers["set-cookie"][0]), "google return: the usual login cookie, ending when the browser closes");
    const tc = w.tokenCalls[0];
    check(w.tokenCalls.length === 1 && tc.code === "code-1" && tc.code_verifier === w.cookie.split(".")[2] && tc.client_id === GENV.GOOGLE_CLIENT_ID && tc.client_secret === "gsecret-xyz"
      && tc.redirect_uri === "https://site.example/api/session" && tc.grant_type === "authorization_code", "google return: swaps the code once, with the verifier, client secret and the same redirect URI");
    check(JSON.stringify(await w.now()) === before && w.sent.length === 0 && w.evs("confirmed").length === 0, "google return: an existing account is unchanged; no email, no events");
    w = await gw();
    await w.start({ pro: "1" });
    r = await w.back();
    check(r.code === 303 && !(await w.now()).proRequestedAt && w.sent.length === 0, "google return: the Pro box doesn't touch an existing account");
    w = await gw({ claims: { email: "M.E+trip@googlemail.com" } });
    await w.start();
    r = await w.back();
    check(await signedInAs(w, r) === w.rec.id, "google return: the address is matched the usual way (dots, +tags, googlemail)");

    // a new address: the return only shows "Create your account"; nothing exists until its button
    w = await gw({ existing: false, claims: { email: "new@example.com" } });
    await w.start();
    r = await w.back();
    const step2 = [].concat(r.headers["set-cookie"] || []);
    check(r.code === 200 && /<h1>Create your account<\/h1>/.test(r.body) && r.body.includes("<b>new@example.com</b>") && /name="action" value="google-signup"/.test(r.body)
      && /<input type="checkbox" name="wantsPro" value="1">/.test(r.body) && r.body.includes('<a href="/">Cancel</a>') && r.headers["cache-control"] === "no-store",
      "google return: a new address gets the Create your account page (its address, the Pro box unticked, Create account and Cancel)");
    check(!sessionOf(r) && step2.length === 1 && /^tpr_oauth=[^;]+; Max-Age=600; Path=\/api\/session; HttpOnly; Secure; SameSite=Lax$/.test(step2[0]) && readSignupCookie(step2[0].split(";")[0].slice(10), { secret: w.env.SESSION_SECRET, now: T0 }) === "new@example.com",
      "google return: no login yet; the cookie now holds the verified address for 10 minutes");
    check((await w.st.list("radar:sub:")).length === 0 && w.evs("subscribed").length === 0 && (await w.st.list(KEY_IPHIT_PREFIX)).length === 0 && w.sent.length === 0,
      "google return: nothing stored, counted or sent before Create account (Cancel leaves nothing behind)");
    r = await w.create();
    const made = await getSubscriber(w.st, subscriberId("new@example.com"));
    check(r.code === 303 && r.headers.location === "/live/" && made && await signedInAs(w, r) === made.id && clearsOAuth(r), "google sign-up: Create account makes the account, signs in and clears tpr_oauth");
    check(made.status === "active" && made.plan === "free" && made.confirmedAt === iso(T0) && made.createdAt === iso(T0) && made.confirmSentAt === null && made.confirmSends === 0 && !made.proRequestedAt && made.token.length > 20,
      "google sign-up: the new account is Free and active at once, with no confirmation sent");
    check(w.sent.length === 0 && w.evs("subscribed").length === 1 && w.evs("confirmed").length === 1 && w.evs("confirmsent").length === 0 && (await w.st.list(KEY_IPHIT_PREFIX)).length === 1,
      "google sign-up: no email; subscribed and confirmed events; counts toward the per-IP limit");
    r = await w.create();
    check(r.code === 303 && await signedInAs(w, r) === made.id && (await w.st.list("radar:sub:")).length === 1 && w.evs("subscribed").length === 1 && w.evs("confirmed").length === 1,
      "google sign-up: a second press just signs in; no second account or events");
    w = await gw({ existing: false, claims: { email: "new@example.com" } });
    await w.start({ pro: "1" });
    r = await w.back();
    check(/<input type="checkbox" name="wantsPro" value="1" checked>/.test(r.body), "google return: the Pro box ticked before Google comes ticked on the page");
    await w.create({ wantsPro: "1" });
    const pro = await getSubscriber(w.st, subscriberId("new@example.com"));
    check(pro.proRequestedAt === iso(T0) && pro.plan === "free" && w.evs("prorequested").length === 1 && w.sent.length === 1 && w.sent[0].to.includes("owner@example.com") && !JSON.stringify(w.sent[0]).includes("new@example.com"),
      "google sign-up: with the Pro box, the request is recorded and the owner emailed (naming nobody)");
    w = await gw({ existing: false, claims: { email: "new@example.com" } });
    await w.start({ pro: "1" });
    await w.back();
    await w.create();
    check(!(await getSubscriber(w.st, subscriberId("new@example.com"))).proRequestedAt && w.sent.length === 0, "google sign-up: Pro unticked on the page means no Pro request");
    const PAY = { RAZORPAY_KEY_ID: "rzp_test_Fixture000001", RAZORPAY_KEY_SECRET: "ks", RAZORPAY_WEBHOOK_SECRET: "wh", RAZORPAY_PLANS: JSON.stringify({ 1: "plan_00000000000001", 12: "plan_00000000000012" }), RAZORPAY_TOTAL_COUNT: "12" };
    w = await gw({ existing: false, claims: { email: "new@example.com" }, envOver: PAY });
    await w.start({ pro: "1" });
    await w.back();
    r = await w.create({ wantsPro: "1" });
    check(r.code === 303 && r.headers.location === "/manage/?pay=1" && w.evs("prorequested").length === 1 && w.sent.length === 0,
      "google sign-up with payments on: Pro ticked goes straight to the plan card to pay (/manage/?pay=1), no owner email");
    w = await gw({ existing: false, claims: { email: "new@example.com" }, envOver: PAY });
    await w.start();
    await w.back();
    check((await w.create()).headers.location === "/live/", "google sign-up with payments on: Pro unticked still goes to the board");
    w = await gw({ envOver: PAY });
    await putSubscriber(w.st, { ...w.rec, proRequestedAt: iso(T0 - 47 * HOUR) });
    await w.start();
    r = await w.back();
    check(r.code === 303 && r.headers.location === "/live/" && await signedInAs(w, r) === w.rec.id,
      "google return with payments on: an existing account that once ticked Pro and never paid goes to the board, not the plan card");
    w = await gw({ envOver: PAY, status: "pending" });
    await putSubscriber(w.st, { ...w.rec, proRequestedAt: iso(T0 - 48 * HOUR) });
    await w.start();
    r = await w.back();
    check(r.code === 303 && r.headers.location === "/manage/?pay=1" && (await w.now()).status === "active",
      "google return with payments on: a pending sign-up with Pro ticked is confirmed and goes to the plan card to pay");

    // Create account refused: an error page, no login, nothing stored
    const refusedSignup = async (label, { setup = {}, prep, origin = "https://site.example", code = 400, page }) => {
      const x = await gw({ existing: false, claims: { email: "new@example.com" }, ...setup });
      await x.start();
      await x.back();
      if (prep) await prep(x);
      const rr = await x.create({}, { origin });
      const ok = rr.code === code && !sessionOf(rr) && page.test(rr.body) && (await x.st.list("radar:sub:")).length === 0 && !x.logs.some((l) => /@/.test(l));
      check(ok, `google sign-up refused: ${label}`);
    };
    await refusedSignup("no cookie (another browser)", { prep: (x) => { x.step2 = ""; }, page: /sign-up didn(&#39;|')t finish/ });
    await refusedSignup("a changed cookie", { prep: (x) => { x.step2 = x.step2.slice(0, -1) + (x.step2.endsWith("A") ? "B" : "A"); }, page: /sign-up didn(&#39;|')t finish/ });
    await refusedSignup("a cookie with another address put in", { prep: (x) => { x.step2 = x.step2.replace(/=[^.]+/, "=" + Buffer.from("evil@example.com").toString("base64url")); }, page: /sign-up didn(&#39;|')t finish/ });
    await refusedSignup("after 10 minutes", { prep: (x) => { x.clock += OAUTH_MINUTES * 60_000; }, page: /sign-up didn(&#39;|')t finish/ });
    await refusedSignup("signed with another secret", { prep: (x) => { x.step2 = "tpr_oauth=" + signupCookie({ email: "new@example.com", secret: "another-secret-0123456789abcdef", now: x.clock }).split(";")[0].slice(10); }, page: /sign-up didn(&#39;|')t finish/ });
    await refusedSignup("the first step's cookie instead", { prep: (x) => { x.step2 = x.cookie; }, page: /sign-up didn(&#39;|')t finish/ });
    await refusedSignup("a POST from another site", { origin: "https://evil.example", code: 403, page: /wrong_origin/ });
    await refusedSignup("subscriptions switched off meanwhile", { prep: (x) => { x.env.SUBSCRIPTIONS_ENABLED = "0"; }, code: 503, page: /paused/ });
    // a pending address
    w = await gw({ status: "pending" });
    await w.start({ pro: "1" });
    r = await w.back();
    const act = await w.now();
    check(r.code === 303 && await signedInAs(w, r) === w.rec.id && act.status === "active" && act.confirmedAt === iso(T0) && act.token === "tok-secret-1" && act.createdAt === w.rec.createdAt,
      "google return: a never-confirmed address is activated (Google proved it) and signed in; token and createdAt kept");
    check(w.evs("confirmed").length === 1 && w.evs("subscribed").length === 0 && act.proRequestedAt === iso(T0) && w.sent.length === 1, "google return: confirmed is counted; the Pro box counts for it");
    w = await gw({ status: "pending" });
    await putSubscriber(w.st, { ...w.rec, pendingPw: { alg: "scrypt", N: 16384, r: 8, p: 1, salt: "c2FsdA", hash: "aGFzaA", k: "0".repeat(64) } });
    await w.start();
    r = await w.back();
    check(r.code === 303 && (await w.now()).status === "active" && !("pendingPw" in await w.now()) && !("pw" in await w.now()),
      "google return: a password typed in at sign-up isn't turned on (only its own confirmation link does that) and is dropped");

    // refused returns: an error page, no login cookie, nothing stored
    const refused = async (label, { setup = {}, prep, query, code = 400, page, tokenCalls = 1, link = true } = {}) => {
      const x = await gw({ existing: false, ...setup });
      await x.start();
      if (prep) await prep(x);
      const rr = await x.back(query && query(x));
      const ok = rr.code === code && !sessionOf(rr) && clearsOAuth(rr) && page.test(rr.body) && rr.body.includes('href="/signin/"') === link && (await x.st.list("radar:sub:")).length === 0
        && x.tokenCalls.length === tokenCalls && !x.logs.some((l) => /@|code-1|at-secret|gsecret/.test(l));
      check(ok, `google return refused: ${label}`);
      return x;
    };
    await refused("cancelled at Google", { query: (x) => ({ state: x.state, error: "access_denied" }), page: /was cancelled/, tokenCalls: 0 });
    await refused("no cookie (another browser)", { prep: (x) => { x.cookie = ""; }, page: /didn(&#39;|')t finish/, tokenCalls: 0 });
    await refused("a state that isn't this attempt's", { query: () => ({ state: "s".repeat(43), code: "code-1" }), page: /didn(&#39;|')t finish/, tokenCalls: 0 });
    await refused("a changed cookie", { prep: (x) => { x.cookie = x.cookie.slice(0, -1) + (x.cookie.endsWith("A") ? "B" : "A"); }, page: /didn(&#39;|')t finish/, tokenCalls: 0 });
    await refused("after 10 minutes", { prep: (x) => { x.clock += OAUTH_MINUTES * 60_000; }, page: /longer than 10 minutes/, tokenCalls: 0 });
    await refused("no code", { query: (x) => ({ state: x.state }), page: /didn(&#39;|')t finish/, tokenCalls: 0 });
    const ex = await refused("Google refuses the code (a 502)", { setup: { tokenStatus: 400 }, code: 502, page: /didn(&#39;|')t work/ });
    check(ex.logs.join("|") === "session google exchange", "google return: a failed swap is logged by kind only");
    await refused("an ID token from another issuer", { setup: { claims: { iss: "https://evil.example" } }, page: /didn(&#39;|')t work/ });
    await refused("an ID token for another app", { setup: { claims: { aud: "other.apps.googleusercontent.com" } }, page: /didn(&#39;|')t work/ });
    await refused("an ID token with another nonce", { setup: { claims: { nonce: "n".repeat(43) } }, page: /didn(&#39;|')t work/ });
    await refused("an expired ID token", { setup: { claims: { exp: Math.floor(T0 / 1000) - 1 } }, page: /didn(&#39;|')t work/ });
    await refused("an address Google hasn't verified", { setup: { claims: { email_verified: false } }, page: /hasn(&#39;|')t verified this address/ });
    await refused("an ID token with no usable address", { setup: { claims: { email: "not-an-address" } }, page: /didn(&#39;|')t work/ });
    w = await gw({ status: "active" });
    await w.start();
    const used = await w.back();
    r = await w.back();
    check(sessionOf(used) && r.code === 303 && w.tokenCalls.length === 2, "google return: a replayed return just asks Google again (Google refuses a used code; see the 502 case)");

    // limits on new accounts
    await refused("a full list (MAX_SUBSCRIBERS): no Create account page", { link: false, code: 503, page: /closed for now/, prep: (x) => x.st.set(KEY_SUBSCRIBER_COUNT, JSON.stringify({ count: 5000 })) });
    await refused("an unreadable count counts as full", { link: false, code: 503, page: /closed for now/, prep: (x) => x.st.set(KEY_SUBSCRIBER_COUNT, "garbage") });
    await refusedSignup("the list filled up before Create account", { prep: (x) => x.st.set(KEY_SUBSCRIBER_COUNT, JSON.stringify({ count: 5000 })), code: 503, page: /closed for now/ });
    await refused("MAX_SUBSCRIBERS unset: not open yet, no Create account page", { setup: { envOver: { MAX_SUBSCRIBERS: "" } }, link: false, code: 503, page: /Subscriptions are not open yet/ });
    await refusedSignup("MAX_SUBSCRIBERS unset at Create account", { prep: (x) => { x.env.MAX_SUBSCRIBERS = ""; }, code: 503, page: /Subscriptions are not open yet/ });
    await refusedSignup("the per-IP hourly limit (shared with sign-up)", { setup: { envOver: { MAX_SIGNUPS_PER_IP_HOUR: "1" } }, code: 429, page: /Too many new accounts/,
      prep: (x) => x.st.set(ipHitPrefix("203.0.113.9", T0) + "aaaaaa", "{}") });
    w = await gw({ envOver: { MAX_SIGNUPS_PER_IP_HOUR: "1" } });
    await w.st.set(ipHitPrefix("203.0.113.9", T0) + "aaaaaa", "{}");
    await w.start();
    r = await w.back();
    check(r.code === 303 && sessionOf(r), "google return: an existing account signs in whatever the per-IP limit");
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

// ---- T17: the locked board (BOARD_PAYWALL), a Pro account outlives its emails, Delete my account
{
  const { signSession } = await import("../api/_lib/session.js");
  const SECRET = "test-session-secret-0123456789abcdef";
  const DAY = 24 * 3600 * 1000;

  // /api/data with the switch off and on
  {
    const sweeps = memStorage();
    sweeps.m.set("radar:history", "[1]");
    sweeps.m.set("radar:sweep:1800000000000", "{\"a\":1}");
    const accounts = memStorage();
    const mk = async (email, over) => {
      const r = { ...newPending(email, { now: T0 - 2 * DAY, randomBytes: seeded(email.length) }), status: "active", confirmedAt: iso(T0 - DAY), ...over };
      await putSubscriber(accounts, r);
      return r;
    };
    const free = await mk("free@example.com", {});
    const pro = await mk("pro@example.com", { plan: "pro", proSource: "owner" });
    const lapsed = await mk("lapsed@example.com", { plan: "pro", proSource: "owner", proUntil: iso(T0 - DAY) });
    const cookie = (r, { secret = SECRET, at = T0 } = {}) => `tpr_session=${signSession(r, { secret, now: at })}`;
    const on = { BOARD_PAYWALL: "1", SESSION_SECRET: SECRET };
    const call = async (env, { key = "radar:history", c, method = "GET", h } = {}) => {
      const handler = h || makeDataHandler({ storage: sweeps, accounts, env, now: () => T0 });
      const res = mockRes();
      await handler({ method, url: "/api/data?key=" + encodeURIComponent(key), headers: c ? { cookie: c } : {} }, res);
      return res;
    };
    const PUBLIC = "public, s-maxage=300, stale-while-revalidate=3600";

    for (const [env, label] of [[{}, "unset"], [{ BOARD_PAYWALL: "0", SESSION_SECRET: SECRET }, "0"], [{ BOARD_PAYWALL: "true", SESSION_SECRET: SECRET }, "\"true\""]]) {
      const anon = await call(env);
      const signed = await call(env, { c: cookie(free) });
      check(anon.code === 200 && anon.json().value === "[1]" && anon.headers["cache-control"] === PUBLIC && signed.code === 200 && signed.headers["cache-control"] === PUBLIC,
        `board switch ${label}: everyone reads the board, with the public cache header as before`);
    }
    let r = await call(on);
    check(r.code === 401 && r.json().error === "not_signed_in" && r.headers["cache-control"] === "private, no-store", "board switch on: not signed in is 401, never cached");
    r = await call(on, { c: cookie(free) });
    check(r.code === 402 && r.json().error === "pro_only" && r.headers["cache-control"] === "private, no-store", "board switch on: a signed-in Free is 402");
    r = await call(on, { c: cookie(lapsed) });
    check(r.code === 402, "board switch on: a lapsed Pro is 402");
    r = await call(on, { c: cookie(pro) });
    const sweep = await call(on, { c: cookie(pro), key: "radar:sweep:1800000000000" });
    check(r.code === 200 && r.json().value === "[1]" && r.headers["cache-control"] === "private, no-store" && sweep.code === 200, "board switch on: a Pro reads the history and a sweep, private and uncached");
    check((await call(on, { c: cookie(pro), key: "radar:sweep:1700000000000" })).code === 404, "board switch on: an unknown sweep is still 404 for a Pro");
    for (const [c, label] of [
      [cookie(pro, { secret: "another-secret-of-enough-length-000" }), "signed with another secret"],
      [cookie(pro, { at: T0 - 13 * 3600 * 1000 }), "expired"],
      [cookie(pro).slice(0, -2) + "xx", "changed"],
      ["tpr_session=garbage", "garbage"],
    ]) check((await call(on, { c })).code === 401, `board switch on: a cookie ${label} is 401`);
    r = await call(on, { key: "radar:seenIds" });
    const post = await call(on, { method: "POST" });
    check(r.code === 400 && r.headers["cache-control"] === "private, no-store" && post.code === 405 && post.headers["cache-control"] === "private, no-store",
      "board switch on: a key not allowed is still 400 and a POST 405, both private");
    check((await call({ BOARD_PAYWALL: "1" }, { c: cookie(pro) })).code === 401, "board switch on with no SESSION_SECRET: nobody is signed in, so 401");

    // the login is read from `accounts` (fresh), not the sweeps' cached store
    const stale = memStorage();
    stale.m.set("radar:history", "[1]");
    await putSubscriber(stale, pro); // a cached copy of the record from before it was revoked
    await putSubscriber(accounts, { ...pro, plan: "free", proSource: null });
    r = await call(on, { c: cookie(pro), h: makeDataHandler({ storage: stale, accounts, env: on, now: () => T0 }) });
    check(r.code === 402, "board switch on: Pro revoked a moment ago is 402 at once (the login is read from the fresh store)");
    await putSubscriber(accounts, pro);
    await deleteSubscriber(accounts, pro.id);
    check((await call(on, { c: cookie(pro), h: makeDataHandler({ storage: stale, accounts, env: on, now: () => T0 }) })).code === 401, "board switch on: a deleted account is 401 at once");
    const dataSrc = readFileSync(new URL("../api/data.js", import.meta.url), "utf8");
    check(/accounts: blobStorage\(\)/.test(dataSrc) && /env: process\.env/.test(dataSrc), "api/data.js reads the login from a fresh store and passes the environment");
  }

  // A bounce or a complaint keeps a Pro, with its emails off
  {
    const KEY = Buffer.from("test-webhook-key-0123456789abcdef");
    const TS = String(Math.floor(T0 / 1000));
    const st = memStorage();
    const logs = [];
    const hook = makeResendWebhookHandler({ env: { RESEND_WEBHOOK_SECRET: "whsec_" + KEY.toString("base64") }, storage: st, now: () => T0, randomBytes: seeded(40), log: (...a) => logs.push(a.join(" ")) });
    let n = 0;
    const send = async (type, to, extra = {}) => {
      const id = "msg_" + ++n;
      const raw = JSON.stringify({ type, created_at: iso(T0), data: { email_id: "e" + n, to: [to], ...extra } });
      const sig = "v1," + createHmac("sha256", KEY).update(`${id}.${TS}.${raw}`).digest("base64");
      return hook(new Request("https://site.example/api/resend-webhook", { method: "POST", headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": TS, "svix-signature": sig }, body: raw }));
    };
    const add = async (email, over) => { const r = { ...newPending(email, { now: T0, randomBytes: seeded(email.length) }), status: "active", ...over }; await putSubscriber(st, r); return r; };
    const evs = (type) => [...st.m.entries()].filter(([k]) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    const bp = await add("bounce.pro@example.com", { plan: "pro", proSource: "owner" });
    const cp = await add("spam.pro@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * DAY) });
    const lp = await add("lapsed.pro@example.com", { plan: "pro", proSource: "owner", proUntil: iso(T0 - DAY) });
    await send("email.bounced", "bounce.pro@example.com", { bounce: { type: "Permanent" } });
    await send("email.complained", "spam.pro@example.com");
    await send("email.bounced", "lapsed.pro@example.com", { bounce: { type: "Permanent" } });
    const after = async (r) => getSubscriber(st, r.id);
    check((await after(bp))?.emailOff === "bounced" && (await after(bp)).plan === "pro", "webhook: a hard bounce keeps a Pro, with emailOff \"bounced\"");
    check((await after(cp))?.emailOff === "complained", "webhook: a complaint keeps a paid Pro, with emailOff \"complained\"");
    check(!(await after(lp)), "webhook: a lapsed Pro is deleted like Free");
    check(evs("bounced").length === 2 && evs("complained").length === 1 && evs("bounced").map(([, v]) => JSON.parse(v).plan).sort().join() === "free,pro", "webhook: the bounced and complained events are recorded either way, with the plan");
    check(logs.every((l) => !l.includes("@")) && logs.some((l) => /matched 1/.test(l)), "webhook: the log has counts only");
  }

  // Delivery skips a record with its emails off, Pro and Free alike
  {
    const st = memStorage();
    const mails = [];
    const fetchFn = async (url, init) => { const body = JSON.parse(init.body); mails.push(...body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) }; };
    const add = async (n, over) => { const r = { ...newPending(`d${n}@example.com`, { now: T0, randomBytes: seeded(200 + n) }), token: "tok" + n, status: "active", ...over }; await putSubscriber(st, r); return r; };
    await add(1, { plan: "pro", proSource: "owner", sweepsPerDay: 5 }); // 5 a day: the 08:09 sweep is one of its slots (T32)
    await add(2, { plan: "pro", proSource: "owner", emailOff: "unsubscribed" });
    await add(3, { plan: "pro", proSource: "owner", emailOff: "bounced" });
    await add(4, {});
    await add(5, { emailOff: "complained" }); // not expected (Free is deleted) but must not be sent to
    const sweep = { id: "1792570150123", at: iso(T0), perCat: {}, problems: [{ id: "a", cat: "traveler_pain", title: "A", summary: "", source: "S", link: "https://example.com/a", region: "EU", date: "2026-10-20", severity: "Medium", opportunity: "", isNew: true }] };
    st.m.set("radar:history", JSON.stringify([{ id: sweep.id, at: sweep.at, total: 1, newCount: 1 }]));
    st.m.set("radar:sweep:" + sweep.id, JSON.stringify(sweep));
    const out = await deliverToSubscribers({ env: { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" }, storage: st, fetchFn, now: () => T0, randomBytes: seeded(9), sweep, scheduled: true, log: () => {} });
    const to = mails.map((m) => m.to[0]).sort().join();
    check(to === "d1@example.com,d4@example.com" && out.emailOff === 3 && out.pro.due === 1 && out.free.due === 1 && out.unreadable === 0, "delivery: records with emails off get nothing and are counted as emailOff");
    check(JSON.parse(st.m.get(KEY_SUBSCRIBER_COUNT)).count === 5, "delivery: a Pro with emails off still counts as a subscriber");
  }

  // /manage/: email-on and delete-account
  {
    const { makeAccountHandler } = await import("../api/_lib/subscription-handlers.js");
    const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example", SESSION_SECRET: SECRET };
    const world = async (over = {}) => {
      const st = memStorage();
      const rec = { ...newPending("acct@example.com", { now: T0 - 2 * DAY, randomBytes: seeded(31) }), token: "tok-acct", status: "active", confirmedAt: iso(T0 - DAY), ...over };
      await putSubscriber(st, rec);
      const logs = [];
      const acct = makeAccountHandler({ env: ENV, storage: st, fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m" }) }), now: () => T0, randomBytes: seeded(4), log: (...a) => logs.push(a.join(" ")) });
      const call = async ({ method = "POST", body = {}, link = true, cookie, origin = "https://site.example" } = {}) => {
        const headers = { host: "site.example", "content-type": "application/json" };
        if (cookie) headers.cookie = cookie;
        if (origin) headers.origin = origin;
        const res = mockRes();
        const query = method === "GET" && link ? { id: rec.id, t: rec.token } : {};
        await acct({ method, headers, query, body: link && method === "POST" ? { id: rec.id, t: rec.token, ...body } : body }, res);
        return res;
      };
      const evs = (type) => [...st.m.entries()].filter(([k]) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
      return { st, rec, call, evs, logs, get: () => getSubscriber(st, rec.id), cookie: `tpr_session=${signSession(rec, { secret: SECRET, now: T0 })}` };
    };

    let w = await world({ plan: "pro", proSource: "owner", emailOff: "unsubscribed" });
    let r = await w.call({ method: "GET" });
    check(r.code === 200 && r.json().emailOff === "unsubscribed", "account GET: shows emailOff");
    r = await w.call({ body: { action: "email-on" } });
    check(r.code === 200 && r.json().emailOff === null && !("emailOff" in (await w.get())), "account email-on: clears emailOff after an unsubscribe");
    r = await w.call({ body: { action: "email-on" } });
    check(r.code === 409 && r.json().error === "already_on", "account email-on: 409 when emails are already on");
    for (const reason of ["bounced", "complained"]) {
      w = await world({ plan: "pro", proSource: "owner", emailOff: reason });
      r = await w.call({ body: { action: "email-on" } });
      check(r.code === 409 && r.json().error === "email_blocked" && (await w.get()).emailOff === reason, `account email-on: 409 after a ${reason === "bounced" ? "bounce" : "complaint"}, field kept`);
    }
    w = await world({ plan: "pro", proSource: "owner", emailOff: "unsubscribed" });
    r = await w.call({ body: { action: "email-on" }, link: false, cookie: w.cookie });
    check(r.code === 200 && !(await w.get()).emailOff, "account email-on: works signed in by cookie");

    w = await world({ plan: "pro", proSource: "owner" });
    r = await w.call({ body: { action: "delete-account" } });
    const del = w.evs("deleted");
    check(r.code === 200 && r.json().deleted === true && !(await w.get()) && /^tpr_session=;/.test(r.headers["set-cookie"] || "") && /Max-Age=0/.test(r.headers["set-cookie"]), "account delete-account by link: record gone, cookie cleared");
    check(del.length === 1 && JSON.parse(del[0][1]).plan === "pro" && !/@|[0-9a-f]{64}/.test(del[0][0] + del[0][1]) && !r.body.includes("@"), "account delete-account: one 'deleted' event with the plan only, no address in the reply");
    w = await world();
    r = await w.call({ body: { action: "delete-account" }, link: false, cookie: w.cookie });
    check(r.code === 200 && !(await w.get()) && JSON.parse(w.evs("deleted")[0][1]).plan === "free", "account delete-account by cookie: a Free account is deleted");
    w = await world();
    r = await w.call({ body: { action: "delete-account" }, link: false, cookie: w.cookie, origin: "https://evil.example" });
    check(r.code === 403 && Boolean(await w.get()), "account delete-account by cookie from another origin: 403, kept");
    r = await w.call({ body: { action: "delete-account" }, link: false });
    check(r.code === 401 && Boolean(await w.get()), "account delete-account with no link and no cookie: 401, kept");
    w = await world();
    r = await w.call({ body: { action: "delete-account", t: "wrong" } });
    check(r.code === 404 && Boolean(await w.get()), "account delete-account with a wrong token: 404, kept");
    w = await world({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * DAY) });
    r = await w.call({ body: { action: "delete-account" } });
    check(r.code === 200 && !(await w.get()) && w.evs("deleted").length === 1, "account delete-account: a paying Razorpay Pro (no subscription on record) is deleted at once");
    w = await world({ plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY) });
    r = await w.call({ body: { action: "delete-account" } });
    check(r.code === 200 && !(await w.get()), "account delete-account: a lapsed Razorpay Pro can delete");
    w = await world();
    r = await w.call({ body: { action: "nope" } });
    check(r.code === 400 && r.json().error === "unknown action", "account: an unknown action is still 400");
  }

  // Admin script: an emailOff column, and a Pro's unsubscribe counts in unsub(pro)
  {
    const admin = await import("./subscribers.mjs");
    const st = memStorage();
    await putSubscriber(st, { ...newPending("quiet.pro@example.com", { now: T0 - DAY, randomBytes: seeded(51) }), status: "active", plan: "pro", proSource: "owner", emailOff: "bounced" });
    await recordEvent(st, "emailoff", { now: T0, randomBytes: seeded(52), plan: "pro" });
    const out = [];
    const code = await admin.main(["list"], { storage: st, now: T0, rb: seeded(53), out: (s) => out.push(s), err: (s) => out.push(s) });
    check(code === 0 && /\temailOff$/m.test(out[0].split("\n")[0]) && /quiet\.pro@example\.com\t.*\tbounced$/m.test(out.join("\n")), "admin list: an emailOff column with the reason");
    const s = await admin.computeStats(st, { now: T0, days: 1 });
    check(s.perDay[0].unsubscribedPro === 1 && s.totals.unsubscribed === 1, "admin stats: an emailoff event counts as a Pro unsubscribe");
  }
}

// ---- T18: the Free email becomes a summary (counts and headlines) while the board is locked
{
  const at = "2026-10-21T08:09:10.123Z";
  const SIGNIN = "https://site.example/signin/";
  const problems = [
    { id: "a", cat: "traveler_pain", severity: "High", isNew: true, title: "Refunds <late>", summary: "SUMMARY-A", source: "SOURCE-A", region: "REGION-A", date: "2026-10-19", link: "https://news.example/a", opportunity: "IDEA-A" },
    { id: "b", cat: "traveler_pain", severity: "Low", isNew: false, title: "Lost bags", summary: "SUMMARY-B", source: "SOURCE-B", region: "", date: "", link: "https://news.example/b", opportunity: "" },
    { id: "c", cat: "industry", severity: "Medium", isNew: false, title: "Strike & delays", summary: "SUMMARY-C", source: "SOURCE-C", region: "REGION-C", date: "2026-10-18", link: "https://news.example/c", opportunity: "IDEA-C" },
  ];
  const urls = (s) => s.match(/https?:\/\/[^\s<>"']+/g) || [];
  const DETAIL = /SUMMARY-|SOURCE-|REGION-|IDEA-|2026-10-1[89]|news\.example|\[(High|Medium|Low)\]|Opportunity/;

  // The builder
  const full = buildDigestEmail({ at, problems, perCat: {} }, "https://site.example/live/", { heading: "Travel Problem Radar: daily digest", subjectLead: "daily" });
  const fullAgain = buildDigestEmail({ at, problems, perCat: {} }, "https://site.example/live/", { heading: "Travel Problem Radar: daily digest", subjectLead: "daily", teaser: false });
  check(full.html === fullAgain.html && full.text === fullAgain.text && full.subject === fullAgain.subject, "teaser: teaser:false gives exactly today's email");
  const tz = buildDigestEmail({ at, problems, perCat: {} }, "https://site.example/live/", { heading: "Travel Problem Radar: daily summary", subjectLead: "daily summary", teaser: true, signInUrl: SIGNIN });
  check(tz.subject === "Travel Problem Radar daily summary · 2026-10-21 · 3 problems, 1 new", "teaser: the subject says it is a summary");
  check(/TRAVELER PAIN \(2\)/i.test(tz.text) && /INDUSTRY \(1\)/i.test(tz.text) && />[^<]*\(2\)</.test(tz.html) && />[^<]*\(1\)</.test(tz.html), "teaser: each category has its count, in text and HTML");
  check(tz.text.includes("- NEW Refunds <late>") && tz.text.includes("- Lost bags") && tz.text.includes("- Strike & delays"), "teaser: the text has every headline, New marked");
  check(tz.html.includes(esc("Refunds <late>")) && !tz.html.includes("Refunds <late>") && tz.html.includes(esc("Strike & delays")), "teaser: the HTML has every headline, escaped");
  check(!DETAIL.test(tz.text) && !DETAIL.test(tz.html), "teaser: no summary, source, region, date, severity tag or product idea");
  check(urls(tz.text).every((u) => u === SIGNIN) && urls(tz.html).every((u) => u === SIGNIN) && urls(tz.text).length === 1 && urls(tz.html).length === 1, "teaser: the only link is the sign-in link");
  check(!/live board:/i.test(tz.text) && /Sign in to see everything/.test(tz.text) && tz.text.includes("Sign in: " + SIGNIN) && tz.html.includes(">Sign in</a>"), "teaser: a sign-in link instead of the live board link");
  check(!/check each source link/.test(tz.text + tz.html) && /Items are not verified\./.test(tz.text), "teaser: the AI notice doesn't mention source links");
  const tf = withSubscriberFooter(tz, { unsubscribeUrl: "https://site.example/api/unsubscribe?id=x&t=y", manageUrl: "https://site.example/manage/?id=x&t=y", plan: "free" });
  check(urls(tf.text + tf.html).every((u) => u.startsWith("https://site.example/")), "teaser: with the footer, every link is on the site");
  for (const bad of ["", "javascript:alert(1)", "https://x.example/a b"]) {
    let threw = false;
    try { buildDigestEmail({ at, problems, perCat: {} }, "", { teaser: true, signInUrl: bad }); } catch (e) { threw = true; }
    check(threw, `teaser: a bad sign-in link throws (${JSON.stringify(bad)})`);
  }

  // Delivery behind BOARD_PAYWALL
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" };
  const world = async (env) => {
    const st = memStorage();
    const mails = [];
    const keys = [];
    const logs = [];
    let clock = T0;
    const fetchFn = async (url, init) => {
      keys.push(init.headers["idempotency-key"]);
      const body = JSON.parse(init.body);
      mails.push(...body);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) };
    };
    for (const [n, plan] of [[1, "pro"], [2, "free"], [3, "free"]]) {
      await putSubscriber(st, { ...newPending(`t${n}@example.com`, { now: T0 - 2 * 24 * 3600 * 1000, randomBytes: seeded(200 + n) }), token: "tok" + n, status: "active", plan, proSource: plan === "pro" ? "owner" : null, proUntil: null, sweepsPerDay: plan === "pro" ? 5 : null });
    }
    const sweep = async (id, ms) => {
      const hist = JSON.parse(st.m.get("radar:history") || "[]");
      hist.push({ id, at: iso(ms), total: problems.length, newCount: 1 });
      st.m.set("radar:history", JSON.stringify(hist));
      st.m.set("radar:sweep:" + id, JSON.stringify({ at: iso(ms), problems }));
      clock = ms;
      return deliverToSubscribers({ env: { ...ENV, ...env }, storage: st, fetchFn, now: () => clock, randomBytes: seeded(9), log: (...a) => logs.push(a.join(" ")), sweep: { id, at: iso(ms), problems, perCat: {} }, scheduled: true });
    };
    return { mails, keys, logs, sweep };
  };
  const proOf = (w) => w.mails.find((m) => m.to[0] === "t1@example.com");
  const freeOf = (w) => w.mails.filter((m) => m.to[0] !== "t1@example.com");

  const off = {};
  for (const [label, env] of [["unset", {}], ["0", { BOARD_PAYWALL: "0" }], ["true", { BOARD_PAYWALL: "true" }]]) {
    const w = await world(env);
    const out = await w.sweep("1792570150123", T0);
    const fr = freeOf(w);
    check(fr.length === 2 && fr.every((m) => /daily digest/.test(m.text) && m.text.includes("Live board: https://site.example/live/") && m.text.includes("https://news.example/a") && /^Travel Problem Radar daily · /.test(m.subject)), `teaser delivery: switch ${label}, the Free email is the full digest`);
    check(out.free.teaser === false && w.keys.some((k) => /-free-1792570150123-0$/.test(k)), `teaser delivery: switch ${label}, the result says teaser:false and the key is unchanged`);
    off[label] = proOf(w);
  }

  const w = await world({ BOARD_PAYWALL: "1" });
  const out = await w.sweep("1792570150123", T0);
  const fr = freeOf(w);
  check(fr.length === 2 && fr.every((m) => /daily summary/.test(m.text) && /^Travel Problem Radar daily summary · /.test(m.subject)), "teaser delivery: switch on, Free gets the summary");
  check(fr.every((m) => m.text.includes("Sign in: https://site.example/signin/") && !DETAIL.test(m.text) && !DETAIL.test(m.html) && !/Live board:/.test(m.text)), "teaser delivery: switch on, a sign-in link and no detail or source link");
  check(fr.every((m) => urls(m.text + m.html).every((u) => u.startsWith("https://site.example/"))), "teaser delivery: switch on, every link in the Free email is on the site");
  check(out.free.teaser === true && out.free.sent === 2 && w.keys.some((k) => /-free-1792570150123-teaser-0$/.test(k)), "teaser delivery: switch on, teaser:true in the result and its own idempotency key");
  const pro = proOf(w);
  check(["unset", "0", "true"].every((l) => off[l].subject === pro.subject && off[l].text === pro.text && off[l].html === pro.html), "teaser delivery: the Pro email is the same with the switch on and off");
  check(pro.text.includes("https://news.example/a") && /Pro update/.test(pro.text), "teaser delivery: Pro keeps the full detail");
  const out2 = await w.sweep("1792588150123", T0 + 5 * 3600 * 1000);
  check(out2.free.due === 0 && out2.free.alreadySent === 2 && freeOf(w).length === 2, "teaser delivery: still once a day for Free");
  check(!/@|tok\d/.test([...w.logs, JSON.stringify(out)].join("\n")), "teaser delivery: no address or token in the result or the log");
}

// T19: the Razorpay library. Signature checks against fixed vectors, the three API calls through a
// recording fetch, and every failure mode returning { error } without throwing or leaking.
{
  // Fixed vectors made outside Node with openssl (printf '%s' <message> | openssl dgst -sha256 -hmac <secret>).
  // Razorpay's docs publish no test vector for either signature.
  const WH_BODY = '{"entity":"event","event":"subscription.activated","payload":{}}';
  const WH_SECRET = "whsec_fixture_not_a_real_secret";
  const WH_SIG = "61e62b023912c5037d2fa2f143514573a53fe2a52aea7f25292dadf291c8416a";
  const CO_SECRET = "keysecret_fixture_not_real";
  const CO = { paymentId: "pay_00000000000001", subscriptionId: "sub_00000000000001", signature: "c16245d96d25cbfea0f3a9216d10187bbeec39a91730d3305808dcbfc76f0871" };

  check(createHmac("sha256", WH_SECRET).update(WH_BODY).digest("hex") === WH_SIG, "razorpay: the webhook vector agrees with openssl");
  check(verifyWebhook(WH_BODY, WH_SIG, WH_SECRET) && verifyWebhook(Buffer.from(WH_BODY), WH_SIG, WH_SECRET), "razorpay: verifyWebhook accepts the fixed vector, as a string or a Buffer");
  const flipped = Buffer.from(WH_BODY); flipped[10] ^= 1;
  check(!verifyWebhook(flipped, WH_SIG, WH_SECRET), "razorpay: verifyWebhook refuses one changed body byte");
  check(!verifyWebhook(WH_BODY, WH_SIG, WH_SECRET + "x") && !verifyWebhook(WH_BODY, WH_SIG, ""), "razorpay: verifyWebhook refuses a wrong or empty secret");
  check([undefined, null, "", 42, WH_SIG.slice(0, 62), WH_SIG + "00", WH_SIG.toUpperCase(), "z".repeat(64)].every((h) => !verifyWebhook(WH_BODY, h, WH_SECRET)), "razorpay: verifyWebhook refuses a missing, empty, wrong-length, uppercase or non-hex header");
  check(!verifyWebhook(JSON.parse(WH_BODY), WH_SIG, WH_SECRET) && !verifyWebhook(undefined, WH_SIG, WH_SECRET), "razorpay: verifyWebhook refuses a parsed body or no body");

  check(createHmac("sha256", CO_SECRET).update(`${CO.paymentId}|${CO.subscriptionId}`).digest("hex") === CO.signature, "razorpay: the checkout vector agrees with openssl");
  check(verifyCheckout(CO, CO_SECRET), "razorpay: verifyCheckout accepts the fixed vector");
  check(!verifyCheckout({ ...CO, paymentId: CO.subscriptionId, subscriptionId: CO.paymentId }, CO_SECRET), "razorpay: verifyCheckout refuses the ids swapped");
  check(!verifyCheckout({ ...CO, subscriptionId: "sub_00000000000002" }, CO_SECRET) && !verifyCheckout(CO, "other") && !verifyCheckout(CO, ""), "razorpay: verifyCheckout refuses another subscription or a wrong or empty secret");
  check([undefined, "", CO.signature.slice(2), CO.signature.toUpperCase()].every((sig) => !verifyCheckout({ ...CO, signature: sig }, CO_SECRET)) && !verifyCheckout({}, CO_SECRET) && !verifyCheckout(undefined, CO_SECRET), "razorpay: verifyCheckout refuses a missing, short or uppercase signature and missing ids");

  // Fixture key values are built here so scripts/check.mjs's Razorpay pattern doesn't see a key and a secret in this file.
  const KEY_ID = "rzp_" + "test_" + "Fixture000001";
  const KEY_SECRET = "fixture" + "-key-" + "secret";
  const ENV = { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET, RAZORPAY_PLANS: JSON.stringify({ 1: "plan_00000000000001", 3: "plan_00000000000003", 6: "plan_00000000000006", 12: "plan_00000000000012" }) };
  check(razorpayConfigured(ENV) && Object.keys(ENV).every((k) => !razorpayConfigured({ ...ENV, [k]: " " })), "razorpay: configured only with the keys, the webhook secret and RAZORPAY_PLANS");
  check(isTestKey(ENV) && !isTestKey({ RAZORPAY_KEY_ID: "rzp_" + "live_" + "Fixture000001" }) && !isTestKey({}), "razorpay: isTestKey tells test keys from live keys");

  const SID = "a".repeat(64);
  const SUB = { id: "sub_00000000000001", entity: "subscription", plan_id: "plan_00000000000001", status: "created", short_url: "https://rzp.io/rzp/abc", notes: { sid: SID }, customer_email: "payer@example.com", current_start: null, current_end: 1792600000, charge_at: 1792600000, ended_at: null, paid_count: 0, remaining_count: 12, total_count: 12 };
  const recorder = (reply) => {
    const calls = [];
    const fetchFn = async (url, opts) => { calls.push({ url, ...opts }); return reply; };
    return { calls, fetchFn };
  };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const basic = (h) => Buffer.from(String(h).replace(/^Basic /, ""), "base64").toString();

  let f = recorder(ok(SUB));
  let out = await createSubscription({ env: ENV, fetchFn: f.fetchFn, planId: "plan_00000000000001", subscriberId: SID, totalCount: 12 });
  let c = f.calls[0];
  check(c.method === "POST" && c.url === "https://api.razorpay.com/v1/subscriptions" && RAZORPAY_API === "https://api.razorpay.com/v1", "razorpay: create posts to /v1/subscriptions");
  check(c.headers.authorization.startsWith("Basic ") && basic(c.headers.authorization) === `${KEY_ID}:${KEY_SECRET}` && c.signal instanceof AbortSignal, "razorpay: create sends Basic auth and a timeout");
  check(c.body === JSON.stringify({ plan_id: "plan_00000000000001", total_count: 12, quantity: 1, customer_notify: true, notes: { sid: SID } }), "razorpay: create sends plan_id, total_count, quantity, customer_notify and notes {sid} only");
  f = recorder(ok(SUB));
  await createSubscription({ env: ENV, fetchFn: f.fetchFn, planId: "plan_00000000000003", subscriberId: SID, totalCount: 4, quantity: 250, startAt: 1792600000, extraNotes: { months: "3", cats: "all", bad: 5, "x y": "z", email: "p".repeat(101) } });
  const cb = JSON.parse(f.calls[0].body);
  check(cb.quantity === 250 && cb.start_at === 1792600000 && JSON.stringify(cb.notes) === JSON.stringify({ sid: SID, months: "3", cats: "all" }),
    "razorpay: create sends the quantity (the price), start_at, and only short string notes beside sid (T33, T34)");
  check(JSON.stringify(out) === JSON.stringify({ id: SUB.id, status: "created", shortUrl: SUB.short_url }), "razorpay: create returns id, status and shortUrl");
  f = recorder(ok(SUB));
  await createSubscription({ env: ENV, fetchFn: f.fetchFn, planId: "plan_00000000000002", subscriberId: SID, totalCount: 1, customerNotify: false });
  check(JSON.parse(f.calls[0].body).plan_id === "plan_00000000000002" && JSON.parse(f.calls[0].body).customer_notify === false, "razorpay: create takes another plan and customer_notify false");

  f = recorder(ok({ ...SUB, status: "cancelled" }));
  out = await cancelSubscription({ env: ENV, fetchFn: f.fetchFn, subscriptionId: SUB.id, atCycleEnd: true });
  c = f.calls[0];
  check(c.method === "POST" && c.url === RAZORPAY_API + "/subscriptions/sub_00000000000001/cancel" && c.body === '{"cancel_at_cycle_end":true}' && basic(c.headers.authorization) === `${KEY_ID}:${KEY_SECRET}`, "razorpay: cancel posts cancel_at_cycle_end as a boolean");
  check(JSON.stringify(out) === JSON.stringify({ id: SUB.id, status: "cancelled" }), "razorpay: cancel returns id and status");
  f = recorder(ok(SUB));
  await cancelSubscription({ env: ENV, fetchFn: f.fetchFn, subscriptionId: SUB.id });
  check(f.calls[0].body === '{"cancel_at_cycle_end":false}', "razorpay: cancel defaults to cancelling now");

  f = recorder(ok(SUB));
  out = await fetchSubscription({ env: ENV, fetchFn: f.fetchFn, subscriptionId: SUB.id });
  c = f.calls[0];
  check(c.method === "GET" && c.url === RAZORPAY_API + "/subscriptions/sub_00000000000001" && c.body === undefined && basic(c.headers.authorization) === `${KEY_ID}:${KEY_SECRET}`, "razorpay: fetch gets /v1/subscriptions/<id> with no body");
  check(out.id === SUB.id && out.sid === SID && out.planId === SUB.plan_id && out.currentEnd === 1792600000 && out.currentStart === null && out.remainingCount === 12 && !JSON.stringify(out).includes("@"), "razorpay: fetch returns the chosen fields and drops the customer's address");

  const calls3 = (fetchFn) => Promise.all([
    createSubscription({ env: ENV, fetchFn, planId: "plan_00000000000001", subscriberId: SID, totalCount: 12 }),
    cancelSubscription({ env: ENV, fetchFn, subscriptionId: SUB.id }),
    fetchSubscription({ env: ENV, fetchFn, subscriptionId: SUB.id }),
  ]);
  const errBody = { error: { code: "BAD_REQUEST_ERROR", description: "bad for payer@example.com", field: "plan_id", source: "business", step: "NA", reason: "input_validation_failed", metadata: {} } };
  const cases = [
    ["400", () => ({ ok: false, status: 400, json: async () => errBody }), 400],
    ["401", () => ({ ok: false, status: 401, json: async () => errBody }), 401],
    ["500", () => ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } }), 500],
    ["a network error", () => { throw new TypeError("fetch failed"); }, "network"],
    ["a timeout", () => { throw new DOMException("The operation timed out.", "TimeoutError"); }, "timeout"],
    ["an HTML 200", () => ({ ok: true, status: 200, json: async () => JSON.parse("<html>") }), "reply"],
    ["a 200 that isn't a subscription", () => ok({ id: "pay_1", email: "payer@example.com" }), "reply"],
  ];
  for (const [label, reply, want] of cases) {
    let outs, threw = false;
    try { outs = await calls3(async () => reply()); } catch (e) { threw = true; }
    check(!threw && outs.every((o) => JSON.stringify(o) === JSON.stringify({ error: want })), `razorpay: ${label} gives { error: ${JSON.stringify(want)} } from all three calls`);
    check(!threw && !outs.some((o) => JSON.stringify(o).includes(KEY_SECRET) || JSON.stringify(o).includes("@")), `razorpay: ${label} returns no secret and no address`);
  }

  f = recorder(ok(SUB));
  const bad = await Promise.all([
    ...[0, 1.5, "12", undefined, -1].map((n) => createSubscription({ env: ENV, fetchFn: f.fetchFn, planId: "plan_00000000000001", subscriberId: SID, totalCount: n })),
    createSubscription({ env: ENV, fetchFn: f.fetchFn, planId: "plan_00000000000001", subscriberId: "a@b.example", totalCount: 1 }),
    createSubscription({ env: ENV, fetchFn: f.fetchFn, subscriberId: SID, totalCount: 1 }),
    ...[0, 2.5, "3"].map((q) => createSubscription({ env: ENV, fetchFn: f.fetchFn, planId: "plan_00000000000001", subscriberId: SID, totalCount: 1, quantity: q })),
    createSubscription({ env: ENV, fetchFn: f.fetchFn, subscriberId: SID, totalCount: 1, planId: "../x" }),
    ...["../x", "sub_1/cancel", "", undefined, "pay_1"].map((id) => cancelSubscription({ env: ENV, fetchFn: f.fetchFn, subscriptionId: id })),
    fetchSubscription({ env: ENV, fetchFn: f.fetchFn, subscriptionId: "sub_1?x=1" }),
  ]);
  check(bad.every((o) => o.error === "input") && f.calls.length === 0, "razorpay: a bad total_count, subscriber id, plan id or subscription id is refused without calling Razorpay");
  const unset = await Promise.all([
    createSubscription({ env: {}, fetchFn: f.fetchFn, planId: "plan_00000000000001", subscriberId: SID, totalCount: 1 }),
    cancelSubscription({ env: {}, fetchFn: f.fetchFn, subscriptionId: SUB.id }),
    fetchSubscription({ env: { RAZORPAY_KEY_ID: KEY_ID }, fetchFn: f.fetchFn, subscriptionId: SUB.id }),
  ]);
  check(unset.every((o) => o.error === "config") && f.calls.length === 0, "razorpay: missing keys give { error: \"config\" } without calling Razorpay");
}

// T20: checkout, checkout-return and cancel on /api/account, against a fake Razorpay. Only the
// webhook (T21) grants Pro, so nothing here may change the plan.
{
  const { makeAccountHandler, KEY_RZPSUB_PREFIX, paymentsReady } = await import("../api/_lib/subscription-handlers.js");
  const { signSession } = await import("../api/_lib/session.js");
  const SECRET = "test-session-secret-0123456789abcdef";
  // Fixture key values are built here so scripts/check.mjs's Razorpay pattern doesn't see a key and a secret in this file.
  const KEY_ID = "rzp_" + "test_" + "Fixture000002";
  const KEY_SECRET = "fixture" + "-key-" + "secret-2";
  const RZP = { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: "whsec_fixture_2", RAZORPAY_PLANS: JSON.stringify({ 1: "plan_00000000000009", 3: "plan_00000000000039", 6: "plan_00000000000069", 12: "plan_00000000000129" }), RAZORPAY_TOTAL_COUNT: "12" };
  const BASE = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", EMAIL_TO: "owner@example.com", SITE_URL: "https://site.example", SESSION_SECRET: SECRET };
  const MIN = 60_000;
  const sig = (paymentId, subscriptionId, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");

  const world = async (envOver = {}) => {
    const st = memStorage();
    const rzpCalls = []; const mail = []; const logs = [];
    let nextSub = 1;
    let rzpReply = null; // null: a good reply; otherwise the fake response to give
    let subGet = null; // GET /subscriptions/:id: null gives the plain reply below (no notes), else subGet(id) is the body or a response
    let clock = T0;
    const fetchFn = async (url, init) => {
      if (!String(url).startsWith("https://api.razorpay.com/")) { mail.push(init); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m" }) }; }
      rzpCalls.push({ url, ...init, json: init.body ? JSON.parse(init.body) : null });
      // A function picks per request: its reply, or nothing for the usual one.
      const given = typeof rzpReply === "function" ? rzpReply(url, init) : rzpReply;
      if (given) return given;
      if (subGet && (!init.method || init.method === "GET") && /\/subscriptions\/sub_[A-Za-z0-9]+$/.test(url)) {
        const b = subGet(url.split("/").at(-1));
        return b && b.status && typeof b.json === "function" ? b : { ok: true, status: 200, json: async () => b };
      }
      const id = url.endsWith("/cancel") ? url.split("/").at(-2) : "sub_T20" + String(nextSub++).padStart(9, "0");
      return { ok: true, status: 200, json: async () => ({ id, status: url.endsWith("/cancel") ? "active" : "created", short_url: "https://rzp.io/x", customer_email: "payer@example.com" }) };
    };
    const env = { ...BASE, ...RZP, ...envOver };
    const acct = makeAccountHandler({ env, storage: st, fetchFn, now: () => clock, randomBytes: seeded(31), log: (...a) => logs.push(a.join(" ")) });
    const add = async (email, over = {}) => {
      const r = { ...newPending(email, { now: T0 - 3600_000, randomBytes: seeded(300 + email.length) }), status: "active", confirmedAt: iso(T0 - 1800_000), ...over };
      await putSubscriber(st, r);
      return r;
    };
    const replies = [];
    const call = async ({ method = "POST", query = {}, body, cookie, origin } = {}) => {
      const headers = { host: "site.example", "content-type": "application/json" };
      if (cookie) headers.cookie = cookie;
      if (origin !== undefined) headers.origin = origin;
      const res = mockRes();
      await acct({ method, headers, query, body }, res);
      replies.push(res.body);
      return res;
    };
    const act = (rec, action, extra = {}) => call({ body: { id: rec.id, t: rec.token, action, ...extra } });
    const get = (rec) => call({ method: "GET", query: { id: rec.id, t: rec.token } });
    const stored = (rec) => getSubscriber(st, rec.id);
    const evs = (type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    return { st, env, rzpCalls, mail, logs, replies, add, call, act, get, stored, evs, setReply: (r) => { rzpReply = r; }, setSubGet: (f) => { subGet = f; }, tick: (ms) => { clock += ms; } };
  };

  // payments on or off
  check(paymentsReady({ ...RZP }) && !paymentsReady({}) && ["", "0", "-1", "1.5", "twelve", " "].every((v) => !paymentsReady({ ...RZP, RAZORPAY_TOTAL_COUNT: v }))
    && ["", "{}", "not json", '{"1":"sub_X"}', '{"2":"plan_00000000000009"}'].every((v) => !paymentsReady({ ...RZP, RAZORPAY_PLANS: v }))
    && paymentsReady({ ...RZP, RAZORPAY_PLANS: '{"12":"plan_00000000000129"}' }) && !paymentsReady({ ...RZP, RAZORPAY_PLANS: '{"3":"plan_00000000000039"}' }),
    "payments: on only with the keys, the webhook secret, a plan for at least one period on sale, and a whole RAZORPAY_TOTAL_COUNT of 1 or more");
  {
    const w = await world({ RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "", RAZORPAY_WEBHOOK_SECRET: "", RAZORPAY_PLANS: "", RAZORPAY_TOTAL_COUNT: "" });
    const free = await w.add("off@example.com");
    let r = await w.get(free);
    check(r.code === 200 && r.json().payments === false && r.json().paymentPending === false && r.json().cancelAtPeriodEnd === false, "account GET: payments off says payments: false");
    let all = true;
    for (const a of ["checkout", "checkout-return", "cancel"]) { r = await w.act(free, a); all = all && r.code === 503 && r.json().error === "payments_off"; }
    check(all && w.rzpCalls.length === 0, "checkout, checkout-return and cancel: 503 payments_off with no Razorpay call while payments are off");
    r = await w.act(free, "request-pro");
    check(r.code === 200 && r.json().proRequestedAt === iso(T0), "request-pro: still works while payments are off");
    const w2 = await world({ RAZORPAY_TOTAL_COUNT: "0" });
    const f2 = await w2.add("count@example.com");
    r = await w2.act(f2, "checkout");
    check(r.code === 503 && r.json().error === "payments_off" && w2.rzpCalls.length === 0, "checkout: a RAZORPAY_TOTAL_COUNT of 0 keeps payments off");
  }

  // checkout
  {
    const w = await world();
    const free = await w.add("buyer@example.com");
    let r = await w.get(free);
    check(r.code === 200 && r.json().payments === true, "account GET: payments on says payments: true");
    r = await w.act(free, "checkout");
    const c = w.rzpCalls[0];
    check(r.code === 200 && r.json().keyId === KEY_ID && r.json().subscriptionId === "sub_T20000000001", "checkout: replies with the key id and the new subscription id");
    check(w.rzpCalls.length === 1 && c.method === "POST" && c.url === "https://api.razorpay.com/v1/subscriptions"
      && JSON.stringify(c.json) === JSON.stringify({ plan_id: "plan_00000000000009", total_count: 12, quantity: 1, customer_notify: true, notes: { sid: free.id, months: "1", perday: "2", cats: "all" } }),
      "checkout: with no choice sent, one create call for all categories, 2 a day and the shortest period, priced by quantity, and no address");
    check(r.json().price === 1 && r.json().months === 1, "checkout: the reply says the price and the period");
    let s = await w.stored(free);
    check(s.plan === "free" && JSON.stringify(s.rzp) === JSON.stringify({ subscriptionId: "sub_T20000000001", status: "created", createdAt: iso(T0), currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null, choice: { cats: null, perDay: 2, months: 1, price: 1 } }),
      "checkout: the record keeps plan free and gains rzp with status created");
    check(w.st.m.get(KEY_RZPSUB_PREFIX + "sub_T20000000001") === JSON.stringify({ id: free.id }) && w.evs("checkoutstarted").length === 1, "checkout: writes the radar:rzpsub: index and one checkoutstarted event");
    w.tick(30 * MIN);
    r = await w.act(free, "checkout");
    check(r.code === 200 && r.json().subscriptionId === "sub_T20000000001" && w.rzpCalls.length === 1 && w.evs("checkoutstarted").length === 1, "checkout: a second click within an hour reopens the same subscription with no new call");
    w.tick(31 * MIN);
    r = await w.act(free, "checkout");
    s = await w.stored(free);
    check(r.code === 200 && r.json().subscriptionId === "sub_T20000000002" && w.rzpCalls.length === 2 && s.rzp.subscriptionId === "sub_T20000000002" && s.rzp.status === "created",
      "checkout: after an hour a new subscription is made and stored");

    // refusals
    const pend = { ...newPending("pend2@example.com", { now: T0, randomBytes: seeded(320) }) };
    await putSubscriber(w.st, pend);
    const pro = await w.add("owner-pro@example.com", { plan: "pro", proSource: "owner" });
    const waiting = await w.add("paid@example.com", { rzp: { subscriptionId: "sub_T20WAIT", status: "authenticated", createdAt: iso(T0 - 5 * MIN), currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null } });
    const before = w.rzpCalls.length;
    r = await w.act(pend, "checkout");
    check(r.code === 409 && r.json().error === "not_confirmed", "checkout: a pending address gets 409 not_confirmed");
    r = await w.act(pro, "checkout");
    check(r.code === 409 && r.json().error === "already_pro", "checkout: a Pro subscriber gets 409 already_pro");
    r = await w.act(waiting, "checkout");
    check(r.code === 409 && r.json().error === "payment_pending" && w.rzpCalls.length === before, "checkout: a paid checkout waiting for the webhook gets 409 payment_pending, so nobody pays twice");
    r = await w.get(waiting);
    check(r.json().paymentPending === true && r.json().effectivePlan === "free", "account GET: paymentPending while the webhook hasn't arrived");
    // A failed renewal (T26): the period has ended, so the account reads as Free while Razorpay retries.
    const retrying = await w.add("retry@example.com", { proSource: "razorpay", rzp: { subscriptionId: "sub_T26RETRY", status: "pending", createdAt: iso(T0 - 40 * 24 * 3600_000), currentEnd: iso(T0 - 3600_000), cancelAtPeriodEnd: false, lastEventAt: iso(T0 - 3600_000) } });
    r = await w.act(retrying, "checkout");
    check(r.code === 409 && r.json().error === "payment_retrying" && w.rzpCalls.length === before, "checkout: while Razorpay retries a renewal, 409 payment_retrying, so nobody pays twice");
    r = await w.get(retrying);
    check(r.json().billing === "pending" && r.json().effectivePlan === "free", "account GET: billing is pending while Razorpay retries a renewal");
    const gaveUp = await w.add("halted@example.com", { rzp: { subscriptionId: "sub_T26HALT", status: "halted", createdAt: iso(T0 - 40 * 24 * 3600_000), currentEnd: iso(T0 - 3600_000), cancelAtPeriodEnd: false, lastEventAt: iso(T0 - 3600_000) } });
    r = await w.get(gaveUp);
    check(r.json().billing === "halted" && r.json().effectivePlan === "free", "account GET: billing is halted once Razorpay gives up");
    for (const [who, label] of [[waiting, "a checkout waiting for the webhook"], [pro, "an owner-granted Pro"]]) {
      r = await w.get(who);
      check(r.json().billing === null, `account GET: billing is null for ${label}`);
    }

    // Razorpay fails
    const unlucky = await w.add("unlucky@example.com");
    w.setReply({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });
    r = await w.act(unlucky, "checkout");
    s = await w.stored(unlucky);
    check(r.code === 502 && r.json().error === "payment_provider" && !s.rzp && w.evs("checkoutstarted").length === 2, "checkout: a Razorpay 500 gives 502 and saves nothing");
    check(w.logs.some((l) => l === "account checkout: razorpay error 500") && w.logs.every((l) => !l.includes("@") && !l.includes(KEY_SECRET)), "checkout: the failure is logged as a status code only");
    w.setReply(null);
    check(w.replies.every((b) => !b.includes("@") && !b.includes(free.token) && !b.includes(KEY_SECRET)), "checkout: no reply holds an address, a token or the key secret");
  }

  // checkout-return
  {
    const w = await world();
    const free = await w.add("returner@example.com");
    let r = await w.act(free, "checkout-return", { paymentId: "pay_A1", subscriptionId: "sub_T20000000001", signature: sig("pay_A1", "sub_T20000000001") });
    check(r.code === 400 && r.json().error === "bad_signature", "checkout-return: no open checkout is 400 bad_signature");
    await w.act(free, "checkout");
    const SUB = "sub_T20000000001";
    const tries = [
      ["a tampered signature", { paymentId: "pay_A1", subscriptionId: SUB, signature: sig("pay_A1", SUB).replace(/^./, (ch) => (ch === "0" ? "1" : "0")) }],
      ["a signature made with another secret", { paymentId: "pay_A1", subscriptionId: SUB, signature: sig("pay_A1", SUB, "other-secret") }],
      ["another subscription id from Checkout", { paymentId: "pay_A1", subscriptionId: "sub_OTHER", signature: sig("pay_A1", "sub_OTHER") }],
      ["a missing signature", { paymentId: "pay_A1", subscriptionId: SUB }],
      ["a payment id that isn't one", { paymentId: "x|y", subscriptionId: SUB, signature: sig("x|y", SUB) }],
    ];
    for (const [label, body] of tries) {
      r = await w.act(free, "checkout-return", body);
      check(r.code === 400 && r.json().error === "bad_signature" && (await w.stored(free)).rzp.status === "created", `checkout-return: ${label} is 400 and changes nothing`);
    }
    r = await w.act(free, "checkout-return", { paymentId: "pay_A1", subscriptionId: SUB, signature: sig("pay_A1", SUB) });
    let s = await w.stored(free);
    check(r.code === 200 && /Payment received; Pro starts in a minute or two/.test(r.json().message) && r.json().paymentPending === true, "checkout-return: a good signature is 200 with the payment-received message");
    check(s.rzp.status === "authenticated" && s.plan === "free" && !s.proSource && effectivePlan(s, T0) === "free", "checkout-return: when Razorpay's subscription doesn't name this account, the record is authenticated and stays Free until the webhook");
    // The webhook got there first: its status stays.
    await putSubscriber(w.st, { ...s, plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * 24 * 3600_000), rzp: { ...s.rzp, status: "active" } });
    r = await w.act(free, "checkout-return", { paymentId: "pay_A1", subscriptionId: SUB, signature: sig("pay_A1", SUB) });
    s = await w.stored(free);
    check(r.code === 200 && s.rzp.status === "active" && s.plan === "pro", "checkout-return: never moves a status the webhook set back to authenticated");
    check(w.mail.length === 0 && w.replies.every((b) => !b.includes("@") && !b.includes(free.token)), "checkout-return: sends no email; no reply holds an address or a token");
  }

  // checkout-return starts Pro at once (2026-10-26): the signature proves the payment, and Razorpay is asked about
  // the subscription first.
  {
    const DAY = 24 * 3600_000;
    const paid = async (label, subReply, email) => {
      const w = await world();
      const rec = await w.add(email, { proRequestedAt: iso(T0 - 600_000), proRequest: { cats: ["industry"], perDay: 3, months: 12 } });
      await w.act(rec, "checkout", { cats: ["industry"], sweepsPerDay: 3, months: 12 });
      const SUB = (await w.stored(rec)).rzp.subscriptionId;
      w.setSubGet(typeof subReply === "function" ? (id) => subReply(id, rec) : () => subReply);
      const r = await w.act(rec, "checkout-return", { paymentId: "pay_NOW1", subscriptionId: SUB, signature: sig("pay_NOW1", SUB) });
      return { w, rec, r, s: await w.stored(rec), SUB };
    };
    const END = Math.floor((T0 + 365 * DAY) / 1000);
    let x = await paid("active", (id, rec) => ({ id, status: "active", notes: { sid: rec.id }, current_end: END, remaining_count: 9, paid_count: 1 }), "instant@example.com");
    check(x.r.code === 200 && x.r.json().effectivePlan === "pro" && x.r.json().paymentPending === false && /Pro is on/.test(x.r.json().message),
      "checkout-return: a verified payment on an active subscription gives Pro at once");
    check(x.s.plan === "pro" && x.s.proSource === "razorpay" && x.s.proUntil === iso(END * 1000) && x.s.rzp.status === "active" && x.s.rzp.remaining === 9 &&
      JSON.stringify(x.s.paidFor) === JSON.stringify({ sub: x.SUB, months: 12, price: 1 }) && JSON.stringify(x.s.cats) === '["industry"]' && x.s.sweepsPerDay === 3 && !x.s.proRequestedAt && !x.s.proRequest,
      "checkout-return: Pro until Razorpay's period end, with the plan chosen at checkout applied and the request cleared");
    check(x.w.evs("progranted").length === 1 && x.s.rzp.lastEventAt === null, "checkout-return: one progranted event; lastEventAt untouched, so the webhook's events aren't taken for stale");
    const later = (await import("../api/_lib/subscription-handlers.js")).applyRzpEvent(x.s, "charged", { status: "active", current_end: END + 3600 }, iso(T0 + 1000), T0 + 1000);
    check(later.proUntil === iso((END + 3600) * 1000) && JSON.stringify(later.paidFor) === JSON.stringify(x.s.paidFor), "checkout-return: the webhook's later event still moves the period end");
    const again = await x.w.act(x.rec, "checkout-return", { paymentId: "pay_NOW1", subscriptionId: x.SUB, signature: sig("pay_NOW1", x.SUB) });
    check(again.code === 200 && x.w.evs("progranted").length === 1 && (await x.w.stored(x.rec)).proUntil === x.s.proUntil, "checkout-return: sent twice, Pro is granted once");

    x = await paid("unreachable", { ok: false, status: 500, json: async () => ({}) }, "offline@example.com");
    check(x.s.plan === "pro" && x.s.rzp.status === "authenticated" && x.s.proUntil === iso(Math.floor((T0 + 12 * 31 * DAY) / 1000) * 1000) && x.w.logs.some((l) => /checkout-return: razorpay error/.test(l)),
      "checkout-return: Razorpay unreachable, the signature is enough: Pro for the months paid for (31 days each) until the webhook brings the real end");
    x = await paid("authenticated", (id, rec) => ({ id, status: "authenticated", notes: { sid: rec.id }, current_end: null }), "authed@example.com");
    check(x.s.plan === "pro" && x.s.rzp.status === "authenticated", "checkout-return: Razorpay still says authenticated: Pro starts anyway");
    x = await paid("halted", (id, rec) => ({ id, status: "halted", notes: { sid: rec.id }, current_end: END }), "halted@example.com");
    check(x.s.plan === "free" && x.s.rzp.status === "authenticated" && x.r.json().paymentPending === true && x.w.evs("progranted").length === 0,
      "checkout-return: a subscription Razorpay calls halted waits for the webhook");
    x = await paid("someone else's", (id) => ({ id, status: "active", notes: { sid: "f".repeat(64) }, current_end: END }), "other@example.com");
    check(x.s.plan === "free" && x.s.rzp.status === "authenticated", "checkout-return: a subscription whose notes name another account waits for the webhook");
  }

  // cancel
  {
    const w = await world();
    const until = iso(T0 + 20 * 24 * 3600_000);
    const owner = await w.add("granted@example.com", { plan: "pro", proSource: "owner" });
    const paid = await w.add("payer@example.com", { plan: "pro", proSource: "razorpay", proUntil: until, rzp: { subscriptionId: "sub_T20PAID", status: "active", createdAt: iso(T0 - 10 * 24 * 3600_000), currentEnd: until, cancelAtPeriodEnd: false, lastEventAt: iso(T0 - 10 * 24 * 3600_000) } });
    const free = await w.add("nopay@example.com");
    let r = await w.act(owner, "cancel");
    check(r.code === 409 && r.json().error === "not_paid_pro", "cancel: an owner-granted Pro gets 409 not_paid_pro");
    r = await w.act(free, "cancel");
    check(r.code === 409 && r.json().error === "not_paid_pro" && w.rzpCalls.length === 0, "cancel: a Free subscriber gets 409 with no Razorpay call");
    r = await w.act(paid, "cancel");
    const c = w.rzpCalls[0];
    let s = await w.stored(paid);
    check(r.code === 200 && c.url === "https://api.razorpay.com/v1/subscriptions/sub_T20PAID/cancel" && c.body === '{"cancel_at_cycle_end":true}', "cancel: cancels the stored subscription at the end of the cycle");
    check(s.rzp.cancelAtPeriodEnd === true && s.plan === "pro" && s.proUntil === until && r.json().cancelAtPeriodEnd === true && r.json().effectivePlan === "pro", "cancel: sets cancelAtPeriodEnd and Pro lasts until proUntil");
    r = await w.act(paid, "cancel");
    check(r.code === 200 && w.rzpCalls.length === 1, "cancel: a repeat is 200 with no new call");
    await w.st.set("radar:rzpsub:sub_T20PAID", JSON.stringify({ id: paid.id }));
    r = await w.act(paid, "delete-account");
    check(r.code === 200 && r.json().deleted === true && !(await w.stored(paid)) && !w.st.m.has("radar:rzpsub:sub_T20PAID") && w.rzpCalls.length === 2
      && w.rzpCalls[1].url.endsWith("/subscriptions/sub_T20PAID/cancel") && w.rzpCalls[1].body === '{"cancel_at_cycle_end":false}',
      "delete-account: a cancelled paid Pro is deleted at once, index too, and its subscription cancelled now rather than at the period end");
    const paid2 = await w.add("payer2@example.com", { plan: "pro", proSource: "razorpay", proUntil: until, rzp: { subscriptionId: "sub_T20PAID2", status: "active", createdAt: iso(T0), currentEnd: until, cancelAtPeriodEnd: false, lastEventAt: null } });
    w.setReply({ ok: false, status: 400, json: async () => ({ error: { code: "BAD_REQUEST_ERROR", description: "nope" } }) });
    r = await w.act(paid2, "cancel");
    s = await w.stored(paid2);
    check(r.code === 502 && r.json().error === "payment_provider" && s.rzp.cancelAtPeriodEnd === false, "cancel: a Razorpay error gives 502 and changes nothing");
    check(w.replies.every((b) => !b.includes("@") && !b.includes(paid.token)), "cancel: no reply holds an address or a token");
  }

  // delete-account (2026-10-27): at once, Razorpay cancelled first; everything that names the account goes
  {
    const DAY = 24 * 3600_000;
    const until = iso(T0 + 20 * DAY);
    const sub = (id, over = {}) => ({ subscriptionId: id, status: "active", createdAt: iso(T0 - 10 * DAY), currentEnd: until, cancelAtPeriodEnd: false, lastEventAt: null, ...over });
    let w = await world();
    const renewing = await w.add("renews@example.com", { plan: "pro", proSource: "razorpay", proUntil: until, rzp: sub("sub_DELRENEW") });
    const cancelled = () => w.rzpCalls.filter((c) => c.url.endsWith("/cancel")).map((c) => c.url.split("/").at(-2) + " " + c.body);
    let r = await w.act(renewing, "delete-account");
    check(r.code === 200 && !(await w.stored(renewing)) && cancelled().join() === 'sub_DELRENEW {"cancel_at_cycle_end":false}',
      "delete-account: a paid Pro that would renew is deleted at once, its subscription cancelled at Razorpay now");
    const renewal = await w.add("renewal@example.com", { plan: "pro", proSource: "razorpay", proUntil: until,
      rzp: sub("sub_DELOLD", { cancelAtPeriodEnd: true, next: { subscriptionId: "sub_DELNEXT", status: "authenticated", startAt: until, choice: { months: 1, price: 1, perDay: 2, cats: null } } }) });
    r = await w.act(renewal, "delete-account");
    check(r.code === 200 && !(await w.stored(renewal)) && cancelled().slice(1).join() === 'sub_DELOLD {"cancel_at_cycle_end":false},sub_DELNEXT {"cancel_at_cycle_end":false}',
      "delete-account: a cancelled plan with a renewal set up: both subscriptions cancelled at once, then deleted");
    const waiting = await w.add("waiting@example.com", { rzp: sub("sub_DELWAIT", { status: "authenticated" }) });
    r = await w.act(waiting, "delete-account");
    check(r.code === 409 && r.json().error === "payment_pending" && await w.stored(waiting), "delete-account: paid but Pro not started yet is 409 payment_pending; kept");
    const owner = await w.add("granted@example.com", { plan: "pro", proSource: "owner", proUntil: until });
    r = await w.act(owner, "delete-account");
    check(r.code === 200 && !(await w.stored(owner)) && cancelled().length === 3, "delete-account: an owner-granted Pro (no billing) is deleted at once, no call to Razorpay");

    // Everything that names the account goes; other accounts' files stay.
    const gone = await w.add("leaving@example.com", { plan: "pro", proSource: "razorpay", proUntil: until, rzp: sub("sub_DELNOW", { cancelAtPeriodEnd: true }) });
    const stays = await w.add("staying@example.com");
    for (const [id, owner_] of [["sub_DELNOW", gone.id], ["sub_DELOLDER", gone.id], ["sub_DELSTAY", stays.id], ["sub_DELBAD", null]]) await w.st.set("radar:rzpsub:" + id, owner_ ? JSON.stringify({ id: owner_ }) : "not json");
    await w.st.set("radar:deliveries:20261026", JSON.stringify({ free: [gone.id, stays.id] }));
    await w.st.set("radar:deliveries:20261027", JSON.stringify({ free: [stays.id] }));
    await recordEvent(w.st, "confirmed", { now: T0, randomBytes: seeded(5), plan: "pro" });
    const before = w.st.m.get("radar:deliveries:20261027");
    r = await w.act(gone, "delete-account");
    check(r.code === 200 && !(await w.stored(gone)) && !w.st.m.has("radar:rzpsub:sub_DELNOW") && !w.st.m.has("radar:rzpsub:sub_DELOLDER"),
      "delete-account: a cancelled Pro is deleted at once, with every Razorpay index file pointing at it (older checkouts too)");
    check(w.st.m.has("radar:rzpsub:sub_DELSTAY") && w.st.m.has("radar:rzpsub:sub_DELBAD") && await w.stored(stays), "delete-account: another account's index, an unreadable one, and other records stay");
    check(JSON.parse(w.st.m.get("radar:deliveries:20261026")).free.join() === stays.id && w.st.m.get("radar:deliveries:20261027") === before,
      "delete-account: its id is taken out of the delivery files; files without it are left as they are");
    check(w.evs("confirmed").length === 1 && w.evs("deleted").length === 4, "delete-account: event counts (no address or id) stay; a deleted event is added each time");
    check(w.st.m.size > 0 && [...w.st.m.values()].every((v) => !v.includes(gone.id) && !v.includes("leaving@")) && [...w.st.m.keys()].every((k) => !k.includes(gone.id)),
      "delete-account: nothing stored names the account any more");

    // A lapsed plan Razorpay is still retrying is cancelled at once; an error that leaves it running keeps the account.
    w = await world();
    const halted = await w.add("halted@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY), rzp: sub("sub_DELHALT", { status: "halted", currentEnd: iso(T0 - DAY) }) });
    r = await w.act(halted, "delete-account");
    check(r.code === 200 && !(await w.stored(halted)) && w.rzpCalls.length === 1 && w.rzpCalls[0].url.endsWith("/subscriptions/sub_DELHALT/cancel") && w.rzpCalls[0].body === '{"cancel_at_cycle_end":false}',
      "delete-account: a lapsed plan Razorpay is retrying (halted) is cancelled now, then the account deleted");
    const pending = await w.add("retrying@example.com", { rzp: sub("sub_DELPEND", { status: "pending" }), plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY) });
    w.setReply({ ok: false, status: 400, json: async () => ({ error: { code: "BAD_REQUEST_ERROR", description: "nope" } }) });
    r = await w.act(pending, "delete-account");
    check(r.code === 502 && r.json().error === "payment_provider" && await w.stored(pending) && w.logs.some((l) => /delete-account: razorpay error/.test(l)),
      "delete-account: a retrying plan Razorpay won't cancel, and can't be looked up either, is 502; the account stays");
    // The cancel fails because the plan is already over at Razorpay: the deletion goes ahead.
    const refuse = { ok: false, status: 400, json: async () => ({ error: { code: "BAD_REQUEST_ERROR", description: "nope" } }) };
    const ended = await w.add("ended@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY), rzp: sub("sub_DELEND", { status: "pending" }) });
    w.setReply((url) => (url.endsWith("/cancel") ? refuse : null));
    w.setSubGet((id) => ({ id, status: "cancelled" }));
    r = await w.act(ended, "delete-account");
    check(r.code === 200 && !(await w.stored(ended)), "delete-account: a cancel refused because Razorpay already ended the plan still deletes the account");
    w.setSubGet((id) => ({ id, status: "pending" }));
    const still = await w.add("still@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY), rzp: sub("sub_DELSTILL", { status: "pending" }) });
    r = await w.act(still, "delete-account");
    check(r.code === 502 && await w.stored(still), "delete-account: a cancel refused while Razorpay says the plan is still retrying keeps the account");
    w.setSubGet(null);
    w.setReply(refuse);
    const unpaid = await w.add("unpaid@example.com", { rzp: sub("sub_DELOPEN", { status: "created", currentEnd: null }) });
    r = await w.act(unpaid, "delete-account");
    check(r.code === 200 && !(await w.stored(unpaid)) && w.rzpCalls.some((c) => c.url.endsWith("/subscriptions/sub_DELOPEN/cancel")),
      "delete-account: an unpaid checkout is cancelled as a courtesy; a failure there doesn't stop the deletion");
  }

  // Unsubscribing a Free account deletes it the same way: Razorpay first (2026-10-27)
  {
    const DAY = 24 * 3600_000;
    for (const fails of [false, true]) {
      const st = memStorage();
      const calls = [];
      const fetchFn = async (url, init) => {
        calls.push(url);
        if (fails) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ id: url.split("/").at(-2), status: "cancelled" }) };
      };
      const rec = { ...newPending("lapsed@example.com", { now: T0 - 40 * DAY, randomBytes: seeded(77) }), status: "active", confirmedAt: iso(T0 - 39 * DAY),
        plan: "pro", proSource: "razorpay", proUntil: iso(T0 - DAY), rzp: { subscriptionId: "sub_UNSUBHALT", status: "halted", cancelAtPeriodEnd: false } };
      await putSubscriber(st, rec);
      await st.set("radar:rzpsub:sub_UNSUBHALT", JSON.stringify({ id: rec.id }));
      const logs = [];
      const unsub = makeUnsubscribeHandler({ env: { ...BASE, ...RZP }, storage: st, fetchFn, now: () => T0, randomBytes: seeded(78), log: (...a) => logs.push(a.join(" ")) });
      const res = mockRes();
      await unsub({ method: "POST", headers: { host: "site.example" }, query: { id: rec.id, t: rec.token } }, res);
      const after = await getSubscriber(st, rec.id);
      if (!fails) {
        check(res.code === 200 && /You(&#39;|')re unsubscribed/.test(res.body) && !after && !st.m.has("radar:rzpsub:sub_UNSUBHALT") && calls.some((u) => u.endsWith("/subscriptions/sub_UNSUBHALT/cancel")),
          "unsubscribe: a lapsed Free account's Razorpay plan (halted) is cancelled, then the account and its index deleted");
      } else {
        check(res.code === 200 && /Your emails are off/.test(res.body) && /couldn(&rsquo;|')t cancel your payment plan/.test(res.body) && after && after.emailOff === "unsubscribed"
          && logs.some((l) => /unsubscribe razorpay error/.test(l)),
          "unsubscribe: if Razorpay won't cancel, the account stays with emails off, and the page says so");
      }
    }
  }

  // T33: one Pro plan. Categories and emails a day are chosen freely; only monthly or yearly changes the price.
  {
    const { readChoice, applyRzpEvent } = await import("../api/_lib/subscription-handlers.js");
    const admin = await import("./subscribers.mjs");
    // readChoice: defaults, each kind of mistake, and periods without a Razorpay plan
    let c = readChoice({}, RZP);
    check(c.ok && c.cats === null && c.perDay === 2 && c.months === 1 && c.price === 1, "readChoice: nothing sent is all categories, 2 a day, monthly");
    c = readChoice({ cats: ["industry", "gov_policy"], sweepsPerDay: 5, months: 12 }, RZP, { forPayment: true });
    check(c.ok && c.cats.length === 2 && c.perDay === 5 && c.months === 12 && c.price === 1, "readChoice: two categories, 5 a day, yearly (₹1 while testing)");
    check(readChoice({ cats: ["nope"] }, RZP).error === "unknown category" && readChoice({ sweepsPerDay: 9 }, RZP).ok === false
      && [2, 3, 6, "12", 0, 1.5].every((m) => readChoice({ months: m }, RZP).error === "unknown period"), "readChoice: an unknown category, emails a day over the limit, and a period not on sale are refused");
    const only12 = { ...RZP, RAZORPAY_PLANS: '{"12":"plan_00000000000129"}' };
    check(readChoice({ months: 1 }, only12, { forPayment: true }).error === "unknown period" && readChoice({}, only12, { forPayment: true }).months === 12
      && readChoice({ months: 1 }, only12).ok, "readChoice: for payment, only periods with a Razorpay plan; the shortest of those is the default");

    const w = await world();
    // checkout with a choice: the right period's plan, the price as the quantity, the choice in notes and stored
    const buyer = await w.add("chooser@example.com");
    let r = await w.act(buyer, "checkout", { cats: ["industry"], sweepsPerDay: 3, months: 1 });
    let call = w.rzpCalls.at(-1);
    check(r.code === 200 && call.json.plan_id === "plan_00000000000009" && call.json.quantity === 1 && call.json.total_count === 12
      && JSON.stringify(call.json.notes) === JSON.stringify({ sid: buyer.id, months: "1", perday: "3", cats: "industry" }),
      "checkout: a monthly choice uses the monthly plan, 12 cycles of RAZORPAY_TOTAL_COUNT 12, the price as quantity and the choice in notes");
    let s = await w.stored(buyer);
    check(JSON.stringify(s.rzp.choice) === JSON.stringify({ cats: ["industry"], perDay: 3, months: 1, price: 1 }) && s.plan === "free", "checkout: the choice is stored with the unpaid subscription; the plan stays free");
    const n = w.rzpCalls.length;
    r = await w.act(buyer, "checkout", { cats: ["industry"], sweepsPerDay: 3, months: 1 });
    check(r.json().subscriptionId === s.rzp.subscriptionId && w.rzpCalls.length === n, "checkout: the same choice again reuses the unpaid subscription");
    r = await w.act(buyer, "checkout", { cats: ["industry"], sweepsPerDay: 3, months: 12 });
    check(r.code === 200 && r.json().subscriptionId !== s.rzp.subscriptionId && w.rzpCalls.length === n + 1 && w.rzpCalls.at(-1).json.plan_id === "plan_00000000000129" && w.rzpCalls.at(-1).json.total_count === 1,
      "checkout: a different choice gets its own subscription; yearly is one cycle");
    for (const [extra, err] of [[{ months: 2 }, "unknown period"], [{ months: 6 }, "unknown period"], [{ cats: ["nope"] }, "unknown category"], [{ sweepsPerDay: 0 }, null]]) {
      const before = w.rzpCalls.length;
      r = await w.act(buyer, "checkout", extra);
      check(r.code === 400 && (!err || r.json().error === err) && w.rzpCalls.length === before, `checkout: ${JSON.stringify(extra)} is 400 with no Razorpay call`);
    }
    const w3 = await world({ RAZORPAY_PLANS: '{"12":"plan_00000000000129"}' });
    const b3 = await w3.add("three@example.com");
    r = await w3.act(b3, "checkout", { months: 1 });
    check(r.code === 400 && r.json().error === "unknown period" && w3.rzpCalls.length === 0, "checkout: a period with no Razorpay plan can't be paid for");
    r = await w3.get(b3);
    check(JSON.stringify(r.json().payPeriods) === "[12]" && JSON.stringify(r.json().periods) === "[1,12]" && JSON.stringify(r.json().pricing) === '{"1":1,"12":1}',
      "account GET: the price table, the periods on sale and the ones that can be paid for now");

    // the first payment applies the choice and records what was paid for; a later charge keeps the member's changes
    s = await w.stored(buyer);
    const end = Math.floor((T0 + 365 * 86400_000) / 1000);
    let next = applyRzpEvent(s, "activated", { id: s.rzp.subscriptionId, status: "active", current_end: end }, iso(T0), T0);
    check(next.plan === "pro" && JSON.stringify(next.cats) === '["industry"]' && next.sweepsPerDay === 3
      && JSON.stringify(next.paidFor) === JSON.stringify({ sub: s.rzp.subscriptionId, months: 12, price: 1 }),
      "webhook: the first grant applies the categories and emails a day chosen at checkout, and records what was paid for");
    next = applyRzpEvent({ ...next, cats: null, sweepsPerDay: 1 }, "charged", { id: s.rzp.subscriptionId, status: "active", current_end: end + 86400 }, iso(T0 + 1), T0 + 1);
    check(next.cats === null && next.sweepsPerDay === 1, "webhook: a later charge keeps the member's own changes");

    // a paid Pro changes categories and emails a day with set-plan, freely: the price doesn't depend on them
    const paid = await w.add("paidpro@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 30 * 86400_000), paidFor: { sub: "sub_X", months: 1, price: 1 } });
    r = await w.act(paid, "set-plan", { cats: ["industry", "gov_policy"], sweepsPerDay: 4 });
    s = await w.stored(paid);
    check(r.code === 200 && JSON.stringify(s.cats) === '["gov_policy","industry"]' && s.sweepsPerDay === 4, "set-plan: a Pro saves categories and emails a day together");
    r = await w.act(paid, "set-plan", { cats: null, sweepsPerDay: 2 });
    check(r.code === 200 && (await w.stored(paid)).cats === null, "set-plan: all four is stored as null");
    r = await w.act(paid, "set-plan", { cats: ["industry", "web_app", "gov_policy"], sweepsPerDay: 5 });
    check(r.code === 200 && (await w.stored(paid)).sweepsPerDay === 5, "set-plan: a paid Pro may pick more categories and emails than at checkout; the price is the same");
    r = await w.act(paid, "set-plan", { cats: ["industry"] });
    check(r.code === 400, "set-plan: both categories and emails a day are needed");
    const freeOne = await w.add("freeone@example.com");
    r = await w.act(freeOne, "set-plan", { cats: null, sweepsPerDay: 2 });
    check(r.code === 403 && r.json().error === "pro_only", "set-plan: Free gets 403 pro_only");

    // request-pro with a choice (payments off): stored, the owner told once, and grant-pro applies it
    const woff = await world({ RAZORPAY_PLANS: "" });
    const asker = await woff.add("asker@example.com");
    r = await woff.act(asker, "request-pro", { cats: ["industry"], sweepsPerDay: 4, months: 1 });
    s = await woff.stored(asker);
    check(r.code === 200 && JSON.stringify(s.proRequest) === JSON.stringify({ cats: ["industry"], perDay: 4, months: 1 }) && JSON.stringify(r.json().proRequest) === JSON.stringify(s.proRequest),
      "request-pro: the chosen plan is stored and shown back");
    const mails = woff.mail.length;
    r = await woff.act(asker, "request-pro", { cats: null, sweepsPerDay: 1, months: 12 });
    s = await woff.stored(asker);
    check(r.code === 200 && s.proRequest.perDay === 1 && s.proRequest.months === 12 && woff.mail.length === mails, "request-pro: asking again with another choice updates it and doesn't email the owner again");
    r = await woff.act(asker, "request-pro", { months: 2 });
    check(r.code === 400 && r.json().error === "unknown period", "request-pro: a bad choice is 400");
    await admin.main(["grant-pro", "asker@example.com", "--yes"], { storage: woff.st, now: T0, rb: seeded(71), out: () => {}, err: () => {} });
    s = await woff.stored(asker);
    check(s.plan === "pro" && s.cats === null && s.sweepsPerDay === 1 && s.proRequest === undefined, "admin grant-pro: applies the requested plan and clears the request");
  }

  // the login cookie
  {
    const w = await world();
    const free = await w.add("cookie@example.com");
    const cookie = "tpr_session=" + signSession(free, { secret: SECRET, now: T0 });
    let r = await w.call({ body: { action: "checkout" }, cookie, origin: "https://evil.example" });
    check(r.code === 403 && r.json().error === "wrong_origin" && w.rzpCalls.length === 0, "checkout: a cookie POST from another site is 403 with no Razorpay call");
    r = await w.call({ body: { action: "checkout" }, cookie, origin: "https://site.example" });
    check(r.code === 200 && r.json().subscriptionId === "sub_T20000000001" && (await w.stored(free)).rzp.status === "created", "checkout: works signed in with the login cookie");
    r = await w.call({ body: { id: free.id, t: "wrong-token", action: "checkout" } });
    check(r.code === 404 && w.rzpCalls.length === 1, "checkout: a wrong token is 404 with no Razorpay call");
  }
}

// T21: POST /api/razorpay-webhook. Signed events against the memory store: the event table, duplicates,
// events out of order, unknown subscriptions, an owner-granted Pro, failures, and the sweep's tidy-up.
{
  const { makeRazorpayWebhookHandler, applyRzpEvent, KEY_RZPSUB_PREFIX, KEY_RZPEVENT_PREFIX, RZP_EVENT_KEEP_DAYS } = await import("../api/_lib/subscription-handlers.js");
  const WH_SECRET = "whsec_" + "fixture_21";
  const S = Math.floor(T0 / 1000); // the event clock, Unix seconds
  const DAY_S = 24 * 3600;
  const END = S + 30 * DAY_S; // current_end a month ahead
  const hmac = (raw, secret = WH_SECRET) => createHmac("sha256", secret).update(raw).digest("hex");

  const world = (envOver = {}) => {
    const st = memStorage();
    const logs = [];
    let clock = T0;
    const hook = makeRazorpayWebhookHandler({ env: { RAZORPAY_WEBHOOK_SECRET: WH_SECRET, ...envOver }, storage: st, now: () => clock, randomBytes: seeded(21), log: (...a) => logs.push(a.join(" ")) });
    const replies = [];
    let n = 0;
    const send = async (event, { id = "evt_T21" + String(++n).padStart(6, "0"), sig, raw, method = "POST", headers = {} } = {}) => {
      const body = raw ?? JSON.stringify(event);
      const h = { "content-type": "application/json", "x-razorpay-signature": sig ?? hmac(body), ...(id ? { "x-razorpay-event-id": id } : {}), ...headers };
      const res = await hook(new Request("https://site.example/api/razorpay-webhook", method === "GET" ? { method, headers: h } : { method, headers: h, body }));
      const text = await res.text();
      replies.push(text);
      return { code: res.status, text, json: () => JSON.parse(text) };
    };
    // A confirmed subscriber who has been through checkout: the index file and rzp as checkout writes them.
    const add = async (email, { sub = "sub_T21" + email.length + "x", status = "authenticated", ...over } = {}) => {
      const r = { ...newPending(email, { now: T0 - 3600_000, randomBytes: seeded(400 + email.length) }), status: "active",
        rzp: { subscriptionId: sub, status, createdAt: iso(T0 - 600_000), currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null }, ...over };
      await putSubscriber(st, r);
      await st.set(KEY_RZPSUB_PREFIX + sub, JSON.stringify({ id: r.id }));
      return r;
    };
    const stored = (r) => getSubscriber(st, r.id);
    const evs = (type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    const markers = () => [...st.m.keys()].filter((k) => k.startsWith(KEY_RZPEVENT_PREFIX));
    return { st, logs, replies, send, add, stored, evs, markers, tick: (ms) => { clock += ms; } };
  };
  const ev = (kind, rec, { at = S, end = END, status, sid, sub } = {}) => ({
    entity: "event", account_id: "acc_T21", event: "subscription." + kind, contains: ["subscription"], created_at: at,
    payload: { subscription: { entity: { id: sub ?? rec.rzp.subscriptionId, entity: "subscription", status: status ?? kind, current_start: at, current_end: end, ended_at: null,
      notes: sid === undefined ? { sid: rec.id } : sid === null ? {} : { sid }, created_at: S - 600 } } },
  });
  const allReplies = [];
  const allLogs = [];
  const done = (w) => { allReplies.push(...w.replies); allLogs.push(...w.logs); };

  // the guards
  {
    const w = world();
    const rec = await w.add("guard@example.com");
    const before = JSON.stringify([...w.st.m]);
    let r = await w.send(ev("activated", rec), { sig: hmac(JSON.stringify(ev("activated", rec)), "another-secret") });
    check(r.code === 401 && JSON.stringify([...w.st.m]) === before, "rzp webhook: a signature made with another secret is 401 and writes nothing");
    r = await w.send(ev("activated", rec), { sig: "" });
    check(r.code === 401 && JSON.stringify([...w.st.m]) === before, "rzp webhook: a missing signature is 401 and writes nothing");
    const body = JSON.stringify(ev("activated", rec));
    r = await w.send(null, { raw: body.replace('"subscription.activated"', '"subscription.halted"'), sig: hmac(body) });
    check(r.code === 401 && (await w.stored(rec)).plan === "free", "rzp webhook: a changed body is 401");
    r = await w.send(null, { method: "GET" });
    check(r.code === 405, "rzp webhook: GET is 405");
    r = await w.send(null, { raw: "{not json" });
    check(r.code === 400, "rzp webhook: a signed body that isn't JSON is 400");
    r = await w.send(null, { raw: "x".repeat(64 * 1024 + 1) });
    check(r.code === 413, "rzp webhook: a body over 64 KB is 413");
    r = await w.send({ event: "payment.captured", created_at: S, payload: {} });
    check(r.code === 200 && r.json().ignored === true, "rzp webhook: a non-subscription event is 200 and ignored");
    r = await w.send({ ...ev("activated", rec), created_at: "yesterday" });
    check(r.code === 200 && r.json().ignored === true && (await w.stored(rec)).plan === "free", "rzp webhook: an event without a usable created_at is ignored");
    const off = world({ RAZORPAY_WEBHOOK_SECRET: " " });
    r = await off.send(ev("activated", rec));
    check(r.code === 503 && off.st.m.size === 0, "rzp webhook: no RAZORPAY_WEBHOOK_SECRET is 503");
    done(w); done(off);
  }

  // the event table
  {
    const w = world();
    const rec = await w.add("table@example.com");
    let r = await w.send(ev("authenticated", rec));
    let s = await w.stored(rec);
    check(r.code === 200 && s.plan === "free" && s.rzp.status === "authenticated" && s.rzp.lastEventAt === iso(S * 1000), "authenticated: no plan change; lastEventAt is set");
    r = await w.send(ev("activated", rec, { status: "active" }));
    s = await w.stored(rec);
    check(r.code === 200 && s.plan === "pro" && s.proSource === "razorpay" && s.proUntil === iso(END * 1000) && s.rzp.status === "active" && s.rzp.currentEnd === iso(END * 1000),
      "activated: Pro from Razorpay, proUntil = current_end as ISO");
    check(effectivePlan(s, T0) === "pro" && w.evs("progranted").length === 1 && JSON.parse(w.st.m.get(w.evs("progranted")[0])).plan === "pro", "activated: one progranted event");
    r = await w.send(ev("charged", rec, { at: S + 10, status: "active" }));
    s = await w.stored(rec);
    check(r.code === 200 && s.plan === "pro" && w.evs("progranted").length === 1, "charged on a Pro: still Pro, no second progranted");
    const END2 = END + 30 * DAY_S;
    r = await w.send(ev("charged", rec, { at: S + 30 * DAY_S, end: END2, status: "active" }));
    s = await w.stored(rec);
    check(s.proUntil === iso(END2 * 1000), "charged next month: proUntil moves to the new current_end");
    r = await w.send(ev("pending", rec, { at: S + 30 * DAY_S + 5, end: END2 }));
    s = await w.stored(rec);
    check(r.code === 200 && s.plan === "pro" && s.rzp.status === "pending", "pending: no plan change");
    r = await w.send(ev("halted", rec, { at: S + 30 * DAY_S + 9, end: END2 }));
    s = await w.stored(rec);
    check(s.plan === "free" && s.proUntil === null && s.proSource === null && s.rzp.status === "halted" && w.evs("prorevoked").length === 1, "halted: Free, proUntil null, one prorevoked");
    r = await w.send(ev("resumed", rec, { at: S + 31 * DAY_S, end: END2, status: "active" }));
    s = await w.stored(rec);
    check(s.plan === "pro" && s.proSource === "razorpay" && s.proUntil === iso(END2 * 1000) && w.evs("progranted").length === 2, "resumed: Pro again, like charged");
    r = await w.send(ev("paused", rec, { at: S + 31 * DAY_S + 1, end: END2 }));
    s = await w.stored(rec);
    check(s.plan === "free" && w.evs("prorevoked").length === 2, "paused: Free, like halted");
    r = await w.send(ev("updated", rec, { at: S + 31 * DAY_S + 2, end: END2, status: "paused" }));
    s = await w.stored(rec);
    check(r.code === 200 && s.plan === "free" && s.rzp.lastEventAt === iso((S + 31 * DAY_S + 2) * 1000), "updated (any other event): no plan change, bookkeeping only");
    done(w);
  }

  // cancelled and completed
  {
    const w = world();
    const rec = await w.add("cancel@example.com");
    await w.send(ev("activated", rec, { status: "active" }));
    let r = await w.send(ev("cancelled", rec, { at: S + 60 }));
    let s = await w.stored(rec);
    check(r.code === 200 && s.plan === "pro" && s.proUntil === iso(END * 1000) && s.rzp.status === "cancelled" && w.evs("prorevoked").length === 0,
      "cancelled with current_end ahead: Pro until current_end, nothing revoked yet");
    check(effectivePlan(s, END * 1000 + 1) === "free", "cancelled: the plan lapses on its own after current_end");
    const late = await w.add("late@example.com", { sub: "sub_T21late" });
    await w.send(ev("activated", late, { status: "active" }));
    w.tick((END - S + 60) * 1000);
    r = await w.send(ev("completed", late, { at: END + 30 }));
    s = await w.stored(late);
    check(s.plan === "free" && s.proUntil === null && w.evs("prorevoked").length === 0, "completed with current_end past: Free now; no prorevoked, as the plan had already lapsed");
    done(w);
  }

  // an owner-granted Pro
  {
    const w = world();
    const owner = await w.add("owner-pro@example.com", { plan: "pro", proSource: "owner", proUntil: null });
    let r = await w.send(ev("halted", owner));
    let s = await w.stored(owner);
    check(r.code === 200 && s.plan === "pro" && s.proSource === "owner" && s.proUntil === null, "halted: an owner-granted Pro is left alone");
    r = await w.send(ev("cancelled", owner, { at: S + 1, end: S - 10 }));
    s = await w.stored(owner);
    check(s.plan === "pro" && s.proSource === "owner", "cancelled: an owner-granted Pro is left alone");
    r = await w.send(ev("activated", owner, { at: S + 2, status: "active" }));
    s = await w.stored(owner);
    check(s.plan === "pro" && s.proSource === "razorpay" && s.proUntil === iso(END * 1000) && w.evs("progranted").length === 0,
      "activated on an owner-granted Pro: the paid subscription takes over (razorpay, with an end date); no progranted, as it was Pro already");
    done(w);
  }

  // duplicates, order, unknown subscriptions
  {
    const w = world();
    const rec = await w.add("dup@example.com");
    let r = await w.send(ev("activated", rec, { status: "active" }), { id: "evt_DUP000001" });
    const marker = `${KEY_RZPEVENT_PREFIX}${utcDay(S * 1000)}-${new Date(S * 1000).toISOString().slice(11, 16).replace(":", "")}-evt_DUP000001`;
    check(r.code === 200 && w.st.m.has(marker), "duplicate: an applied event leaves radar:rzp-event:<day>-<HHMM>-<event id>");
    await w.send(ev("halted", rec, { at: S + 5 }), { id: "evt_DUP000002" });
    const snap = JSON.stringify([...w.st.m]);
    // A redelivery repeats the body, including created_at, so it maps to the same marker.
    r = await w.send(ev("activated", rec, { status: "active" }), { id: "evt_DUP000001" });
    check(r.code === 200 && r.json().duplicate === true && JSON.stringify([...w.st.m]) === snap && (await w.stored(rec)).plan === "free",
      "duplicate: a redelivered event is 200 duplicate and changes nothing");

    const o = await w.add("order@example.com", { sub: "sub_T21order" });
    await w.send(ev("charged", o, { at: S + 100, status: "active" }));
    r = await w.send(ev("halted", o, { at: S + 50 }));
    let s = await w.stored(o);
    check(r.code === 200 && r.json().stale === true && s.plan === "pro" && s.rzp.status === "active", "stale: an older halted arriving after a newer charged doesn't undo it");
    const same = await w.add("same@example.com", { sub: "sub_T21same" });
    await w.send(ev("activated", same, { at: S + 200, status: "active" }));
    r = await w.send(ev("authenticated", same, { at: S + 200 }));
    s = await w.stored(same);
    check(r.code === 200 && s.plan === "pro" && s.rzp.status === "active", "same second: authenticated after activated applies but keeps status active");

    const before = w.st.m.size;
    r = await w.send(ev("activated", rec, { sub: "sub_T21nobody", sid: null }));
    check(r.code === 200 && r.json().unknown === true && w.st.m.size === before, "unknown: a subscription with no index and no sid is 200, nothing written");
    r = await w.send(ev("activated", rec, { sub: "sub_T21nobody", sid: "f".repeat(64) }));
    check(r.code === 200 && r.json().unknown === true && w.st.m.size === before, "unknown: a sid with no record is 200, nothing written");
    r = await w.send(ev("activated", rec, { sub: "sub_T21abandoned" }));
    check(r.code === 200 && r.json().unknown === true && w.st.m.size === before && (await w.stored(rec)).plan === "free",
      "unknown: notes.sid finds a record whose subscription is a different one (an abandoned checkout); nothing changes");
    check(w.logs.filter((l) => l.includes("unknown subscription")).length === 3, "unknown: logged as 'unknown subscription'");
    // The index file is missing (a lost write): notes.sid still finds the record.
    const lost = await w.add("lost@example.com", { sub: "sub_T21lost" });
    w.st.m.delete(KEY_RZPSUB_PREFIX + "sub_T21lost");
    r = await w.send(ev("activated", lost, { status: "active" }));
    check(r.code === 200 && (await w.stored(lost)).plan === "pro", "notes.sid: finds the record when the index file is missing");
    // No event id header: applied, but without a marker.
    const noid = await w.add("noid@example.com", { sub: "sub_T21noid" });
    const m0 = w.markers().length;
    r = await w.send(ev("activated", noid, { status: "active" }), { id: "" });
    check(r.code === 200 && (await w.stored(noid)).plan === "pro" && w.markers().length === m0, "no x-razorpay-event-id: applied, no marker");
    done(w);
  }

  // storage failures are 500, so Razorpay retries
  for (const op of ["get", "set"]) {
    const w = world();
    const rec = await w.add("fail-" + op + "@example.com");
    const f = w.st[op];
    w.st[op] = async () => { throw new Error("blob down for fail-" + op + "@example.com"); };
    const r = await w.send(ev("activated", rec, { status: "active" }));
    w.st[op] = f;
    check(r.code === 500 && w.logs.some((l) => l.endsWith("error: Error")) && w.markers().length === 0, `storage ${op} throws: 500, no marker, and the log has the error name only`);
    done(w);
  }

  // nothing private in replies or logs
  check(allReplies.length > 30 && allReplies.every((b) => !b.includes("@") && !/[0-9a-f]{64}/.test(b) && !b.includes("sub_")), "rzp webhook: no reply holds an address, a record id or a subscription id");
  check(allLogs.length > 20 && allLogs.every((l) => !l.includes("@") && !/[0-9a-f]{64}/.test(l) && !l.includes("sub_")), "rzp webhook: no log line holds an address, a record id or a subscription id");

  // applyRzpEvent never makes a Pro without an end date
  {
    const rec = { id: "a".repeat(64), status: "active", plan: "free", proSource: null, proUntil: null, rzp: { subscriptionId: "sub_X", status: "authenticated" } };
    const next = applyRzpEvent(rec, "activated", { id: "sub_X", status: "active" }, iso(T0), T0);
    check(next.plan === "free" && next.rzp.status === "active", "applyRzpEvent: activated without current_end doesn't grant Pro");
  }

  // the sweep: the next scheduled run mails the new Pro, and tidies markers older than 30 days
  {
    const w = world();
    const rec = await w.add("sweep-pro@example.com");
    await w.send(ev("activated", rec, { status: "active" }));
    const old = utcDay(T0 - (RZP_EVENT_KEEP_DAYS + 1) * 86400_000);
    const edge = utcDay(T0 - RZP_EVENT_KEEP_DAYS * 86400_000);
    w.st.m.set(`${KEY_RZPEVENT_PREFIX}${old}-evt_OLD`, "{}");
    w.st.m.set(`${KEY_RZPEVENT_PREFIX}${edge}-evt_EDGE`, "{}");
    w.st.m.set(KEY_RZPEVENT_PREFIX + "junk", "{}");
    const prob = { id: "p1", cat: "traveler_pain", title: "Item", summary: "", source: "S", link: "https://example.com/p1", region: "EU", date: "2026-10-20", severity: "Medium", opportunity: "", isNew: false };
    // at 10:09 UTC, slot 10: one of the default 2 a day (T32)
    w.st.m.set("radar:history", JSON.stringify([{ id: "1792570150123", at: iso(T0 + 2 * 3600_000), total: 1, newCount: 0 }]));
    w.st.m.set("radar:sweep:1792570150123", JSON.stringify({ at: iso(T0 + 2 * 3600_000), problems: [prob] }));
    const mails = [];
    const fetchFn = async (url, init) => { const body = JSON.parse(init.body); mails.push(...body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: body.map((_, i) => ({ id: "m" + i })) }) }; };
    const env = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", SITE_URL: "https://site.example" };
    const out = await deliverToSubscribers({ env, storage: w.st, fetchFn, now: () => T0 + 2 * 3600_000, randomBytes: seeded(5), scheduled: true, log: () => {},
      sweep: { id: "1792570150123", at: iso(T0 + 2 * 3600_000), problems: [prob], perCat: {}, newCount: 0 } });
    check(out.pro && out.pro.sent === 1 && mails.filter((m) => m.to[0] === "sweep-pro@example.com").length === 1, "sweep: the next scheduled run sends the Pro email to an account the webhook made Pro");
    const left = w.markers().map((k) => k.slice(KEY_RZPEVENT_PREFIX.length));
    check(!left.some((k) => k.endsWith("evt_OLD")) && left.some((k) => k.endsWith("evt_EDGE")) && left.includes("junk") && left.length === 3,
      `sweep: deletes Razorpay event markers older than 30 days, keeps newer ones and anything it doesn't recognise (${left.length} left)`);

    // /api/data never serves the Razorpay keys.
    const dh = makeDataHandler({ storage: w.st });
    let refused = 0;
    for (const k of [KEY_RZPSUB_PREFIX + rec.rzp.subscriptionId, w.markers()[0]]) { const res = mockRes(); await dh({ method: "GET", url: "/api/data?key=" + encodeURIComponent(k), headers: {} }, res); if (res.code === 400) refused++; }
    check(refused === 2, "/api/data refuses radar:rzpsub: and radar:rzp-event: keys");
  }
}

// ---- conditional writes: two updates to one record at the same moment don't undo each other
{
  // blobStorage().update over a fake @vercel/blob client that keeps an ETag per file, like Blob.
  const files = new Map(); // path -> { text, etag }
  let etagN = 0;
  const puts = [];
  let competeOnce = false; // write the file again between update's read and its write, once
  const fake = {
    get: async (p) => {
      const f = files.get(p);
      if (!f) return null;
      const out = { statusCode: 200, stream: new Blob([f.text]).stream(), etag: f.etag };
      if (competeOnce) { competeOnce = false; files.set(p, { text: JSON.stringify({ ...JSON.parse(f.text), other: true }), etag: "e" + ++etagN }); }
      return out;
    },
    put: async (p, body, opts) => {
      puts.push({ p, opts });
      const f = files.get(p);
      if (opts.ifMatch !== undefined && (!f || f.etag !== opts.ifMatch)) throw Object.assign(new Error("Precondition failed: ETag mismatch."), { name: "BlobPreconditionFailedError" });
      files.set(p, { text: body, etag: "e" + ++etagN });
    },
  };
  const blob = blobStorage(fake);
  await blob.update("radar:sub:x", () => JSON.stringify({ n: 1 }));
  check(puts[0].opts.ifMatch === undefined && puts[0].opts.allowOverwrite === true && JSON.parse(files.get("radar/subscribers/x.json").text).n === 1, "blob update: a missing file is written without ifMatch");
  await blob.update("radar:sub:x", (text) => JSON.stringify({ ...JSON.parse(text), n: 2 }));
  check(puts[1].opts.ifMatch === "e1" && puts[1].opts.access === "private", "blob update: the write carries the ETag that was read (ifMatch)");
  let runs = 0;
  competeOnce = true;
  const out = await blob.update("radar:sub:x", (text) => { runs++; return JSON.stringify({ ...JSON.parse(text), n: 3 }); });
  check(runs === 2 && JSON.parse(out).other === true && JSON.parse(out).n === 3 && files.get("radar/subscribers/x.json").text === out,
    "blob update: a write made between the read and the write is kept; the change runs again on a fresh read");
  const before = puts.length;
  await blob.update("radar:sub:x", () => undefined);
  check(puts.length === before, "blob update: a change that returns undefined writes nothing");
  const always = { get: fake.get, put: async () => { throw Object.assign(new Error("Precondition failed: ETag mismatch."), { name: "BlobPreconditionFailedError" }); } };
  runs = 0;
  let threw = false;
  try { await blobStorage(always).update("radar:sub:x", (text) => { runs++; return text; }); } catch (e) { threw = e.name === "BlobPreconditionFailedError"; }
  check(threw && runs === 5, "blob update: gives up and throws after 5 mismatches");
  let other = null;
  try { await blobStorage({ get: fake.get, put: async () => { throw new Error("blob down"); } }).update("radar:sub:x", (text) => text); } catch (e) { other = e.message; }
  check(other === "blob down", "blob update: any other error is thrown at once, not retried");

  const { makeAccountHandler, makeRazorpayWebhookHandler, makeSessionHandler, KEY_RZPSUB_PREFIX } = await import("../api/_lib/subscription-handlers.js");
  const KEY_ID = "rzp_" + "test_" + "Fixture000003";
  const KEY_SECRET = "fixture" + "-key-" + "secret-3";
  const WH_SECRET = "whsec_" + "fixture_3";
  const ENV = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", EMAIL_TO: "owner@example.com", SITE_URL: "https://site.example",
    SESSION_SECRET: "test-session-secret-0123456789abcdef", RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET, RAZORPAY_PLANS: JSON.stringify({ 1: "plan_00000000000009", 3: "plan_00000000000039", 6: "plan_00000000000069", 12: "plan_00000000000129" }), RAZORPAY_TOTAL_COUNT: "12" };
  const S = Math.floor(T0 / 1000);
  const SUB = "sub_RACE00000001";
  const world = async (over = {}) => {
    const st = memStorage();
    const mail = []; const logs = [];
    const fetchFn = async (url, init) => { const b = JSON.parse(init.body); mail.push(...(Array.isArray(b) ? b : [b])); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m0", data: [{ id: "m0" }] }) }; };
    const deps = { env: ENV, storage: st, fetchFn, now: () => T0, randomBytes: seeded(61), log: (...a) => logs.push(a.join(" ")) };
    const acct = makeAccountHandler(deps);
    const sess = makeSessionHandler(deps);
    const hook = makeRazorpayWebhookHandler(deps);
    const rec = { ...newPending("race@example.com", { now: T0 - 3600_000, randomBytes: seeded(62) }), status: "active", confirmedAt: iso(T0 - 1800_000),
      rzp: { subscriptionId: SUB, status: "created", createdAt: iso(T0 - 600_000), currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null }, ...over };
    await putSubscriber(st, rec);
    await st.set(KEY_RZPSUB_PREFIX + SUB, JSON.stringify({ id: rec.id }));
    const res = async (h, req) => { const r = mockRes(); await h({ headers: { host: "site.example", "content-type": "application/json" }, query: {}, ...req }, r); return r; };
    const act = (action, extra = {}) => res(acct, { method: "POST", body: { id: rec.id, t: rec.token, action, ...extra } });
    let n = 0;
    const webhook = async (kind, at, status) => {
      const body = JSON.stringify({ entity: "event", event: "subscription." + kind, contains: ["subscription"], created_at: at,
        payload: { subscription: { entity: { id: SUB, entity: "subscription", status, current_start: at, current_end: at + 30 * 86400, notes: { sid: rec.id } } } } });
      const r = await hook(new Request("https://site.example/api/razorpay-webhook", { method: "POST", body,
        headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", WH_SECRET).update(body).digest("hex"), "x-razorpay-event-id": "evt_RACE" + ++n } }));
      return r.status;
    };
    // Runs `fn` once, right after the next read of the record: the read hands back what was there before.
    const afterNextRead = (fn) => {
      const get = st.get;
      st.get = async (k) => {
        const v = await get(k);
        if (k === "radar:sub:" + rec.id) { st.get = get; await fn(); }
        return v;
      };
    };
    const stored = () => getSubscriber(st, rec.id);
    const evs = (type) => [...st.m.keys()].filter((k) => k.startsWith("radar:event:") && k.includes(`-${type}-`));
    return { st, rec, mail, logs, act, res, sess, webhook, afterNextRead, stored, evs };
  };

  // Bug #1: the webhook's Pro lands while Checkout's return is being handled.
  {
    const w = await world();
    w.afterNextRead(async () => { check((await w.webhook("activated", S, "active")) === 200, "race: the webhook's activated event is applied"); });
    const sig = createHmac("sha256", KEY_SECRET).update(`pay_RACE1|${SUB}`).digest("hex");
    const r = await w.act("checkout-return", { paymentId: "pay_RACE1", subscriptionId: SUB, signature: sig });
    const s = await w.stored();
    check(r.code === 200 && s.plan === "pro" && s.proSource === "razorpay" && s.rzp.status === "active" && r.json().effectivePlan === "pro",
      "race: an activated webhook that lands during checkout-return leaves the record Pro (it was written back as Free before)");
  }
  // Two Razorpay events delivered at the same moment, the older one last.
  {
    const w = await world({ rzp: { subscriptionId: SUB, status: "authenticated", createdAt: iso(T0 - 600_000), currentEnd: null, cancelAtPeriodEnd: false, lastEventAt: null } });
    const codes = await Promise.all([w.webhook("activated", S + 10, "active"), w.webhook("authenticated", S, "authenticated")]);
    const s = await w.stored();
    check(codes.every((c) => c === 200) && s.plan === "pro" && s.rzp.status === "active" && s.rzp.lastEventAt === iso((S + 10) * 1000) && w.evs("progranted").length === 1,
      "race: activated and an older authenticated arriving together leave the record Pro, with one progranted event");
  }
  // One sign-in link pressed twice at the same moment signs in once.
  {
    const w = await world();
    await w.res(w.sess, { method: "POST", body: { action: "request", email: "race@example.com" } });
    const m = /[?&]c=([A-Za-z0-9_-]+)/.exec((w.mail.find((x) => /c=/.test(x.text || "")) || {}).text || "");
    const code = m ? m[1] : "";
    const [a, b] = await Promise.all([1, 2].map(() => w.res(w.sess, { method: "POST", body: { id: w.rec.id, c: code } })));
    const ok = [a, b].filter((r) => r.code === 303 && /^tpr_session=[^;]+/.test(r.headers["set-cookie"] || ""));
    const refused = [a, b].filter((r) => r.code === 400 && !r.headers["set-cookie"] && /sign-in link isn/.test(r.body));
    check(code && ok.length === 1 && refused.length === 1 && (await w.stored()).signin === null, "race: two presses of one sign-in link at once: one 303 with a cookie, one invalid page");
  }
  // The Confirm button pressed twice at once: one sign-in, one "already subscribed".
  {
    const w = await world({ status: "pending", confirmedAt: null, rzp: null });
    const conf = makeConfirmHandler({ env: ENV, storage: w.st, fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m0" }) }), now: () => T0, randomBytes: seeded(63), log: () => {} });
    const rs = await Promise.all([1, 2].map(() => w.res(conf, { method: "POST", body: { id: w.rec.id, t: w.rec.token } })));
    const first = rs.filter((r) => r.code === 200 && /You&#39;re subscribed/.test(r.body) && /^tpr_session=[^;]+/.test(r.headers["set-cookie"] || ""));
    const second = rs.filter((r) => r.code === 200 && /already subscribed/.test(r.body) && !r.headers["set-cookie"]);
    check(first.length === 1 && second.length === 1 && w.evs("confirmed").length === 1 && (await w.stored()).status === "active",
      "race: two Confirm presses at once: one signs in, the other gets the already-subscribed page with no cookie; one confirmed event");
  }
  // Two Request Pro clicks at once: one request, one owner email.
  {
    const w = await world({ rzp: null });
    const rs = await Promise.all([w.act("request-pro"), w.act("request-pro")]);
    check(rs.every((r) => r.code === 200 && r.json().proRequestedAt === iso(T0)) && w.evs("prorequested").length === 1 && w.mail.filter((x) => x.to === "owner@example.com" || (Array.isArray(x.to) && x.to.includes("owner@example.com"))).length === 1,
      "race: two Request Pro clicks at once record one request and email the owner once");
  }
  // Someone else writes the record every time: after 5 tries the request fails, and nothing is half done.
  {
    const w = await world({ rzp: null });
    w.st.beforeWrite = async (k) => { if (k === "radar:sub:" + w.rec.id) await w.st.set(k, w.st.m.get(k)); };
    const r = await w.act("request-pro");
    w.st.beforeWrite = null;
    check(r.code === 500 && w.st.updateMisses === 5 && !(await w.stored()).proRequestedAt && w.evs("prorequested").length === 0 && w.mail.length === 0,
      "race: a record written by someone else on every try gives 500 after 5 tries, with no request, event or email");
    check(w.logs.some((l) => l === "account error: BlobPreconditionFailedError") && w.logs.every((l) => !l.includes("@")), "race: the give-up is logged by error name only");
  }
}

// T34: renewing Pro. A cancelled, still-running plan sets up a renewal that starts when it ends; a lapsed one renews
// with its last plan; a plan that won't renew gets one warning email a week before it ends.
{
  const { makeAccountHandler, makeRazorpayWebhookHandler, KEY_RZPSUB_PREFIX, RENEW_GRACE_HOURS } = await import("../api/_lib/subscription-handlers.js");
  const { endingSoon } = await import("../api/_lib/subscriber-delivery.js");
  const KEY_ID = "rzp_" + "test_" + "Fixture000034";
  const KEY_SECRET = "fixture" + "-key-" + "secret-34";
  const WH = "whsec_" + "fixture_34";
  const DAY = 24 * 3600_000;
  const env = { SUBSCRIPTIONS_ENABLED: "1", RESEND_API_KEY: "re_k", EMAIL_FROM: "Radar <hello@pehchanthetraveller.com>", EMAIL_TO: "owner@example.com", SITE_URL: "https://site.example",
    SESSION_SECRET: "test-session-secret-0123456789abcdef", RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH,
    RAZORPAY_PLANS: JSON.stringify({ 1: "plan_00000000000001", 3: "plan_00000000000003", 6: "plan_00000000000006", 12: "plan_00000000000012" }), RAZORPAY_TOTAL_COUNT: "12" };
  const st = memStorage();
  const rzpCalls = [];
  let clock = T0, nextSub = 1;
  const fetchFn = async (url, init) => {
    rzpCalls.push({ url, ...init, json: init.body ? JSON.parse(init.body) : null });
    const id = url.endsWith("/cancel") ? url.split("/").at(-2) : "sub_T34" + String(nextSub++).padStart(9, "0");
    return { ok: true, status: 200, json: async () => ({ id, status: url.endsWith("/cancel") ? "cancelled" : "created" }) };
  };
  const acct = makeAccountHandler({ env, storage: st, fetchFn, now: () => clock, randomBytes: seeded(34), log: () => {} });
  const hook = makeRazorpayWebhookHandler({ env, storage: st, now: () => clock, randomBytes: seeded(35), log: () => {} });
  const replies = [];
  const act = async (rec, action, extra = {}) => {
    const res = mockRes();
    await acct({ method: "POST", headers: { host: "site.example", "content-type": "application/json" }, body: { id: rec.id, t: rec.token, action, ...extra } }, res);
    replies.push(res.body);
    return res;
  };
  let evn = 0;
  const send = async (kind, sub, rec, { end, remaining } = {}) => {
    const body = JSON.stringify({ event: "subscription." + kind, created_at: Math.floor(clock / 1000) + evn, payload: { subscription: { entity: {
      id: sub, status: kind === "charged" ? "active" : kind, current_end: end, notes: { sid: rec.id }, ...(remaining !== undefined ? { remaining_count: remaining } : {}) } } } });
    const res = await hook(new Request("https://site.example/api/razorpay-webhook", { method: "POST", body,
      headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", WH).update(body).digest("hex"), "x-razorpay-event-id": "evt_T34" + String(++evn).padStart(6, "0") } }));
    return res.status;
  };
  const stored = (rec) => getSubscriber(st, rec.id);
  const until = iso(T0 + 5 * DAY);
  const endS = Math.floor(Date.parse(until) / 1000);
  const add = async (email, over = {}) => {
    const r = { ...newPending(email, { now: T0 - 3600_000, randomBytes: seeded(500 + email.length) }), status: "active", confirmedAt: iso(T0 - 1800_000), ...over };
    await putSubscriber(st, r);
    if (r.rzp && r.rzp.subscriptionId) await st.set(KEY_RZPSUB_PREFIX + r.rzp.subscriptionId, JSON.stringify({ id: r.id }));
    return r;
  };
  const paidRzp = (sub, over = {}) => ({ subscriptionId: sub, status: "active", createdAt: iso(T0 - 25 * DAY), currentEnd: until, cancelAtPeriodEnd: false, lastEventAt: iso(T0 - 25 * DAY),
    choice: { cats: ["industry"], perDay: 3, months: 1, price: 1 }, ...over });
  const paidOver = (sub, over = {}) => ({ plan: "pro", proSource: "razorpay", proUntil: until, cats: ["industry"], sweepsPerDay: 3,
    paidFor: { sub, months: 1, price: 1 }, rzp: paidRzp(sub, over) });

  // A plan that still renews can't set up another; a cancelled one can.
  const keep = await add("keep@example.com", paidOver("sub_T34KEEP0001"));
  let r = await act(keep, "checkout", { cats: ["industry"], sweepsPerDay: 3, months: 12 });
  check(r.code === 409 && r.json().error === "already_pro" && rzpCalls.length === 0, "renew: a plan that still renews gets 409 already_pro");
  r = await act(keep, "cancel");
  check(r.code === 200 && r.json().cancelAtPeriodEnd === true && r.json().canRenew === true && r.json().renewal === null, "renew: once cancelled, the account says it can renew");
  const calls = rzpCalls.length;
  r = await act(keep, "checkout", { cats: ["industry", "web_app"], sweepsPerDay: 2, months: 12 });
  let c = rzpCalls.at(-1);
  let s = await stored(keep);
  check(r.code === 200 && r.json().renewing === true && rzpCalls.length === calls + 1 && c.json.start_at === endS && c.json.plan_id === "plan_00000000000012" && c.json.total_count === 1 && c.json.notes.renews === "1",
    "renew: a cancelled plan's checkout starts a new subscription at the end of the paid period (start_at), for the chosen period");
  check(s.rzp.subscriptionId === "sub_T34KEEP0001" && s.rzp.next.subscriptionId === r.json().subscriptionId && s.rzp.next.status === "created" && s.plan === "pro" && s.proUntil === until
    && st.m.get(KEY_RZPSUB_PREFIX + r.json().subscriptionId) === JSON.stringify({ id: keep.id }), "renew: the running plan stays; the renewal waits beside it as rzp.next, indexed for the webhook");
  const renewSub = r.json().subscriptionId;
  r = await act(keep, "checkout", { cats: ["industry", "web_app"], sweepsPerDay: 2, months: 12 });
  check(r.json().subscriptionId === renewSub && rzpCalls.length === calls + 1, "renew: the same choice again reopens the same renewal");
  // approving it in Checkout
  const sig = createHmac("sha256", KEY_SECRET).update(`pay_T34A|${renewSub}`).digest("hex");
  r = await act(keep, "checkout-return", { paymentId: "pay_T34A", subscriptionId: renewSub, signature: sig });
  s = await stored(keep);
  check(r.code === 200 && s.rzp.next.status === "authenticated" && JSON.stringify(r.json().renewal) === JSON.stringify({ months: 12, price: 1, startsAt: until }) && r.json().canRenew === false,
    "renew: Checkout's signed reply marks the renewal approved, and the account shows it");
  r = await act(keep, "checkout", { months: 1 });
  check(r.code === 409 && r.json().error === "already_renewed", "renew: a second renewal is refused");
  check(endingSoon(s, clock) === false, "renew: a cancelled plan with an approved renewal gets no ending warning");
  // the old plan ends first: Pro holds for the grace hours, then the renewal's first charge takes over
  clock = Date.parse(until) + 60_000;
  check((await send("cancelled", "sub_T34KEEP0001", keep, { end: endS })) === 200, "renew: the old plan's cancelled event is applied");
  s = await stored(keep);
  check(s.plan === "pro" && Date.parse(s.proUntil) === clock + RENEW_GRACE_HOURS * 3600_000, `renew: with a renewal approved, Pro holds ${RENEW_GRACE_HOURS} hours past the old end`);
  const newEnd = endS + 365 * 86400;
  check((await send("charged", renewSub, keep, { end: newEnd, remaining: 3 })) === 200, "renew: the renewal's first charge is applied");
  s = await stored(keep);
  check(s.rzp.subscriptionId === renewSub && !s.rzp.next && s.proUntil === iso(newEnd * 1000) && s.plan === "pro" && JSON.stringify(s.cats) === '["web_app","industry"]' && s.sweepsPerDay === 2
    && s.paidFor.sub === renewSub && s.paidFor.months === 12 && s.rzp.cancelAtPeriodEnd === false && s.rzp.remaining === 3,
    "renew: the renewal becomes the plan, with its categories, emails a day and period, and renews from then on");
  const before = JSON.stringify(s);
  check((await send("cancelled", "sub_T34KEEP0001", keep, { end: endS })) === 200 && JSON.stringify(await stored(keep)) === before, "renew: a late event for the old plan changes nothing");

  // cancelling again stops an approved renewal before it starts
  clock = T0;
  const twice = await add("twice@example.com", paidOver("sub_T34TWCE0001", { cancelAtPeriodEnd: true, next: { subscriptionId: "sub_T34TWCE0002", status: "authenticated", createdAt: iso(T0), startAt: until, choice: { cats: null, perDay: 2, months: 1, price: 1 } } }));
  r = await act(twice, "cancel");
  c = rzpCalls.at(-1);
  s = await stored(twice);
  check(r.code === 200 && c.url.endsWith("/subscriptions/sub_T34TWCE0002/cancel") && c.json.cancel_at_cycle_end === false && !s.rzp.next && r.json().canRenew === true,
    "renew: cancelling again cancels the renewal at once, and the plan can be renewed again");
  // a renewal whose first charge fails is dropped
  const failing = await add("failing@example.com", paidOver("sub_T34FAIL0001", { cancelAtPeriodEnd: true, next: { subscriptionId: "sub_T34FAIL0002", status: "authenticated", createdAt: iso(T0), startAt: until, choice: { cats: null, perDay: 2, months: 1, price: 1 } } }));
  await st.set(KEY_RZPSUB_PREFIX + "sub_T34FAIL0002", JSON.stringify({ id: failing.id }));
  await send("halted", "sub_T34FAIL0002", failing, { end: endS });
  s = await stored(failing);
  check(!s.rzp.next && s.rzp.subscriptionId === "sub_T34FAIL0001" && s.plan === "pro" && s.proUntil === until, "renew: a renewal that fails is dropped; the running plan is untouched");

  // after the end: Free, and the page gets the last plan to fill in
  const lapsed = await add("lapsed34@example.com", { plan: "free", proSource: null, proUntil: null, paidFor: { sub: "sub_T34LAPS0001", months: 12, price: 1 },
    rzp: paidRzp("sub_T34LAPS0001", { status: "cancelled", choice: { cats: ["gov_policy", "industry"], perDay: 4, months: 12, price: 1 } }) });
  r = await act(lapsed, "set-plan", { cats: null, sweepsPerDay: 1 });
  const g = mockRes();
  await acct({ method: "GET", headers: { host: "site.example" }, query: { id: lapsed.id, t: lapsed.token } }, g);
  check(JSON.stringify(g.json().lastPlan) === JSON.stringify({ cats: ["gov_policy", "industry"], perDay: 4, months: 12 }) && g.json().canRenew === false && g.json().effectivePlan === "free",
    "renew after the end: the account gives the last plan paid for, to fill the card in");
  r = await act(lapsed, "checkout", { cats: ["gov_policy", "industry"], sweepsPerDay: 4, months: 12 });
  check(r.code === 200 && !("start_at" in rzpCalls.at(-1).json) && r.json().renewing === false, "renew after the end: an ordinary checkout, starting now");

  // the warning a week before a plan that won't renew ends
  const W = (over) => ({ status: "active", plan: "pro", proUntil: iso(T0 + 5 * DAY), ...over });
  check(endingSoon(W({ proSource: "owner" }), T0) && !endingSoon(W({ proSource: "owner", proUntil: iso(T0 + 8 * DAY) }), T0) && !endingSoon(W({ proSource: "owner", endWarnedFor: iso(T0 + 5 * DAY) }), T0),
    "warning: an owner-granted Pro ending within 7 days, once per end date");
  check(endingSoon(W({ proSource: "razorpay", rzp: { cancelAtPeriodEnd: true } }), T0) && endingSoon(W({ proSource: "razorpay", rzp: { remaining: 0 } }), T0)
    && !endingSoon(W({ proSource: "razorpay", rzp: { cancelAtPeriodEnd: false, remaining: 4 } }), T0) && !endingSoon(W({ proSource: "owner", proUntil: iso(T0 - 1000) }), T0),
    "warning: a cancelled paid plan or its last cycle, never one that renews or has ended");
  {
    const ws = memStorage();
    const mails = [];
    const sendFetch = async (url, init) => { const b = JSON.parse(init.body); mails.push(...(Array.isArray(b) ? b : [b])); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: (Array.isArray(b) ? b : [b]).map(() => ({ id: "m" })) }) }; };
    const mk = async (email, over) => { const r0 = { ...newPending(email, { now: T0 - DAY, randomBytes: seeded(600 + email.length) }), status: "active", confirmedAt: iso(T0 - DAY), ...over }; await putSubscriber(ws, r0); return r0; };
    const o = await mk("owned@example.com", { plan: "pro", proSource: "owner", proUntil: iso(T0 + 3 * DAY) });
    await mk("renews@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 3 * DAY), rzp: { subscriptionId: "sub_T34R", status: "active", cancelAtPeriodEnd: false } });
    const cx = await mk("stops@example.com", { plan: "pro", proSource: "razorpay", proUntil: iso(T0 + 2 * DAY), rzp: { subscriptionId: "sub_T34S", status: "active", cancelAtPeriodEnd: true } });
    const sweep = { id: "1792570150999", at: iso(T0), slot: 0, slotAt: iso(T0), perCat: {}, problems: [] };
    const run = () => deliverToSubscribers({ env, storage: ws, fetchFn: sendFetch, now: () => T0, randomBytes: seeded(36), sweep, scheduled: true, log: () => {} });
    let res = await run();
    const warned = mails.filter((m) => /Pro ends on/.test(m.subject));
    check(res.endWarning.due === 2 && res.endWarning.sent === 2 && warned.map((m) => m.to[0] || m.to).sort().join() === "owned@example.com,stops@example.com",
      "warning: the sweep emails the owner-granted and the cancelled plan, not the one that renews");
    check(warned.every((m) => m.text.includes("https://site.example/manage/") && /won't renew/.test(m.text)) && warned.some((m) => /Keep renewing/.test(m.text)) && warned.some((m) => /Request Pro/.test(m.text)),
      "warning: it says when Pro ends, links the manage page, and says how to keep it (Keep renewing when paid, else Request Pro)");
    check((await getSubscriber(ws, o.id)).endWarnedFor === iso(T0 + 3 * DAY) && (await getSubscriber(ws, cx.id)).endWarnedFor === iso(T0 + 2 * DAY), "warning: each record remembers the end it was warned for");
    mails.length = 0;
    res = await run();
    check(res.endWarning.due === 0 && mails.filter((m) => /Pro ends on/.test(m.subject)).length === 0, "warning: a later sweep doesn't send it again");
    check(JSON.stringify(res).indexOf("@") === -1, "warning: the result holds no address");
  }
  check(replies.every((b) => !b.includes("@") && !b.includes(keep.token)), "renew: no reply holds an address or a token");
}

finish("subscription tests");
