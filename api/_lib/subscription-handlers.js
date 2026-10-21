// HTTP handlers for the subscriber endpoints (docs/subscriptions/tasks/T05 to T07), built from
// injected dependencies like handlers.js, so the offline tests can call them directly.
// Nothing here puts an address, an id or a token in a reply or a log line.
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { DEFAULT_FROM, buildConfirmEmail, sendOne } from "./email.js";
import { BodyTooLargeError, allowMethods, esc, readFields, sendJson, sendPage } from "./http.js";
import {
  CONFIRM_RESEND_HOURS, PENDING_TTL_DAYS, countEvents, deleteSubscriber, effectivePlan, getSubscriber, newPending, normaliseEmail, putSubscriber,
  recordEvent, subscriberId, tokenOk, utcDay,
} from "./subscribers.js";

// The sweep writes the number of active plus pending records here after each run (T10), so a
// sign-up reads one small file instead of listing every subscriber.
export const KEY_SUBSCRIBER_COUNT = "radar:subscriberCount";
export const DEFAULT_MAX_CONFIRMS_PER_DAY = 10;

const OK_REPLY = { ok: true, message: "If that address can be subscribed, a confirmation link is on its way." };
const HOUR_MS = 3600 * 1000;

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

const senderOk = (from) => Boolean(from) && from !== DEFAULT_FROM && !/@resend\.dev\b/i.test(from);

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
    if (!email) return sendJson(res, 400, { error: "enter a valid email address" });

    try {
      const t = now();
      const maxSubs = positiveInt(env.MAX_SUBSCRIBERS);
      const maxConfirms = maxConfirmsPerDay(env.MAX_CONFIRMS_PER_DAY);

      const existing = await getSubscriber(storage, subscriberId(email));
      if (existing && existing.status !== "pending") return reply(); // active (row 7), or anything unexpected
      if (existing && t - Date.parse(existing.confirmSentAt) < CONFIRM_RESEND_HOURS * HOUR_MS) return reply(); // row 8

      if (!existing) {
        // Rows 10: a full list, or one we can't measure, takes no new address.
        const count = await readSubscriberCount(storage);
        if (maxSubs === null || count === null || count >= maxSubs) return reply();
      }
      // Row 11 (and the same cap on a re-send, which spends quota the same way). A count we
      // can't read counts as reached.
      let sentToday;
      try { sentToday = await countEvents(storage, { day: utcDay(t), type: "confirmsent" }); } catch (e) { sentToday = Infinity; }
      if (sentToday >= maxConfirms) return reply();

      let record = existing;
      if (!record) {
        record = newPending(email, { now: t, randomBytes });
      } else {
        record = { ...record, confirmSentAt: new Date(t).toISOString() };
      }
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
const INVALID = { title: "This link isn't valid", body: `<p>It may have expired. <a href="/subscribe/">Sign up again</a>.</p>` };

// The id and token from the query string (GET), or from the form (POST) unless `queryOnly`: a
// mail app's one-click unsubscribe POSTs to the link itself, with only a fixed body. Anything not a string is "".
async function linkParams(req, { queryOnly }) {
  if (req.method === "POST" && !queryOnly) {
    const f = await readFields(req, { limit: 2048 });
    return { id: typeof f.id === "string" ? f.id : "", t: typeof f.t === "string" ? f.t : "" };
  }
  let q = req.query;
  if (!q || typeof q !== "object") q = Object.fromEntries(new URL(req.url || "/", "http://x").searchParams);
  return { id: typeof q.id === "string" ? q.id : "", t: typeof q.t === "string" ? q.t : "" };
}

const hiddenForm = (action, id, t, label) =>
  `<form method="post" action="${action}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(t)}"><p><button type="submit">${esc(label)}</button></p></form>`;

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

export function makeConfirmHandler({ env, storage, now, randomBytes = cryptoRandomBytes, log = console.log }) {
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
        const done = () => sendPage(res, 200, {
          title: "You're subscribed",
          body: `<p>You'll get the daily digest after the first sweep of the UTC day (about 05:47 IST).</p><p><a href="/live/">Open the live board</a></p>`,
        });
        if (record.status === "active") {
          return post ? done() : sendPage(res, 200, { title: "You're already subscribed", body: `<p>Nothing more to do. <a href="/live/">Open the live board</a></p>` });
        }
        if (record.status !== "pending") return sendPage(res, 404, INVALID);
        if (!post) {
          return sendPage(res, 200, {
            title: "Confirm your subscription",
            body: `<p>One click to start getting the Travel Problem Radar digest by email.</p>${hiddenForm("/api/confirm", params.id, params.t, "Confirm")}`,
          });
        }
        await putSubscriber(storage, { ...record, status: "active", confirmedAt: new Date(t).toISOString() });
        await recordEvent(storage, "confirmed", { now: t, randomBytes, plan: record.plan === "pro" ? "pro" : "free" });
        return done();
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
      invalid: { code: 200, page: { title: "You're not subscribed", body: "<p>This address isn't on the list, so nothing more will be sent.</p>" } },
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
            body: `<p>Your Pro plan is paid, so it has to be cancelled on the <a href="/subscribe/">manage page</a> before the address is deleted.</p>`,
          });
        }
        await deleteSubscriber(storage, record.id);
        await recordEvent(storage, "unsubscribed", { now: t, randomBytes, plan: record.plan === "pro" ? "pro" : "free" });
        return sendPage(res, 200, { title: "You're unsubscribed", body: "<p>Your address has been deleted. Nothing more will be sent.</p>" });
      },
    });
  };
}
