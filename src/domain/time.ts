/**
 * Time tracked: intervals, and what they add up to.
 *
 * An entry is a start and an end. While a timer runs the end is null, and
 * everything that reads it takes `now` as an argument rather than calling the
 * clock — so the arithmetic is testable, and a component that ticks decides
 * for itself how often to ask.
 *
 * ## The part that is actually hard
 *
 * An entry that crosses midnight belongs to two days. Working from 22:00 to
 * 01:30 is two hours on Tuesday and ninety minutes on Wednesday, and a tracker
 * that files the whole thing under one of them is wrong on both. So the split
 * is the primitive here, and every total is built from it.
 *
 * The boundaries come from `dayStartsAt`, which knows the zone — which matters
 * on the two days a year that are not twenty-four hours long. On the day the
 * clocks go back, midnight to midnight really is twenty-five hours of tracked
 * time, and the sum should say so.
 */

import { addLocalDays, dayStartsAt } from './calendar';
import { localPlace } from './schedule';

export interface Entry {
  id: string;
  itemId: string;
  /** UTC instants (ADR-013). */
  startedAt: string;
  /** Null while the timer is running. */
  endedAt: string | null;
}

/** How long an entry has lasted, in minutes. A running one is measured to `now`. */
export function minutesOf(entry: Entry, now: string): number {
  const start = Date.parse(entry.startedAt);
  const end = Date.parse(entry.endedAt ?? now);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

export function isRunning(entry: Entry): boolean {
  return entry.endedAt === null;
}

/** The one running entry, if any. Storage allows at most one. */
export function runningEntry(entries: readonly Entry[]): Entry | null {
  return entries.find(isRunning) ?? null;
}

/** Everything tracked against one task. */
export function minutesForItem(entries: readonly Entry[], itemId: string, now: string): number {
  return entries
    .filter((entry) => entry.itemId === itemId)
    .reduce((total, entry) => total + minutesOf(entry, now), 0);
}

export interface DayShare {
  /** Local day, `YYYY-MM-DD`. */
  day: string;
  minutes: number;
}

/**
 * How an entry divides across the local days it touches.
 *
 * The whole point of the module: an entry that starts on one day and ends on
 * another is not a fact about either day alone. A single-day entry comes back
 * as one share, which is the common case and costs one conversion.
 */
export function splitByLocalDay(entry: Entry, zone: string, now: string): DayShare[] {
  return splitInterval(entry.startedAt, entry.endedAt ?? now, zone);
}

/**
 * Any interval, divided across the local days it touches.
 *
 * Shared with the capacity arithmetic: a reserved block from 22:00 to 01:00
 * loads two days for the same reason a tracked entry does. One walk, two
 * readers, so they cannot disagree about where midnight is.
 */
export function splitInterval(startedAt: string, endedAt: string, zone: string): DayShare[] {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return [];

  // One zone conversion for the start; the day's end comes from the memo. The
  // common interval — a block, a meeting, a morning's work — ends before the
  // next midnight and never pays for a second conversion. A year of them is
  // what the year view and the reports walk, and this is where their time
  // went: two `Intl` reads per interval was 10 µs each, 1,664 times.
  const firstDay = localPlace(startedAt, zone).day;
  let nextMidnight = midnightAfter(firstDay, zone);
  if (endMs <= nextMidnight) {
    return [{ day: firstDay, minutes: Math.round((endMs - startMs) / 60_000) }];
  }

  const shares: DayShare[] = [];
  let day = firstDay;
  let cursor = startMs;

  // Walk the local midnights. The boundary instants come from the zone, so a
  // day that is 23 or 25 hours long is exactly that many minutes wide.
  while (cursor < endMs) {
    const until = Math.min(nextMidnight, endMs);
    const minutes = Math.round((until - cursor) / 60_000);
    if (minutes > 0) shares.push({ day, minutes });
    cursor = until;
    day = addLocalDays(day, 1);
    nextMidnight = midnightAfter(day, zone);
  }
  return shares;
}

/**
 * The instant the day after `day` starts, in a zone — memoised.
 *
 * A zone conversion is deterministic, so remembering one is not state, only
 * work not repeated: a year has 366 midnights and the occurrences that fall
 * on them number in the thousands. Bounded so a long-lived process does not
 * grow it without end; a clear is a cache miss, never a wrong answer.
 */
const MIDNIGHTS = new Map<string, number>();
const MIDNIGHTS_CAP = 8_192;

function midnightAfter(day: string, zone: string): number {
  const key = `${zone}|${day}`;
  const known = MIDNIGHTS.get(key);
  if (known !== undefined) return known;
  if (MIDNIGHTS.size >= MIDNIGHTS_CAP) MIDNIGHTS.clear();
  const instant = Date.parse(dayStartsAt(addLocalDays(day, 1), zone));
  MIDNIGHTS.set(key, instant);
  return instant;
}

/**
 * Minutes per local day, over every entry given, newest day last.
 *
 * What a "time this week" report reads, and what the day's total under a task
 * reads. Days with nothing tracked are absent rather than zero: a caller that
 * wants a continuous range fills the gaps, and one that wants a list does not
 * have to filter them out.
 */
export function minutesByDay(entries: readonly Entry[], zone: string, now: string): DayShare[] {
  const total = new Map<string, number>();
  for (const entry of entries) {
    for (const share of splitByLocalDay(entry, zone, now)) {
      total.set(share.day, (total.get(share.day) ?? 0) + share.minutes);
    }
  }
  return [...total.entries()]
    .map(([day, minutes]) => ({ day, minutes }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Everything tracked on one local day, across every task. */
export function minutesOnDay(
  entries: readonly Entry[],
  day: string,
  zone: string,
  now: string,
): number {
  return minutesByDay(entries, zone, now).find((share) => share.day === day)?.minutes ?? 0;
}

/** `1:05:09` — a running timer, which wants seconds. */
export function elapsedClock(entry: Entry, now: string): string {
  const start = Date.parse(entry.startedAt);
  const end = Date.parse(entry.endedAt ?? now);
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * How the tracked time compares to the estimate.
 *
 * Null when there is no estimate to compare against — the honest answer, and
 * the same rule the plan follows: a ratio against nothing is not a number.
 */
export function against(
  trackedMinutes: number,
  estimateMinutes: number | null,
): { overBy: number; ratio: number } | null {
  if (estimateMinutes === null || estimateMinutes <= 0) return null;
  return {
    overBy: trackedMinutes - estimateMinutes,
    ratio: trackedMinutes / estimateMinutes,
  };
}
