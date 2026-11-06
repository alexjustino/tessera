/**
 * What surrounds today: the days just ahead, and the work with no date.
 *
 * Today shows what is due now. On its own that leaves a person asking where
 * everything else went, so it also says what is coming and how much has no date
 * at all. Pure: no I/O, no React, no host.
 */

import { bucketOf, endOfLocalDay } from './schedule';
import type { Item } from './item';

export interface ComingUp {
  /** Open work due after today and within the window, soonest first. */
  readonly upcoming: readonly Item[];
  /** How many open tasks have no due date. */
  readonly undated: number;
}

export function comingUp(items: readonly Item[], now: string, zone: string, days = 7): ComingUp {
  const open = items.filter((item) => item.completedAt === null);
  const until = Date.parse(endOfLocalDay(now, zone, days));
  const upcoming = open
    .filter((item) => {
      if (item.dueAt === null) return false;
      const bucket = bucketOf(item.dueAt, now, zone);
      return bucket !== 'overdue' && bucket !== 'today' && Date.parse(item.dueAt) <= until;
    })
    .sort((a, b) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? ''));
  return { upcoming, undated: open.filter((item) => item.dueAt === null).length };
}

/** A task added on Today with no date of its own is for today: that is where it was typed. */
export function dueForToday(dueAt: string | null, now: string, zone: string): string {
  if (dueAt !== null) return dueAt;
  // The day's end is the instant tomorrow begins, so a minute before it is still today.
  return new Date(Date.parse(endOfLocalDay(now, zone)) - 60_000).toISOString();
}
