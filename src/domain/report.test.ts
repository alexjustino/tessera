import { describe, expect, it } from 'vitest';

import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import type { Item } from './item';
import {
  buildReport,
  daysIn,
  figuresOf,
  inPeriod,
  periodOf,
  shiftPeriod,
  traceable,
  type Figure,
} from './report';
import type { Entry } from './time';

const ZONE = 'America/Sao_Paulo';

const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 540,
  endsMinute: 1080,
}));

const at = (day: string, hour: number, minute = 0): string =>
  new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`,
  ).toISOString();

const NOW = at('2026-09-11', 18); // Friday evening

const task = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  collectionId: 'tasks',
  parentItemId: null,
  title: `Task ${id}`,
  position: 'a',
  startAt: null,
  dueAt: null,
  remindAt: null,
  recurrenceRule: null,
  recurrenceMode: 'schedule',
  completedAt: null,
  estimateMinutes: null,
  isMilestone: false,
  createdAt: at('2026-09-01', 9),
  updatedAt: at('2026-09-01', 9),
  ...extra,
});

const entry = (id: string, itemId: string, startedAt: string, endedAt: string | null): Entry => ({
  id,
  itemId,
  startedAt,
  endedAt,
});

const occurrence = (id: string, startsAt: string, endsAt: string, itemId: string | null = null) => {
  const event: CalendarEvent = {
    id,
    calendarId: 'personal',
    title: itemId === null ? `Event ${id}` : '',
    startsAt,
    endsAt,
    tz: ZONE,
    allDay: false,
    rrule: null,
    color: null,
    itemId,
  };
  const result: Occurrence = { event, originalStart: startsAt, startsAt, endsAt };
  return result;
};

/** The week of 7–13 September 2026. */
const WEEK = periodOf('week', '2026-09-09');

describe('a period', () => {
  it('is the week around a day, starting where the caller says weeks start', () => {
    expect(WEEK).toEqual({ kind: 'week', firstDay: '2026-09-07', lastDay: '2026-09-13' });
    expect(periodOf('week', '2026-09-09', 0).firstDay).toBe('2026-09-06');
  });

  it('is the month around a day, however long that month is', () => {
    expect(periodOf('month', '2026-02-10')).toEqual({
      kind: 'month',
      firstDay: '2026-02-01',
      lastDay: '2026-02-28',
    });
    expect(periodOf('month', '2028-02-10').lastDay).toBe('2028-02-29');
    expect(periodOf('month', '2026-12-31').lastDay).toBe('2026-12-31');
  });

  it('shifts by a week or a month, across a year end', () => {
    expect(shiftPeriod(WEEK, 1).firstDay).toBe('2026-09-14');
    expect(shiftPeriod(WEEK, -1).lastDay).toBe('2026-09-06');
    expect(shiftPeriod(periodOf('month', '2026-12-05'), 1).firstDay).toBe('2027-01-01');
    expect(shiftPeriod(periodOf('month', '2026-01-05'), -1).firstDay).toBe('2025-12-01');
  });

  it('lists its days and knows what is inside it', () => {
    expect(daysIn(WEEK)).toHaveLength(7);
    expect(daysIn(periodOf('month', '2026-02-01'))).toHaveLength(28);
    expect(inPeriod('2026-09-07', WEEK)).toBe(true);
    expect(inPeriod('2026-09-13', WEEK)).toBe(true);
    expect(inPeriod('2026-09-14', WEEK)).toBe(false);
    expect(inPeriod('2026-09-06', WEEK)).toBe(false);
  });
});

describe('the report', () => {
  const items = [
    task('a', { title: 'Write the brief', estimateMinutes: 120 }),
    task('b', { title: 'Review it', estimateMinutes: 45, completedAt: at('2026-09-10', 16) }),
    task('c', { title: 'Old thing', completedAt: at('2026-09-02', 10) }), // last week
    task('d', { title: 'Never touched' }),
  ];
  const entries = [
    entry('e1', 'a', at('2026-09-07', 9), at('2026-09-07', 11)), // 2h Monday
    entry('e2', 'a', at('2026-09-08', 23), at('2026-09-09', 1)), // crosses midnight: 1h + 1h
    entry('e3', 'b', at('2026-09-10', 14), at('2026-09-10', 15, 30)), // 1h30
    entry('e4', 'a', at('2026-09-04', 9), at('2026-09-04', 10)), // last week: not in the period
    entry('e5', 'b', at('2026-09-11', 17), null), // running, 1h to NOW
  ];
  const occurrences = [
    occurrence('o1', at('2026-09-07', 9), at('2026-09-07', 12), 'a'), // a block, 3h
    occurrence('o2', at('2026-09-10', 10), at('2026-09-10', 11)), // a meeting, 1h
    occurrence('o3', at('2026-09-20', 10), at('2026-09-20', 11)), // next week
  ];
  const report = buildReport(WEEK, { entries, items, occurrences, hours: HOURS }, ZONE, NOW);

  it('adds the tracked time up inside the period only, split at midnight', () => {
    // 2h + (1h + 1h) + 1h30 + 1h running = 6h30.
    expect(report.tracked.value).toBe(390);
    expect(report.tracked.rows.map((row) => row.key)).not.toContain('entry:e4@2026-09-04');
    // The overnight entry is two rows, one per day.
    expect(report.tracked.rows.filter((row) => row.key.startsWith('entry:e2'))).toHaveLength(2);
  });

  it('says which task the time went to, largest first', () => {
    expect(report.trackedByTask.map((figure) => [figure.label, figure.value])).toEqual([
      ['Write the brief', 240],
      ['Review it', 150],
    ]);
  });

  it('says which day the time went to, with the overnight hour on the day it happened', () => {
    expect(report.trackedByDay.map((figure) => [figure.label, figure.value])).toEqual([
      ['2026-09-07', 120],
      ['2026-09-08', 60],
      ['2026-09-09', 60],
      ['2026-09-10', 90],
      ['2026-09-11', 60],
    ]);
  });

  it('counts what was completed in the period, and not what was completed before it', () => {
    expect(report.completed.value).toBe(1);
    expect(report.completed.rows[0]!.title).toBe('Review it');
  });

  it('compares all-time tracked time to the estimate, for tasks worked on in the period', () => {
    expect(report.againstEstimate.map((line) => line.title)).toEqual([
      'Review it', // 150 of 45: 3.3×, first
      'Write the brief', // 300 of 120 (the hour last week counts: the estimate is for the task)
    ]);
    expect(report.againstEstimate[1]!.trackedMinutes).toBe(300);
    expect(report.overEstimate.value).toBe(2);
    expect(report.overEstimate.rows.map((row) => row.minutes)).toEqual([105, 180]);
  });

  it('leaves out a task with no estimate: there is nothing to compare against', () => {
    expect(report.againstEstimate.map((line) => line.itemId)).not.toContain('d');
  });

  it('adds up what the calendar reserved in the period against the hours it had', () => {
    expect(report.reserved.value).toBe(240);
    expect(report.reserved.rows.map((row) => row.title)).toEqual(['Write the brief', 'Event o2']);
    expect(report.capacity).toBe(5 * 540);
  });

  it('is empty rather than wrong when there is nothing', () => {
    const empty = buildReport(
      WEEK,
      { entries: [], items: [], occurrences: [], hours: [] },
      ZONE,
      NOW,
    );
    expect(empty.tracked.value).toBe(0);
    expect(empty.trackedByTask).toEqual([]);
    expect(empty.completed.value).toBe(0);
    expect(empty.againstEstimate).toEqual([]);
    expect(empty.reserved.value).toBe(0);
    expect(empty.capacity).toBe(0);
  });

  it('names a task that is gone rather than crashing on it', () => {
    const orphan = buildReport(
      WEEK,
      {
        entries: [entry('x', 'ghost', at('2026-09-07', 9), at('2026-09-07', 10))],
        items,
        occurrences: [],
        hours: HOURS,
      },
      ZONE,
      NOW,
    );
    expect(orphan.trackedByTask[0]!.label).toBe('A task that is gone');
    expect(orphan.tracked.value).toBe(60);
  });
});

describe('every number can be traced to the rows it came from', () => {
  const items = [
    task('a', { estimateMinutes: 30 }),
    task('b', { completedAt: at('2026-09-08', 9) }),
  ];
  const entries = [
    entry('e1', 'a', at('2026-09-07', 9), at('2026-09-07', 10)),
    entry('e2', 'a', at('2026-09-09', 22), at('2026-09-10', 2)),
    entry('e3', 'b', at('2026-09-11', 9), null),
  ];
  const occurrences = [occurrence('o1', at('2026-09-08', 9), at('2026-09-08', 12), 'a')];
  const report = buildReport(WEEK, { entries, items, occurrences, hours: HOURS }, ZONE, NOW);

  it('holds for every figure the report produces', () => {
    const figures = figuresOf(report);
    expect(figures.length).toBeGreaterThan(5);
    for (const figure of figures) {
      expect(traceable(figure), `${figure.id} does not add up`).toBe(true);
    }
  });

  it('and the check itself catches a figure that lies', () => {
    const honest: Figure = {
      id: 'x',
      label: 'x',
      unit: 'minutes',
      value: 3,
      rows: [
        { key: 'a', itemId: null, title: '', day: null, minutes: 1 },
        { key: 'b', itemId: null, title: '', day: null, minutes: 2 },
      ],
    };
    expect(traceable(honest)).toBe(true);
    expect(traceable({ ...honest, value: 4 })).toBe(false);
    // A row counted twice is a figure that adds up and still lies.
    expect(traceable({ ...honest, value: 2, rows: [honest.rows[0]!, honest.rows[0]!] })).toBe(
      false,
    );
    expect(traceable({ ...honest, unit: 'count', value: 2 })).toBe(true);
    expect(traceable({ ...honest, unit: 'count', value: 3 })).toBe(false);
  });
});
