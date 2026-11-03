/**
 * How today stands: the figures a person opens Today to see, and one score.
 *
 * The score is arithmetic a person can do by hand, out of 100 points (ADR-045):
 *
 * - **Delivered, 50 points.** Of the work that is yours today — finished today,
 *   still due today, or late — the share that is finished.
 * - **Focus, 25 points.** Of the working time gone so far today, the share with
 *   a clock running. Only for someone who uses the clock at all.
 * - **Planned, 25 points.** Of the work due in the next seven days, the share
 *   with time set aside on the calendar.
 *
 * A part with nothing to measure says so and takes no points either way: the
 * total is scaled to the parts that were measured, so a quiet morning does not
 * read as a bad one. With nothing measured there is no score, and the screen says
 * that instead of showing a number nobody earned (the rule of ADR-020).
 *
 * Pure: no I/O, no React, no host.
 */

import { addLocalDays, todayIn, workingSpan, type Occurrence, type WorkHours } from './calendar';
import { capacityOf } from './capacity';
import type { Item } from './item';
import { bucketOf, endOfLocalDay, localDay, localPlace } from './schedule';
import { minutesByDay, type Entry } from './time';

/** How much of the working day has to have gone before focus means anything. */
const FOCUS_FROM_MINUTES = 15;

export type ScorePartId = 'delivered' | 'focus' | 'planned';

export interface ScorePart {
  id: ScorePartId;
  label: string;
  /** Points it is worth when measured. */
  weight: number;
  /** Earned share, 0 to 1. Null when there is nothing to measure. */
  share: number | null;
  /** The arithmetic, in words: what was counted against what. */
  says: string;
}

export type ScoreWord = 'Behind' | 'Steady' | 'On track' | 'Ahead';

export interface DayReading {
  day: string;
  done: number;
  tracked: number;
}

export interface Pulse {
  today: string;
  /** Open work due today. */
  due: Item[];
  /** Open work whose date has gone. */
  overdue: Item[];
  /** Work finished today. */
  done: Item[];
  /** Minutes on the clock today. */
  tracked: number;
  /** Working minutes today has, in all. */
  capacity: number;
  /** Working minutes left today that nothing on the calendar holds. */
  free: number;
  /** What is on the calendar today, in order, all-day events first. */
  agenda: Occurrence[];
  /** The next timed thing on the calendar today, if any. */
  next: Occurrence | null;
  /** The last seven days, oldest first, today last. */
  week: DayReading[];
  parts: ScorePart[];
  /** Out of 100, or null when nothing could be measured. */
  score: number | null;
  word: ScoreWord | null;
}

export interface PulseInput {
  items: readonly Item[];
  entries: readonly Entry[];
  /** Occurrences covering at least today. */
  occurrences: readonly Occurrence[];
  hours: readonly WorkHours[];
  daysOff?: ReadonlySet<string>;
  /** Tasks with time reserved on the calendar. */
  reserved: ReadonlySet<string>;
  now: string;
  zone: string;
}

/** The word for a score: what the number is called, so it is never only a number. */
export function wordFor(score: number): ScoreWord {
  if (score >= 90) return 'Ahead';
  if (score >= 75) return 'On track';
  if (score >= 50) return 'Steady';
  return 'Behind';
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function clock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function pulseOf(input: PulseInput): Pulse {
  const { items, entries, hours, daysOff, reserved, now, zone } = input;
  const today = todayIn(now, zone);
  const minuteNow = localPlace(now, zone).minute;
  const open = items.filter((item) => item.completedAt === null && !item.isMilestone);

  const due = open.filter((item) => bucketOf(item.dueAt, now, zone) === 'today');
  const overdue = open.filter((item) => bucketOf(item.dueAt, now, zone) === 'overdue');
  const done = items.filter(
    (item) => item.completedAt !== null && localDay(item.completedAt, zone) === today,
  );

  const byDay = new Map(minutesByDay(entries, zone, now).map((s) => [s.day, s.minutes]));
  const tracked = byDay.get(today) ?? 0;

  // ── The calendar today ─────────────────────────────────────────────────
  const onToday = input.occurrences.filter(
    (occurrence) => localDay(occurrence.startsAt, zone) === today,
  );
  const agenda = [...onToday].sort((a, b) => {
    if (a.event.allDay !== b.event.allDay) return a.event.allDay ? -1 : 1;
    return Date.parse(a.startsAt) - Date.parse(b.startsAt);
  });
  const timed = agenda.filter((occurrence) => !occurrence.event.allDay);
  const next = timed.find((occurrence) => Date.parse(occurrence.endsAt) > Date.parse(now)) ?? null;

  // ── What is left of today ──────────────────────────────────────────────
  const capacity = capacityOf(today, hours, daysOff);
  const span = capacity > 0 ? workingSpan(today, hours) : null;
  let free = 0;
  let gone = 0;
  if (span !== null) {
    const from = Math.max(minuteNow, span.startsMinute);
    gone = Math.max(0, Math.min(minuteNow, span.endsMinute) - span.startsMinute);
    free = Math.max(0, span.endsMinute - from);
    for (const occurrence of timed) {
      const start = Math.max(from, localPlace(occurrence.startsAt, zone).minute);
      const endsToday = localDay(occurrence.endsAt, zone) === today;
      const end = Math.min(
        span.endsMinute,
        endsToday ? localPlace(occurrence.endsAt, zone).minute : span.endsMinute,
      );
      if (end > start) free = Math.max(0, free - (end - start));
    }
  }

  // ── The last seven days ────────────────────────────────────────────────
  const week: DayReading[] = [];
  for (let back = 6; back >= 0; back -= 1) {
    const day = addLocalDays(today, -back);
    week.push({
      day,
      done: items.filter(
        (item) => item.completedAt !== null && localDay(item.completedAt, zone) === day,
      ).length,
      tracked: byDay.get(day) ?? 0,
    });
  }

  // ── The score ──────────────────────────────────────────────────────────
  const yours = done.length + due.length + overdue.length;
  const until = Date.parse(endOfLocalDay(now, zone, 7));
  const soon = open.filter((item) => item.dueAt !== null && Date.parse(item.dueAt) <= until);
  const covered = soon.filter((item) => reserved.has(item.id)).length;
  const usesTheClock = entries.length > 0;

  const parts: ScorePart[] = [
    {
      id: 'delivered',
      label: 'Delivered',
      weight: 50,
      share: yours === 0 ? null : done.length / yours,
      says:
        yours === 0
          ? 'Nothing was due today, and nothing is late.'
          : `${done.length} of ${plural(yours, 'task')} finished${
              overdue.length > 0 ? `, ${overdue.length} of them late` : ''
            }.`,
    },
    {
      id: 'focus',
      label: 'Focus',
      weight: 25,
      share: usesTheClock && gone >= FOCUS_FROM_MINUTES ? Math.min(1, tracked / gone) : null,
      says: !usesTheClock
        ? 'Not counted: no clock has been started yet.'
        : gone < FOCUS_FROM_MINUTES
          ? 'Not counted yet: the working day has barely started.'
          : `${clock(tracked)} on the clock of ${clock(gone)} of working time gone.`,
    },
    {
      id: 'planned',
      label: 'Planned',
      weight: 25,
      share: soon.length === 0 ? null : covered / soon.length,
      says:
        soon.length === 0
          ? 'Nothing is due in the next seven days.'
          : `${covered} of ${plural(soon.length, 'task')} due within a week ${
              covered === 1 ? 'has' : 'have'
            } time set aside.`,
    },
  ];

  const measured = parts.filter((part) => part.share !== null);
  const worth = measured.reduce((sum, part) => sum + part.weight, 0);
  const score =
    worth === 0
      ? null
      : Math.round(
          (measured.reduce((sum, part) => sum + part.weight * (part.share ?? 0), 0) / worth) * 100,
        );

  return {
    today,
    due,
    overdue,
    done,
    tracked,
    capacity,
    free,
    agenda,
    next,
    week,
    parts,
    score,
    word: score === null ? null : wordFor(score),
  };
}

/** Why a card matters today. The chip on the board says the same word. */
export type TodayMark = 'late' | 'running' | 'today' | 'reserved';

/**
 * What ties a task to today, the strongest reason first: a date that has gone,
 * a clock on it now, a date of today, or time set aside for it today.
 */
export function todayMarkOf(
  item: Item,
  reservedToday: ReadonlySet<string>,
  runningId: string | null,
  now: string,
  zone: string,
): TodayMark | null {
  if (item.completedAt !== null) return null;
  const bucket = bucketOf(item.dueAt, now, zone);
  if (bucket === 'overdue') return 'late';
  if (item.id === runningId) return 'running';
  if (bucket === 'today') return 'today';
  return reservedToday.has(item.id) ? 'reserved' : null;
}
