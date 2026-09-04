import { describe, expect, it } from 'vitest';

import type { Edge } from './graph';
import type { Item } from './item';
import { asWallClock } from './schedule';
import {
  capture,
  checkName,
  describe as describeBody,
  instantiate,
  readBody,
  spanDays,
  type TemplateBody,
} from './template';

const ZONE = 'America/Sao_Paulo'; // UTC−3, no daylight saving since 2019
const NEW_YORK = 'America/New_York'; // still changes its clocks

const at = (day: string, hour: number, minute = 0, offset = '-03:00'): string =>
  new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`,
  ).toISOString();

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

/** Kick-off Monday 09:00, build due Thursday 14:00, launch milestone the Monday after. */
const LAUNCH: Item[] = [
  task('kick', { title: 'Kick-off', startAt: at('2026-09-07', 9), dueAt: at('2026-09-07', 10) }),
  task('build', { title: 'Build it', dueAt: at('2026-09-10', 14), estimateMinutes: 480 }),
  task('launch', { title: 'Launch', dueAt: at('2026-09-14', 9), isMilestone: true }),
  task('notes', { title: 'Write it up' }), // undated
];
const LAUNCH_EDGES: Edge[] = [
  { blockerId: 'kick', blockedId: 'build' },
  { blockerId: 'build', blockedId: 'launch' },
  { blockerId: 'build', blockedId: 'outsider' }, // to a task not in the set
];

const wall = (instant: string | null, zone: string) => {
  const local = asWallClock(instant!, zone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
};

describe('capturing a template', () => {
  const body = capture(LAUNCH, LAUNCH_EDGES, ZONE);

  it('anchors on the earliest date and stores every other date as days from it', () => {
    const byKey = new Map(body.tasks.map((entry) => [entry.title, entry]));
    expect(byKey.get('Kick-off')).toMatchObject({
      startOffsetDays: 0,
      startMinute: 9 * 60,
      dueOffsetDays: 0,
      dueMinute: 10 * 60,
    });
    expect(byKey.get('Build it')).toMatchObject({
      startOffsetDays: null,
      dueOffsetDays: 3,
      dueMinute: 14 * 60,
      estimateMinutes: 480,
    });
    expect(byKey.get('Launch')).toMatchObject({ dueOffsetDays: 7, isMilestone: true });
  });

  it('leaves an undated task undated', () => {
    const notes = body.tasks.find((entry) => entry.title === 'Write it up')!;
    expect(notes.startOffsetDays).toBeNull();
    expect(notes.dueOffsetDays).toBeNull();
  });

  it('keeps the dependencies between its tasks, by key, and drops the ones that leave', () => {
    const keyOf = new Map(body.tasks.map((entry) => [entry.title, entry.key]));
    expect(body.edges).toEqual([
      { blockerKey: keyOf.get('Kick-off'), blockedKey: keyOf.get('Build it') },
      { blockerKey: keyOf.get('Build it'), blockedKey: keyOf.get('Launch') },
    ]);
  });

  it('gives every task a key of its own', () => {
    expect(new Set(body.tasks.map((entry) => entry.key)).size).toBe(body.tasks.length);
  });

  it('is a template of nothing when given nothing', () => {
    expect(capture([], [], ZONE)).toEqual({ tasks: [], edges: [] });
  });
});

describe('applying a template', () => {
  const body = capture(LAUNCH, LAUNCH_EDGES, ZONE);

  it('rebases every date onto the day it is applied to, keeping the time of day', () => {
    // A Monday a month later.
    const applied = instantiate(body, '2026-10-05', ZONE);
    const byTitle = new Map(applied.tasks.map((entry) => [entry.title, entry]));
    expect(wall(byTitle.get('Kick-off')!.startAt, ZONE)).toBe('2026-10-05 09:00');
    expect(wall(byTitle.get('Build it')!.dueAt, ZONE)).toBe('2026-10-08 14:00');
    expect(wall(byTitle.get('Launch')!.dueAt, ZONE)).toBe('2026-10-12 09:00');
    expect(byTitle.get('Write it up')!.dueAt).toBeNull();
  });

  it('keeps the dependencies, still by key, for the caller to link', () => {
    const applied = instantiate(body, '2026-10-05', ZONE);
    expect(applied.edges).toEqual(body.edges);
    // Every edge names a task that was produced.
    const keys = new Set(applied.tasks.map((entry) => entry.key));
    for (const edge of applied.edges) {
      expect(keys.has(edge.blockerKey)).toBe(true);
      expect(keys.has(edge.blockedKey)).toBe(true);
    }
  });

  it('carries estimates and milestones across', () => {
    const applied = instantiate(body, '2026-10-05', ZONE);
    expect(applied.tasks.find((entry) => entry.title === 'Build it')!.estimateMinutes).toBe(480);
    expect(applied.tasks.find((entry) => entry.title === 'Launch')!.isMilestone).toBe(true);
  });

  it('crosses a month end and a year end as calendar days', () => {
    const applied = instantiate(body, '2026-12-28', ZONE);
    const launch = applied.tasks.find((entry) => entry.title === 'Launch')!;
    expect(wall(launch.dueAt, ZONE)).toBe('2027-01-04 09:00');
  });

  it('keeps the wall-clock time across a daylight-saving change', () => {
    // Captured in New York in October (EDT), applied across 1 November (EST).
    const before: Item[] = [
      task('a', { title: 'Start', dueAt: at('2026-10-26', 9, 0, '-04:00') }),
      task('b', { title: 'End', dueAt: at('2026-10-30', 9, 0, '-04:00') }),
    ];
    const nyBody = capture(before, [], NEW_YORK);
    const applied = instantiate(nyBody, '2026-10-29', NEW_YORK);
    // Four days on: 2 November, after the clocks went back — still 09:00.
    expect(wall(applied.tasks[1]!.dueAt, NEW_YORK)).toBe('2026-11-02 09:00');
    // Which is one hour more elapsed than a naive 96 hours.
    const elapsed = Date.parse(applied.tasks[1]!.dueAt!) - Date.parse(applied.tasks[0]!.dueAt!);
    expect(elapsed).toBe(97 * 3_600_000);
  });

  it('produces independent copies each time it is applied', () => {
    const first = instantiate(body, '2026-10-05', ZONE);
    const second = instantiate(body, '2026-11-02', ZONE);
    expect(first.tasks[0]!.startAt).not.toBe(second.tasks[0]!.startAt);
    expect(first.tasks.map((entry) => entry.title)).toEqual(
      second.tasks.map((entry) => entry.title),
    );
  });
});

describe('describing', () => {
  it('says what a template holds and how long it runs', () => {
    const body = capture(LAUNCH, LAUNCH_EDGES, ZONE);
    expect(spanDays(body)).toBe(7);
    expect(describeBody(body)).toBe('4 tasks · 2 dependencies · over 8 days');
    expect(describeBody({ tasks: [], edges: [] })).toBe('0 tasks');
    expect(
      describeBody(capture([task('x', { title: 'One', dueAt: at('2026-09-07', 9) })], [], ZONE)),
    ).toBe('1 task · on one day');
  });
});

describe('reading a body from storage', () => {
  const good: TemplateBody = {
    tasks: [
      {
        key: 't1',
        title: 'A',
        estimateMinutes: null,
        isMilestone: false,
        startOffsetDays: null,
        startMinute: null,
        dueOffsetDays: 2,
        dueMinute: 540,
      },
      {
        key: 't2',
        title: 'B',
        estimateMinutes: 60,
        isMilestone: true,
        startOffsetDays: 0,
        startMinute: 0,
        dueOffsetDays: null,
        dueMinute: null,
      },
    ],
    edges: [{ blockerKey: 't1', blockedKey: 't2' }],
  };

  it('accepts what it wrote', () => {
    expect(readBody(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it('refuses shapes that are not a template', () => {
    expect(readBody(null)).toBeNull();
    expect(readBody('tasks')).toBeNull();
    expect(readBody({ tasks: 'no', edges: [] })).toBeNull();
    expect(readBody({ tasks: [{ key: 't1' }], edges: [] })).toBeNull();
    expect(
      readBody({ tasks: [{ ...good.tasks[0], estimateMinutes: 'lots' }], edges: [] }),
    ).toBeNull();
  });

  it('refuses an edge to a key that is not there, or to itself, or a duplicated key', () => {
    expect(readBody({ ...good, edges: [{ blockerKey: 't1', blockedKey: 't9' }] })).toBeNull();
    expect(readBody({ ...good, edges: [{ blockerKey: 't1', blockedKey: 't1' }] })).toBeNull();
    expect(readBody({ tasks: [good.tasks[0], good.tasks[0]], edges: [] })).toBeNull();
  });
});

describe('a name', () => {
  it('is trimmed, never empty, and never absurdly long', () => {
    expect(checkName('  Launch  ')).toBe('Launch');
    expect(checkName('   ')).toBeNull();
    expect(checkName('x'.repeat(200))!.length).toBe(120);
  });
});
