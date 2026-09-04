import { describe, expect, it } from 'vitest';

import { plan } from './criticalPath';
import type { Edge } from './graph';
import { layout, type TimelineTask } from './timeline';

/**
 * The timeline's budget, from the slice's own proof of done: five hundred items
 * lay out inside a frame.
 *
 * Sixteen milliseconds is one frame at sixty hertz. The layout runs on every
 * change to the plan — a bar dragged, a dependency added, a task ticked — so it
 * has to fit inside one, with the paint still to come.
 *
 * Best-of-five, like the other benchmarks: a single run on a shared machine
 * measures the machine.
 */

const ZONE = 'America/Sao_Paulo';
const TASKS = 500;
const FRAME_MS = 16;

function bestOfFive(work: () => void): number {
  let best = Infinity;
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    work();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * A plan the shape real ones are: mostly chains of a few tasks, joining
 * occasionally, spread over a quarter. Every fifth task is a milestone and
 * every seventh has no date at all.
 */
function seed(count: number): { tasks: TimelineTask[]; edges: Edge[] } {
  const tasks: TimelineTask[] = [];
  const edges: Edge[] = [];
  const start = Date.UTC(2026, 8, 1);

  for (let index = 0; index < count; index += 1) {
    const day = index % 90;
    const dated = index % 7 !== 0;
    tasks.push({
      id: `task-${index}`,
      title: `Task ${index}`,
      startAt: dated ? new Date(start + day * 86_400_000).toISOString() : null,
      dueAt: dated ? new Date(start + (day + 2) * 86_400_000).toISOString() : null,
      completedAt: index % 11 === 0 ? new Date(start).toISOString() : null,
      estimateMinutes: index % 3 === 0 ? 120 : null,
      isMilestone: index % 5 === 0,
    });
    // Chains of four, so the graph has depth without becoming one long line.
    if (index % 4 !== 0 && index > 0) {
      edges.push({ blockerId: `task-${index - 1}`, blockedId: `task-${index}` });
    }
  }
  return { tasks, edges };
}

const { tasks, edges } = seed(TASKS);
const critical = plan(
  tasks.map((task) => ({
    id: task.id,
    estimateMinutes: task.estimateMinutes,
    isMilestone: task.isMilestone,
  })),
  edges,
).critical;

describe(`the timeline at ${TASKS} tasks`, () => {
  it('seeds the volume the budget was written against', () => {
    expect(tasks).toHaveLength(TASKS);
    expect(edges.length).toBeGreaterThan(300);
  });

  it('lays out inside a frame', () => {
    const elapsed = bestOfFive(() => layout(tasks, edges, ZONE, critical));
    console.log(`  layout: ${elapsed.toFixed(1)} ms for ${TASKS} tasks (frame ${FRAME_MS} ms)`);
    expect(elapsed).toBeLessThan(FRAME_MS);
  });

  it('places every dated task, and leaves out only what has no date', () => {
    const result = layout(tasks, edges, ZONE, critical);
    expect(result.bars.length + result.undated.length).toBe(TASKS);
    expect(result.undated.length).toBeGreaterThan(0);
    // Rows are one per placed task, numbered without gaps.
    expect(new Set(result.bars.map((bar) => bar.row)).size).toBe(result.bars.length);
  });

  it('draws an arrow only where both ends are placed', () => {
    const result = layout(tasks, edges, ZONE, critical);
    const placed = new Set(result.bars.map((bar) => bar.id));
    expect(result.arrows.length).toBeLessThanOrEqual(edges.length);
    for (const arrow of result.arrows) {
      expect(placed.has(arrow.from)).toBe(true);
      expect(placed.has(arrow.to)).toBe(true);
    }
  });
});
