/**
 * How the weeks have been going: what got finished, what came in, what the clock
 * saw, and how far the estimates can be trusted.
 *
 * Every reading comes from rows the workspace already holds, so nothing here is
 * kept anywhere. A figure with too little behind it says so with `null` rather
 * than a percentage nobody could back (SPEC 1.3, ADR-035). Pure: no I/O, no React,
 * no host.
 */

import { addLocalDays } from './calendar';
import type { Item } from './item';
import { localDay } from './schedule';
import { minutesByDay, minutesOf, type Entry } from './time';

/** How many finished, estimated tasks it takes before the estimates are measured. */
export const ACCURACY_SAMPLE = 3;

export interface WeekReading {
  firstDay: string;
  /** Tasks finished in the week. */
  finished: number;
  /** Tasks that came in during the week. */
  added: number;
  /** Minutes on the clock. */
  tracked: number;
}

/** The weeks up to and including the one starting on `firstDay`, oldest first. */
export function weeklyTrend(input: {
  items: readonly Item[];
  entries: readonly Entry[];
  firstDay: string;
  weeks: number;
  zone: string;
  now: string;
}): WeekReading[] {
  const starts = Array.from({ length: input.weeks }, (_, index) =>
    addLocalDays(input.firstDay, -7 * (input.weeks - 1 - index)),
  );
  const readings = new Map<string, WeekReading>(
    starts.map((firstDay) => [firstDay, { firstDay, finished: 0, added: 0, tracked: 0 }]),
  );
  const first = starts[0] ?? input.firstDay;
  const last = addLocalDays(input.firstDay, 6);

  /** The reading a local day falls in, or undefined outside the run. */
  const weekOf = (day: string): WeekReading | undefined => {
    if (day < first || day > last) return undefined;
    const offset = Math.floor(
      (Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) -
        Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10))) /
        (7 * 86_400_000),
    );
    return readings.get(starts[offset] ?? '');
  };

  for (const item of input.items) {
    if (item.completedAt !== null) {
      const week = weekOf(localDay(item.completedAt, input.zone));
      if (week !== undefined) week.finished += 1;
    }
    const added = weekOf(localDay(item.createdAt, input.zone));
    if (added !== undefined) added.added += 1;
  }
  for (const share of minutesByDay(input.entries, input.zone, input.now)) {
    const week = weekOf(share.day);
    if (week !== undefined) week.tracked += share.minutes;
  }
  return starts.map((firstDay) => readings.get(firstDay) as WeekReading);
}

export interface Accuracy {
  /** Tasks it was measured on. */
  sample: number;
  /** How many of them came in at or under their estimate. */
  within: number;
  /** The typical tracked time for each estimated hour: 1.5 means half as long again. */
  ratio: number;
}

/**
 * How the estimates held up, on finished tasks with both an estimate and time on
 * the clock. Null below the sample: two tasks are an anecdote.
 */
export function accuracyOf(
  items: readonly Item[],
  entries: readonly Entry[],
  now: string,
): Accuracy | null {
  const tracked = new Map<string, number>();
  for (const entry of entries) {
    tracked.set(entry.itemId, (tracked.get(entry.itemId) ?? 0) + minutesOf(entry, now));
  }
  const ratios: number[] = [];
  let within = 0;
  for (const item of items) {
    const spent = tracked.get(item.id) ?? 0;
    const estimate = item.estimateMinutes ?? 0;
    if (item.completedAt === null || spent <= 0 || estimate <= 0) continue;
    ratios.push(spent / estimate);
    if (spent <= estimate) within += 1;
  }
  if (ratios.length < ACCURACY_SAMPLE) return null;
  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const ratio =
    ratios.length % 2 === 1
      ? (ratios[middle] ?? 1)
      : ((ratios[middle - 1] ?? 1) + (ratios[middle] ?? 1)) / 2;
  return { sample: ratios.length, within, ratio };
}

/** A reading against the one before it, in the words a figure's note wants. */
export function compare(now: number, before: number): { change: number; word: string } {
  const change = now - before;
  if (change === 0) return { change, word: 'the same as before' };
  return { change, word: `${change > 0 ? 'up' : 'down'} from ${before}` };
}
