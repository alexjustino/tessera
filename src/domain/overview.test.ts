import { describe, expect, it } from 'vitest';

import type { Item } from './item';
import { countSlices, inSlice, portionsOf } from './overview';
import type { Property } from './property';

const SP = 'America/Sao_Paulo';
const NOW = '2026-11-02T15:00:00.000Z';
const NONE: ReadonlySet<string> = new Set();

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    dueAt: null,
    completedAt: null,
    estimateMinutes: 60,
    isMilestone: false,
    ...over,
  }) as Item;

const STATUS = {
  id: 'status',
  type: 'status',
  name: 'Status',
  config: {
    options: [
      { id: 'todo', label: 'To do', color: 'neutral' },
      { id: 'doing', label: 'Doing', color: 'info' },
    ],
  },
} as unknown as Property;

describe('the slices of the list', () => {
  it('counts each trouble once, and a task can be in several', () => {
    const counts = countSlices(
      [
        item('late', { dueAt: '2026-10-30T15:00:00.000Z' }),
        item('soon', { dueAt: '2026-11-04T15:00:00.000Z' }),
        item('bare', { estimateMinutes: null }),
      ],
      new Set(['soon']),
      NOW,
      SP,
    );
    expect(counts).toEqual({
      open: 3,
      overdue: 1,
      week: 1,
      undated: 1,
      waiting: 1,
      unestimated: 1,
    });
  });

  it('takes the seventh day and not the eighth', () => {
    const on = item('on', { dueAt: '2026-11-09T15:00:00.000Z' });
    const after = item('after', { dueAt: '2026-11-11T15:00:00.000Z' });
    expect(inSlice(on, 'week', NONE, NOW, SP)).toBe(true);
    expect(inSlice(after, 'week', NONE, NOW, SP)).toBe(false);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('puts a finished task in no slice, even a late one', () => {
    const done = item('done', {
      dueAt: '2026-10-30T15:00:00.000Z',
      completedAt: '2026-10-31T15:00:00.000Z',
    });
    expect(countSlices([done], new Set(['done']), NOW, SP)).toEqual({
      open: 0,
      overdue: 0,
      week: 0,
      undated: 0,
      waiting: 0,
      unestimated: 0,
    });
  });

  it('does not ask a milestone for an estimate', () => {
    const milestone = item('m', { isMilestone: true, estimateMinutes: null });
    expect(inSlice(milestone, 'unestimated', NONE, NOW, SP)).toBe(false);
  });

  it('does not count late work as due in the next seven days', () => {
    const late = item('late', { dueAt: '2026-10-30T15:00:00.000Z' });
    expect(inSlice(late, 'week', NONE, NOW, SP)).toBe(false);
  });
});

describe('how open work divides up', () => {
  it('follows the property order and adds up to the open work', () => {
    const portions = portionsOf([item('a'), item('b'), item('c')], STATUS, {
      a: { status: 'doing' },
      b: { status: 'doing' },
    });
    expect(portions.map((p) => [p.label, p.count])).toEqual([
      ['To do', 0],
      ['Doing', 2],
      ['None', 1],
    ]);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves finished work out', () => {
    const portions = portionsOf([item('a', { completedAt: NOW })], STATUS, {
      a: { status: 'doing' },
    });
    expect(portions.every((p) => p.count === 0)).toBe(true);
  });

  it('counts a value whose option was removed as having none', () => {
    const portions = portionsOf([item('a')], STATUS, { a: { status: 'gone' } });
    expect(portions.find((p) => p.id === '__none__')?.count).toBe(1);
  });
});
