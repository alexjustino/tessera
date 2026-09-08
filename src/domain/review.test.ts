import { describe, expect, it } from 'vitest';

import type { WorkHours } from './calendar';
import type { Goal, GoalLink } from './goal';
import type { Edge } from './graph';
import type { Item } from './item';
import { periodOf, traceable } from './report';
import { buildReview, describeGap, isFinished, type ReviewInput } from './review';

const SP = 'America/Sao_Paulo';
const NOW = '2026-09-09T15:00:00.000Z'; // Wednesday
const PERIOD = periodOf('week', '2026-09-09');

const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * 60,
  endsMinute: 17 * 60,
}));

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    collectionId: 'tasks',
    title: id,
    completedAt: null,
    startAt: null,
    dueAt: null,
    estimateMinutes: null,
    isMilestone: false,
    position: 'm',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...over,
  }) as unknown as Item;

const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id,
  name: id,
  measure: 'tasks',
  target: 3,
  dueDay: null,
  position: 'm',
  ...over,
});

const edge = (blockerId: string, blockedId: string): Edge => ({ blockerId, blockedId });

const review = (over: Partial<ReviewInput> = {}) =>
  buildReview(
    {
      goals: [],
      goalLinks: [],
      items: [],
      edges: [],
      reserved: new Set<string>(),
      period: PERIOD,
      hours: HOURS,
      ...over,
    },
    NOW,
    SP,
  );

describe('a goal with nothing to act on', () => {
  const links: GoalLink[] = [
    { goalId: 'ship', itemId: 'a' },
    { goalId: 'ship', itemId: 'b' },
  ];

  it('is not listed while something in it can be picked up', () => {
    const found = review({
      goals: [goal('ship')],
      goalLinks: links,
      items: [item('a', { completedAt: '2026-09-08T12:00:00.000Z' }), item('b')],
    });
    expect(found.projects).toEqual([]);
  });

  it('is listed when everything in it is waiting for something else', () => {
    const found = review({
      goals: [goal('ship')],
      goalLinks: links,
      items: [item('a'), item('b'), item('blocker')],
      edges: [edge('blocker', 'a'), edge('blocker', 'b')],
    });
    expect(found.projects).toHaveLength(1);
    expect(found.projects[0]!.reason).toBe('blocked');
    expect(describeGap(found.projects[0]!)).toContain('waiting for something else');
  });

  it('is listed when it holds nothing at all', () => {
    const found = review({ goals: [goal('ship')], goalLinks: [], items: [] });
    expect(found.projects[0]!.reason).toBe('empty');
    expect(describeGap(found.projects[0]!)).toBe('Nothing is in it yet.');
  });

  it('is listed when everything in it is done and the target is not reached', () => {
    const found = review({
      goals: [goal('ship', { target: 5 })],
      goalLinks: links,
      items: [
        item('a', { completedAt: '2026-09-08T12:00:00.000Z' }),
        item('b', { completedAt: '2026-09-08T12:00:00.000Z' }),
      ],
    });
    expect(found.projects[0]!.reason).toBe('finished');
    expect(describeGap(found.projects[0]!)).toContain('2 tasks are finished');
  });

  it('is not listed once it has reached its target, whatever is left in it', () => {
    const found = review({
      goals: [goal('ship', { target: 2 })],
      goalLinks: links,
      items: [
        item('a', { completedAt: '2026-09-08T12:00:00.000Z' }),
        item('b', { completedAt: '2026-09-08T12:00:00.000Z' }),
      ],
    });
    expect(found.projects).toEqual([]);
  });
});

describe('a task waiting for nothing', () => {
  it('is one whose blockers are all finished and which nobody has claimed', () => {
    const found = review({
      items: [item('blocker', { completedAt: '2026-09-08T12:00:00.000Z' }), item('freed')],
      edges: [edge('blocker', 'freed')],
    });
    expect(found.waiting).toHaveLength(1);
    expect(found.waiting[0]!.item.id).toBe('freed');
    expect(found.waiting[0]!.blockers).toEqual(['blocker']);
  });

  it('is not a task that never waited for anything', () => {
    expect(review({ items: [item('loose')] }).waiting).toEqual([]);
  });

  it('is not a task still waiting for something unfinished', () => {
    const found = review({
      items: [item('blocker'), item('waiting')],
      edges: [edge('blocker', 'waiting')],
    });
    expect(found.waiting).toEqual([]);
  });

  it('is not a task somebody has already picked up', () => {
    const freed = [item('blocker', { completedAt: '2026-09-08T12:00:00.000Z' })];
    const edges = [edge('blocker', 'freed')];

    const dated = review({
      items: [...freed, item('freed', { dueAt: '2026-09-11T12:00:00.000Z' })],
      edges,
    });
    expect(dated.waiting).toEqual([]);

    const reserved = review({
      items: [...freed, item('freed')],
      edges,
      reserved: new Set(['freed']),
    });
    expect(reserved.waiting).toEqual([]);
  });

  it('is not a task that is already finished', () => {
    const found = review({
      items: [
        item('blocker', { completedAt: '2026-09-08T12:00:00.000Z' }),
        item('freed', { completedAt: '2026-09-09T12:00:00.000Z' }),
      ],
      edges: [edge('blocker', 'freed')],
    });
    expect(found.waiting).toEqual([]);
  });
});

describe('planned but not scheduled', () => {
  const due = (id: string, day: string, minutes: number) =>
    item(id, { dueAt: `${day}T15:00:00.000Z`, estimateMinutes: minutes });

  it('adds up the estimates due in the period with no time reserved', () => {
    const found = review({
      items: [due('a', '2026-09-10', 90), due('b', '2026-09-11', 60)],
    });
    expect(found.unscheduled.value).toBe(150);
    expect(found.unscheduled.rows.map((row) => row.title)).toEqual(['a', 'b']);
    expect(traceable(found.unscheduled)).toBe(true);
  });

  it('leaves out what is reserved, what is done, and what is due elsewhere', () => {
    const found = review({
      items: [
        due('reserved', '2026-09-10', 90),
        item('done', {
          dueAt: '2026-09-10T15:00:00.000Z',
          estimateMinutes: 90,
          completedAt: '2026-09-09T12:00:00.000Z',
        }),
        due('next month', '2026-10-10', 90),
      ],
      reserved: new Set(['reserved']),
    });
    expect(found.unscheduled.value).toBe(0);
    expect(found.unscheduled.rows).toEqual([]);
  });

  it('counts nothing for a task nobody sized, rather than guessing', () => {
    const found = review({ items: [item('unsized', { dueAt: '2026-09-10T15:00:00.000Z' })] });
    expect(found.unscheduled.rows).toEqual([]);
  });

  it('says how much working time the period has left, today included', () => {
    // Wednesday: Wed, Thu, Fri of an 09:00–17:00 week.
    expect(review().capacityLeft).toBe(3 * 8 * 60);
  });
});

describe('finishing the review', () => {
  it('is finished when there is no gap left, whatever else is on the screen', () => {
    const found = review({ items: [item('a', { dueAt: '2026-09-10T15:00:00.000Z' })] });
    expect(isFinished(found)).toBe(true);
  });

  it('is not finished while a project has no next action', () => {
    expect(isFinished(review({ goals: [goal('ship')] }))).toBe(false);
  });

  it('is not finished while a task is waiting for nothing', () => {
    const found = review({
      items: [item('blocker', { completedAt: '2026-09-08T12:00:00.000Z' }), item('freed')],
      edges: [edge('blocker', 'freed')],
    });
    expect(isFinished(found)).toBe(false);
  });
});
