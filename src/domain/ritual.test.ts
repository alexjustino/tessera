import { describe, expect, it } from 'vitest';

import type { Item } from './item';
import {
  assumedIn,
  dateOn,
  journalEntry,
  journalTitle,
  movesTo,
  ritualDue,
  weigh,
  workLeft,
} from './ritual';

const SP = 'America/Sao_Paulo';
const at = (day: string, hour: number, minute = 0) => {
  const [year, month, date] = day.split('-').map(Number);
  // Sao Paulo is three hours behind UTC; Date.UTC carries an hour past midnight over.
  return new Date(Date.UTC(year!, month! - 1, date!, hour + 3, minute)).toISOString();
};
/** Saturday 9:00. */
const NOW = at('2026-11-07', 9);

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    dueAt: at('2026-11-05', 16, 30),
    remindAt: null,
    recurrenceRule: null,
    completedAt: null,
    isMilestone: false,
    estimateMinutes: 60,
    ...over,
  }) as Item;

describe('moving work to a day', () => {
  it('keeps its time of day', () => {
    expect(dateOn(item('a'), '2026-11-08', SP, NOW).dueAt).toBe(at('2026-11-08', 16, 30));
  });

  it('moves a reminder by as much as the date', () => {
    const moved = dateOn(item('a', { remindAt: at('2026-11-05', 16) }), '2026-11-08', SP, NOW);
    expect(moved.remindAt).toBe(at('2026-11-08', 16));
  });

  it('gives a task with no date the end of the day', () => {
    expect(dateOn(item('a', { dueAt: null }), '2026-11-08', SP, NOW).dueAt).toBe(
      at('2026-11-08', 23, 59),
    );
  });

  it('kept for today with its hour gone, it is due at the end of today, not late at once', () => {
    const early = item('a', { dueAt: at('2026-11-05', 8) });
    expect(dateOn(early, '2026-11-07', SP, NOW).dueAt).toBe(at('2026-11-07', 23, 59));
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('leaves a repeating task where it is, and says so', () => {
    const { moves, repeating } = movesTo(
      [item('a'), item('weekly', { recurrenceRule: 'FREQ=WEEKLY' })],
      '2026-11-08',
      SP,
      NOW,
    );
    expect(moves.map((move) => move.itemId)).toEqual(['a']);
    expect(repeating.map((task) => task.id)).toEqual(['weekly']);
  });
});

describe('weighing the day', () => {
  it('counts what is left of each estimate, an hour for none, nothing for a milestone', () => {
    const work = workLeft(
      [
        item('a', { estimateMinutes: 90 }),
        item('b', { estimateMinutes: null }),
        item('m', { isMilestone: true }),
      ],
      new Map([['a', 30]]),
    );
    expect(work).toBe(60 + 60);
    expect(
      assumedIn([item('b', { estimateMinutes: null }), item('m', { isMilestone: true })]),
    ).toBe(1);
  });

  it('says how far over the free time it is', () => {
    expect(weigh(300, 240)).toEqual({ fits: false, overBy: 60 });
    expect(weigh(120, 240)).toEqual({ fits: true, overBy: 0 });
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('never counts negative work for a task past its estimate', () => {
    expect(workLeft([item('a', { estimateMinutes: 30 })], new Map([['a', 90]]))).toBe(0);
  });
});

describe('the journal', () => {
  it('is a page a month', () => {
    expect(journalTitle('2026-11-07')).toBe('Journal — November 2026');
  });

  it('says the day, its figures and the line', () => {
    const nodes = journalEntry(
      '2026-11-07',
      { done: 4, tracked: 130, score: 72, carried: 2 },
      ' Good day. ',
    );
    const texts = nodes.map((node) => node.content?.[0]?.text);
    expect(texts).toEqual([
      'Saturday, Nov 7',
      '4 done · 2h 10m on the clock · 2 to tomorrow · score 72',
      'Good day.',
    ]);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('writes no empty line when nothing was said, and no score when none was measured', () => {
    const nodes = journalEntry(
      '2026-11-07',
      { done: 0, tracked: 0, score: null, carried: 0 },
      '  ',
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.content?.[0]?.text).toBe('0 done · 0m on the clock');
  });
});

describe('when the ritual is offered', () => {
  it('offers the plan in the morning until it is done, and the close from late afternoon', () => {
    expect(ritualDue(9 * 60, null)).toBe('plan');
    expect(ritualDue(9 * 60, { plannedAt: 'x', closedAt: null })).toBeNull();
    expect(ritualDue(15 * 60 + 30, null)).toBeNull();
    expect(ritualDue(17 * 60, { plannedAt: 'x', closedAt: null })).toBe('close');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('offers nothing once the day is closed', () => {
    expect(ritualDue(18 * 60, { plannedAt: null, closedAt: 'x' })).toBeNull();
    expect(ritualDue(8 * 60, { plannedAt: null, closedAt: 'x' })).toBeNull();
  });
});
