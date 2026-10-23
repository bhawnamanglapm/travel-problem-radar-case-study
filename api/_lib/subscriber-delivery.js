// Delivery to subscribers after a saved sweep (docs/subscriptions/tasks/T09): Pro gets an email
// after every saved scheduled sweep, Free gets one roll-up per UTC day. What was sent is
// remembered in radar:deliveries:<YYYYMMDD>, so a send that is cut off picks up later without
// sending anyone the same digest twice. Never throws; the result and the log hold counts only.
import { buildDigestEmail, sendBatch, withSubscriberFooter } from "./email.js";
import { KEY_INDEX, sweepKey } from "./radar.js";
import { IPHIT_KEEP_HOURS, KEY_IPHIT_PREFIX, KEY_RZPEVENT_PREFIX, KEY_SUBSCRIBER_COUNT, RZP_EVENT_KEEP_DAYS, managePath, senderOk, siteUrl, utcHour } from "./subscription-handlers.js";
import { PENDING_TTL_DAYS, deleteSubscriber, effectivePlan, listSubscribers, normaliseCats, recordEvent, utcDay } from "./subscribers.js";

export const KEY_DELIVERIES_PREFIX = "radar:deliveries:";
const DAY_MS = 24 * 3600 * 1000;
const KEEP_DELIVERY_DAYS = 7;
const MAX_ROLLUP_SWEEPS = 12; // 24 h of 5-hourly sweeps is about 5; this leaves room for manual runs
const SEV_RANK = { High: 3, Medium: 2, Low: 1 };

// Error text for the result and the log: the class name and a short message with anything that
// looks like an address, an id or a token taken out.
const safeError = (e) => {
  const msg = String((e && e.message) || e).replace(/\S+@\S+/g, "[address]").replace(/[0-9a-f]{40,}/gi, "[id]").slice(0, 120);
  return `${(e && e.name) || "Error"}: ${msg}`;
};

async function readJSON(storage, key) {
  try {
    const v = await storage.get(key);
    return v == null ? null : JSON.parse(v);
  } catch (e) { return null; }
}

// The Free roll-up: every problem saved in the 24 hours up to `now`, one copy per id (the newest),
// New if any of those sweeps flagged it New, sorted like runDailySweep sorts. `sweep` itself is
// always included, even if reading it back fails.
export async function buildRollup(storage, sweep, now) {
  const hist = await readJSON(storage, KEY_INDEX);
  const entries = (Array.isArray(hist) ? hist : [])
    .filter((e) => e && e.id && e.id !== sweep.id && now - Date.parse(e.at) < DAY_MS && Date.parse(e.at) <= now)
    .slice(-MAX_ROLLUP_SWEEPS);
  const sets = [];
  for (const e of entries) {
    const s = await readJSON(storage, sweepKey(e.id));
    if (s && Array.isArray(s.problems)) sets.push({ at: Date.parse(e.at), problems: s.problems });
  }
  sets.sort((a, b) => a.at - b.at);
  sets.push({ at: Date.parse(sweep.at), problems: sweep.problems });
  const byId = new Map();
  for (const s of sets) {
    for (const p of s.problems) {
      const was = byId.get(p.id);
      byId.set(p.id, { ...p, isNew: Boolean(p.isNew) || Boolean(was && was.isNew) });
    }
  }
  return [...byId.values()].sort((a, b) => (b.isNew - a.isNew) || ((SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0)));
}

// A Pro record's categories as a group key: "all", or the chosen keys joined with "+". A stored
// value that normaliseCats wouldn't accept (hand-edited, or from an older shape) counts as "all".
export function proCatsKey(cats) {
  const n = normaliseCats(cats);
  return n.ok && n.cats ? n.cats.join("+") : "all";
}

export async function deliverToSubscribers({ env, storage, fetchFn, now, randomBytes, sweep, scheduled, deadlineAt, log = console.log }) {
  try {
    const site = siteUrl(env);
    if (env.SUBSCRIPTIONS_ENABLED !== "1" || !env.RESEND_API_KEY || !senderOk(env.EMAIL_FROM) || !site) return "not configured";

    const t = now();
    const result = { pro: null, free: null, pending: 0, expired: 0, unreadable: 0, emailOff: 0, stopped: null };
    const creds = { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
    const shouldStop = () => deadlineAt != null && now() >= deadlineAt;

    // 2. Load and tidy the list
    const { records, skipped } = await listSubscribers(storage);
    result.unreadable = skipped;
    const live = [];
    for (const r of records) {
      if (r.status === "pending" && t - Date.parse(r.createdAt) > PENDING_TTL_DAYS * DAY_MS) {
        await deleteSubscriber(storage, r.id);
        await recordEvent(storage, "expired", { now: t, randomBytes });
        result.expired++;
      } else if (r.status === "pending") {
        result.pending++;
        live.push(r);
      } else if (r.status === "active") {
        live.push(r);
      }
    }
    try {
      await storage.set(KEY_SUBSCRIBER_COUNT, JSON.stringify({ count: live.length, at: new Date(t).toISOString() }));
    } catch (e) { result.countSaveFailed = true; }

    // A Pro account whose emails stopped (unsubscribed, bounced or complained: T17) stays, but gets nothing.
    const active = live.filter((r) => r.status === "active");
    const emailOn = active.filter((r) => !r.emailOff);
    result.emailOff = active.length - emailOn.length;
    const sendable = emailOn.filter((r) => typeof r.email === "string" && typeof r.token === "string" && r.token);
    result.unreadable += emailOn.length - sendable.length;
    const pro = sendable.filter((r) => effectivePlan(r, t) === "pro");
    const free = sendable.filter((r) => effectivePlan(r, t) !== "pro");
    const message = (r, mail, plan) => ({
      to: r.email,
      ...withSubscriberFooter(mail, { unsubscribeUrl: `${site}/api/unsubscribe?id=${r.id}&t=${r.token}`, manageUrl: site + managePath(r.id, r.token), plan }),
    });
    const liveUrl = `${site}/live/`;
    let halted = false;
    const note = (r) => { if (r.stopped && !result.stopped) { result.stopped = r.stopped; halted = true; } };

    // 3. Pro: every saved scheduled sweep
    if (!scheduled) {
      result.pro = { skipped: "manual run" };
    } else if (pro.length) {
      // One email body per distinct set of chosen categories (T14), at most 15. "all" keeps the
      // idempotency key Pro had before categories, so a retry around a deploy can't send twice.
      result.pro = { due: pro.length, sent: 0, failed: 0, deferred: 0, emptyForCats: 0 };
      const groups = new Map();
      for (const rec of pro) {
        const key = proCatsKey(rec.cats);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rec);
      }
      const keys = [...groups.keys()].sort((a, b) => (a === "all" ? -1 : b === "all" ? 1 : a < b ? -1 : 1));
      for (const key of keys) {
        const recs = groups.get(key);
        const cats = key === "all" ? null : key.split("+");
        const problems = cats ? sweep.problems.filter((p) => cats.includes(p.cat)) : sweep.problems;
        if (!problems.length) { result.pro.emptyForCats += recs.length; continue; }
        if (halted) { result.pro.deferred += recs.length; continue; }
        const perCat = cats ? Object.fromEntries(Object.entries(sweep.perCat || {}).filter(([k]) => cats.includes(k))) : sweep.perCat;
        const mail = buildDigestEmail({ at: sweep.at, problems, perCat }, liveUrl, { heading: "Travel Problem Radar: Pro update", cats });
        const r = await sendBatch(creds, recs.map((rec) => message(rec, mail, "pro")), {
          fetchFn, shouldStop, idempotencyKey: key === "all" ? `${sweep.id}-pro` : `${sweep.id}-pro-${key}`,
        });
        result.pro.sent += r.sent;
        result.pro.failed += r.failed;
        result.pro.deferred += recs.length - r.sent - r.failed;
        note(r);
      }
    } else {
      result.pro = { due: 0, sent: 0, failed: 0, deferred: 0, emptyForCats: 0 };
    }

    // 4 and 5. Free: once per UTC day
    const today = utcDay(t);
    const deliveriesKey = KEY_DELIVERIES_PREFIX + today;
    const doneFile = await readJSON(storage, deliveriesKey);
    const sentToday = new Set(doneFile && Array.isArray(doneFile.free) ? doneFile.free : []);
    const due = free.filter((r) => !sentToday.has(r.id));
    // With the board locked (T17), Free gets the summary: counts and headlines, and a sign-in link (T18).
    const teaser = env.BOARD_PAYWALL === "1";
    result.free = { due: due.length, sent: 0, failed: 0, deferred: 0, alreadySent: free.length - due.length, teaser };
    if (due.length && halted) {
      result.free.deferred = due.length;
    } else if (due.length) {
      const problems = await buildRollup(storage, sweep, t);
      const mail = teaser
        ? buildDigestEmail({ at: sweep.at, problems, perCat: {} }, liveUrl, { heading: "Travel Problem Radar: daily summary", subjectLead: "daily summary", teaser, signInUrl: `${site}/signin/` })
        : buildDigestEmail({ at: sweep.at, problems, perCat: {} }, liveUrl, { heading: "Travel Problem Radar: daily digest", subjectLead: "daily" });
      const r = await sendBatch(creds, due.map((rec) => message(rec, mail, "free")), {
        // A different body needs a different key: Resend refuses a reused key with a new body.
        fetchFn, shouldStop, idempotencyKey: `${today}-free-${sweep.id}${teaser ? "-teaser" : ""}`,
        // After each chunk, so a timeout after chunk 2 doesn't resend chunks 1 and 2 at the next sweep.
        onChunk: async ({ sentIndexes }) => {
          if (!sentIndexes.length) return;
          sentIndexes.forEach((i) => sentToday.add(due[i].id));
          try {
            await storage.set(deliveriesKey, JSON.stringify({ free: [...sentToday] }));
          } catch (e) { result.deliveriesSaveFailed = true; throw e; }
        },
      });
      Object.assign(result.free, { sent: r.sent, failed: r.failed, deferred: due.length - r.sent - r.failed });
      note(r);
    }

    // Old delivery files
    try {
      const cutoff = utcDay(t - KEEP_DELIVERY_DAYS * DAY_MS);
      for (const day of await storage.list(KEY_DELIVERIES_PREFIX)) {
        if (/^\d{8}$/.test(day) && day < cutoff) await storage.del(KEY_DELIVERIES_PREFIX + day);
      }
    } catch (e) { /* tidying is best effort */ }

    // Old per-IP sign-up counters (T13 part B): keys start with the UTC hour, YYYYMMDDHH.
    try {
      const cutoff = utcHour(t - IPHIT_KEEP_HOURS * 3600 * 1000);
      for (const suffix of await storage.list(KEY_IPHIT_PREFIX)) {
        if (/^\d{10}-/.test(suffix) && suffix.slice(0, 10) < cutoff) await storage.del(KEY_IPHIT_PREFIX + suffix);
      }
    } catch (e) { /* tidying is best effort */ }

    // Old Razorpay event markers (T21): keys start with the event's UTC day, YYYYMMDD.
    try {
      const cutoff = utcDay(t - RZP_EVENT_KEEP_DAYS * DAY_MS);
      for (const suffix of await storage.list(KEY_RZPEVENT_PREFIX)) {
        if (/^\d{8}-/.test(suffix) && suffix.slice(0, 8) < cutoff) await storage.del(KEY_RZPEVENT_PREFIX + suffix);
      }
    } catch (e) { /* tidying is best effort */ }

    log("subscribers", JSON.stringify(result));
    return result;
  } catch (e) {
    const out = { error: safeError(e) };
    try { log("subscribers", JSON.stringify(out)); } catch (e2) { /* nothing more to do */ }
    return out;
  }
}
