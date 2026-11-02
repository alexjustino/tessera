import { describe, expect, it } from 'vitest';

import type { WorkHours } from './calendar';
import {
  calibrationOf,
  forecastGoals,
  forecastTask,
  MIN_SAMPLE,
  quantile,
  RATIO_CEILING,
  ratiosOf,
} from './confidence';
import type { Goal, GoalLink } from './goal';
import type { Item } from './item';
import type { LedgerInput } from './receipt';

/*
 * The same paper week as the receipt's tests: Monday to Friday, 09:00–17:00,
 * 480 minutes a day, from Monday 2 November 2026, in UTC.
 */

const H = 60;
const TODAY = '2026-11-02';
const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * H,
  endsMinute: 17 * H,
}));

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

/**
 * Ten finished one-hour tasks that took, in minutes:
 * 60 ×5, 90 ×3, 120 ×2 — ratios 1 ×5, 1.5 ×3, 2 ×2.
 * Median 1.25; 85th percentile 1.5 + 0.65 × (2 − 1.5) = 1.825.
 */
const TOOK = [60, 60, 60, 60, 60, 90, 90, 90, 120, 120];
const HISTORY = TOOK.map((_, i) =>
  item(`done${i}`, { estimateMinutes: H, completedAt: '2026-10-20T10:00:00.000Z' }),
);
const TRACKED = new Map(TOOK.map((minutes, i) => [`done${i}`, minutes]));

const ledger = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  today: TODAY,
  zone: 'UTC',
  hours: HOURS,
  occurrences: [],
  items: [],
  edges: [],
  goals: [],
  goalLinks: [],
  tracked: TRACKED,
  ...over,
});

describe('quantile', () => {
  it('interpolates between neighbours, as a spreadsheet PERCENTILE does', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([7], 0.85)).toBe(7);
  });

  it('refuses to invent a quantile of nothing', () => {
    expect(() => quantile([], 0.5)).toThrow();
  });
});

describe('the measurements', () => {
  it('one ratio per finished task with an estimate and tracked time', () => {
    expect(ratiosOf(HISTORY, TRACKED).sort()).toEqual([1, 1, 1, 1, 1, 1.5, 1.5, 1.5, 2, 2]);
  });

  it('leaves out open work, milestones, tasks with no estimate and tasks with no time', () => {
    const items = [
      item('open', { estimateMinutes: H }),
      item('flag', { estimateMinutes: H, isMilestone: true, completedAt: TODAY }),
      item('unsized', { completedAt: TODAY }),
      item('untimed', { estimateMinutes: H, completedAt: TODAY }),
    ];
    const tracked = new Map([
      ['open', 60],
      ['flag', 60],
      ['unsized', 60],
    ]);
    expect(ratiosOf(items, tracked)).toEqual([]);
  });

  it('clamps a measurement outside a quarter to four times its estimate', () => {
    const items = [item('overnight', { estimateMinutes: H, completedAt: TODAY })];
    expect(ratiosOf(items, new Map([['overnight', 10 * H]]))).toEqual([RATIO_CEILING]);
  });
});

describe('the calibration', () => {
  it('has no range below the sample, and says how much history there is', () => {
    const nine = calibrationOf(HISTORY.slice(0, MIN_SAMPLE - 1), TRACKED);
    expect(nine).toEqual({ sample: 9, likely: null, sure: null });
  });

  it('at the sample, the median and the 85th percentile of the ratios', () => {
    const c = calibrationOf(HISTORY, TRACKED);
    expect(c.sample).toBe(10);
    expect(c.likely).toBeCloseTo(1.25, 10);
    expect(c.sure).toBeCloseTo(1.825, 10);
  });
});

describe('a task forecast', () => {
  // Sixteen hours of open work: two paper days as typed.
  const BIG = item('Big', { estimateMinutes: 16 * H });

  it('reads plain, likely and 85% sure from the same projection, scaled', () => {
    const input = ledger({ items: [...HISTORY, BIG] });
    const forecast = forecastTask(input, calibrationOf(input.items, TRACKED), 'Big');
    // As typed: 960 min → Mon + Tue.
    // Likely ×1.25: 1200 min → Mon, Tue, then 240 on Wed.
    // 85% ×1.825: 1752 min → Mon, Tue, Wed (1440), then 312 on Thu.
    expect(forecast).toEqual({ plain: '2026-11-03', likely: '2026-11-04', sure: '2026-11-05' });
  });

  it('below the sample gives the plain day and no range', () => {
    const input = ledger({ items: [...HISTORY.slice(0, 5), BIG] });
    const forecast = forecastTask(input, calibrationOf(input.items, TRACKED), 'Big');
    expect(forecast).toEqual({ plain: '2026-11-03', likely: null, sure: null });
  });

  it('has nothing to say about a task the projection does not count', () => {
    const input = ledger({ items: [...HISTORY, item('unsized')] });
    expect(forecastTask(input, calibrationOf(input.items, TRACKED), 'unsized')).toBeNull();
  });
});

describe('goal forecasts', () => {
  const goal: Goal = {
    id: 'Launch',
    name: 'Launch',
    measure: 'tasks',
    target: 2,
    dueDay: '2026-11-04',
    position: 'm',
  };
  const BIG = item('Big', { estimateMinutes: 16 * H });

  it('a goal is done when its last projected task is, plain and as a range', () => {
    const input = ledger({
      items: [...HISTORY, BIG],
      goals: [goal],
      goalLinks: [{ goalId: 'Launch', itemId: 'Big' }] as GoalLink[],
    });
    expect(forecastGoals(input, calibrationOf(input.items, TRACKED))).toEqual([
      { goalId: 'Launch', plain: '2026-11-03', likely: '2026-11-04', sure: '2026-11-05' },
    ]);
  });

  it('a goal with nothing open and estimated is left out rather than given a date', () => {
    const input = ledger({
      items: [...HISTORY],
      goals: [goal],
      goalLinks: [{ goalId: 'Launch', itemId: 'done0' }] as GoalLink[],
    });
    expect(forecastGoals(input, calibrationOf(input.items, TRACKED))).toEqual([]);
  });
});
