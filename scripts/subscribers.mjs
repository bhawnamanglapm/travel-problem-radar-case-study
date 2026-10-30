// Owner admin tool for subscribers (docs/subscriptions/tasks/T11). Runs on your own machine against
// the Blob store; it is not part of the deployment (.vercelignore skips scripts/) and adds no endpoint.
// The read-only view of the same data is the admin dashboard, /admin/ (api/_lib/admin.js).
//
//   node --env-file=.env.local scripts/subscribers.mjs stats [--days 30]
//   node --env-file=.env.local scripts/subscribers.mjs list [--plan pro|free|pending|requested]
//   node --env-file=.env.local scripts/subscribers.mjs show <email> [--check]
//   node --env-file=.env.local scripts/subscribers.mjs grant-pro <email> [--until 2027-01-31] [--yes]
//   node --env-file=.env.local scripts/subscribers.mjs revoke-pro <email> [--paid] [--yes]
//   node --env-file=.env.local scripts/subscribers.mjs delete <email> [--yes]
//   node --env-file=.env.local scripts/subscribers.mjs prune-events --older-than 400 [--yes]
//   node --env-file=.env.local scripts/subscribers.mjs recount [--yes]
//
// Addresses are printed only by `list` and `show`. A token is never printed. Every write changes
// nothing until --yes is given. `show --check` also asks Razorpay (read-only) about the record's subscriptions.
// Exit codes: 0 done, 1 not found or refused, 2 bad usage.
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  KEY_EVENT_PREFIX, deleteSubscriberData, effectivePlan, findSubscriber, getSubscriber, listSubscribers, normaliseEmail,
  recordEvent, updateSubscriber, utcDay,
} from "../api/_lib/subscribers.js";
import { KEY_SUBSCRIBER_COUNT, stopRazorpay } from "../api/_lib/subscription-handlers.js";
import { fetchSubscription } from "../api/_lib/razorpay.js";
import { computeStats } from "../api/_lib/admin.js";

const DAY_MS = 24 * 3600 * 1000;
const EVENT_RE = /^(\d{8})-\d{9}-([a-z]+)-[0-9a-f]{6}$/; // suffix after "radar:event:"

export class UsageError extends Error {}

const FLAGS = { "--yes": false, "--paid": false, "--check": false, "--days": true, "--plan": true, "--until": true, "--older-than": true };
const COMMANDS = {
  stats: { args: 0, flags: ["--days"] },
  list: { args: 0, flags: ["--plan"] },
  show: { args: 1, flags: ["--check"] },
  "grant-pro": { args: 1, flags: ["--until", "--yes"] },
  "revoke-pro": { args: 1, flags: ["--paid", "--yes"] },
  delete: { args: 1, flags: ["--yes"] },
  "prune-events": { args: 0, flags: ["--older-than", "--yes"] },
  recount: { args: 0, flags: ["--yes"] },
};

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || !COMMANDS[cmd]) throw new UsageError(`unknown command${cmd ? ` "${cmd}"` : ""}; one of: ${Object.keys(COMMANDS).join(", ")}`);
  const spec = COMMANDS[cmd];
  const args = [];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      if (!(a in FLAGS) || !spec.flags.includes(a)) throw new UsageError(`${cmd}: unknown option ${a}`);
      if (FLAGS[a]) {
        if (i + 1 >= rest.length || rest[i + 1].startsWith("--")) throw new UsageError(`${cmd}: ${a} needs a value`);
        flags[a.slice(2)] = rest[++i];
      } else flags[a.slice(2)] = true;
    } else args.push(a);
  }
  if (args.length !== spec.args) throw new UsageError(`${cmd}: expected ${spec.args} argument${spec.args === 1 ? " (an email address)" : "s"}, got ${args.length}`);
  return { cmd, args, flags };
}

const positiveInt = (v, name) => {
  if (!/^\d{1,5}$/.test(String(v)) || Number(v) < 1) throw new UsageError(`${name} must be a whole number of days, 1 or more`);
  return Number(v);
};
const emailArg = (s) => {
  const e = normaliseEmail(s);
  if (!e) throw new UsageError("that is not a valid email address");
  return e;
};
// "2027-01-31" -> the end of that UTC day, so the date given is the last day of Pro. A past date is allowed.
export function untilToIso(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999));
  if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new UsageError("--until must be a real date like 2027-01-31");
  return d.toISOString();
}

// ---- stats

// computeStats lives in api/_lib/admin.js, which the dashboard (/admin/) uses too.
export { computeStats };

export function formatStats(s) {
  const pad = (v, n) => String(v).padStart(n);
  const lines = [
    `Now: ${s.now.pending} pending, ${s.now.free} Free, ${s.now.pro} Pro (${s.now.proExpiring7d} of them ending within 7 days), ${s.now.proRequested} waiting for Pro${s.now.unreadable ? `, ${s.now.unreadable} unreadable` : ""}`,
    "",
    `Last ${s.days} days (UTC):`,
    "day       subscribed  confirmsent  notices  confirmed  unsub(free)  unsub(pro)  expired  bounced  complained  pro asked  sign-ins  free sent",
  ];
  for (const r of s.perDay) {
    if (!(r.subscribed || r.confirmsent || r.noticesent || r.confirmed || r.unsubscribedFree || r.unsubscribedPro || r.expired || r.bounced || r.complained || r.prorequested || r.signinsent || r.freeDelivered)) continue;
    lines.push(`${r.day}  ${pad(r.subscribed, 10)}  ${pad(r.confirmsent, 11)}  ${pad(r.noticesent, 7)}  ${pad(r.confirmed, 9)}  ${pad(r.unsubscribedFree, 11)}  ${pad(r.unsubscribedPro, 10)}  ${pad(r.expired, 7)}  ${pad(r.bounced, 7)}  ${pad(r.complained, 10)}  ${pad(r.prorequested, 9)}  ${pad(r.signinsent, 8)}  ${pad(r.freeDelivered, 9)}`);
  }
  const t = s.totals;
  lines.push("", `Total: ${t.subscribed} subscribed, ${t.confirmsent} confirmation emails, ${t.noticesent} already-subscribed notices, ${t.confirmed} confirmed, ${t.unsubscribed} unsubscribed, ${t.expired} expired, ${t.bounced} bounced, ${t.complained} complained, ${t.prorequested} Pro requests, ${t.signinsent} sign-in emails`);
  lines.push(s.confirmRate === null
    ? "Confirm rate: n/a (nobody subscribed in this period)"
    : `Confirm rate: ${(s.confirmRate * 100).toFixed(1)}% (${t.confirmed} confirmed / ${t.subscribed} subscribed, counted by when each event happened, so people who subscribed earlier can raise it)`);
  return lines.join("\n");
}

// ---- reads of single records (the owner's terminal only)

export async function listRows(storage, { now, plan = null }) {
  if (plan !== null && !["pro", "free", "pending", "requested"].includes(plan)) throw new UsageError("--plan must be pro, free, pending or requested");
  const { records, skipped } = await listSubscribers(storage);
  const rows = records.filter((r) => {
    if (plan === "pending") return r.status === "pending";
    if (plan === "pro") return r.status === "active" && effectivePlan(r, now) === "pro";
    if (plan === "free") return r.status === "active" && effectivePlan(r, now) === "free";
    if (plan === "requested") return r.status === "active" && effectivePlan(r, now) === "free" && Boolean(r.proRequestedAt);
    return true;
  }).map((r) => ({
    email: r.email, status: r.status, plan: r.plan, lapsed: r.status === "active" && r.plan === "pro" && effectivePlan(r, now) === "free",
    proUntil: r.proUntil || null, confirmedAt: r.confirmedAt || null, proRequestedAt: r.proRequestedAt || null, emailOff: r.emailOff || null,
  }));
  return { rows, skipped };
}

export function formatRows({ rows, skipped }) {
  const lines = rows.map((r) => [r.email, r.status, r.plan + (r.lapsed ? " (lapsed)" : ""), r.proUntil || "-", r.confirmedAt || "-", r.proRequestedAt || "-", r.emailOff || "-"].join("\t"));
  return ["email\tstatus\tplan\tproUntil\tconfirmedAt\tproRequestedAt\temailOff",...lines, `${rows.length} shown${skipped ? `, ${skipped} unreadable` : ""}`].join("\n");
}

export async function showRecord(storage, email) {
  const r = await findSubscriber(storage, email);
  if (!r) return null;
  const { token, ...rest } = r; // never print the token
  return rest;
}

// show --check (T22): Razorpay's view of the plan and of any renewal set up after it, next to what the record has
// stored, for a member the sweep counts as rzpMismatch. Read-only; fetchSubscription returns no customer details.
export async function checkRazorpay(record, { env, fetchFn }) {
  const rzp = record.rzp && typeof record.rzp === "object" ? record.rzp : {};
  const next = rzp.next && typeof rzp.next === "object" ? rzp.next : {};
  const subs = [["plan", rzp.subscriptionId, rzp.status], ["renewal", next.subscriptionId, next.status]].filter(([, id]) => id);
  if (!subs.length) return ["razorpay: no subscription on this record"];
  const lines = [];
  for (const [label, id, stored] of subs) {
    const s = await fetchSubscription({ env, fetchFn, subscriptionId: id });
    const end = s.currentEnd ? new Date(s.currentEnd * 1000).toISOString() : "-";
    lines.push(s.error ? `razorpay ${label} ${id}: error ${s.error} (stored: ${stored || "-"})`
      : `razorpay ${label} ${id}: status ${s.status} (stored: ${stored || "-"}), currentEnd ${end}, paidCount ${s.paidCount ?? "-"}, remainingCount ${s.remainingCount ?? "-"}`);
  }
  return lines;
}

// ---- writes. Each returns { code: 0|1, message, changed } and writes only when apply is true.

export async function grantPro(storage, email, { until = null, apply, now, randomBytes: rb = randomBytes }) {
  const r = await findSubscriber(storage, email);
  if (!r) return { code: 1, message: "not found: no subscriber with that address", changed: false };
  if (r.status !== "active") return { code: 1, message: `refused: the subscriber is ${r.status}, only an active (confirmed) subscriber can be given Pro`, changed: false };
  if (r.plan === "pro" && r.proSource === "razorpay") return { code: 1, message: "refused: this is a paid Razorpay Pro; change it in Razorpay, not here", changed: false };
  const proUntil = until ? untilToIso(until) : null;
  const lapsed = proUntil !== null && Date.parse(proUntil) <= now;
  const summary = `plan ${r.plan} -> pro, proSource ${r.proSource || "none"} -> owner, proUntil ${r.proUntil || "none"} -> ${proUntil || "none (no end date)"}${lapsed ? " (already past: the sweep will treat them as Free)" : ""}`;
  if (!apply) return { code: 1, message: `would change: ${summary}. Nothing changed; add --yes to apply.`, changed: false };
  // The request is answered, so it leaves the waiting list (the prorequested event keeps the history).
  // Written only if the record is still active and not paid Pro (a payment may land meanwhile).
  // The categories and emails a day chosen with the request (T33) are applied; the request then goes.
  const { changed } = await updateSubscriber(storage, r.id, (cur) => {
    if (cur.status !== "active" || cur.proSource === "razorpay") return null;
    const { proRequest, ...rest } = cur;
    const chose = proRequest && typeof proRequest === "object" ? { cats: proRequest.cats || null, ...(Number.isInteger(proRequest.perDay) ? { sweepsPerDay: proRequest.perDay } : {}) } : {};
    return { ...rest, ...chose, plan: "pro", proSource: "owner", proUntil, proRequestedAt: null };
  });
  if (!changed) return { code: 1, message: "refused: the record changed meanwhile (deleted, or paid Pro now); run it again", changed: false };
  await recordEvent(storage, "progranted", { now, randomBytes: rb, plan: "pro" });
  return { code: 0, message: `done: ${summary}`, changed: true };
}

// A paid Razorpay Pro needs --paid (after a refund, docs/subscriptions/refunds-and-chargebacks.md): its Razorpay
// subscriptions are cancelled at once first, as delete does, so no later charge can bring Pro back.
export async function revokePro(storage, email, { apply, paid = false, now, randomBytes: rb = randomBytes, env = {}, fetchFn = fetch }) {
  const r = await findSubscriber(storage, email);
  if (!r) return { code: 1, message: "not found: no subscriber with that address", changed: false };
  const isPaid = r.proSource === "razorpay";
  if (isPaid && !paid) return { code: 1, message: "refused: this is a paid Razorpay Pro; add --paid to cancel it in Razorpay and end Pro now (after a refund)", changed: false };
  if (r.plan !== "pro") return { code: 1, message: "nothing to do: the subscriber is already on the Free plan", changed: false };
  const rzp = r.rzp && typeof r.rzp === "object" ? r.rzp : {};
  const subs = isPaid ? [rzp.subscriptionId, rzp.next && rzp.next.subscriptionId].filter((x) => typeof x === "string" && x) : [];
  const summary = `${subs.length ? `cancel Razorpay subscription ${subs.join(" and ")} at once, ` : ""}plan pro -> free, proSource ${r.proSource || "none"} -> none, proUntil ${r.proUntil || "none"} -> none`;
  if (!apply) return { code: 1, message: `would change: ${summary}. Nothing changed; add --yes to apply.`, changed: false };
  if (isPaid) {
    const stopped = await stopRazorpay(r, { env, fetchFn });
    if (stopped) return { code: 1, message: `refused: Razorpay didn't cancel ${subs.join(" or ")} (${stopped}); nothing changed. Check the keys in the shell, or cancel it in Razorpay's dashboard, then revoke again`, changed: false };
  }
  const { changed } = await updateSubscriber(storage, r.id, (cur) => (cur.plan === "pro" && (cur.proSource !== "razorpay" || isPaid)
    ? { ...cur, plan: "free", proSource: null, proUntil: null } : null));
  if (!changed) return { code: 1, message: "refused: the record changed meanwhile (deleted, Free, or paid Pro now); run it again", changed: false };
  await recordEvent(storage, "prorevoked", { now, randomBytes: rb, plan: "pro" });
  return { code: 0, message: `done: ${summary}`, changed: true };
}

// As Delete my account does (deleteAccount): its Razorpay subscriptions are cancelled at once (RAZORPAY_KEY_ID and
// RAZORPAY_KEY_SECRET from the shell), then the record, its radar:rzpsub: index files and its id in the delivery
// files go. If Razorpay won't cancel a plan that could still charge, nothing is deleted.
export async function removeSubscriber(storage, email, { apply, env = {}, fetchFn = fetch }) {
  const r = await findSubscriber(storage, email);
  if (!r) return { code: 1, message: "not found: no subscriber with that address", changed: false };
  const rzp = r.rzp && typeof r.rzp === "object" ? r.rzp : {};
  const subs = [rzp.subscriptionId, rzp.next && rzp.next.subscriptionId].filter((x) => typeof x === "string" && x);
  const what = `the ${r.status} ${r.plan} record`;
  const cancels = subs.length ? `, cancel Razorpay subscription ${subs.join(" and ")} at once` : "";
  if (!apply) return { code: 1, message: `would${cancels ? cancels.slice(1) + " and" : ""} delete ${what} and the files that name it. Nothing changed; add --yes to apply.`, changed: false };
  const stopped = await stopRazorpay(r, { env, fetchFn });
  if (stopped) return { code: 1, message: `refused: Razorpay didn't cancel ${subs.join(" or ")} (${stopped}); nothing deleted. Check the keys in the shell, or cancel it in Razorpay's dashboard, then delete again`, changed: false };
  const gone = await deleteSubscriberData(storage, r.id);
  return { code: 0, message: `done: deleted ${what}, ${gone.indexes} Razorpay index file(s) and its id in ${gone.deliveries} delivery file(s)${subs.length ? "; Razorpay subscriptions cancelled" : ""}`, changed: true };
}

export async function pruneEvents(storage, { olderThanDays, apply, now }) {
  const cutoff = utcDay(now - olderThanDays * DAY_MS);
  const old = (await storage.list(KEY_EVENT_PREFIX)).filter((s) => { const m = EVENT_RE.exec(s); return m && m[1] < cutoff; });
  if (!apply) return { code: 1, message: `would delete ${old.length} event record${old.length === 1 ? "" : "s"} older than ${olderThanDays} days (before ${cutoff}). Nothing changed; add --yes to apply.`, changed: false };
  for (const s of old) await storage.del(KEY_EVENT_PREFIX + s);
  return { code: 0, message: `done: deleted ${old.length} event record${old.length === 1 ? "" : "s"} older than ${olderThanDays} days (before ${cutoff})`, changed: old.length > 0 };
}

// Writes the pending-plus-active count that sign-up checks against MAX_SUBSCRIBERS, in the shape the
// sweep writes. For a store whose count is missing (sign-up reads that as 0, so the cap isn't applied
// until a sweep writes one, as on a Preview) or unreadable (sign-up reads that as full).
export async function recount(storage, { apply, now }) {
  const { records } = await listSubscribers(storage);
  const count = records.filter((r) => r.status === "pending" || r.status === "active").length;
  let stored = null;
  try { const v = JSON.parse(await storage.get(KEY_SUBSCRIBER_COUNT)); stored = v && Number.isInteger(v.count) ? v.count : null; } catch (e) { /* missing or unreadable */ }
  const summary = `subscriber count ${stored === null ? "none" : stored} -> ${count}`;
  if (!apply) return { code: 1, message: `would change: ${summary}. Nothing changed; add --yes to apply.`, changed: false };
  await storage.set(KEY_SUBSCRIBER_COUNT, JSON.stringify({ count, at: new Date(now).toISOString() }));
  return { code: 0, message: `done: ${summary}`, changed: true };
}

// ---- the command line

export async function main(argv, { storage, now = Date.now(), rb = randomBytes, out = console.log, err = console.error, env = process.env, fetchFn = fetch } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`usage error: ${e.message}`);
    return 2;
  }
  const { cmd, args, flags } = parsed;
  const apply = flags.yes === true;
  try {
    if (cmd === "stats") {
      out(formatStats(await computeStats(storage, { now, days: flags.days ? positiveInt(flags.days, "--days") : 30 })));
      return 0;
    }
    if (cmd === "list") { out(formatRows(await listRows(storage, { now, plan: flags.plan || null }))); return 0; }
    if (cmd === "recount") {
      const res = await recount(storage, { apply, now });
      (res.code === 0 ? out : err)(res.message);
      return res.code;
    }
    if (cmd === "prune-events") {
      if (!flags["older-than"]) throw new UsageError("prune-events needs --older-than <days>");
      const res = await pruneEvents(storage, { olderThanDays: positiveInt(flags["older-than"], "--older-than"), apply, now });
      (res.code === 0 ? out : err)(res.message);
      return res.code;
    }
    const email = emailArg(args[0]);
    if (cmd === "show") {
      const r = await showRecord(storage, email);
      if (!r) { err("not found: no subscriber with that address"); return 1; }
      out(JSON.stringify(r, null, 2));
      if (flags.check) out((await checkRazorpay(r, { env, fetchFn })).join("\n"));
      return 0;
    }
    const res = cmd === "grant-pro" ? await grantPro(storage, email, { until: flags.until || null, apply, now, randomBytes: rb })
      : cmd === "revoke-pro" ? await revokePro(storage, email, { apply, paid: flags.paid === true, now, randomBytes: rb, env, fetchFn })
        : await removeSubscriber(storage, email, { apply, env, fetchFn });
    (res.code === 0 ? out : err)(res.message);
    return res.code;
  } catch (e) {
    if (e instanceof UsageError) { err(`usage error: ${e.message}`); return 2; }
    err(`error: ${e && e.message ? e.message : e}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { blobStorage } = await import("../api/_lib/storage.js");
  process.exitCode = await main(process.argv.slice(2), { storage: blobStorage() });
}
