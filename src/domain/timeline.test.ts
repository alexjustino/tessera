import { describe, expect, it } from 'vitest';

import type { Edge } from './graph';
import { columnsOf, layout, shiftByDays, type TimelineTask } from './timeline';

const ZONE = 'America/Sao_Paulo'; // UTC−3, no daylight saving since 2019
const edge = (blockerId: string, blockedId: string): Edge => ({ blockerId, blockedId });

/** 09:00 on a day in São Paulo, as a UTC instant. */
const at = (day: string, hour = 9): string =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString();

function task(id: string, over: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id,
    title: id,
    startAt: null,
    dueAt: null,
    completedAt: null,
    estimateMinutes: null,
    isMilestone: false,
    ...over,
  };
}

describe('the window', () => {
  it('spans the dates present, with a day of air on each side', () => {
    const result = layout(
      [
        task('a', { startAt: at('2026-09-07'), dueAt: at('2026-09-09') }),
        task('b', { startAt: at('2026-09-10'), dueAt: at('2026-09-11') }),
      ],
      [],
      ZONE,
    );

    expect(result.firstDay).toBe('2026-09-06');
    expect(result.days).toBe(7); // 6th to the 12th inclusive
    expect(columnsOf(result)).toHaveLength(7);
    expect(columnsOf(result)[0]).toBe('2026-09-06');
    expect(columnsOf(result).at(-1)).toBe('2026-09-12');
  });

  it('is a fortnight from today when there is nothing to place', () => {
    const result = layout([task('a'), task('b')], [], ZONE);
    expect(result.days).toBe(14);
    expect(result.bars).toEqual([]);
    expect(result.undated).toEqual(['a', 'b']);
  });
});

describe('where a bar goes', () => {
  it('runs from its start to its due date', () => {
    const result = layout(
      [task('a', { startAt: at('2026-09-07'), dueAt: at('2026-09-09') })],
      [],
      ZONE,
    );
    const [bar] = result.bars;
    // The window opens on the 6th at local midnight; the bar starts at 09:00
    // on the 7th, so 1.375 days in.
    expect(bar!.startDay).toBeCloseTo(1.375, 3);
    expect(bar!.spanDays).toBeCloseTo(2, 3);
  });

  it('uses the estimate to reach back from the due date when there is no start', () => {
    const result = layout(
      [task('a', { dueAt: at('2026-09-09', 17), estimateMinutes: 8 * 60 })],
      [],
      ZONE,
    );
    expect(result.bars[0]!.spanDays).toBeCloseTo(8 / 24, 3);
  });

  it('is a readable minimum rather than a hairline when nothing says how long', () => {
    const result = layout([task('a', { dueAt: at('2026-09-09') })], [], ZONE);
    expect(result.bars[0]!.spanDays).toBeCloseTo(0.25, 3);
  });

  it('a milestone is a point, not a bar', () => {
    const result = layout(
      [task('gate', { dueAt: at('2026-09-09'), isMilestone: true, estimateMinutes: 999 })],
      [],
      ZONE,
    );
    expect(result.bars[0]!.spanDays).toBe(0);
    expect(result.bars[0]!.isMilestone).toBe(true);
  });

  it('never draws backwards when a start is after its due date', () => {
    const result = layout(
      [task('a', { startAt: at('2026-09-20'), dueAt: at('2026-09-09'), estimateMinutes: 60 })],
      [],
      ZONE,
    );
    // Falls back to the estimate ending at the due date.
    expect(result.bars[0]!.spanDays).toBeGreaterThan(0);
    expect(result.bars[0]!.spanDays).toBeLessThan(1);
  });

  it('carries what the row needs to be drawn', () => {
    const result = layout(
      [task('a', { dueAt: at('2026-09-09'), completedAt: at('2026-09-08'), title: 'Done thing' })],
      [],
      ZONE,
      new Set(['a']),
    );
    expect(result.bars[0]).toMatchObject({ title: 'Done thing', completed: true, critical: true });
  });
});

describe('rows', () => {
  it('are one per task, in dependency order', () => {
    const tasks = [
      task('ship', { dueAt: at('2026-09-11') }),
      task('design', { dueAt: at('2026-09-08') }),
      task('build', { dueAt: at('2026-09-10') }),
    ];
    const edges = [edge('design', 'build'), edge('build', 'ship')];

    const result = layout(tasks, edges, ZONE);
    expect(result.bars.map((bar) => bar.id)).toEqual(['design', 'build', 'ship']);
    expect(result.bars.map((bar) => bar.row)).toEqual([0, 1, 2]);
  });

  it('leave out what has no date, and say which', () => {
    const result = layout(
      [task('placed', { dueAt: at('2026-09-09') }), task('floating')],
      [],
      ZONE,
    );
    expect(result.bars).toHaveLength(1);
    expect(result.undated).toEqual(['floating']);
  });
});

describe('arrows', () => {
  const tasks = [
    task('design', { startAt: at('2026-09-07'), dueAt: at('2026-09-08') }),
    task('build', { startAt: at('2026-09-09'), dueAt: at('2026-09-10') }),
  ];
  const edges = [edge('design', 'build')];

  it('leave the blocker and arrive at what it blocks', () => {
    const result = layout(tasks, edges, ZONE);
    expect(result.arrows).toHaveLength(1);
    const [arrow] = result.arrows;
    expect(arrow!.from).toBe('design');
    expect(arrow!.to).toBe('build');
    expect(arrow!.fromRow).toBe(0);
    expect(arrow!.toRow).toBe(1);
    expect(arrow!.toDay).toBeGreaterThan(arrow!.fromDay);
    expect(arrow!.breaks).toBe(false);
  });

  it('report a plan that contradicts itself', () => {
    // build is scheduled to start before design is finished.
    const overlapping = [
      task('design', { startAt: at('2026-09-07'), dueAt: at('2026-09-10') }),
      task('build', { startAt: at('2026-09-08'), dueAt: at('2026-09-11') }),
    ];
    const result = layout(overlapping, edges, ZONE);
    expect(result.arrows[0]!.breaks).toBe(true);
    expect(result.conflicts).toBe(1);
  });

  it('are dropped when either end has no date to point at', () => {
    const result = layout([tasks[0]!, task('build')], edges, ZONE);
    expect(result.arrows).toEqual([]);
    expect(result.conflicts).toBe(0);
  });
});

describe('moving a bar', () => {
  it('shifts both ends by whole days, keeping the length', () => {
    const moved = shiftByDays(task('a', { startAt: at('2026-09-07'), dueAt: at('2026-09-09') }), 2);
    expect(moved!.startAt).toBe(at('2026-09-09'));
    expect(moved!.dueAt).toBe(at('2026-09-11'));
  });

  it('moves a task that has only a due date by that date', () => {
    const moved = shiftByDays(task('a', { dueAt: at('2026-09-09') }), -3);
    expect(moved!.startAt).toBeNull();
    expect(moved!.dueAt).toBe(at('2026-09-06'));
  });

  it('refuses to invent dates for a task that has none', () => {
    expect(shiftByDays(task('a'), 3)).toBeNull();
    expect(shiftByDays(task('a', { dueAt: at('2026-09-09') }), 0)).toBeNull();
  });
});
