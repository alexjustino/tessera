/**
 * The timeline: the graph, drawn against dates.
 *
 * A Gantt is three questions, and this module answers all three without
 * touching a screen:
 *
 * 1. **Where does a bar go?** From the task's own dates, not from the plan's
 *    arithmetic. P2 computes minutes from the start of the project; a person
 *    reads Thursday. So the bar is what they set, and the critical path only
 *    colours it.
 * 2. **How wide is the window?** From the earliest and latest dates present,
 *    padded to whole days, with a floor so a single task is not a hairline.
 * 3. **Where do the arrows go?** From the bars, once they are placed — an
 *    arrow is geometry, and geometry belongs with the layout that produced it.
 *
 * Rows are one per task, in dependency order (`topologicalOrder`), because a
 * Gantt that packs bars into shared lanes stops being readable as a plan the
 * moment two unrelated things share a line.
 *
 * ## What is left out, and said so
 *
 * A task with no due date has nowhere to go. It is not invented a place: it is
 * counted in `undated`, and the screen says how many rather than showing a
 * chart that quietly omits work.
 */

import { topologicalOrder, type Edge } from './graph';
import { addLocalDays, dayStartsAt } from './calendar';
import { localPlace } from './schedule';

/** A day is the unit the grid is drawn in. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The narrowest a bar may be drawn, as a fraction of a day. */
const MIN_BAR_DAYS = 0.25;

/** How many days the window shows when there is nothing to show. */
const EMPTY_WINDOW_DAYS = 14;

export interface TimelineTask {
  id: string;
  title: string;
  /** UTC instants (ADR-013). */
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  estimateMinutes: number | null;
  isMilestone: boolean;
}

export interface Bar {
  id: string;
  title: string;
  /** Row index, top to bottom. */
  row: number;
  /** Days from the window's first day. Fractional. */
  startDay: number;
  /** Width in days. Zero for a milestone, which is a point. */
  spanDays: number;
  isMilestone: boolean;
  completed: boolean;
  critical: boolean;
}

export interface Arrow {
  from: string;
  to: string;
  /** Where the arrow leaves the blocker: its right edge, in days and rows. */
  fromDay: number;
  fromRow: number;
  /** Where it arrives: the left edge of what it blocks. */
  toDay: number;
  toRow: number;
  /** True when the blocked task starts before its blocker ends — a conflict. */
  breaks: boolean;
}

export interface Timeline {
  /** The window's first local day, `YYYY-MM-DD`. */
  firstDay: string;
  /** How many days the window spans. */
  days: number;
  bars: Bar[];
  arrows: Arrow[];
  /** Tasks with no due date, which the chart cannot place. */
  undated: string[];
  /** Dependencies whose blocked task starts before its blocker finishes. */
  conflicts: number;
}

/** Where a task sits in time, or null when it cannot be placed. */
function spanOf(task: TimelineTask): { startMs: number; endMs: number } | null {
  if (task.dueAt === null) return null;
  const endMs = Date.parse(task.dueAt);
  if (Number.isNaN(endMs)) return null;

  if (task.isMilestone) return { startMs: endMs, endMs };

  if (task.startAt !== null) {
    const startMs = Date.parse(task.startAt);
    // A start after the due date is a person's mistake, not something to draw
    // backwards: the bar runs from the due date and the conflict shows in the
    // dates themselves.
    if (!Number.isNaN(startMs) && startMs < endMs) return { startMs, endMs };
  }

  // No start: the estimate says how long, and it ends when it is due. Without
  // an estimate it is a marker at its date rather than a bar of invented width.
  const minutes = task.estimateMinutes ?? 0;
  return { startMs: endMs - minutes * 60_000, endMs };
}

/**
 * Lay out the timeline.
 *
 * `critical` comes from the plan (P2) and only decides colour; passing an empty
 * set draws an uncoloured chart rather than a wrong one.
 */
export function layout(
  tasks: readonly TimelineTask[],
  edges: readonly Edge[],
  zone: string,
  critical: ReadonlySet<string> = new Set(),
): Timeline {
  const spans = new Map<string, { startMs: number; endMs: number }>();
  const undated: string[] = [];

  for (const task of tasks) {
    const span = spanOf(task);
    if (span === null) undated.push(task.id);
    else spans.set(task.id, span);
  }

  const placed = tasks.filter((task) => spans.has(task.id));
  if (placed.length === 0) {
    const today = localPlace(new Date().toISOString(), zone).day;
    return {
      firstDay: today,
      days: EMPTY_WINDOW_DAYS,
      bars: [],
      arrows: [],
      undated,
      conflicts: 0,
    };
  }

  // ── The window ───────────────────────────────────────────────────────────
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const span of spans.values()) {
    earliest = Math.min(earliest, span.startMs);
    latest = Math.max(latest, span.endMs);
  }

  // Whole local days, with a day of air on each side so a bar never touches
  // the frame.
  const firstDay = addLocalDays(localPlace(new Date(earliest).toISOString(), zone).day, -1);
  const lastDay = addLocalDays(localPlace(new Date(latest).toISOString(), zone).day, 1);
  const originMs = Date.parse(dayStartsAt(firstDay, zone));
  const days = Math.max(
    1,
    Math.round((Date.parse(dayStartsAt(lastDay, zone)) - originMs) / DAY_MS) + 1,
  );

  const toDays = (ms: number) => (ms - originMs) / DAY_MS;

  // ── The rows ─────────────────────────────────────────────────────────────
  const order = topologicalOrder(
    placed.map((task) => task.id),
    edges,
  );
  const rowOf = new Map(order.map((id, index) => [id, index]));
  const byId = new Map(placed.map((task) => [task.id, task]));

  const bars: Bar[] = order.map((id) => {
    const task = byId.get(id) as TimelineTask;
    const span = spans.get(id) as { startMs: number; endMs: number };
    const spanDays = toDays(span.endMs) - toDays(span.startMs);
    return {
      id,
      title: task.title,
      row: rowOf.get(id) as number,
      startDay: toDays(span.startMs),
      spanDays: task.isMilestone ? 0 : Math.max(MIN_BAR_DAYS, spanDays),
      isMilestone: task.isMilestone,
      completed: task.completedAt !== null,
      critical: critical.has(id),
    };
  });

  // ── The arrows ───────────────────────────────────────────────────────────
  const arrows: Arrow[] = [];
  for (const edge of edges) {
    const from = spans.get(edge.blockerId);
    const to = spans.get(edge.blockedId);
    if (from === undefined || to === undefined) continue;

    arrows.push({
      from: edge.blockerId,
      to: edge.blockedId,
      fromDay: toDays(from.endMs),
      fromRow: rowOf.get(edge.blockerId) as number,
      toDay: toDays(to.startMs),
      toRow: rowOf.get(edge.blockedId) as number,
      // The dates disagree with the dependency: the blocked task is scheduled
      // to begin before the thing blocking it is finished.
      breaks: to.startMs < from.endMs,
    });
  }

  return {
    firstDay,
    days,
    bars,
    arrows,
    undated,
    conflicts: arrows.filter((arrow) => arrow.breaks).length,
  };
}

/**
 * Move a task by whole days, keeping its length.
 *
 * Returns the new start and due instants, or null when there is nothing to
 * move — the caller then leaves the task alone rather than inventing dates for
 * it. A milestone has only a due date, and moves by it.
 */
export function shiftByDays(
  task: TimelineTask,
  days: number,
): { startAt: string | null; dueAt: string } | null {
  if (task.dueAt === null || days === 0) return null;
  const dueMs = Date.parse(task.dueAt);
  if (Number.isNaN(dueMs)) return null;

  const shifted = (ms: number) => new Date(ms + days * DAY_MS).toISOString();
  const startMs = task.startAt === null ? null : Date.parse(task.startAt);

  return {
    startAt: startMs === null || Number.isNaN(startMs) ? null : shifted(startMs),
    dueAt: shifted(dueMs),
  };
}

/** The local days the window covers, in order — the grid's columns. */
export function columnsOf(timeline: Timeline): string[] {
  return Array.from({ length: timeline.days }, (_, index) =>
    addLocalDays(timeline.firstDay, index),
  );
}
