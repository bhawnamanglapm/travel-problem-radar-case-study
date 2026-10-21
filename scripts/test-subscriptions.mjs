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
import { KEY_SUBSCRIBER_COUNT, makeSubscribeHandler, siteUrl } from "../api/_lib/subscription-handlers.js";
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

finish("subscription tests");
