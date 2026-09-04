/**
 * Dates, recurrence, and what "today" means.
 *
 * This is the module where products like this one go wrong, and the failures
 * are all the same shape: an off-by-one-day that only appears west of
 * Greenwich, a recurring 09:00 task that becomes 08:00 in November, a "due
 * today" that flips at 21:00 because somebody compared UTC instants.
 *
 * Three rules keep it honest.
 *
 * **Instants are UTC; wall-clock is local** (ADR-013). The database stores an
 * instant. "Friday at 9" is a wall-clock time in a zone, and turning one into
 * the other is a conversion that must happen in exactly one place.
 *
 * **Recurrence is calculated in wall-clock, then converted.** A weekly 09:00
 * task must stay 09:00 across a daylight-saving change. Expanding in UTC and
 * converting afterwards moves it by an hour twice a year, which is precisely
 * the bug nobody reports and everybody notices.
 *
 * **Now is a parameter.** Nothing here reads the clock. A test that cannot
 * choose the current time cannot test the day a month ends, or the hour a
 * clock goes back.
 *
 * Pure: no I/O, no React, no host.
 */

import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { RRule, rrulestr } from 'rrule';

/** How a recurring item finds its next date. */
export type RecurrenceMode = 'schedule' | 'after_completion';

export const RECURRENCE_MODES: RecurrenceMode[] = ['schedule', 'after_completion'];

/** An item's schedule, as the interface handles it. */
export interface Schedule {
  /** ISO-8601 UTC, or null. */
  startAt: string | null;
  dueAt: string | null;
  remindAt: string | null;
  /** An RFC 5545 rule, without `DTSTART`. */
  rule: string | null;
  mode: RecurrenceMode;
}

export const NO_SCHEDULE: Schedule = {
  startAt: null,
  dueAt: null,
  remindAt: null,
  rule: null,
  mode: 'schedule',
};

// ── Zones ──────────────────────────────────────────────────────────────────

/** The zone this machine is in. The one place the environment is consulted. */
export function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A UTC instant, read as wall-clock in a zone.
 *
 * The returned `Date` is a lie in a useful way: its UTC fields hold the local
 * wall-clock numbers, which is what date arithmetic and `rrule` need. It must
 * never be stored.
 */
export function asWallClock(instant: string | Date, zone: string): Date {
  return toZonedTime(typeof instant === 'string' ? new Date(instant) : instant, zone);
}

/** A wall-clock time in a zone, back to the instant it denotes. */
export function asInstant(wallClock: Date, zone: string): string {
  return fromZonedTime(wallClock, zone).toISOString();
}

/**
 * Where an instant falls in a zone: which local day, and how many minutes into
 * it.
 *
 * The one conversion, so callers that need both do not pay for two. It goes
 * through `date-fns-tz`, which keeps its formatters; building an
 * `Intl.DateTimeFormat` per call — what `toLocaleString` with a `timeZone` does
 * — is roughly fifty microseconds each, and a calendar week asks thousands of
 * times.
 */
export function localPlace(instant: string, zone: string): { day: string; minute: number } {
  const wall = asWallClock(instant, zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    day: `${wall.getFullYear()}-${pad(wall.getMonth() + 1)}-${pad(wall.getDate())}`,
    minute: wall.getHours() * 60 + wall.getMinutes(),
  };
}

/** `2026-09-05` for the day an instant falls on, in a zone. */
export function localDay(instant: string, zone: string): string {
  const local = asWallClock(instant, zone);
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${local.getFullYear()}-${month}-${day}`;
}

/**
 * How many whole days separate two instants, counted in calendar days rather
 * than in 24-hour blocks.
 *
 * The difference matters: 23:00 tonight and 01:00 tomorrow are two hours apart
 * and one day apart, and a person means the second.
 */
export function daysBetween(from: string, to: string, zone: string): number {
  return differenceInCalendarDays(asWallClock(to, zone), asWallClock(from, zone));
}

// ── Buckets ────────────────────────────────────────────────────────────────

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none';

/**
 * Where a due date belongs, relative to now.
 *
 * Overdue is decided on the instant, not on the day: a task due at 09:00 is
 * overdue at 09:01, not at midnight. But "today" and "tomorrow" are calendar
 * days, because that is what the words mean.
 */
export function bucketOf(dueAt: string | null, now: string, zone: string): Bucket {
  if (dueAt === null) return 'none';

  if (new Date(dueAt).getTime() < new Date(now).getTime()) return 'overdue';

  const days = daysBetween(now, dueAt, zone);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return 'week';
  return 'later';
}

/** The instant at which the given local day begins, as UTC. */
export function startOfLocalDay(now: string, zone: string, offsetDays = 0): string {
  const local = startOfDay(addDays(asWallClock(now, zone), offsetDays));
  return asInstant(local, zone);
}

/** The instant at which the given local day ends, as UTC. */
export function endOfLocalDay(now: string, zone: string, offsetDays = 0): string {
  return startOfLocalDay(now, zone, offsetDays + 1);
}

// ── Recurrence ─────────────────────────────────────────────────────────────

/** Rules the interface offers without asking anyone to write RFC 5545. */
export const COMMON_RULES: ReadonlyArray<{ label: string; rule: string }> = [
  { label: 'Every day', rule: 'FREQ=DAILY' },
  { label: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every week', rule: 'FREQ=WEEKLY' },
  { label: 'Every two weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Every month', rule: 'FREQ=MONTHLY' },
  { label: 'Every year', rule: 'FREQ=YEARLY' },
];

export function describeRule(rule: string | null): string {
  if (rule === null) return 'Does not repeat';
  const known = COMMON_RULES.find((candidate) => candidate.rule === rule);
  if (known !== undefined) return known.label;
  try {
    return rrulestr(`RRULE:${rule}`).toText();
  } catch {
    // A rule this build cannot read is shown as itself rather than hidden. The
    // data is real even when the description is not available.
    return rule;
  }
}

/** True when a rule is well-formed enough to expand. */
export function isValidRule(rule: string): boolean {
  try {
    rrulestr(`RRULE:${rule}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the rule, anchored at a wall-clock start.
 *
 * The anchor is expressed in wall-clock so the rule computes in calendar terms
 * — "the first Monday", "the 31st" — and the result is converted to an instant
 * afterwards. Expanding in UTC and converting later is what moves a 09:00 task
 * to 08:00 in winter.
 */
function build(rule: string, anchor: Date): RRule | null {
  try {
    const parsed = rrulestr(`RRULE:${rule}`);
    return new RRule({ ...parsed.origOptions, dtstart: anchor });
  } catch {
    return null;
  }
}

/**
 * The next occurrence after `after`, or null when the series has ended.
 *
 * `schedule` follows the calendar: a weekly task due last Monday is next due
 * this Monday whether or not it was ever completed. `after_completion` counts
 * from the day it was actually finished — "three days after I do it" — which is
 * what maintenance work means and what Microsoft To Do cannot express.
 */
export function nextOccurrence(
  schedule: Schedule,
  from: string,
  zone: string,
  completedAt: string | null = null,
): string | null {
  if (schedule.rule === null || schedule.dueAt === null) return null;

  if (schedule.mode === 'after_completion') {
    // The interval is applied to the completion, keeping the original
    // wall-clock time of day: finishing a daily 09:00 task at 22:00 makes it
    // due at 09:00 tomorrow, not at 22:00.
    const base = completedAt ?? from;
    const anchor = asWallClock(schedule.dueAt, zone);
    const completedWall = asWallClock(base, zone);
    const restarted = new Date(completedWall);
    restarted.setHours(anchor.getHours(), anchor.getMinutes(), 0, 0);

    const rule = build(schedule.rule, restarted);
    if (rule === null) return null;

    const next = rule.after(restarted, false);
    return next === null ? null : asInstant(next, zone);
  }

  const anchor = asWallClock(schedule.dueAt, zone);
  const rule = build(schedule.rule, anchor);
  if (rule === null) return null;

  const next = rule.after(asWallClock(from, zone), false);
  return next === null ? null : asInstant(next, zone);
}

/**
 * Every occurrence inside a window, as instants.
 *
 * Bounded on purpose. An unbounded rule has infinitely many occurrences, and a
 * caller that forgets to say when to stop should get an empty list rather than
 * a frozen window.
 */
export function occurrencesBetween(
  schedule: Schedule,
  fromInstant: string,
  toInstant: string,
  zone: string,
  limit = 500,
): string[] {
  if (schedule.rule === null || schedule.dueAt === null) return [];
  if (new Date(toInstant).getTime() <= new Date(fromInstant).getTime()) return [];

  const rule = build(schedule.rule, asWallClock(schedule.dueAt, zone));
  if (rule === null) return [];

  return rule
    .between(asWallClock(fromInstant, zone), asWallClock(toInstant, zone), true)
    .slice(0, limit)
    .map((occurrence) => asInstant(occurrence, zone));
}

// ── Showing ────────────────────────────────────────────────────────────────

/**
 * A due date the way a person would say it.
 *
 * "Today 09:00" rather than "05/09/2026, 09:00" — relative where relative is
 * clearer, absolute where it is not.
 */
export function formatDue(dueAt: string | null, now: string, zone: string, locale = 'en'): string {
  if (dueAt === null) return '';

  const local = asWallClock(dueAt, zone);
  const midnight = local.getHours() === 0 && local.getMinutes() === 0;
  const time = midnight
    ? ''
    : ` ${local.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;

  const days = daysBetween(now, dueAt, zone);
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days === -1) return `Yesterday${time}`;

  if (days < 0) {
    const overdue = Math.abs(days);
    return `${overdue} day${overdue === 1 ? '' : 's'} ago`;
  }

  if (days <= 6) {
    return `${local.toLocaleDateString(locale, { weekday: 'long' })}${time}`;
  }

  const sameYear = local.getFullYear() === asWallClock(now, zone).getFullYear();
  return (
    local.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    }) + time
  );
}
