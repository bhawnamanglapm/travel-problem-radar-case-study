// Delivery to subscribers after a saved sweep (docs/subscriptions/tasks/T09): Pro gets an email
// in each slot of the number a day they chose (T32), Free gets one roll-up per UTC day. What was sent is
// remembered in radar:deliveries:<YYYYMMDD>, so a send that is cut off picks up later without
// sending anyone the same digest twice. Never throws; the result and the log hold counts only.
import { buildDigestEmail, buildPlanEndingEmail, sendBatch, withSubscriberFooter } from "./email.js";
import { KEY_INDEX, areaOf, sweepKey } from "./radar.js";
import { IPHIT_KEEP_HOURS, KEY_IPHIT_PREFIX, KEY_RZPEVENT_PREFIX, KEY_SUBSCRIBER_COUNT, RZP_EVENT_KEEP_DAYS, managePath, senderOk, siteUrl, utcHour } from "./subscription-handlers.js";
import { DEFAULT_SWEEPS_PER_DAY, SLOTS_BY_FREQ, previousSlotAt, slotOf, sweepLimits, sweepsPerDayOf } from "./schedule.js";
import { KEY_DELIVERIES_PREFIX, PENDING_TTL_DAYS, deleteSubscriber, effectivePlan, listSubscribers, normaliseAreas, normaliseCats, readAreas, recordEvent, updateSubscriber, utcDay } from "./subscribers.js";

export { KEY_DELIVERIES_PREFIX };
const DAY_MS = 24 * 3600 * 1000;
const KEEP_DELIVERY_DAYS = 7;
const MAX_ROLLUP_SWEEPS = 12; // 24 h holds at most 5 scheduled sweeps; this leaves room for manual runs
const SEV_RANK = { High: 3, Medium: 2, Low: 1 };
export const END_WARNING_DAYS = 7;
// Razorpay states after which a paid plan won't be charged again (T22). A missed webhook can leave such a record on
// plan "pro" past its end; the tidy step in step 2 moves it to Free.
const RZP_LAPSED = new Set(["cancelled", "completed", "halted", "expired"]);
const paidPastEnd = (r, t) => r.status === "active" && r.proSource === "razorpay" && r.plan === "pro" && effectivePlan(r, t) !== "pro";
const rzpStatusOf = (r) => (r.rzp && typeof r.rzp === "object" ? r.rzp.status : null);

// A Pro plan that ends within END_WARNING_DAYS and won't renew (T34): a paid plan cancelled with no renewal set up,
// a paid plan in its last billing cycle, or an owner-granted Pro with an end date. Not yet warned for this end.
export function endingSoon(r, t) {
  if (effectivePlan(r, t) !== "pro" || !r.proUntil) return false;
  const left = Date.parse(r.proUntil) - t;
  if (!(left > 0 && left <= END_WARNING_DAYS * DAY_MS) || r.endWarnedFor === r.proUntil) return false;
  if (r.proSource !== "razorpay") return true;
  const rzp = r.rzp && typeof r.rzp === "object" ? r.rzp : {};
  const renewal = rzp.next && rzp.next.status === "authenticated";
  return (rzp.cancelAtPeriodEnd === true && !renewal) || rzp.remaining === 0;
}

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
// always included, even if reading it back fails. `include` picks other index entries instead of
// the 24 hours (a Pro member's window, T32).
export async function buildRollup(storage, sweep, now, { include } = {}) {
  const inDay = (e) => now - Date.parse(e.at) < DAY_MS && Date.parse(e.at) <= now;
  const hist = await readJSON(storage, KEY_INDEX);
  const entries = (Array.isArray(hist) ? hist : [])
    .filter((e) => e && e.id && e.id !== sweep.id && (include || inDay)(e))
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

// A Pro record's areas (T41) as a group key, like proCatsKey: "all", or the chosen areas as slugs
// joined with "+" ("asia+europe"). A stored value normaliseAreas wouldn't accept counts as "all".
const areaSlug = (a) => a.toLowerCase().replace(/[^a-z0-9]+/g, "-");
export function proAreasKey(areas) {
  const n = normaliseAreas(areas);
  return n.ok && n.areas ? n.areas.map(areaSlug).join("+") : "all";
}

export async function deliverToSubscribers({ env, storage, fetchFn, now, randomBytes, sweep, scheduled, deadlineAt, log = console.log }) {
  try {
    const site = siteUrl(env);
    if (env.SUBSCRIPTIONS_ENABLED !== "1" || !env.RESEND_API_KEY || !senderOk(env.EMAIL_FROM) || !site) return "not configured";

    const t = now();
    const result = { pro: null, free: null, pending: 0, expired: 0, unreadable: 0, emailOff: 0, proLapsed: 0, rzpMismatch: 0, stopped: null };
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
      } else if (r.status === "active" && paidPastEnd(r, t) && RZP_LAPSED.has(rzpStatusOf(r))) {
        // T22: a paid plan that has ended (grace included) but is still stored as Pro: the webhook that would have
        // moved it was missed. The stored record is checked again, so a webhook landing now wins. rzp is kept.
        let rec = r;
        try {
          const u = await updateSubscriber(storage, r.id, (cur) => (paidPastEnd(cur, t) && RZP_LAPSED.has(rzpStatusOf(cur)) ? { ...cur, plan: "free", proSource: null, proUntil: null } : null));
          if (u.changed) {
            rec = u.record;
            result.proLapsed++;
            await recordEvent(storage, "prorevoked", { now: t, randomBytes, plan: "free" });
          }
        } catch (e) { result.proLapsedSaveFailed = true; }
        live.push(rec);
      } else if (r.status === "active") {
        // Ended but Razorpay's last word was "active": a renewal charge that hasn't arrived. Counted for the owner
        // to check with `subscribers.mjs show <email> --check`; delivery already treats it as Free.
        if (paidPastEnd(r, t) && rzpStatusOf(r) === "active") result.rzpMismatch++;
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

    // 3. Pro: the scheduled sweeps in the slots each member chose (T32)
    if (!scheduled) {
      result.pro = { skipped: "manual run" };
    } else if (pro.length) {
      // One email body per distinct set of chosen categories (T14) and number a day, at most 15 × 5.
      // "all" at the default number keeps the idempotency key Pro had before either choice, so a
      // retry around a deploy can't send twice.
      const { max } = sweepLimits(env);
      const slot = Number.isInteger(sweep.slot) && sweep.slotAt
        ? { hour: sweep.slot, at: Date.parse(sweep.slotAt) } : slotOf(Date.parse(sweep.at));
      result.pro = { due: pro.length, slot: slot.hour, sent: 0, failed: 0, deferred: 0, emptyForCats: 0, notThisSlot: 0 };
      const groups = new Map();
      for (const rec of pro) {
        const f = sweepsPerDayOf(rec, max);
        const key = proCatsKey(rec.cats);
        const areaKey = proAreasKey(readAreas(rec));
        const g = `${key}|${areaKey}|${f}`;
        if (!groups.has(g)) groups.set(g, { key, areaKey, f, areas: normaliseAreas(readAreas(rec)).areas || null, recs: [] });
        groups.get(g).recs.push(rec);
      }
      const byKey = (a, b) => (a === b ? 0 : a === "all" ? -1 : b === "all" ? 1 : a < b ? -1 : 1);
      const order = (a, b) => byKey(a.key, b.key) || byKey(a.areaKey, b.areaKey) || a.f - b.f;
      // A member on fewer a day than the site gets every scheduled sweep since their last slot, so
      // nothing found in between is missed. On the site's number, that is only this sweep.
      const slotAtOf = (e) => (e.slotAt ? Date.parse(e.slotAt) : slotOf(Date.parse(e.at)).at);
      const sinceSlot = new Map();
      const problemsFor = async (f) => {
        if (!sinceSlot.has(f)) {
          const from = previousSlotAt(f, slot);
          sinceSlot.set(f, await buildRollup(storage, sweep, t, {
            include: (e) => !e.manual && slotAtOf(e) > from && slotAtOf(e) <= slot.at && Date.parse(e.at) <= t,
          }));
        }
        return sinceSlot.get(f);
      };
      for (const { key, areaKey, f, areas, recs } of [...groups.values()].sort(order)) {
        if (!SLOTS_BY_FREQ[f].includes(slot.hour)) { result.pro.notThisSlot += recs.length; continue; }
        const cats = key === "all" ? null : key.split("+");
        const all = await problemsFor(f);
        // Areas (T41): a problem in a chosen area, or a worldwide one (owner decision O2).
        const inAreas = (p) => { const a = areaOf(p.region); return a === "Global" || areas.includes(a); };
        const problems = all.filter((p) => (!cats || cats.includes(p.cat)) && (!areas || inAreas(p)));
        if (!problems.length) { result.pro.emptyForCats += recs.length; continue; }
        if (halted) { result.pro.deferred += recs.length; continue; }
        // A failed category is the owner's alert, not the subscriber's: no "Failed this run" line here.
        const mail = buildDigestEmail({ at: sweep.at, problems, perCat: {} }, liveUrl, { heading: "Travel Problem Radar: Pro update", cats, areas });
        const r = await sendBatch(creds, recs.map((rec) => message(rec, mail, "pro")), {
          fetchFn, shouldStop,
          idempotencyKey: (key === "all" ? `${sweep.id}-pro` : `${sweep.id}-pro-${key}`) + (areaKey === "all" ? "" : `-a-${areaKey}`)
            + (f === DEFAULT_SWEEPS_PER_DAY ? "" : `-f${f}`),
        });
        result.pro.sent += r.sent;
        result.pro.failed += r.failed;
        result.pro.deferred += recs.length - r.sent - r.failed;
        note(r);
      }
    } else {
      result.pro = { due: 0, sent: 0, failed: 0, deferred: 0, emptyForCats: 0, notThisSlot: 0 };
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

    // 6. Plans ending within a week that won't renew (T34): one email per plan end, remembered as endWarnedFor.
    const ending = sendable.filter((r) => endingSoon(r, t));
    result.endWarning = { due: ending.length, sent: 0, failed: 0, deferred: 0 };
    if (ending.length && halted) {
      result.endWarning.deferred = ending.length;
    } else if (ending.length) {
      const r = await sendBatch(creds, ending.map((rec) => ({
        to: rec.email,
        ...withSubscriberFooter(buildPlanEndingEmail({ endsAt: rec.proUntil, manageUrl: site + managePath(rec.id, rec.token), renewable: rec.proSource === "razorpay", siteUrl: site }),
          { unsubscribeUrl: `${site}/api/unsubscribe?id=${rec.id}&t=${rec.token}`, manageUrl: site + managePath(rec.id, rec.token), plan: "pro" }),
      })), {
        fetchFn, shouldStop,
        onChunk: async ({ sentIndexes }) => {
          for (const i of sentIndexes) {
            const rec = ending[i];
            try { await updateSubscriber(storage, rec.id, (cur) => (cur.proUntil === rec.proUntil ? { ...cur, endWarnedFor: rec.proUntil } : null)); }
            catch (e) { result.endWarning.saveFailed = true; }
          }
        },
      });
      Object.assign(result.endWarning, { sent: r.sent, failed: r.failed, deferred: ending.length - r.sent - r.failed });
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
