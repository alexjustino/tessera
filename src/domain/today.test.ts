import { describe, expect, it } from 'vitest';

import type { Item } from './item';
import { bucketOf } from './schedule';
import { comingUp, dueForToday } from './today';

const SP = 'America/Sao_Paulo';
const NOW = '2026-11-02T15:00:00.000Z'; // Monday, noon in Sao Paulo

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, title: id, dueAt: null, completedAt: null, ...over }) as Item;

describe('comingUp', () => {
  it('lists the days ahead, soonest first', () => {
    const found = comingUp(
      [
        item('friday', { dueAt: '2026-11-06T15:00:00.000Z' }),
        item('tuesday', { dueAt: '2026-11-03T15:00:00.000Z' }),
      ],
      NOW,
      SP,
    );
    expect(found.upcoming.map((task) => task.id)).toEqual(['tuesday', 'friday']);
  });

  it('counts the work with no date instead of hiding it', () => {
    expect(comingUp([item('a'), item('b')], NOW, SP).undated).toBe(2);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves out what Today already shows', () => {
    const found = comingUp(
      [
        item('late', { dueAt: '2026-10-30T15:00:00.000Z' }),
        item('today', { dueAt: '2026-11-02T20:00:00.000Z' }),
      ],
      NOW,
      SP,
    );
    expect(found.upcoming).toEqual([]);
  });

  it('leaves out what is further away than the window', () => {
    const found = comingUp([item('far', { dueAt: '2026-11-20T15:00:00.000Z' })], NOW, SP);
    expect(found.upcoming).toEqual([]);
  });

  it('leaves out finished work, dated or not', () => {
    const done = '2026-11-01T15:00:00.000Z';
    const found = comingUp(
      [
        item('a', { completedAt: done }),
        item('b', { completedAt: done, dueAt: '2026-11-03T15:00:00.000Z' }),
      ],
      NOW,
      SP,
    );
    expect(found).toEqual({ upcoming: [], undated: 0 });
  });
});

describe('dueForToday', () => {
  it('gives a task typed on Today the end of today', () => {
    const due = dueForToday(null, NOW, SP);
    expect(due).toBe('2026-11-03T02:59:00.000Z');
    expect(bucketOf(due, NOW, SP)).toBe('today');
  });

  it('keeps a date the person typed', () => {
    const friday = '2026-11-06T15:00:00.000Z';
    expect(dueForToday(friday, NOW, SP)).toBe(friday);
  });
});
