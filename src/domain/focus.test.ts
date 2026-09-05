import { describe, expect, it } from 'vitest';

import { describeQueue, focusQueue, nextAfter, pickFocus } from './focus';
import type { Edge } from './graph';
import type { Item } from './item';

const task = (id: string, position: string, extra: Partial<Item> = {}): Item => ({
  id,
  collectionId: 'tasks',
  parentItemId: null,
  title: `Task ${id}`,
  position,
  startAt: null,
  dueAt: null,
  remindAt: null,
  recurrenceRule: null,
  recurrenceMode: 'schedule',
  completedAt: null,
  estimateMinutes: null,
  isMilestone: false,
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  ...extra,
});

// a, then b which waits for a, c free, d done, e a milestone, f waits for d (done).
const ITEMS: Item[] = [
  task('a', 'a'),
  task('b', 'b'),
  task('c', 'c'),
  task('d', 'd', { completedAt: '2026-09-02T12:00:00.000Z' }),
  task('e', 'e', { isMilestone: true }),
  task('f', 'f'),
];
const EDGES: Edge[] = [
  { blockerId: 'a', blockedId: 'b' },
  { blockerId: 'd', blockedId: 'f' },
];

describe('the queue', () => {
  it('is what is open, not waiting, and not a milestone — in list order', () => {
    expect(focusQueue(ITEMS, EDGES).map((item) => item.id)).toEqual(['a', 'c', 'f']);
  });

  it('releases a task when what it waited for is done', () => {
    const done = ITEMS.map((item) =>
      item.id === 'a' ? { ...item, completedAt: '2026-09-03T12:00:00.000Z' } : item,
    );
    expect(focusQueue(done, EDGES).map((item) => item.id)).toEqual(['b', 'c', 'f']);
  });

  it('follows the list order, not the order the items were given in', () => {
    const shuffled = [ITEMS[2]!, ITEMS[5]!, ITEMS[0]!];
    expect(focusQueue(shuffled, EDGES).map((item) => item.id)).toEqual(['a', 'c', 'f']);
  });

  it('is empty when nothing is ready', () => {
    expect(focusQueue([], [])).toEqual([]);
    expect(focusQueue([task('x', 'a', { isMilestone: true })], [])).toEqual([]);
  });
});

describe('picking the one', () => {
  it('takes what the person pointed at, while it is open', () => {
    expect(pickFocus(ITEMS, EDGES, null, 'c')?.id).toBe('c');
    // Even a waiting task: pointing at it is a decision.
    expect(pickFocus(ITEMS, EDGES, null, 'b')?.id).toBe('b');
  });

  it('otherwise takes the task the clock is on', () => {
    expect(pickFocus(ITEMS, EDGES, 'f', null)?.id).toBe('f');
    expect(pickFocus(ITEMS, EDGES, 'f', 'c')?.id).toBe('c');
  });

  it('otherwise takes the first task ready to start', () => {
    expect(pickFocus(ITEMS, EDGES, null, null)?.id).toBe('a');
  });

  it('never picks a completed task, whoever asked', () => {
    expect(pickFocus(ITEMS, EDGES, 'd', 'd')?.id).toBe('a');
    expect(pickFocus(ITEMS, EDGES, null, 'ghost')?.id).toBe('a');
  });

  it('is nothing when there is nothing', () => {
    expect(pickFocus([], [], null, null)).toBeNull();
    expect(
      pickFocus([task('x', 'a', { completedAt: '2026-09-02T12:00:00.000Z' })], [], 'x', 'x'),
    ).toBeNull();
  });
});

describe('next', () => {
  it('is the first ready task that is not the current one', () => {
    expect(nextAfter(ITEMS, EDGES, 'a')?.id).toBe('c');
    expect(nextAfter(ITEMS, EDGES, 'c')?.id).toBe('a');
    // From a task that is not itself ready, next is still the first ready one.
    expect(nextAfter(ITEMS, EDGES, 'b')?.id).toBe('a');
  });

  it('is nothing when the current task is the last thing left', () => {
    expect(nextAfter([task('only', 'a')], [], 'only')).toBeNull();
  });

  it('is described in a sentence', () => {
    expect(describeQueue(ITEMS, EDGES, 'a')).toBe('2 more ready to start.');
    expect(describeQueue([task('only', 'a')], [], 'only')).toBe('Nothing else is ready to start.');
  });
});
