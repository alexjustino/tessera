import { describe, expect, it } from 'vitest';

import {
  checkName,
  checkTarget,
  daysLeft,
  describeProgress,
  goalsOf,
  isAchieved,
  itemsOf,
  progressOf,
  remainingOf,
  shareOf,
  stateOf,
  type Goal,
  type GoalLink,
} from './goal';
import type { Item } from './item';
import { traceable } from './report';
import type { Entry } from './time';

const SP = 'America/Sao_Paulo';
const NOW = '2026-09-10T15:00:00.000Z';

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  name: 'Ship 1.2',
  measure: 'tasks',
  target: 3,
  dueDay: null,
  position: 'm',
  ...over,
});

const item = (id: string, title: string, completedAt: string | null = null): Item =>
  ({
    id,
    collectionId: 'tasks',
    title,
    completedAt,
    dueAt: null,
    startAt: null,
    position: 'm',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  }) as unknown as Item;

const entry = (id: string, itemId: string, from: string, to: string | null): Entry => ({
  id,
  itemId,
  startedAt: from,
  endedAt: to,
});

const ITEMS = [
  item('i1', 'Write the brief', '2026-09-08T12:00:00.000Z'),
  item('i2', 'Draw the diagram', '2026-09-09T18:00:00.000Z'),
  item('i3', 'Review it'),
];

const LINKS: GoalLink[] = [
  { goalId: 'g1', itemId: 'i1' },
  { goalId: 'g1', itemId: 'i2' },
  { goalId: 'g1', itemId: 'i3' },
  { goalId: 'g2', itemId: 'i3' },
];

describe('what a goal may be', () => {
  it('needs a name and something to reach', () => {
    expect(checkName('Ship 1.2')).toBeNull();
    expect(checkName('   ')).toBe('A goal needs a name.');
    expect(checkName('x'.repeat(201))).toContain('at most 200');

    expect(checkTarget(12)).toBeNull();
    expect(checkTarget(0)).toBe('A goal needs something to reach.');
    expect(checkTarget(-3)).toBe('A goal needs something to reach.');
    expect(checkTarget(1.5)).toBe('A target is a whole number.');
    expect(checkTarget(Number.NaN)).toBe('A target is a whole number.');
  });
});

describe('what is in a goal', () => {
  it('is the tasks that were put in it, in list order', () => {
    expect(itemsOf(goal(), LINKS, ITEMS).map((entry) => entry.id)).toEqual(['i1', 'i2', 'i3']);
  });

  it('is nothing when nothing was put in', () => {
    expect(itemsOf(goal({ id: 'g9' }), LINKS, ITEMS)).toEqual([]);
  });

  it('reads the other way too: which goals a task counts towards', () => {
    const goals = [goal(), goal({ id: 'g2', name: 'Read more' })];
    expect(goalsOf('i3', LINKS, goals).map((entry) => entry.id)).toEqual(['g1', 'g2']);
    expect(goalsOf('i1', LINKS, goals).map((entry) => entry.id)).toEqual(['g1']);
  });
});

describe('progress counted in tasks', () => {
  const inside = itemsOf(goal(), LINKS, ITEMS);

  it('is the finished ones, and it carries them', () => {
    const figure = progressOf(goal(), inside, [], NOW, SP);
    expect(figure.value).toBe(2);
    expect(figure.unit).toBe('count');
    expect(figure.rows.map((row) => row.title)).toEqual(['Write the brief', 'Draw the diagram']);
    expect(traceable(figure)).toBe(true);
  });

  it('files each row under the day it was finished, in the workspace’s zone', () => {
    const figure = progressOf(goal(), inside, [], NOW, SP);
    // 2026-09-08T12:00Z is the 8th in São Paulo; 09-09T18:00Z is the 9th.
    expect(figure.rows.map((row) => row.day)).toEqual(['2026-09-08', '2026-09-09']);
  });

  it('is nothing, traceably, when nothing is finished', () => {
    const figure = progressOf(goal(), [item('i9', 'Not yet')], [], NOW, SP);
    expect(figure.value).toBe(0);
    expect(figure.rows).toEqual([]);
    expect(traceable(figure)).toBe(true);
  });
});

describe('progress counted in minutes', () => {
  const timed = goal({ measure: 'minutes', target: 120 });
  const inside = itemsOf(timed, LINKS, ITEMS);
  const ENTRIES = [
    entry('e1', 'i1', '2026-09-08T10:00:00.000Z', '2026-09-08T10:30:00.000Z'),
    entry('e2', 'i2', '2026-09-09T09:00:00.000Z', '2026-09-09T10:00:00.000Z'),
    // A task that is not in this goal.
    entry('e3', 'i9', '2026-09-09T09:00:00.000Z', '2026-09-09T11:00:00.000Z'),
  ];

  it('adds up the entries on its own tasks and nothing else', () => {
    const figure = progressOf(timed, inside, ENTRIES, NOW, SP);
    expect(figure.value).toBe(90);
    expect(figure.unit).toBe('minutes');
    expect(figure.rows.map((row) => row.key)).toEqual(['entry:e2', 'entry:e1']);
    expect(traceable(figure)).toBe(true);
  });

  it('counts a running timer up to now, like everywhere else', () => {
    const running = [entry('e4', 'i1', '2026-09-10T14:00:00.000Z', null)];
    const figure = progressOf(timed, inside, running, NOW, SP);
    expect(figure.value).toBe(60);
    expect(traceable(figure)).toBe(true);
  });

  it('leaves out an entry that lasted no time at all', () => {
    const zero = [entry('e5', 'i1', '2026-09-08T10:00:00.000Z', '2026-09-08T10:00:00.000Z')];
    expect(progressOf(timed, inside, zero, NOW, SP).rows).toEqual([]);
  });
});

describe('where a goal stands', () => {
  const done = progressOf(goal(), ITEMS.slice(0, 2), [], NOW, SP);

  it('says how much of the target is done, and never more than all of it', () => {
    expect(shareOf(done, goal())).toBeCloseTo(2 / 3);
    expect(shareOf(done, goal({ target: 1 }))).toBe(1);
    expect(remainingOf(done, goal())).toBe(1);
    expect(remainingOf(done, goal({ target: 1 }))).toBe(0);
  });

  it('is achieved once the value reaches the target', () => {
    expect(isAchieved(done, goal({ target: 2 }))).toBe(true);
    expect(isAchieved(done, goal({ target: 3 }))).toBe(false);
  });

  it('counts the days to its day, and past it', () => {
    expect(daysLeft(goal({ dueDay: '2026-09-12' }), NOW, SP)).toBe(2);
    expect(daysLeft(goal({ dueDay: '2026-09-10' }), NOW, SP)).toBe(0);
    expect(daysLeft(goal({ dueDay: '2026-09-01' }), NOW, SP)).toBe(-9);
    expect(daysLeft(goal(), NOW, SP)).toBeNull();
  });

  it('never calls a finished goal late', () => {
    const late = goal({ target: 2, dueDay: '2026-09-01' });
    expect(stateOf(done, late, NOW, SP)).toBe('achieved');
    expect(stateOf(done, goal({ target: 5, dueDay: '2026-09-01' }), NOW, SP)).toBe('overdue');
    expect(stateOf(done, goal({ target: 5, dueDay: '2026-09-30' }), NOW, SP)).toBe('due');
    expect(stateOf(done, goal({ target: 5 }), NOW, SP)).toBe('open');
  });

  it('says the progress the way a person would', () => {
    const hours = (minutes: number) => `${minutes}m`;
    expect(describeProgress(done, goal(), hours)).toBe('2 of 3 tasks');
    expect(describeProgress(done, goal({ target: 1 }), hours)).toBe('2 of 1 task');
    const timed = goal({ measure: 'minutes', target: 120 });
    expect(describeProgress({ ...done, value: 90 }, timed, hours)).toBe('90m of 120m');
  });
});
