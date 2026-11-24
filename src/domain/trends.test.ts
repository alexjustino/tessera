import { describe, expect, it } from 'vitest';

import type { Item } from './item';
import type { Entry } from './time';
import { accuracyOf, compare, weeklyTrend } from './trends';

const SP = 'America/Sao_Paulo';
const NOW = '2026-11-04T15:00:00.000Z';
const THIS_WEEK = '2026-11-02';

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    completedAt: null,
    estimateMinutes: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    ...over,
  }) as Item;

const entry = (itemId: string, startedAt: string, minutes: number): Entry =>
  ({
    id: `${itemId}-${startedAt}`,
    itemId,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
  }) as Entry;

const trend = (items: Item[], entries: Entry[] = []) =>
  weeklyTrend({ items, entries, firstDay: THIS_WEEK, weeks: 3, zone: SP, now: NOW });

describe('the weeks so far', () => {
  it('runs oldest first and ends on this week', () => {
    expect(trend([]).map((week) => week.firstDay)).toEqual([
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ]);
  });

  it('files each thing under the week it happened in', () => {
    const weeks = trend(
      [
        item('a', { completedAt: '2026-11-03T15:00:00.000Z' }),
        item('b', { completedAt: '2026-10-27T15:00:00.000Z' }),
        item('c', { createdAt: '2026-11-02T15:00:00.000Z' }),
      ],
      [entry('a', '2026-10-20T15:00:00.000Z', 90)],
    );
    expect(weeks.map((week) => week.finished)).toEqual([0, 1, 1]);
    expect(weeks.map((week) => week.added)).toEqual([0, 0, 1]);
    expect(weeks.map((week) => week.tracked)).toEqual([90, 0, 0]);
  });

  it('puts Sunday night in the week it is the end of, in the person’s own zone', () => {
    // 23:30 on Sunday 1 November in Sao Paulo is already Monday in UTC.
    const weeks = trend([item('a', { completedAt: '2026-11-02T02:30:00.000Z' })]);
    expect(weeks.map((week) => week.finished)).toEqual([0, 1, 0]);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('leaves out what happened before the run', () => {
    const weeks = trend([item('a', { completedAt: '2026-01-05T15:00:00.000Z' })]);
    expect(weeks.every((week) => week.finished === 0)).toBe(true);
  });
});

describe('how the estimates held up', () => {
  const done = (id: string, estimate: number) =>
    item(id, { completedAt: NOW, estimateMinutes: estimate });

  it('gives the middle reading and how many came in within the estimate', () => {
    const accuracy = accuracyOf(
      [done('a', 60), done('b', 60), done('c', 60)],
      [
        entry('a', '2026-11-01T12:00:00.000Z', 30),
        entry('b', '2026-11-01T14:00:00.000Z', 60),
        entry('c', '2026-11-01T16:00:00.000Z', 120),
      ],
      NOW,
    );
    expect(accuracy).toEqual({ sample: 3, within: 2, ratio: 1 });
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('says nothing below the sample, rather than a percentage from two tasks', () => {
    expect(
      accuracyOf(
        [done('a', 60), done('b', 60)],
        [entry('a', '2026-11-01T12:00:00.000Z', 30), entry('b', '2026-11-01T14:00:00.000Z', 60)],
        NOW,
      ),
    ).toBeNull();
  });

  it('leaves out open work and work nobody timed', () => {
    const accuracy = accuracyOf(
      [
        item('open', { estimateMinutes: 60 }),
        done('untimed', 60),
        item('unsized', { completedAt: NOW }),
      ],
      [
        entry('open', '2026-11-01T12:00:00.000Z', 30),
        entry('unsized', '2026-11-01T14:00:00.000Z', 30),
      ],
      NOW,
    );
    expect(accuracy).toBeNull();
  });
});

describe('a reading against the one before', () => {
  it('says which way it went', () => {
    expect(compare(5, 3)).toEqual({ change: 2, word: 'up from 3' });
    expect(compare(1, 3)).toEqual({ change: -2, word: 'down from 3' });
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('does not call no change a change', () => {
    expect(compare(3, 3).word).toBe('the same as before');
  });
});
