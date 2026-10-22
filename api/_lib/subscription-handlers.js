// HTTP handlers for the subscriber endpoints (docs/subscriptions/tasks/T05 to T07), built from
// injected dependencies like handlers.js, so the offline tests can call them directly.
// Nothing here puts an address, an id or a token in a reply or a log line.
import { createHash, createHmac, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";
import { DEFAULT_FROM, buildAlreadySubscribedEmail, buildConfirmEmail, buildProRequestEmail, buildSignInEmail, sendEmail, sendOne } from "./email.js";
import { BodyTooLargeError, allowMethods, esc, readFields, sendJson, sendPage } from "./http.js";
import { clearCookie, originOk, readSession, sessionCookie, sessionSecret, signSession } from "./session.js";
import {
  CONFIRM_RESEND_HOURS, PENDING_TTL_DAYS, countEvents, deleteSubscriber, effectivePlan, findSubscriber, getSubscriber, newPending, normaliseCats, normaliseEmail, putSubscriber,
  recordEvent, tokenOk, utcDay,
} from "./subscribers.js";

// The sweep writes the number of active plus pending records here after each run (T10), so a
// sign-up reads one small file instead of listing every subscriber.
export const KEY_SUBSCRIBER_COUNT = "radar:subscriberCount";
export const DEFAULT_MAX_CONFIRMS_PER_DAY = 10;

// Per-IP sign-up attempts (T13 part B): one file per accepted attempt,
// radar:iphit:<YYYYMMDDHH>-<16 hex of a hash of the IP>-<6 hex>, counted with list. No raw IP is
// stored; the sweep deletes files older than IPHIT_KEEP_HOURS. The Vercel firewall rule in front
// (DEPLOYMENT.md) stops floods before they cost Blob operations; this gives the exact hourly limit.
export const KEY_IPHIT_PREFIX = "radar:iphit:";
export const DEFAULT_MAX_SIGNUPS_PER_IP_HOUR = 5;
export const IPHIT_KEEP_HOURS = 2;
export const utcHour = (now) => new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, ""); // YYYYMMDDHH

const OK_REPLY = { ok: true, message: "If that address can be subscribed, a confirmation link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder." };
// An address that is already subscribed is told so (the owner's choice, 2026-10-22, accepting that
// the reply shows whether an address subscribes). The inbox gets a notice with its manage link at
// most once every NOTICE_HOURS.
const ALREADY_EMAILED = { ok: true, already: true, message: "This address is already subscribed. We've emailed it a link to manage the subscription." };
const ALREADY = { ok: true, already: true, message: "This address is already subscribed. Use the Manage link in any digest email to change it." };
// Row 7 with sign-in set up (T16): the way back in is a sign-in link, so that is what goes.
const ALREADY_SIGNIN = { ok: true, already: true, message: "This address already has an account. We've emailed it a sign-in link. Not in your inbox within a few minutes? Check your spam or junk folder." };
const ALREADY_HELD = { ok: true, already: true, message: "This address already has an account. Sign in with a link from the sign-in page, or use the Manage link in any digest email." };
const PENDING_REPLY = { ok: true, message: "A confirmation link was already sent to this address in the last 24 hours. Check your inbox and spam or junk folder." };
export const NOTICE_HOURS = 24;
const HOUR_MS = 3600 * 1000;

// Emails sign-up has sent today: confirmations and already-subscribed notices share MAX_CONFIRMS_PER_DAY.
async function signupEmailsToday(storage, t) {
  const day = utcDay(t);
  return (await countEvents(storage, { day, type: "confirmsent" })) + (await countEvents(storage, { day, type: "noticesent" }));
}

const positiveInt = (v) => {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

// Unset or unreadable gives the default; an explicit 0 closes confirmations.
const maxConfirmsPerDay = (v) => {
  const raw = String(v ?? "").trim();
  if (raw === "0") return 0;
  return positiveInt(raw) ?? DEFAULT_MAX_CONFIRMS_PER_DAY;
};

// The client's IP as Vercel reports it. Vercel overwrites x-forwarded-for, so a client can't set
// it (docs: "Request headers"); x-vercel-forwarded-for is the same value and survives another
// proxy in front. Null when there is none (local runs, tests) or it doesn't look like an IP.
export function clientIp(headers = {}) {
  for (const name of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const v = headers[name];
    const first = String(Array.isArray(v) ? v[0] : v ?? "").split(",")[0].trim();
    if (first && /^[0-9a-f:.]{2,45}$/i.test(first)) return first;
  }
  return null;
}

// The list prefix for this IP's attempts in this UTC hour.
export const ipHitPrefix = (ip, now) =>
  `${KEY_IPHIT_PREFIX}${utcHour(now)}-${createHash("sha256").update("radar-ip:" + ip).digest("hex").slice(0, 16)}-`;

// T13 part B: true when this IP has used up its attempts this hour (sign-up and sign-in share the
// limit); otherwise the attempt is counted. A count we can't read counts as reached.
async function ipLimitReached({ req, env, storage, t, randomBytes }) {
  const ip = clientIp(req.headers);
  if (!ip) return false;
  const prefix = ipHitPrefix(ip, t);
  const maxPerIp = positiveInt(env.MAX_SIGNUPS_PER_IP_HOUR) ?? DEFAULT_MAX_SIGNUPS_PER_IP_HOUR;
  let hits;
  try { hits = (await storage.list(prefix)).length; } catch (e) { hits = Infinity; }
  if (hits >= maxPerIp) return true;
  try {
    await storage.set(prefix + Buffer.from(randomBytes(3)).toString("hex"), JSON.stringify({ at: new Date(t).toISOString() }));
  } catch (e) { /* best effort: a lost hit only makes the limit a little looser */ }
  return false;
}

// The count as a number. A missing file is 0 (no sweep has written one yet); a file that can't
// be read or understood is null, which callers treat as "full".
async function readSubscriberCount(storage) {
  try {
    const raw = await storage.get(KEY_SUBSCRIBER_COUNT);
    if (raw == null) return 0;
    const v = JSON.parse(raw);
    const n = typeof v === "number" ? v : v && typeof v === "object" ? v.count : NaN;
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch (e) { return null; }
}

// Where the links in emails point. SITE_URL, else the Vercel production domain, else nothing.
export function siteUrl(env) {
  const set = String(env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (set) return /^https?:\/\/[^\s<>"]+$/.test(set) ? set : "";
  const v = String(env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  return v && /^[a-z0-9.-]+(:\d+)?$/i.test(v) ? `https://${v}` : "";
}

export const senderOk = (from) => Boolean(from) && from !== DEFAULT_FROM && !/@resend\.dev\b/i.test(from);

// A ticked checkbox ("on"), the page script's "1", or JSON true.
const isYes = (v) => v === true || v === "1" || v === "on";

// Where a subscriber sees their plan and asks for Pro (T20 adds checkout to the same page).
export const managePath = (id, t) => `/manage/?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}`;

// Tells the owner (EMAIL_TO) that someone asked for Pro. Names nobody. Never throws, and a
// failed send never fails the request that caused it.
async function notifyOwnerProRequest({ env, fetchFn, at, source, log }) {
  try {
    const r = await sendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, to: env.EMAIL_TO }, buildProRequestEmail({ at: new Date(at).toISOString(), source }), { fetchFn });
    if (r !== "sent") log("pro-request owner-email", r);
  } catch (e) {
    log("pro-request owner-email", "error: " + ((e && e.name) || "Error"));
  }
}

export function makeSubscribeHandler({ env, storage, fetchFn, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function subscribe(req, res) {
    if (!allowMethods(req, res, ["POST"])) return;
    if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendJson(res, 503, { error: "subscriptions are not open yet" });
    const site = siteUrl(env);
    if (!env.RESEND_API_KEY || !senderOk(env.EMAIL_FROM) || !site) {
      log("subscribe", "not configured");
      return sendJson(res, 503, { error: "subscriptions are not open yet" });
    }

    let fields;
    try {
      fields = await readFields(req, { limit: 8192 });
    } catch (e) {
      if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
      throw e;
    }
    const reply = () => sendJson(res, 200, OK_REPLY);

    if (fields.website) return reply(); // the honeypot
    const email = normaliseEmail(fields.email);
    const wantsPro = isYes(fields.wantsPro); // counts only once the address is confirmed
    if (!email) return sendJson(res, 400, { error: "enter a valid email address" });

    try {
      const t = now();
      // More than the limit from one IP this hour gets the usual reply and nothing is stored or sent.
      if (await ipLimitReached({ req, env, storage, t, randomBytes })) return reply();
      const maxSubs = positiveInt(env.MAX_SUBSCRIBERS);
      const maxConfirms = maxConfirmsPerDay(env.MAX_CONFIRMS_PER_DAY);

      const existing = await findSubscriber(storage, email);
      if (existing && existing.status === "active") { // row 7
        if (sessionSecret(env)) {
          const sent = await sendSignInLink({ record: existing, env, storage, fetchFn, t, randomBytes, log, already: true });
          return sendJson(res, 200, sent === "sent" ? ALREADY_SIGNIN : ALREADY_HELD);
        }
        // Without sign-in (no SESSION_SECRET), the manage link instead.
        // A notice at most once every NOTICE_HOURS, and only under the day's cap.
        if (existing.noticeSentAt && t - Date.parse(existing.noticeSentAt) < NOTICE_HOURS * HOUR_MS) return sendJson(res, 200, ALREADY);
        let sentToday;
        try { sentToday = await signupEmailsToday(storage, t); } catch (e) { sentToday = Infinity; }
        if (sentToday >= maxConfirms) return sendJson(res, 200, ALREADY);
        const mail = buildAlreadySubscribedEmail({
          manageUrl: site + managePath(existing.id, existing.token),
          unsubscribeUrl: `${site}/api/unsubscribe?id=${existing.id}&t=${existing.token}`,
          siteUrl: site,
        });
        const result = await sendOne({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, { to: existing.email, ...mail }, {
          fetchFn,
          idempotencyKey: `notice-${existing.id.slice(0, 24)}-${t}`,
        });
        if (result !== "sent") {
          log("subscribe notice-email", result);
          return sendJson(res, 200, ALREADY);
        }
        try {
          await putSubscriber(storage, { ...existing, noticeSentAt: new Date(t).toISOString() });
          await recordEvent(storage, "noticesent", { now: t, randomBytes, plan: effectivePlan(existing, t) });
        } catch (e) {
          log("subscribe notice-record", "error: " + ((e && e.name) || "Error")); // the email went; say so
        }
        return sendJson(res, 200, ALREADY_EMAILED);
      }
      if (existing && existing.status !== "pending") return reply(); // anything unexpected
      if (existing && t - Date.parse(existing.confirmSentAt) < CONFIRM_RESEND_HOURS * HOUR_MS) return sendJson(res, 200, PENDING_REPLY); // row 8

      if (!existing) {
        // Rows 10: a full list, or one we can't measure, takes no new address.
        const count = await readSubscriberCount(storage);
        if (maxSubs === null || count === null || count >= maxSubs) return reply();
      }
      // Row 11 (and the same cap on a re-send, which spends quota the same way). A count we
      // can't read counts as reached.
      let sentToday;
      try { sentToday = await signupEmailsToday(storage, t); } catch (e) { sentToday = Infinity; }
      if (sentToday >= maxConfirms) return reply();

      let record = existing;
      if (!record) {
        record = newPending(email, { now: t, randomBytes });
      } else {
        record = { ...record, confirmSentAt: new Date(t).toISOString() };
      }
      if (wantsPro && !record.proRequestedAt) record = { ...record, proRequestedAt: new Date(t).toISOString() };
      await putSubscriber(storage, record);
      if (!existing) await recordEvent(storage, "subscribed", { now: t, randomBytes, plan: "free" });
      await recordEvent(storage, "confirmsent", { now: t, randomBytes, plan: "free" });

      const mail = buildConfirmEmail({ confirmUrl: `${site}/api/confirm?id=${record.id}&t=${record.token}`, siteUrl: site });
      const result = await sendOne({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, { to: record.email, ...mail }, {
        fetchFn,
        idempotencyKey: `confirm-${record.id.slice(0, 24)}-${Date.parse(record.confirmSentAt)}`,
      });
      if (result !== "sent") log("subscribe confirm-email", result);
      return reply();
    } catch (e) {
      log("subscribe", "error: " + ((e && e.name) || "Error"));
      return sendJson(res, 500, { error: "could not process the request; try again later" });
    }
  };
}

// ---- confirm and unsubscribe links (T06, T07)

const PAUSED = { title: "Subscriptions are paused", body: "<p>Subscriptions are paused right now. Your link stays valid: try it again later.</p>" };
const INVALID = { title: "This link isn't valid", body: `<p>It may have expired. <a href="/signup/">Sign up again</a>.</p>` };

// The id and token from the query string (GET), or from the form (POST) unless `queryOnly`: a
// mail app's one-click unsubscribe POSTs to the link itself, with only a fixed body. Anything not a string is "".
async function linkParams(req, { queryOnly }) {
  if (req.method === "POST" && !queryOnly) {
    const f = await readFields(req, { limit: 2048 });
    return { id: typeof f.id === "string" ? f.id : "", t: typeof f.t === "string" ? f.t : "", fields: f };
  }
  let q = req.query;
  if (!q || typeof q !== "object") q = Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
  return { id: typeof q.id === "string" ? q.id : "", t: typeof q.t === "string" ? q.t : "" };
}

// `name` is the secret's field: "t" for a token, "c" for a sign-in code.
const hiddenForm = (action, id, secret, label, name = "t") =>
  `<form method="post" action="${action}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="${name}" value="${esc(secret)}"><p><button type="submit">${esc(label)}</button></p></form>`;

// Shared by confirm and unsubscribe. Unknown id, bad token and missing fields are all the same
// answer (the invalid page), so the endpoint can't be used to test ids.
async function handleLink({ req, res, env, storage, now, page, queryOnly = false, needsEnabled = true, invalid = { code: 404, page: INVALID } }) {
  if (!allowMethods(req, res, ["GET", "POST"])) return;
  if (needsEnabled && env.SUBSCRIPTIONS_ENABLED !== "1") return sendPage(res, 503, PAUSED);
  let params;
  try {
    params = await linkParams(req, { queryOnly });
  } catch (e) {
    if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
    throw e;
  }
  try {
    const record = await getSubscriber(storage, params.id);
    if (!record || !tokenOk(record, params.t)) return sendPage(res, invalid.code, invalid.page);
    return await page({ record, params, post: req.method === "POST", now: now() });
  } catch (e) {
    return sendPage(res, 500, { title: "Something went wrong", body: "<p>Please try the link again in a minute.</p>" });
  }
}

export function makeConfirmHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function confirm(req, res) {
    return handleLink({
      req, res, env, storage, now,
      page: async ({ record, params, post, now: t }) => {
        // A pending record that was never confirmed within 7 days is deleted, and only for the
        // holder of its token, so nobody can delete a record by guessing an address's id.
        if (record.status === "pending" && t - Date.parse(record.createdAt) > PENDING_TTL_DAYS * 24 * 3600 * 1000) {
          await deleteSubscriber(storage, record.id);
          await recordEvent(storage, "expired", { now: t, randomBytes });
          return sendPage(res, 404, INVALID);
        }
        // Confirming also signs this browser in (T16), when sign-in is set up.
        const done = (rec) => {
          const secret = sessionSecret(env);
          if (secret) res.setHeader("set-cookie", sessionCookie(signSession(rec, { secret, now: t })));
          return sendPage(res, 200, {
            title: "You're subscribed",
            body: (secret ? `<p>Your account is ready, and you're signed in on this browser.</p>` : "")
              + `<p>You'll get the daily digest after the first sweep of the UTC day (about 05:47 IST).</p>`
              + (effectivePlan(rec, t) === "pro" ? ""
                : rec.proRequestedAt ? `<p>You asked for Pro (an email after every sweep). You'll be switched over shortly; until then you get the daily digest.</p>`
                : `<p>Want an email after every sweep instead? <a href="${esc(managePath(params.id, params.t))}">Request Pro</a></p>`)
              + `<p><a href="/live/">Open the live board</a></p>`,
          });
        };
        if (record.status === "active") {
          return post ? done(record) : sendPage(res, 200, { title: "You're already subscribed", body: `<p>Nothing more to do. <a href="${esc(managePath(params.id, params.t))}">Manage your subscription</a> · <a href="/live/">Open the live board</a></p>` });
        }
        if (record.status !== "pending") return sendPage(res, 404, INVALID);
        if (!post) {
          return sendPage(res, 200, {
            title: "Confirm your subscription",
            body: `<p>One click to start getting the Travel Problem Radar digest by email.</p>${hiddenForm("/api/confirm", params.id, params.t, "Confirm")}`,
          });
        }
        const active = { ...record, status: "active", confirmedAt: new Date(t).toISOString() };
        await putSubscriber(storage, active);
        await recordEvent(storage, "confirmed", { now: t, randomBytes, plan: record.plan === "pro" ? "pro" : "free" });
        // A Pro request ticked at sign-up counts from here, once the address is proven.
        if (active.proRequestedAt && effectivePlan(active, t) !== "pro") {
          await recordEvent(storage, "prorequested", { now: t, randomBytes, plan: "free" });
          await notifyOwnerProRequest({ env, fetchFn, at: t, source: "signup", log });
        }
        return done(active);
      },
    });
  };
}

export function makeUnsubscribeHandler({ env, storage, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function unsubscribe(req, res) {
    return handleLink({
      req, res, env, storage, now,
      queryOnly: true,
      needsEnabled: false, // leaving must always work
      // 200, not 404: a repeat click or a second one-click delivery isn't an error, and it changes nothing.
      // The words claim nothing about the address: a link from before a re-subscribe has the same id
      // but an old token, and that person is still on the list.
      invalid: { code: 200, page: { title: "This link is no longer active", body: "<p>Nothing was changed. If you already unsubscribed, you're off the list. If you're still getting emails, use the Unsubscribe link in the most recent one.</p>" } },
      page: async ({ record, params, post, now: t }) => {
        if (!post) {
          const action = `/api/unsubscribe?id=${encodeURIComponent(params.id)}&t=${encodeURIComponent(params.t)}`;
          return sendPage(res, 200, {
            title: "Unsubscribe from Travel Problem Radar?",
            body: `<p>You'll stop getting the digest, and your address will be deleted.</p><form method="post" action="${esc(action)}"><p><button type="submit">Unsubscribe</button></p></form>`,
          });
        }
        if (record.proSource === "razorpay" && effectivePlan(record, t) === "pro") {
          return sendPage(res, 200, {
            title: "Cancel your Pro plan first",
            body: `<p>Your Pro plan is paid, so it has to be cancelled on the <a href="${esc(managePath(params.id, params.t))}">manage page</a> before the address is deleted.</p>`,
          });
        }
        await deleteSubscriber(storage, record.id);
        await recordEvent(storage, "unsubscribed", { now: t, randomBytes, plan: record.plan === "pro" ? "pro" : "free" });
        return sendPage(res, 200, { title: "You're unsubscribed", body: "<p>Your address has been deleted. Nothing more will be sent.</p>" });
      },
    });
  };
}

// ---- the manage page's data (/manage/, linked from every digest)

// What the manage page may show: the plan, never the address.
const accountView = (record, t) => ({
  status: record.status,
  plan: record.plan === "pro" ? "pro" : "free",
  effectivePlan: effectivePlan(record, t),
  proUntil: record.proUntil || null,
  proSource: record.proSource || null,
  proRequestedAt: record.proRequestedAt || null,
  cats: record.cats || null,
});

// GET ?id&t: the plan. With no id and no token, the login cookie (T16) says whose plan; a POST
// signed in that way must come from this site (originOk). Replies add `signedIn`, whether this
// browser holds a valid login cookie. POST {id, t, action: "request-pro"}: ask for Pro. Until payments exist
// (T20, T21) the owner grants it with the admin script; this records the request and tells them.
// POST {id, t, action: "set-cats", cats: [...]}: a Pro subscriber picks their categories (T14).
export function makeAccountHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function account(req, res) {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendJson(res, 503, { error: "subscriptions are paused" });
    let params;
    let action = "";
    let cats;
    try {
      params = await linkParams(req, { queryOnly: false });
      if (params.fields && typeof params.fields.action === "string") action = params.fields.action;
      if (params.fields) cats = params.fields.cats;
    } catch (e) {
      if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
      throw e;
    }
    try {
      const t = now();
      const session = await readSession(req, { env, storage, now: t });
      let record;
      if (params.id || params.t) {
        record = await getSubscriber(storage, params.id);
        // Unknown id and wrong token are the same answer, so ids can't be tested.
        if (!record || !tokenOk(record, params.t)) return sendJson(res, 404, { error: "this link isn't valid" });
      } else {
        if (!session) return sendJson(res, 401, { error: "not_signed_in" });
        if (req.method === "POST" && !originOk(req)) return sendJson(res, 403, { error: "wrong_origin" });
        record = session;
      }
      const view = (rec) => ({ ...accountView(rec, t), signedIn: Boolean(session) });
      if (req.method === "GET") return sendJson(res, 200, view(record));

      if (action === "set-cats") {
        if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
        // A lapsed Pro is Free here too; what they chose before stays stored for when they renew.
        if (effectivePlan(record, t) !== "pro") return sendJson(res, 403, { error: "pro_only" });
        const chosen = normaliseCats(cats);
        if (!chosen.ok) return sendJson(res, 400, { error: "unknown category" });
        const updated = { ...record, cats: chosen.cats };
        await putSubscriber(storage, updated);
        return sendJson(res, 200, { ok: true, ...view(updated) });
      }
      if (action !== "request-pro") return sendJson(res, 400, { error: "unknown action" });
      if (record.status !== "active") return sendJson(res, 409, { error: "not_confirmed" });
      if (effectivePlan(record, t) === "pro") return sendJson(res, 409, { error: "already_pro" });
      if (record.proRequestedAt) return sendJson(res, 200, { ok: true, ...view(record) }); // a repeat click
      const updated = { ...record, proRequestedAt: new Date(t).toISOString() };
      await putSubscriber(storage, updated);
      await recordEvent(storage, "prorequested", { now: t, randomBytes, plan: "free" });
      await notifyOwnerProRequest({ env, fetchFn, at: t, source: "manage", log });
      return sendJson(res, 200, { ok: true, ...view(updated) });
    } catch (e) {
      log("account", "error: " + ((e && e.name) || "Error"));
      return sendJson(res, 500, { error: "could not process the request; try again later" });
    }
  };
}

// ---- sign-in by emailed link (T16, docs/subscriptions/paid-website.md)

export const SIGNIN_MINUTES = 15;
export const SIGNIN_GAP_MINUTES = 5;
export const DEFAULT_MAX_SIGNINS_PER_DAY = 50;
const MINUTE_MS = 60 * 1000;

// The same words whether or not the address has an account, and whether or not a limit held the email back.
const SIGNIN_REPLY = { ok: true, message: "If that address has an account, a sign-in link is on its way. Not in your inbox within a few minutes? Check your spam or junk folder." };
const NOT_SET_UP = { title: "Sign-in isn't set up yet", body: `<p>Use the Manage link in any digest email instead.</p>` };
const SIGNIN_INVALID = { title: "This sign-in link isn't valid", body: `<p>It may have expired or been used already. <a href="/signin/">Get a new link</a>.</p>` };

const codeHash = (code) => createHash("sha256").update("radar-signin:" + code).digest("hex");

// Constant-time: the record's stored hash against the hash of the code given.
function signinOk(record, code, t) {
  const s = record && record.signin;
  if (!s || typeof s.hash !== "string" || typeof code !== "string" || !code) return false;
  if (!(Date.parse(s.exp) > t)) return false;
  const want = Buffer.from(s.hash);
  const got = Buffer.from(codeHash(code));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Emails an active record a sign-in link, unless one went in the last SIGNIN_GAP_MINUTES (the newest
// link replaces the last) or the day's MAX_SIGNINS_PER_DAY is reached. Returns "sent", "held", or
// how the send failed. The caller has already checked the per-IP limit. `already`: the address
// tried to sign up again (row 7), which changes the email's first line.
async function sendSignInLink({ record, env, storage, fetchFn, t, randomBytes, log, already = false }) {
  if (record.signin && t - Date.parse(record.signin.sentAt) < SIGNIN_GAP_MINUTES * MINUTE_MS) return "held";
  const raw = String(env.MAX_SIGNINS_PER_DAY ?? "").trim();
  const maxPerDay = raw === "0" ? 0 : positiveInt(raw) ?? DEFAULT_MAX_SIGNINS_PER_DAY;
  let sentToday;
  try { sentToday = await countEvents(storage, { day: utcDay(t), type: "signinsent" }); } catch (e) { sentToday = Infinity; }
  if (sentToday >= maxPerDay) return "held";

  const site = siteUrl(env);
  const code = Buffer.from(randomBytes(32)).toString("base64url");
  await putSubscriber(storage, {
    ...record,
    signin: { hash: codeHash(code), exp: new Date(t + SIGNIN_MINUTES * MINUTE_MS).toISOString(), sentAt: new Date(t).toISOString() },
  });
  await recordEvent(storage, "signinsent", { now: t, randomBytes, plan: effectivePlan(record, t) });
  const mail = buildSignInEmail({ signInUrl: `${site}/api/session?id=${record.id}&c=${code}`, siteUrl: site, already });
  const result = await sendOne({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }, { to: record.email, ...mail }, {
    fetchFn,
    idempotencyKey: `signin-${record.id.slice(0, 24)}-${t}`,
  });
  if (result !== "sent") log(already ? "subscribe signin-email" : "session signin-email", result);
  return result;
}

// One endpoint, /api/session:
//   POST {action: "request", email, website}  emails a sign-in link to a confirmed address
//   GET  ?id&c                                 the link: a Sign in button (mail scanners open links)
//   POST id, c                                 the button: uses the code, sets the cookie, 303 to /live/
//   GET  ?action=me                            {signedIn, plan} for the pages
//   POST {action: "signout"}                   clears the cookie in this browser
// The code is random, stored only as a hash, works once and expires after SIGNIN_MINUTES.
export function makeSessionHandler({ env, storage, fetchFn = fetch, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function session(req, res) {
    if (!allowMethods(req, res, ["GET", "POST"])) return;
    let q = req.query;
    if (!q || typeof q !== "object") q = Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
    const t = now();
    const secret = sessionSecret(env);

    if (req.method === "GET" && q.action === "me") {
      const rec = await readSession(req, { env, storage, now: t });
      return sendJson(res, 200, { signedIn: Boolean(rec), plan: rec ? effectivePlan(rec, t) : null });
    }

    let fields = {};
    if (req.method === "POST") {
      try {
        fields = await readFields(req, { limit: 4096 });
      } catch (e) {
        if (e instanceof BodyTooLargeError) return sendJson(res, 413, { error: "request too large" });
        throw e;
      }
      if (!originOk(req)) return sendJson(res, 403, { error: "wrong_origin" });
      if (fields.action === "signout") {
        res.setHeader("set-cookie", clearCookie());
        return sendJson(res, 200, { ok: true });
      }
    }

    if (fields.action === "request") {
      const site = siteUrl(env);
      if (env.SUBSCRIPTIONS_ENABLED !== "1" || !secret || !env.RESEND_API_KEY || !senderOk(env.EMAIL_FROM) || !site) {
        return sendJson(res, 503, { error: "sign-in isn't set up yet" });
      }
      const reply = () => sendJson(res, 200, SIGNIN_REPLY);
      if (fields.website) return reply(); // the honeypot
      const email = normaliseEmail(fields.email);
      if (!email) return sendJson(res, 400, { error: "enter a valid email address" });
      try {
        if (await ipLimitReached({ req, env, storage, t, randomBytes })) return reply();
        const record = await findSubscriber(storage, email);
        if (record && record.status === "active") await sendSignInLink({ record, env, storage, fetchFn, t, randomBytes, log });
        return reply();
      } catch (e) {
        log("session", "error: " + ((e && e.name) || "Error"));
        return sendJson(res, 500, { error: "could not process the request; try again later" });
      }
    }
    if (req.method === "POST" && fields.action !== undefined) return sendJson(res, 400, { error: "unknown action" });

    // The link and its button. Unknown id, wrong code, used and expired all get the same page.
    if (env.SUBSCRIPTIONS_ENABLED !== "1") return sendPage(res, 503, PAUSED);
    if (!secret) return sendPage(res, 503, NOT_SET_UP);
    const src = req.method === "POST" ? fields : q;
    const id = typeof src.id === "string" ? src.id : "";
    const code = typeof src.c === "string" ? src.c : "";
    try {
      const record = await getSubscriber(storage, id);
      if (!record || record.status !== "active" || !signinOk(record, code, t)) return sendPage(res, 400, SIGNIN_INVALID);
      if (req.method === "GET") {
        return sendPage(res, 200, { title: "Sign in to Travel Problem Radar", body: `<p>One click to sign in on this browser.</p>${hiddenForm("/api/session", id, code, "Sign in", "c")}` });
      }
      const used = { ...record, signin: null };
      await putSubscriber(storage, used);
      res.statusCode = 303;
      res.setHeader("set-cookie", sessionCookie(signSession(used, { secret, now: t })));
      res.setHeader("location", "/live/");
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      return res.end();
    } catch (e) {
      log("session", "error: " + ((e && e.name) || "Error"));
      return sendPage(res, 500, { title: "Something went wrong", body: "<p>Please try the link again in a minute.</p>" });
    }
  };
}

// ---- bounces and complaints from Resend (T13 part A)

export const WEBHOOK_TOLERANCE_S = 300;
const WEBHOOK_MAX_BYTES = 64 * 1024;
const WEBHOOK_MAX_RECIPIENTS = 50;

// Resend signs webhooks the Svix way: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>",
// keyed with the base64 part of the secret after "whsec_", sent base64 in svix-signature as a
// space-separated list of "v1,<sig>". True only for a matching v1 signature on a timestamp
// within WEBHOOK_TOLERANCE_S of now (ms). Never throws.
export function verifySvix({ secret, id, timestamp, signature, raw, now }) {
  try {
    if (!secret || !id || !timestamp || !signature || typeof raw !== "string") return false;
    if (!/^\d{1,12}$/.test(timestamp)) return false;
    if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > WEBHOOK_TOLERANCE_S) return false;
    const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
    if (!key.length) return false;
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
    return String(signature).split(" ").some((part) => {
      const [version, sig] = part.split(",");
      if (version !== "v1" || !sig) return false;
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  } catch (e) { return false; }
}

const jsonResponse = (code, body) => new Response(JSON.stringify(body), {
  status: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

// The action a verified event asks for: "bounced" for a hard bounce, "complained" for a spam
// report, null for anything else (soft and undetermined bounces, other event types).
function webhookAction(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "email.complained") return "complained";
  if (event.type === "email.bounced" && event.data && event.data.bounce && event.data.bounce.type === "Permanent") return "bounced";
  return null;
}

// POST /api/resend-webhook, as a Web-standard handler: (Request) => Response. It reads the body
// with request.text() because the signature covers the exact bytes. A hard bounce or complaint
// deletes that subscriber's record and records an event with no address. Works while
// subscriptions are switched off, like unsubscribe: removing an address is always allowed.
export function makeResendWebhookHandler({ env, storage, now, randomBytes = cryptoRandomBytes, log = console.log }) {
  return async function resendWebhook(request) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const secret = String(env.RESEND_WEBHOOK_SECRET || "").trim();
    if (!secret) {
      log("resend-webhook", "not configured");
      return jsonResponse(503, { error: "not configured" });
    }
    const declared = Number(request.headers.get("content-length"));
    if (declared > WEBHOOK_MAX_BYTES) return jsonResponse(413, { error: "request too large" });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > WEBHOOK_MAX_BYTES) return jsonResponse(413, { error: "request too large" });

    const t = now();
    const ok = verifySvix({
      secret, raw, now: t,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    });
    if (!ok) return jsonResponse(401, { error: "invalid signature" });

    let event;
    try { event = JSON.parse(raw); } catch (e) { return jsonResponse(400, { error: "malformed body" }); }
    const action = webhookAction(event);
    if (!action) return jsonResponse(200, { ok: true, ignored: true });

    const to = Array.isArray(event.data && event.data.to) ? event.data.to.slice(0, WEBHOOK_MAX_RECIPIENTS) : [];
    try {
      let removed = 0;
      for (const addr of to) {
        const email = normaliseEmail(addr);
        if (!email) continue;
        const record = await findSubscriber(storage, email);
        if (!record) continue; // not a subscriber, e.g. the owner's own EMAIL_TO
        await deleteSubscriber(storage, record.id);
        await recordEvent(storage, action, { now: t, randomBytes, plan: effectivePlan(record, t) });
        removed++;
      }
      log("resend-webhook", `${action}: removed ${removed}`);
      return jsonResponse(200, { ok: true });
    } catch (e) {
      log("resend-webhook", "error: " + ((e && e.name) || "Error"));
      return jsonResponse(500, { error: "could not process the event; try again later" });
    }
  };
}
