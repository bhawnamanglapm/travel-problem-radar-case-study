// How many scheduled sweeps a day (T32). Each Pro member picks 1 to 5 emails a day; the site sweeps
// as often as the most frequent member needs. The GitHub schedule still fires in all five slots
// (00, 05, 10, 15 and 20 UTC); a slot nobody needs is skipped before any Anthropic call.
import { effectivePlan, listSubscribers } from "./subscribers.js";

// UTC hours. Each choice holds every slot of the smaller ones, so sweeping for the largest choice
// serves everyone. Slot 00 is always in: it carries the Free roll-up and has the Vercel backstop.
export const SLOTS_BY_FREQ = { 1: [0], 2: [0, 10], 3: [0, 10, 15], 4: [0, 5, 10, 15], 5: [0, 5, 10, 15, 20] };
export const MAX_SWEEPS_PER_DAY = 5;
// A Pro member who hasn't chosen (the final Pro plan's default).
export const DEFAULT_SWEEPS_PER_DAY = 2;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The slot a time falls in: the UTC hour rounded down to a multiple of 5, and when that slot began.
// A GitHub run at 05:40 is slot 05; the Vercel backstop at 01:30 is slot 00.
export function slotOf(t) {
  const d = new Date(t);
  const hour = Math.floor(d.getUTCHours() / 5) * 5;
  return { hour, at: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour) };
}

// The slot a scheduled run was due for (T35). GitHub sends it as X-Sweep-Slot, because its runs can start hours
// late and slotOf(start) would then count a late run in the next slot. Used when it names one of the five slots
// and that slot began under DUE_SLOT_WINDOW_HOURS before `t`; otherwise the slot of `t`. A forged header can only
// pick another real slot, which the secret already allows.
export const SLOT_HOURS = [0, 5, 10, 15, 20];
export const DUE_SLOT_WINDOW_HOURS = 12;
export function dueSlot(t, header) {
  const own = slotOf(t);
  const raw = String(header ?? "").trim();
  const hour = Number(raw);
  if (!/^\d{1,2}$/.test(raw) || !SLOT_HOURS.includes(hour)) return own;
  let at = own.at - own.hour * HOUR_MS + hour * HOUR_MS;
  if (at > t) at -= DAY_MS;
  return t - at < DUE_SLOT_WINDOW_HOURS * HOUR_MS ? { hour, at } : own;
}

// When the slot before `slot` (a slotOf result) began, among the slots of `perDay`: earlier the
// same day, or that list's last slot the day before. Undefined when `slot` isn't one of them.
export function previousSlotAt(perDay, slot) {
  const hours = SLOTS_BY_FREQ[perDay];
  const i = hours.indexOf(slot.hour);
  if (i < 0) return undefined;
  const dayStart = slot.at - slot.hour * HOUR_MS;
  return i > 0 ? dayStart + hours[i - 1] * HOUR_MS : dayStart - DAY_MS + hours[hours.length - 1] * HOUR_MS;
}

const choice = (v) => {
  const s = String(v ?? "").trim();
  const n = Number(s);
  return s !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_SWEEPS_PER_DAY ? n : null;
};

// SWEEPS_PER_DAY_MIN (default 1) is the owner's floor, SWEEPS_PER_DAY_MAX (default 5) the cost cap
// and the most a member may choose. Each is 1 to 5; anything else is the default. A floor above
// the cap is lowered to it.
export function sweepLimits(env = {}) {
  const max = choice(env.SWEEPS_PER_DAY_MAX) ?? MAX_SWEEPS_PER_DAY;
  const min = Math.min(choice(env.SWEEPS_PER_DAY_MIN) ?? 1, max);
  return { min, max };
}

// A choice the manage page sent: { ok: true, value } for a whole number from 1 to `max`, else
// { ok: false, error } with "unknown frequency" (not 1 to 5) or "over the limit" (above `max`).
export function normaliseSweepsPerDay(input, max) {
  if (!Number.isInteger(input) || input < 1 || input > MAX_SWEEPS_PER_DAY) return { ok: false, error: "unknown frequency" };
  if (input > max) return { ok: false, error: "over the limit" };
  return { ok: true, value: input };
}

// A record's emails a day: its stored choice, or the default, and never above `max`. A stored
// value that isn't 1 to 5 (hand-edited) counts as no choice.
export function sweepsPerDayOf(record, max) {
  const v = record && Number.isInteger(record.sweepsPerDay) && record.sweepsPerDay >= 1 && record.sweepsPerDay <= MAX_SWEEPS_PER_DAY
    ? record.sweepsPerDay : DEFAULT_SWEEPS_PER_DAY;
  return Math.min(v, max);
}

// The site's sweeps a day: the highest choice among Pro members who get emails, or 1 with none,
// kept between the floor and the cap. With subscriptions off it is the floor. Never throws: when
// the list can't be read it returns the cap, so a slot someone may need still runs.
export async function siteSweepsPerDay({ env = {}, storage, now }) {
  const { min, max } = sweepLimits(env);
  if (env.SUBSCRIPTIONS_ENABLED !== "1") return { perDay: min, pro: 0 };
  try {
    const { records } = await listSubscribers(storage);
    const pro = records.filter((r) => r.status === "active" && !r.emailOff && effectivePlan(r, now) === "pro");
    const wanted = pro.reduce((m, r) => Math.max(m, sweepsPerDayOf(r, max)), 1);
    return { perDay: Math.min(Math.max(wanted, min), max), pro: pro.length };
  } catch (e) {
    return { perDay: max, pro: null, error: "couldn't read the subscriber list" };
  }
}
