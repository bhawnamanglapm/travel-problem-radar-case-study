// HTTP handlers for the subscriber endpoints (docs/subscriptions/tasks/T05 to T07), built from
// injected dependencies like handlers.js, so the offline tests can call them directly.
// Nothing here puts an address, an id or a token in a reply or a log line.
import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { DEFAULT_FROM, buildConfirmEmail, sendOne } from "./email.js";
import { BodyTooLargeError, allowMethods, readFields, sendJson } from "./http.js";
import {
  CONFIRM_RESEND_HOURS, countEvents, getSubscriber, newPending, normaliseEmail, putSubscriber, recordEvent, subscriberId, utcDay,
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
