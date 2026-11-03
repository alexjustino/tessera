/**
 * A suggested plan: where the open work could go, hour by hour (ADR-046).
 *
 * The owner's review of 1.4 put it plainly: a calendar that stays empty until a
 * person drags every task onto it is one more chore. So the calendar proposes.
 * Every open task is laid into the free working time from now on, earliest date
 * first, never over an event, never before what blocks it, never on a day off.
 *
 * **It is a suggestion, and nothing is written.** A suggestion is computed on every
 * read and stored nowhere. It becomes a reservation only when the person takes it
 * or moves it, which is how the promise of SPEC 1.3 stays true: show the cost,
 * never decide. Moving one suggestion reserves it there and the rest flow around
 * it, because the rest are only arithmetic.
 *
 * **It says what it assumed.** A task with no estimate is planned at an hour and
 * marked as assumed, because leaving it out is how the calendar stayed empty, and
 * guessing silently is how a plan starts to lie (ADR-020). What lands after its
 * date is marked late; what does not fit in the horizon is listed rather than
 * dropped.
 *
 * Deterministic: the same input always gives the same plan. Pure: no I/O, no React,
 * no host.
 */

import { addLocalDays, workingSpan } from './calendar';
import type { Item } from './item';
import { instantOf } from './moveByKeys';
import { blocksOf, orderOf, type LedgerInput } from './receipt';
import { localDay, localPlace } from './schedule';

/** How far ahead a plan is worth laying. Further than this it is fiction. */
export const PLAN_DAYS = 21;

/** What a task with no estimate is planned at, said as an assumption. */
export const ASSUMED_MINUTES = 60;

/** The shortest piece of work worth a place on a calendar. */
const SHORTEST_PIECE = 30;

const SNAP = 15;

export interface Suggestion {
  /** Unique within a plan. */
  key: string;
  itemId: string;
  title: string;
  day: string;
  startMinute: number;
  minutes: number;
  startsAt: string;
  endsAt: string;
  /** The task has no estimate, so this length is an assumption. */
  assumed: boolean;
  /** This piece ends after the task's date. */
  late: boolean;
}

export interface Unplaced {
  itemId: string;
  title: string;
  /** Minutes that found no room in the horizon. */
  minutes: number;
}

export interface SuggestedPlan {
  suggestions: Suggestion[];
  /** Work that found no room, or waits on work that found none. */
  unplaced: Unplaced[];
  /** How many tasks were planned at an assumed length. */
  assumed: number;
  /** How many tasks land after their date. */
  late: number;
  /** Minutes the plan lays. */
  minutes: number;
}

interface Slot {
  start: number;
  end: number;
}

/** A day's working span, less what has gone and what the calendar holds. */
function freeSlots(day: string, input: LedgerInput): Slot[] {
  if (input.daysOff?.has(day) === true) return [];
  const span = workingSpan(day, input.hours);
  if (span === null) return [];

  let from = span.startsMinute;
  if (day === input.today && input.minuteNow !== undefined) {
    from = Math.max(from, Math.ceil(input.minuteNow / SNAP) * SNAP);
  }
  if (from >= span.endsMinute) return [];

  const busy: Slot[] = [];
  for (const occurrence of input.occurrences) {
    if (occurrence.event.allDay) continue;
    const start = localPlace(occurrence.startsAt, input.zone);
    const end = localPlace(occurrence.endsAt, input.zone);
    if (start.day > day || end.day < day) continue;
    busy.push({
      start: start.day === day ? start.minute : 0,
      end: end.day === day ? end.minute : 24 * 60,
    });
  }
  busy.sort((a, b) => a.start - b.start);

  const slots: Slot[] = [];
  let cursor = from;
  for (const taken of busy) {
    if (taken.start > cursor)
      slots.push({ start: cursor, end: Math.min(taken.start, span.endsMinute) });
    cursor = Math.max(cursor, taken.end);
  }
  if (cursor < span.endsMinute) slots.push({ start: cursor, end: span.endsMinute });
  return slots.filter((slot) => slot.end > slot.start);
}

/** Lay the open work into the free time from now on. */
export function suggestPlan(
  input: LedgerInput,
  options: {
    /** Tasks the person has said to leave out for now. */
    leaveOut?: ReadonlySet<string>;
    horizonDays?: number;
    /** Sorts tasks with the same date. Lower comes first. */
    rankOf?: (itemId: string) => number;
  } = {},
): SuggestedPlan {
  const horizon = options.horizonDays ?? PLAN_DAYS;
  const days: string[] = [];
  for (let i = 0; i < horizon; i += 1) days.push(addLocalDays(input.today, i));
  const free = new Map(days.map((day) => [day, freeSlots(day, input)]));

  const future = input.occurrences.filter(
    (occurrence) => localDay(occurrence.endsAt, input.zone) >= input.today,
  );
  const reserved = new Map<string, number>();
  for (const [itemId, minutes] of blocksOf(future, input.zone, input.today)) {
    reserved.set(itemId, (reserved.get(itemId) ?? 0) + minutes);
  }

  const leaveOut = options.leaveOut ?? new Set<string>();
  const open = input.items.filter(
    (item) => item.completedAt === null && !item.isMilestone && !leaveOut.has(item.id),
  );
  const dueDays = new Map<string, string>();
  for (const item of open) {
    if (item.dueAt !== null) dueDays.set(item.id, localDay(item.dueAt, input.zone));
  }
  const order = orderOf(open, input.edges, dueDays, options.rankOf);

  const blockers = new Map<string, string[]>();
  for (const edge of input.edges) {
    blockers.set(edge.blockedId, [...(blockers.get(edge.blockedId) ?? []), edge.blockerId]);
  }

  const suggestions: Suggestion[] = [];
  const unplaced: Unplaced[] = [];
  /** Where each task's last piece ends, for whatever waits on it. */
  const endsAt = new Map<string, { day: string; minute: number } | null>();
  let assumedTasks = 0;
  const lateTasks = new Set<string>();

  const needOf = (item: Item): { minutes: number; assumed: boolean } => {
    const done = (input.tracked.get(item.id) ?? 0) + (reserved.get(item.id) ?? 0);
    if (item.estimateMinutes !== null) {
      return { minutes: Math.max(0, item.estimateMinutes - done), assumed: false };
    }
    // Time already set aside or spent says the person has this in hand.
    return done > 0 ? { minutes: 0, assumed: false } : { minutes: ASSUMED_MINUTES, assumed: true };
  };

  for (const item of order) {
    const { minutes: need, assumed } = needOf(item);
    if (need === 0) {
      endsAt.set(item.id, { day: input.today, minute: 0 });
      continue;
    }

    // Not before its own start, and not before everything it waits on.
    let earliest: { day: string; minute: number } = { day: input.today, minute: 0 };
    if (item.startAt !== null) {
      const start = localPlace(item.startAt, input.zone);
      if (start.day > earliest.day) earliest = { day: start.day, minute: 0 };
    }
    let stuck = false;
    for (const blocker of blockers.get(item.id) ?? []) {
      if (!endsAt.has(blocker)) continue;
      const end = endsAt.get(blocker);
      if (end === null || end === undefined) {
        stuck = true;
        continue;
      }
      if (end.day > earliest.day || (end.day === earliest.day && end.minute > earliest.minute)) {
        earliest = end;
      }
    }

    let left = need;
    if (!stuck) {
      for (const day of days) {
        if (left === 0) break;
        if (day < earliest.day) continue;
        const slots = free.get(day) ?? [];
        for (const slot of slots) {
          if (left === 0) break;
          const start = day === earliest.day ? Math.max(slot.start, earliest.minute) : slot.start;
          const room = slot.end - start;
          if (room <= 0) continue;
          // A sliver is no use unless it finishes the task.
          if (room < SHORTEST_PIECE && room < left) continue;
          const take = Math.min(room, left);
          suggestions.push({
            key: `${item.id}@${day}@${start}`,
            itemId: item.id,
            title: item.title,
            day,
            startMinute: start,
            minutes: take,
            startsAt: instantOf(day, start, input.zone),
            endsAt: instantOf(day, start + take, input.zone),
            assumed,
            late: (dueDays.get(item.id) ?? day) < day,
          });
          if (start === slot.start) {
            slot.start += take;
          } else {
            // Taken from the middle: keep what comes before it for smaller work.
            slots.push({ start: start + take, end: slot.end });
            slot.end = start;
            slots.sort((a, b) => a.start - b.start);
          }
          left -= take;
          endsAt.set(item.id, { day, minute: start + take });
        }
      }
    }

    if (left === need) endsAt.set(item.id, null);
    if (left > 0) unplaced.push({ itemId: item.id, title: item.title, minutes: left });
    if (left < need && assumed) assumedTasks += 1;
  }

  suggestions.sort((a, b) =>
    a.day === b.day ? a.startMinute - b.startMinute : a.day < b.day ? -1 : 1,
  );
  for (const suggestion of suggestions) if (suggestion.late) lateTasks.add(suggestion.itemId);

  return {
    suggestions,
    unplaced,
    assumed: assumedTasks,
    late: lateTasks.size,
    minutes: suggestions.reduce((sum, suggestion) => sum + suggestion.minutes, 0),
  };
}
