import { describe, expect, it } from 'vitest';

import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import type { Goal, GoalLink } from './goal';
import type { Edge } from './graph';
import type { Item } from './item';
import {
  daysBetween,
  isFree,
  project,
  PROPOSED_ID,
  receiptOf,
  type LedgerInput,
  type Proposal,
} from './receipt';

/*
 * Every case below is a plan a person can check on paper: a working week of
 * Monday to Friday, 09:00 to 17:00 — eight hours, 480 minutes a day — starting
 * on Monday 2 November 2026, in UTC so that a day is a day.
 */

const UTC = 'UTC';
const TODAY = '2026-11-02'; // Monday
const NOW = '2026-11-02T08:00:00.000Z';
const H = 60;
const DAY = 8 * H;

const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * H,
  endsMinute: 17 * H,
}));

const due = (day: string) => `${day}T12:00:00.000Z`;

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    collectionId: 'tasks',
    parentItemId: null,
    title: id,
    position: 'm',
    startAt: null,
    dueAt: null,
    remindAt: null,
    recurrenceRule: null,
    recurrenceMode: 'schedule',
    completedAt: null,
    estimateMinutes: null,
    isMilestone: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }) as Item;

const occurrence = (startsAt: string, endsAt: string, itemId: string | null = null): Occurrence => {
  const event: CalendarEvent = {
    id: `e-${startsAt}`,
    calendarId: 'c',
    title: 'Meeting',
    startsAt,
    endsAt,
    tz: UTC,
    allDay: false,
    rrule: null,
    color: null,
    itemId,
  };
  return { event, originalStart: startsAt, startsAt, endsAt };
};

const goal = (id: string, dueDay: string | null, over: Partial<Goal> = {}): Goal => ({
  id,
  name: id,
  measure: 'tasks',
  target: 2,
  dueDay,
  position: 'm',
  ...over,
});

const ledger = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  today: TODAY,
  zone: UTC,
  hours: HOURS,
  occurrences: [],
  items: [],
  edges: [],
  goals: [],
  goalLinks: [],
  tracked: new Map(),
  ...over,
});

// A: a day of work due Tuesday. B: a day of work due Wednesday.
const A = item('A', { estimateMinutes: DAY, dueAt: due('2026-11-03'), position: 'a' });
const B = item('B', { estimateMinutes: DAY, dueAt: due('2026-11-04'), position: 'b' });

const receipt = (proposal: Proposal, over: Partial<LedgerInput> = {}) => {
  const result = receiptOf(ledger({ items: [A, B], ...over }), proposal, NOW);
  if (result === null) throw new Error('expected a receipt');
  return result;
};

describe('daysBetween', () => {
  it('counts calendar days, across a month end and both ways', () => {
    expect(daysBetween('2026-11-02', '2026-11-02')).toBe(0);
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2026-11-09', '2026-11-02')).toBe(-7);
  });
});

describe('the projection', () => {
  it('fills free time earliest due first: A on Monday, B on Tuesday', () => {
    const p = project(ledger({ items: [B, A] }));
    expect(p.finishes.get('A')).toBe('2026-11-02');
    expect(p.finishes.get('B')).toBe('2026-11-03');
  });

  it('skips the weekend: a week and an hour of work ends on the next Monday', () => {
    const week = item('W', { estimateMinutes: 5 * DAY + H });
    expect(project(ledger({ items: [week] })).finishes.get('W')).toBe('2026-11-09');
  });

  it('a meeting takes its hours out of the day before any task gets them', () => {
    const meeting = occurrence('2026-11-02T09:00:00.000Z', '2026-11-02T13:00:00.000Z');
    const p = project(ledger({ items: [A], occurrences: [meeting] }));
    // Four hours left on Monday, four more needed on Tuesday.
    expect(p.finishes.get('A')).toBe('2026-11-03');
  });

  it('a meeting that already ended is not counted against today', () => {
    const past = occurrence('2026-10-30T09:00:00.000Z', '2026-10-30T17:00:00.000Z');
    expect(project(ledger({ items: [A], occurrences: [past] })).finishes.get('A')).toBe(
      '2026-11-02',
    );
  });

  it('time already tracked reduces what a task still needs', () => {
    const p = project(ledger({ items: [A, B], tracked: new Map([['A', DAY]]) }));
    expect(p.demand.get('A')).toBe(0);
    expect(p.finishes.get('A')).toBe('2026-11-02');
    expect(p.finishes.get('B')).toBe('2026-11-02');
  });

  it('time reserved for a task counts towards it, and it cannot finish before that block', () => {
    const block = occurrence('2026-11-04T09:00:00.000Z', '2026-11-04T13:00:00.000Z', 'A');
    const p = project(ledger({ items: [A], occurrences: [block] }));
    expect(p.demand.get('A')).toBe(4 * H);
    // The four free hours on Monday would do it, but the block is on Wednesday.
    expect(p.finishes.get('A')).toBe('2026-11-04');
  });

  it('a blocker goes first even when the task it blocks is due sooner', () => {
    const edges: Edge[] = [{ blockerId: 'B', blockedId: 'A' }];
    const p = project(ledger({ items: [A, B], edges }));
    expect(p.finishes.get('B')).toBe('2026-11-02');
    expect(p.finishes.get('A')).toBe('2026-11-03');
  });

  it('a task does not take time before its start day', () => {
    const later = item('L', { estimateMinutes: H, startAt: due('2026-11-05') });
    expect(project(ledger({ items: [later] })).finishes.get('L')).toBe('2026-11-05');
  });

  it('counts tasks with no estimate instead of guessing them, and ignores milestones and finished work', () => {
    const p = project(
      ledger({
        items: [
          A,
          item('unsized'),
          item('flag', { isMilestone: true, estimateMinutes: DAY }),
          item('done', { estimateMinutes: DAY, completedAt: NOW }),
        ],
      }),
    );
    expect(p.unestimated).toBe(1);
    expect([...p.finishes.keys()]).toEqual(['A']);
  });

  it('work that does not fit in the horizon has no finish day', () => {
    const huge = item('X', { estimateMinutes: 100 * DAY });
    expect(project(ledger({ items: [huge], horizonDays: 7 })).finishes.get('X')).toBeNull();
  });

  it('a task blocked by work that never fits never fits either', () => {
    const huge = item('X', { estimateMinutes: 100 * DAY });
    const p = project(
      ledger({ items: [huge, A], edges: [{ blockerId: 'X', blockedId: 'A' }], horizonDays: 7 }),
    );
    expect(p.finishes.get('A')).toBeNull();
  });

  it('is the same projection whatever order the rows arrive in', () => {
    const C = item('C', { estimateMinutes: 3 * H, position: 'c' });
    const one = project(ledger({ items: [A, B, C] }));
    const two = project(ledger({ items: [C, B, A] }));
    expect(Object.fromEntries(two.finishes)).toEqual(Object.fromEntries(one.finishes));
  });
});

describe('the projection from now', () => {
  const sized = item('a', { estimateMinutes: 8 * H });

  it('gives today only what is left of it', () => {
    // 09:00–17:00 and it is 13:00: four hours today, four tomorrow.
    const found = project(ledger({ items: [sized], minuteNow: 13 * H }));
    expect(found.finishes.get('a')).toBe('2026-11-03');
  });

  it('moves everything to tomorrow once the working day is over', () => {
    const found = project(
      ledger({ items: [item('a', { estimateMinutes: H })], minuteNow: 20 * H }),
    );
    expect(found.finishes.get('a')).toBe('2026-11-03');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('gives today all of it before the day starts', () => {
    const found = project(ledger({ items: [sized], minuteNow: 7 * H }));
    expect(found.finishes.get('a')).toBe(TODAY);
  });
});

describe('the receipt', () => {
  it('a new day of work due today pushes A and B one day each, and nothing is late', () => {
    const r = receipt({ kind: 'task', title: 'Brief', minutes: DAY, dueAt: due('2026-11-02') });
    expect(r.costMinutes).toBe(DAY);
    expect(r.own).toEqual({
      itemId: PROPOSED_ID,
      finish: '2026-11-02',
      dueDay: '2026-11-02',
      late: false,
    });
    expect(r.shifts.map((s) => [s.itemId, s.before, s.after, s.days, s.becameLate])).toEqual([
      ['A', '2026-11-02', '2026-11-03', 1, false],
      ['B', '2026-11-03', '2026-11-04', 1, false],
    ]);
    expect(isFree(r)).toBe(false);
  });

  it('two days of work due today make it, A and B all late — and the late ones come first', () => {
    const r = receipt({ kind: 'task', title: 'Big', minutes: 2 * DAY, dueAt: due('2026-11-02') });
    expect(r.own.finish).toBe('2026-11-03');
    expect(r.own.late).toBe(true);
    expect(r.shifts.map((s) => [s.itemId, s.after, s.becameLate])).toEqual([
      ['A', '2026-11-04', true],
      ['B', '2026-11-05', true],
    ]);
  });

  it('an undated hour with room to spare costs an hour and moves nothing', () => {
    const r = receipt({ kind: 'task', title: 'Someday', minutes: H, dueAt: null });
    expect(r.costMinutes).toBe(H);
    expect(r.shifts).toEqual([]);
    expect(isFree(r)).toBe(true);
  });

  it('doubling an estimate moves what comes after it — to its due day, not past it', () => {
    const r = receipt({ kind: 'estimate', itemId: 'A', minutes: 2 * DAY });
    expect(r.costMinutes).toBe(DAY);
    expect(r.own.finish).toBe('2026-11-03');
    expect(r.own.late).toBe(false);
    // B now takes Wednesday, which is the day it is due: moved, still in time.
    expect(r.shifts.map((s) => [s.itemId, s.after, s.days, s.becameLate])).toEqual([
      ['B', '2026-11-04', 1, false],
    ]);
  });

  it('removing an estimate gives time back: B moves earlier, by a negative number of days', () => {
    const r = receipt({ kind: 'estimate', itemId: 'A', minutes: null });
    expect(r.costMinutes).toBe(-DAY);
    expect(r.shifts.map((s) => [s.itemId, s.days])).toEqual([['B', -1]]);
    expect(r.own.finish).toBeNull();
    expect(r.unestimated).toBe(1);
  });

  it('bringing a due day forward reorders the queue', () => {
    const r = receipt({ kind: 'due', itemId: 'B', dueAt: due('2026-11-02') });
    expect(r.costMinutes).toBe(0);
    expect(r.own.finish).toBe('2026-11-02');
    expect(r.shifts.map((s) => [s.itemId, s.days, s.becameLate])).toEqual([['A', 1, false]]);
  });

  it('a change to a task that does not exist is refused, not invented', () => {
    expect(receiptOf(ledger(), { kind: 'estimate', itemId: 'ghost', minutes: H }, NOW)).toBeNull();
    expect(receiptOf(ledger(), { kind: 'due', itemId: 'ghost', dueAt: null }, NOW)).toBeNull();
  });

  it('a goal whose tasks move moves with them, and says when it becomes late', () => {
    const goals = [goal('Launch', '2026-11-04')];
    const goalLinks: GoalLink[] = [
      { goalId: 'Launch', itemId: 'A' },
      { goalId: 'Launch', itemId: 'B' },
    ] as GoalLink[];
    const one = receipt(
      { kind: 'task', title: 'Brief', minutes: DAY, dueAt: due('2026-11-02') },
      { goals, goalLinks },
    );
    expect(one.goals.map((g) => [g.goalId, g.before, g.after, g.days, g.becameLate])).toEqual([
      ['Launch', '2026-11-03', '2026-11-04', 1, false],
    ]);

    const two = receipt(
      { kind: 'task', title: 'Big', minutes: 2 * DAY, dueAt: due('2026-11-02') },
      { goals, goalLinks },
    );
    expect(two.goals[0]?.becameLate).toBe(true);
  });

  it('a goal with no due day, or with no projected tasks, is not on the receipt', () => {
    const goals = [goal('Open', null), goal('Empty', '2026-11-04')];
    const goalLinks = [{ goalId: 'Open', itemId: 'A' }] as GoalLink[];
    const r = receipt(
      { kind: 'task', title: 'Brief', minutes: DAY, dueAt: due('2026-11-02') },
      { goals, goalLinks },
    );
    expect(r.goals).toEqual([]);
  });

  it('a task that stops fitting in the horizon is late with no finish day', () => {
    const r = receipt(
      { kind: 'task', title: 'Huge', minutes: 100 * DAY, dueAt: due('2026-11-02') },
      { horizonDays: 14 },
    );
    expect(r.own.finish).toBeNull();
    expect(r.own.late).toBe(true);
    const a = r.shifts.find((s) => s.itemId === 'A');
    expect(a?.after).toBeNull();
    expect(a?.days).toBeNull();
    expect(a?.becameLate).toBe(true);
  });
});

describe('days off (M3)', () => {
  it('a day off on Monday moves A to Tuesday and B to Wednesday', () => {
    const p = project(ledger({ items: [A, B], daysOff: new Set(['2026-11-02']) }));
    expect(p.finishes.get('A')).toBe('2026-11-03');
    expect(p.finishes.get('B')).toBe('2026-11-04');
  });

  it('a receipt counts the day off too: the same new day of work now makes B late', () => {
    const r = receipt(
      { kind: 'task', title: 'Brief', minutes: DAY, dueAt: due('2026-11-02') },
      { daysOff: new Set(['2026-11-03']) },
    );
    // Monday: Brief. Tuesday: off. A on Wednesday (due Tue, late), B on Thursday (due Wed, late).
    expect(r.shifts.map((s) => [s.itemId, s.after, s.becameLate])).toEqual([
      ['A', '2026-11-04', true],
      ['B', '2026-11-05', true],
    ]);
  });
});
