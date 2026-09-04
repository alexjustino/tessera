/**
 * How full a day is: what the calendar has reserved against the hours there
 * are to reserve.
 *
 * Capacity is the working hours already in the workspace (`work_hours`, one
 * span per weekday). Planned time is what sits on the calendar with a start
 * and an end: events, and the blocks that reserve time for a task. Nothing
 * here estimates or guesses. A task with an estimate and no time reserved is
 * not on the calendar, so it is not on the map (ADR-023).
 *
 * The map is a year of days, each with a level. Levels are words, not only
 * shades, so a legend, a label and a screen reader can all say the same thing.
 */

import {
  addLocalDays,
  daysOfYear,
  weekdayOf,
  workingSpan,
  type Occurrence,
  type WorkHours,
} from './calendar';
import { splitInterval } from './time';

/** How full a day is, in words. */
export type Level = 'off' | 'free' | 'light' | 'half' | 'busy' | 'full' | 'over';

export const LEVELS: ReadonlyArray<{ id: Level; label: string }> = [
  { id: 'off', label: 'Not a working day' },
  { id: 'free', label: 'Nothing reserved' },
  { id: 'light', label: 'Up to a quarter' },
  { id: 'half', label: 'Up to half' },
  { id: 'busy', label: 'Up to three quarters' },
  { id: 'full', label: 'Up to the whole day' },
  { id: 'over', label: 'More than the day has' },
];

export interface DayLoad {
  day: string;
  /** Working minutes on this weekday; zero on a day off. */
  capacity: number;
  /** Minutes reserved on the calendar. */
  planned: number;
  level: Level;
}

/** The working minutes in a day, or zero when it is not a working day. */
export function capacityOf(day: string, hours: readonly WorkHours[]): number {
  const span = workingSpan(day, hours);
  return span === null ? 0 : Math.max(0, span.endsMinute - span.startsMinute);
}

/**
 * Minutes reserved per local day, from the occurrences given.
 *
 * All-day events carry no minutes and are left out: a birthday does not use
 * up a working day, and pretending it uses all of it would colour every
 * public holiday as overloaded. An occurrence that crosses midnight loads both
 * days, split where midnight actually falls in the zone.
 */
export function plannedByDay(
  occurrences: readonly Occurrence[],
  zone: string,
): Map<string, number> {
  const planned = new Map<string, number>();
  for (const occurrence of occurrences) {
    if (occurrence.event.allDay) continue;
    for (const share of splitInterval(occurrence.startsAt, occurrence.endsAt, zone)) {
      planned.set(share.day, (planned.get(share.day) ?? 0) + share.minutes);
    }
  }
  return planned;
}

/** The word for a day with this much reserved against this much capacity. */
export function levelOf(planned: number, capacity: number): Level {
  if (capacity <= 0) return planned > 0 ? 'over' : 'off';
  if (planned <= 0) return 'free';
  const ratio = planned / capacity;
  if (ratio <= 0.25) return 'light';
  if (ratio <= 0.5) return 'half';
  if (ratio <= 0.75) return 'busy';
  if (ratio <= 1) return 'full';
  return 'over';
}

export interface MonthLoad {
  /** `YYYY-MM`. */
  month: string;
  /** Empty cells before the first day, so the grid starts on the week's first day. */
  leading: number;
  days: DayLoad[];
  capacity: number;
  planned: number;
}

export interface YearLoad {
  year: number;
  months: MonthLoad[];
  capacity: number;
  planned: number;
  /** Days reserved beyond their capacity: the ones worth looking at first. */
  overloaded: number;
}

/**
 * A whole year, day by day, month by month.
 *
 * One pass over the occurrences and one over the days. The occurrences are
 * whatever the caller expanded for the year; the days come from the calendar
 * itself, so a leap year has its 29th of February and nothing is assumed
 * about how long a month is.
 */
export function yearOf(
  year: number,
  occurrences: readonly Occurrence[],
  hours: readonly WorkHours[],
  zone: string,
  startsOn = 1,
): YearLoad {
  const planned = plannedByDay(occurrences, zone);
  const months: MonthLoad[] = [];
  let current: MonthLoad | null = null;

  for (const day of daysOfYear(year)) {
    const month = day.slice(0, 7);
    if (current === null || current.month !== month) {
      current = {
        month,
        leading: (weekdayOf(day) - startsOn + 7) % 7,
        days: [],
        capacity: 0,
        planned: 0,
      };
      months.push(current);
    }
    const capacity = capacityOf(day, hours);
    const reserved = planned.get(day) ?? 0;
    current.days.push({ day, capacity, planned: reserved, level: levelOf(reserved, capacity) });
    current.capacity += capacity;
    current.planned += reserved;
  }

  return {
    year,
    months,
    capacity: months.reduce((sum, month) => sum + month.capacity, 0),
    planned: months.reduce((sum, month) => sum + month.planned, 0),
    overloaded: months.reduce(
      (sum, month) => sum + month.days.filter((day) => day.level === 'over').length,
      0,
    ),
  };
}

/** The load on one day: what a day view or a tooltip asks. */
export function dayLoad(
  day: string,
  occurrences: readonly Occurrence[],
  hours: readonly WorkHours[],
  zone: string,
): DayLoad {
  const capacity = capacityOf(day, hours);
  const planned = plannedByDay(occurrences, zone).get(day) ?? 0;
  return { day, capacity, planned, level: levelOf(planned, capacity) };
}

/** The days of the week a day is in, starting on `startsOn`. */
export function weekOf(day: string, startsOn = 1): string[] {
  const offset = (weekdayOf(day) - startsOn + 7) % 7;
  const first = addLocalDays(day, -offset);
  return Array.from({ length: 7 }, (_, index) => addLocalDays(first, index));
}
