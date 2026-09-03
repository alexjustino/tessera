/**
 * The calendar — occurrences, and where they sit on the grid.
 *
 * Two things live here, and both are the kind that look easy and are not.
 *
 * **Expanding a series.** A recurring event is a rule plus a list of
 * exceptions: this Tuesday cancelled, next Thursday moved to 15:00. Those two
 * sentences are what every person expects a calendar to be able to say, and
 * what a naive implementation cannot say at all.
 *
 * **Laying out a day.** When events overlap, they share the width — and the
 * rule for who goes where is not obvious. Outlook and Google both do the same
 * thing: group the events that transitively overlap, pack them into as few
 * columns as possible, then let each one widen into the space to its right if
 * nothing is there. Getting the last part wrong produces a day of thin slivers
 * with white space beside them.
 *
 * Both are pure functions, which is the whole reason the calendar's engine is
 * ours (ADR-014): the geometry is testable without rendering a pixel.
 */

import { asInstant, localDay, localPlace } from './schedule';

/** An event, as the interface handles it. */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** UTC instants (ADR-013). */
  startsAt: string;
  endsAt: string;
  tz: string;
  allDay: boolean;
  rrule: string | null;
  color: string | null;
  /** Set when this event is time reserved for a task. */
  itemId: string | null;
}

/** One occurrence of an event, resolved to concrete instants. */
export interface Occurrence {
  event: CalendarEvent;
  /** Which occurrence of the series this is — the key an exception matches on. */
  originalStart: string;
  startsAt: string;
  endsAt: string;
}

export interface EventException {
  eventId: string;
  originalStart: string;
  kind: 'cancelled' | 'moved';
  startsAt: string | null;
  endsAt: string | null;
}

// ── Expanding ──────────────────────────────────────────────────────────────

/**
 * Every occurrence of every event inside a window.
 *
 * Exceptions are applied here rather than at the database, because "cancelled"
 * and "moved" are statements about a rule, and the rule only exists once it has
 * been expanded.
 */
export function expand(
  events: readonly CalendarEvent[],
  exceptions: readonly EventException[],
  fromInstant: string,
  toInstant: string,
  expandRule: (event: CalendarEvent, from: string, to: string) => string[],
): Occurrence[] {
  const byEvent = new Map<string, EventException[]>();
  for (const exception of exceptions) {
    const list = byEvent.get(exception.eventId) ?? [];
    list.push(exception);
    byEvent.set(exception.eventId, list);
  }

  const occurrences: Occurrence[] = [];

  for (const event of events) {
    const duration = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();
    const starts =
      event.rrule === null
        ? overlapsWindow(event.startsAt, event.endsAt, fromInstant, toInstant)
          ? [event.startsAt]
          : []
        : expandRule(event, fromInstant, toInstant);

    for (const originalStart of starts) {
      const exception = byEvent
        .get(event.id)
        ?.find((candidate) => candidate.originalStart === originalStart);

      if (exception?.kind === 'cancelled') continue;

      const startsAt = exception?.startsAt ?? originalStart;
      const endsAt =
        exception?.endsAt ?? new Date(new Date(startsAt).getTime() + duration).toISOString();

      // A moved occurrence can land outside the window it was expanded for.
      if (!overlapsWindow(startsAt, endsAt, fromInstant, toInstant)) continue;

      occurrences.push({ event, originalStart, startsAt, endsAt });
    }
  }

  return occurrences.sort((a, b) =>
    a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0,
  );
}

/**
 * Does a span touch a window?
 *
 * Half-open on both sides: an event ending exactly when the window begins is
 * not in it, and one beginning exactly when the window ends is not either.
 * Without that, a 09:00–10:00 meeting appears on two days.
 */
export function overlapsWindow(
  startsAt: string,
  endsAt: string,
  fromInstant: string,
  toInstant: string,
): boolean {
  return startsAt < toInstant && endsAt > fromInstant;
}

// ── Laying out a day ───────────────────────────────────────────────────────

/** An occurrence with its place on the grid. */
export interface Box {
  occurrence: Occurrence;
  /** Minutes from local midnight, clamped to the day. */
  topMinutes: number;
  heightMinutes: number;
  /** 0 to 1, as a fraction of the day's width. */
  left: number;
  width: number;
}

/** The shortest an event may be drawn, so a five-minute one is still readable. */
const MIN_HEIGHT_MINUTES = 20;

const DAY_MINUTES = 24 * 60;

/**
 * The instant at which a local day begins, in a zone.
 *
 * Computed once per layout rather than per event: it is what turns the
 * question "does this occurrence belong to this day" into a comparison of two
 * numbers instead of a timezone conversion.
 */
export function dayStartsAt(day: string, zone: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const wall = new Date(0);
  wall.setFullYear(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  wall.setHours(0, 0, 0, 0);
  return asInstant(wall, zone);
}

/**
 * Minutes from local midnight, for an instant on a given local day.
 *
 * Clamped: an event that began yesterday and runs into today starts at the top
 * of the grid rather than at a negative offset.
 *
 * The position is the **wall clock**, not the elapsed time, because the grid
 * draws twenty-four fixed hours. On the day the clocks go forward, 14:00 local
 * is thirteen hours after local midnight and still belongs at hour fourteen.
 */
export function minutesInto(instant: string, day: string, zone: string): number {
  const place = localPlace(instant, zone);
  if (place.day < day) return 0;
  if (place.day > day) return DAY_MINUTES;
  return Math.max(0, Math.min(DAY_MINUTES, place.minute));
}

/**
 * Arrange a day's occurrences into columns.
 *
 * The algorithm, in three steps:
 *
 * 1. **Cluster.** Walk the day in start order, collecting events into groups
 *    that transitively overlap. Two events in different clusters never share
 *    width, however close they look.
 * 2. **Pack.** Within a cluster, put each event in the first column whose last
 *    event has already finished. This is the classic interval-graph colouring,
 *    and it uses the fewest columns possible.
 * 3. **Widen.** Let each event expand rightwards over columns that are free for
 *    its whole span. Skipping this step is what produces a day of thin slivers
 *    with empty space beside them — technically correct, visibly wrong.
 */
export function layoutDay(occurrences: readonly Occurrence[], day: string, zone: string): Box[] {
  // The day as two instants, computed once. Everything below is arithmetic.
  const dayStart = Date.parse(dayStartsAt(day, zone));
  const dayEnd = Date.parse(dayStartsAt(addLocalDays(day, 1), zone));

  const timed: Array<{ occurrence: Occurrence; top: number; height: number }> = [];

  for (const occurrence of occurrences) {
    if (occurrence.event.allDay) continue;

    const startsAt = Date.parse(occurrence.startsAt);
    const endsAt = Date.parse(occurrence.endsAt);

    // Half-open: an event ending exactly at midnight belongs to the day that
    // is ending, not to the one starting. A zero-length event belongs to the
    // day its single instant falls in.
    const touchesDay =
      startsAt === endsAt
        ? startsAt >= dayStart && startsAt < dayEnd
        : startsAt < dayEnd && endsAt > dayStart;
    if (!touchesDay) continue;

    // Only what survives the filter is worth a timezone conversion.
    const top = startsAt < dayStart ? 0 : minutesInto(occurrence.startsAt, day, zone);
    const bottom = endsAt > dayEnd ? DAY_MINUTES : minutesInto(occurrence.endsAt, day, zone);

    timed.push({
      occurrence,
      top,
      // An event ending after midnight was clamped to the end of the day, so
      // its height comes from the clamped value rather than its real end.
      height: Math.max(MIN_HEIGHT_MINUTES, bottom - top),
    });
  }

  timed.sort((a, b) => a.top - b.top || b.height - a.height);

  const boxes: Box[] = [];

  for (const cluster of clustersOf(timed)) {
    const columns: Array<Array<(typeof timed)[number]>> = [];

    for (const entry of cluster) {
      // The first column whose last event has already finished.
      const column = columns.find((candidate) => {
        const last = candidate[candidate.length - 1];
        return last !== undefined && last.top + last.height <= entry.top;
      });

      if (column === undefined) columns.push([entry]);
      else column.push(entry);
    }

    const total = columns.length;

    columns.forEach((column, index) => {
      for (const entry of column) {
        // Widen rightwards while the neighbouring columns are free for this
        // event's whole span.
        let span = 1;
        for (let ahead = index + 1; ahead < total; ahead += 1) {
          const blocked = columns[ahead]!.some(
            (other) => other.top < entry.top + entry.height && other.top + other.height > entry.top,
          );
          if (blocked) break;
          span += 1;
        }

        boxes.push({
          occurrence: entry.occurrence,
          topMinutes: entry.top,
          heightMinutes: entry.height,
          left: index / total,
          width: span / total,
        });
      }
    });
  }

  return boxes.sort((a, b) => a.topMinutes - b.topMinutes || a.left - b.left);
}

/** Groups of events that transitively overlap. */
function clustersOf<T extends { top: number; height: number }>(entries: readonly T[]): T[][] {
  const clusters: T[][] = [];
  let current: T[] = [];
  let reach = -1;

  for (const entry of entries) {
    if (current.length > 0 && entry.top >= reach) {
      clusters.push(current);
      current = [];
      reach = -1;
    }
    current.push(entry);
    reach = Math.max(reach, entry.top + entry.height);
  }

  if (current.length > 0) clusters.push(current);
  return clusters;
}

// ── Which days a view shows ────────────────────────────────────────────────

export type CalendarScale = 'day' | 'workWeek' | 'week' | 'month' | 'agenda';

export const CALENDAR_SCALES: ReadonlyArray<{ id: CalendarScale; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'workWeek', label: 'Work week' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'agenda', label: 'Agenda' },
];

/** `2026-09-05` plus a number of days, staying a calendar date. */
export function addLocalDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  // Built from parts rather than parsed: `new Date('2026-03-15')` is midnight
  // UTC, which is the day before for anyone west of Greenwich.
  const shifted = new Date(year!, month! - 1, date! + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/** The weekday of a local date, 0 for Sunday. */
export function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).getDay();
}

/**
 * The days a scale shows, given the date it is anchored on.
 *
 * `startsOn` is the first day of the week — 0 for Sunday, 1 for Monday — which
 * differs by country and is not something to guess.
 */
export function daysOf(scale: CalendarScale, anchor: string, startsOn = 1): string[] {
  switch (scale) {
    case 'day':
      return [anchor];

    case 'workWeek': {
      const monday = startOfWeek(anchor, 1);
      return [0, 1, 2, 3, 4].map((offset) => addLocalDays(monday, offset));
    }

    case 'week': {
      const first = startOfWeek(anchor, startsOn);
      return [0, 1, 2, 3, 4, 5, 6].map((offset) => addLocalDays(first, offset));
    }

    case 'month': {
      // Whole weeks, so the grid is rectangular and the days either side of the
      // month are visible rather than blank.
      const [year, month] = anchor.split('-').map(Number);
      const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
      const start = startOfWeek(firstOfMonth, startsOn);

      const days: string[] = [];
      for (let offset = 0; offset < 42; offset += 1) {
        const day = addLocalDays(start, offset);
        days.push(day);
        // Stop at a whole week once the month is behind us.
        if (offset % 7 === 6 && Number(day.split('-')[1]) !== month && offset >= 27) break;
      }
      return days;
    }

    case 'agenda': {
      return Array.from({ length: 14 }, (_, offset) => addLocalDays(anchor, offset));
    }
  }
}

export function startOfWeek(day: string, startsOn: number): string {
  const weekday = weekdayOf(day);
  return addLocalDays(day, -((weekday - startsOn + 7) % 7));
}

/** How far the arrows move, per scale. */
export function step(scale: CalendarScale, anchor: string, direction: 1 | -1): string {
  switch (scale) {
    case 'day':
      return addLocalDays(anchor, direction);
    case 'workWeek':
    case 'week':
      return addLocalDays(anchor, 7 * direction);
    case 'agenda':
      return addLocalDays(anchor, 14 * direction);
    case 'month': {
      const [year, month] = anchor.split('-').map(Number);
      const shifted = new Date(year!, month! - 1 + direction, 1);
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-01`;
    }
  }
}

/** Today, as a local date. */
export function todayIn(now: string, zone: string): string {
  return localDay(now, zone);
}

// ── Working hours ──────────────────────────────────────────────────────────

export interface WorkHours {
  weekday: number;
  startsMinute: number;
  endsMinute: number;
}

/** The working span for a day, or null when it is not a working day. */
export function workingSpan(day: string, hours: readonly WorkHours[]): WorkHours | null {
  return hours.find((candidate) => candidate.weekday === weekdayOf(day)) ?? null;
}
