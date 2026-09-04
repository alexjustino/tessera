/**
 * Reports: a period, and what happened in it — with every number carrying
 * the rows it came from.
 *
 * The rule this module exists for: **a figure is never just a number**. Each
 * one is built from a list of rows and states the list, so the interface can
 * open any figure and show what it added up, and a test can check that the
 * sum of the rows *is* the figure. A report that shows "12h" without being
 * able to say which twelve hours is a report nobody can argue with, which is
 * the same as a report nobody can trust.
 *
 * Four questions a person asks about a week or a month, each answered from
 * the data the earlier slices already keep:
 *
 * - **Tracked** — the time entries (P4), split at local midnight, by task and
 *   by day.
 * - **Done** — the tasks completed in the period.
 * - **Against the estimate** — for tasks worked on in the period, all the time
 *   ever tracked against what was estimated (P2). The estimate is for the
 *   whole task, so the comparison is too.
 * - **Reserved** — what the calendar held in the period against the working
 *   hours there were (P5).
 *
 * Nothing here reads the clock or the zone; both come in as arguments.
 */

import { addLocalDays, startOfWeek, type Occurrence, type WorkHours } from './calendar';
import { capacityOf, plannedByDay } from './capacity';
import type { Item } from './item';
import { localDay } from './schedule';
import { minutesOf, splitByLocalDay, type Entry } from './time';

// ── Periods ────────────────────────────────────────────────────────────────

export type PeriodKind = 'week' | 'month';

export interface Period {
  kind: PeriodKind;
  /** Local days, both inclusive. */
  firstDay: string;
  lastDay: string;
}

/** The week or month a day is in. */
export function periodOf(kind: PeriodKind, day: string, startsOn = 1): Period {
  if (kind === 'week') {
    const firstDay = startOfWeek(day, startsOn);
    return { kind, firstDay, lastDay: addLocalDays(firstDay, 6) };
  }
  const firstDay = `${day.slice(0, 7)}-01`;
  const [year, month] = day.split('-').map(Number);
  const nextMonth = new Date(year!, month!, 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  const firstOfNext = `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01`;
  return { kind, firstDay, lastDay: addLocalDays(firstOfNext, -1) };
}

/** The period before or after this one. */
export function shiftPeriod(period: Period, direction: 1 | -1, startsOn = 1): Period {
  if (period.kind === 'week') {
    return periodOf('week', addLocalDays(period.firstDay, 7 * direction), startsOn);
  }
  const [year, month] = period.firstDay.split('-').map(Number);
  const shifted = new Date(year!, month! - 1 + direction, 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  return periodOf('month', `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-01`);
}

/** Every local day in the period, in order. */
export function daysIn(period: Period): string[] {
  const days: string[] = [];
  for (let day = period.firstDay; day <= period.lastDay; day = addLocalDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function inPeriod(day: string, period: Period): boolean {
  return day >= period.firstDay && day <= period.lastDay;
}

// ── Figures ────────────────────────────────────────────────────────────────

/**
 * One row a figure was built from. Enough to show it and to open what it
 * points at: the task, the entry, the occurrence.
 */
export interface ReportRow {
  /** `entry:<id>`, `task:<id>` or `occurrence:<eventId>@<originalStart>` — unique within a figure. */
  key: string;
  itemId: string | null;
  title: string;
  /** Local day the row is filed under, where it has one. */
  day: string | null;
  /** What the row contributes. Zero for rows that are counted rather than summed. */
  minutes: number;
}

export interface Figure {
  id: string;
  label: string;
  /** Minutes for a duration, a count otherwise. */
  unit: 'minutes' | 'count';
  value: number;
  rows: ReportRow[];
}

function summed(id: string, label: string, rows: ReportRow[]): Figure {
  return {
    id,
    label,
    unit: 'minutes',
    value: rows.reduce((sum, row) => sum + row.minutes, 0),
    rows,
  };
}

function counted(id: string, label: string, rows: ReportRow[]): Figure {
  return { id, label, unit: 'count', value: rows.length, rows };
}

// ── The report ─────────────────────────────────────────────────────────────

export interface ReportInput {
  entries: readonly Entry[];
  items: readonly Item[];
  /** Occurrences already expanded over at least the period. */
  occurrences: readonly Occurrence[];
  hours: readonly WorkHours[];
}

export interface EstimateLine {
  itemId: string;
  title: string;
  estimateMinutes: number;
  trackedMinutes: number;
}

export interface Report {
  period: Period;
  /** All time tracked in the period. */
  tracked: Figure;
  /** The same time, one figure per task, largest first. */
  trackedByTask: Figure[];
  /** The same time, one figure per day, in order. Days with nothing are absent. */
  trackedByDay: Figure[];
  /** Tasks completed in the period. */
  completed: Figure;
  /** Tasks worked on in the period that have an estimate, all-time tracked beside it. */
  againstEstimate: EstimateLine[];
  /** Of those, the ones over. */
  overEstimate: Figure;
  /** Minutes the calendar held in the period. */
  reserved: Figure;
  /** Working minutes the period had. Not a figure: it comes from a table, not from rows. */
  capacity: number;
}

export function buildReport(period: Period, input: ReportInput, zone: string, now: string): Report {
  const titleOf = new Map(input.items.map((item) => [item.id, item.title]));
  const title = (id: string | null) =>
    id === null ? 'Untitled' : (titleOf.get(id) ?? 'A task that is gone');

  // ── Tracked: every entry share that falls inside the period ────────────
  const shares: ReportRow[] = [];
  for (const entry of input.entries) {
    for (const share of splitByLocalDay(entry, zone, now)) {
      if (!inPeriod(share.day, period)) continue;
      shares.push({
        key: `entry:${entry.id}@${share.day}`,
        itemId: entry.itemId,
        title: title(entry.itemId),
        day: share.day,
        minutes: share.minutes,
      });
    }
  }
  const tracked = summed('tracked', 'Tracked', shares);

  const byTask = new Map<string, ReportRow[]>();
  for (const row of shares) {
    const id = row.itemId ?? '';
    byTask.set(id, [...(byTask.get(id) ?? []), row]);
  }
  const trackedByTask = [...byTask.entries()]
    .map(([id, rows]) => summed(`tracked:task:${id}`, title(id), rows))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const byDay = new Map<string, ReportRow[]>();
  for (const row of shares) {
    byDay.set(row.day!, [...(byDay.get(row.day!) ?? []), row]);
  }
  const trackedByDay = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rows]) => summed(`tracked:day:${day}`, day, rows));

  // ── Done ───────────────────────────────────────────────────────────────
  const completedRows: ReportRow[] = input.items
    .filter(
      (item) => item.completedAt !== null && inPeriod(localDay(item.completedAt, zone), period),
    )
    .map((item) => ({
      key: `task:${item.id}`,
      itemId: item.id,
      title: item.title,
      day: localDay(item.completedAt!, zone),
      minutes: 0,
    }))
    .sort((a, b) => a.day!.localeCompare(b.day!) || a.title.localeCompare(b.title));
  const completed = counted('completed', 'Completed', completedRows);

  // ── Against the estimate ───────────────────────────────────────────────
  const workedOn = new Set(shares.map((row) => row.itemId));
  const againstEstimate: EstimateLine[] = input.items
    .filter(
      (item) => workedOn.has(item.id) && item.estimateMinutes !== null && item.estimateMinutes > 0,
    )
    .map((item) => ({
      itemId: item.id,
      title: item.title,
      estimateMinutes: item.estimateMinutes!,
      trackedMinutes: input.entries
        .filter((entry) => entry.itemId === item.id)
        .reduce((sum, entry) => sum + minutesOf(entry, now), 0),
    }))
    .sort(
      (a, b) =>
        b.trackedMinutes / b.estimateMinutes - a.trackedMinutes / a.estimateMinutes ||
        a.title.localeCompare(b.title),
    );
  const overEstimate = counted(
    'over-estimate',
    'Over the estimate',
    againstEstimate
      .filter((line) => line.trackedMinutes > line.estimateMinutes)
      .map((line) => ({
        key: `task:${line.itemId}`,
        itemId: line.itemId,
        title: line.title,
        day: null,
        minutes: line.trackedMinutes - line.estimateMinutes,
      })),
  );

  // ── Reserved against capacity ──────────────────────────────────────────
  const reservedRows: ReportRow[] = [];
  for (const occurrence of input.occurrences) {
    if (occurrence.event.allDay) continue;
    const perDay = plannedByDay([occurrence], zone);
    for (const [day, minutes] of perDay) {
      if (!inPeriod(day, period)) continue;
      reservedRows.push({
        key: `occurrence:${occurrence.event.id}@${occurrence.originalStart}@${day}`,
        itemId: occurrence.event.itemId,
        title: occurrence.event.title || title(occurrence.event.itemId),
        day,
        minutes,
      });
    }
  }
  reservedRows.sort((a, b) => a.day!.localeCompare(b.day!) || a.title.localeCompare(b.title));
  const reserved = summed('reserved', 'Reserved', reservedRows);
  const capacity = daysIn(period).reduce((sum, day) => sum + capacityOf(day, input.hours), 0);

  return {
    period,
    tracked,
    trackedByTask,
    trackedByDay,
    completed,
    againstEstimate,
    overEstimate,
    reserved,
    capacity,
  };
}

/** Every figure in a report, flat — what the traceability test walks. */
export function figuresOf(report: Report): Figure[] {
  return [
    report.tracked,
    ...report.trackedByTask,
    ...report.trackedByDay,
    report.completed,
    report.overEstimate,
    report.reserved,
  ];
}

/**
 * Does a figure say what its rows say? True when the value is the sum of the
 * rows' minutes (for a duration) or their number (for a count), and every row
 * key is unique. The invariant the module promises, as a function so the
 * interface can assert it too.
 */
export function traceable(figure: Figure): boolean {
  const keys = new Set(figure.rows.map((row) => row.key));
  if (keys.size !== figure.rows.length) return false;
  const expected =
    figure.unit === 'minutes'
      ? figure.rows.reduce((sum, row) => sum + row.minutes, 0)
      : figure.rows.length;
  return figure.value === expected;
}
