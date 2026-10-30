# T35 · Sweep slots that survive GitHub's delays

| | |
|---|---|
| Phase | 3, showing Pro and going live |
| Who | Developer |
| Size | S |
| Depends on | — (start now) |
| Unblocks | T27 (Pro is sold on emails at the chosen times); T32's checks after deploy |

> Added 2026-10-25, from the sweep runs since T32 went live.

## Why

T32 works out a sweep's slot from the time the run **starts** (`slotOf(now)` in `api/_lib/schedule.js`). GitHub's
schedule is meant to fire at minute 17 of 00, 05, 10, 15 and 20 UTC, but its runs since 2026-10-24 started hours
late:

| Due (UTC) | Started | Late | Slot it was counted in | At 2 a day |
|---|---|---|---|---|
| 10-24 15:17 | 18:12 | 2 h 55 m | 15 | skipped (right) |
| 10-24 20:17 | 22:32 | 2 h 15 m | 20 | skipped (right) |
| 10-25 00:17 | 04:49 | 4 h 32 m | 00 | swept (right; failed only for credit) |
| 10-25 05:17 | 09:52 | 4 h 35 m | 05 | skipped (right) |
| 10-25 10:17 | 14:25 | 4 h 08 m | 10 | swept (right; failed only for credit) |

Every run landed in the right slot, but only just: a run more than about 4 h 43 m late falls into the **next** slot.
Then it is counted wrongly. For example, the 10:17 run starting at 15:05 would be counted as slot 15 and, at 2 a day,
skipped, so slot 10's Pro emails never go out. The 2-hour gap adds a second failure: a 00:17 run that starts at 04:49,
followed by a punctual 05:17 run, has the second one skipped as "under 2 h old".

## What to build

- `sweep.yml` gets one cron line per slot (`17 0 * * *`, `17 5 * * *`, …) and sends the slot the run was **due** for
  as `X-Sweep-Slot`, taken from `github.event.schedule`. The Vercel backstop (01:30) stays slot 00.
- The sweep handler uses that slot when it is one of the five and the run starts within 12 hours of the slot's start,
  else falls back to `slotOf(now)`. A forged header can only pick another real slot, which the secret already allows.
- The 2-hour gap becomes **one sweep per slot**: a scheduled run is skipped if a sweep for the same slot and day
  already started (`radar:lastScheduled` stores the slot as well as the time). The Vercel backstop and a late GitHub
  run of the same slot then can't both sweep, and two different slots never block each other.
- Log each run's lateness (`slotAt`, `lateMinutes`) in the reply, so the delay can be watched. Optionally, if GitHub stays
  this late, move the trigger to a punctual external scheduler calling the same endpoint; that is an owner choice
  (a secret stored with another service).

## Built (2026-10-25)

- `dueSlot(t, header)` in `api/_lib/schedule.js`: the header's slot if it is 0, 5, 10, 15 or 20 and began under
  12 hours ago (`DUE_SLOT_WINDOW_HOURS`), else `slotOf(t)`. 12 rather than 5 hours: the longest delay seen was
  4 h 35 m past minute 17, which is 4 h 52 m past the slot's start.
- `runDailySweep`: the 2-hour gap is replaced by one scheduled sweep per slot. `radar:lastScheduled` is
  `{ at, slotAt }`; a time-only value from before is read as the slot of that time.
- The handler sends `slotAt` and `lateMinutes` in every scheduled reply and log line.
- `sweep.yml`: five cron lines, and `X-Sweep-Slot` from `github.event.schedule`.
- Tests: `dueSlot` within and beyond 12 hours, the day before, bad headers; a late slot-00 run then an on-time
  slot-05 run both sweep; the backstop then a late slot-00 run sweep once; the handler sweeps a 15:05 run as slot 10
  and reports 305 minutes late. The acceptance item for a day of real runs is still open.

## Acceptance criteria

- [x] A run due at 10:17 that starts at 15:05 sweeps as slot 10 (when 10 is needed) and slot 15's own run still sweeps
- [x] The Vercel backstop and a late slot-00 GitHub run don't both sweep
- [x] A day of scheduled runs after deploy shows each slot swept or skipped as `SLOTS_BY_FREQ` says, with the delays
  logged (checked 2026-10-30 from the 20 runs of 2026-10-26 to 29; the table is under
  "Checked 2026-10-30" in [T32](T32-sweeps-per-day.md). The runs were 228 to 418 minutes late from the slot's start. At
  least 15 of the 20 started after the next slot had begun, so the old `slotOf(now)` would have counted them wrongly;
  e.g. 10-27's 05 run started at 10:39 and was rightly skipped as slot 05, not swept as slot 10. Slot 00's GitHub run answered "already swept" each day,
  after the Vercel backstop)
- [x] Docs: [T32](T32-sweeps-per-day.md), DEPLOYMENT.md (the schedule), TECHNICAL.md, CHANGELOG.md

## Tests

The slot from the header, within and beyond 12 hours; a bad header ignored; one sweep per slot (backstop then late
GitHub run; late slot 00 then on-time slot 05 both sweep); the reply's `slotAt` and `lateMinutes`.
