/**
 * Templates: a set of tasks worth doing again, with the shape between them.
 *
 * A template is what a launch, a sprint or an onboarding looks like before it
 * has dates: the tasks, how long each takes, which are milestones, which wait
 * for which — and *when each falls relative to the first*. Dates are stored
 * as offsets in days from the template's anchor (its earliest date) plus the
 * minute of the day, so "kick-off Monday 09:00, review three days later at
 * 14:00" applied to any Monday is a kick-off at 09:00 and a review Thursday at
 * 14:00, whatever month, whatever the clocks did in between.
 *
 * Dependencies are kept by *key*, not by id. A template has no ids — it is
 * not tasks, it is the plan for tasks — so each entry has a key of its own,
 * and the edges name keys. Applying the template makes new tasks, maps keys
 * to their new ids, and links them. That is the proof of done for the slice:
 * a template with dependencies keeps them, with the dates rebased.
 */

import { addLocalDays } from './calendar';
import type { Edge } from './graph';
import type { Item } from './item';
import { asInstant, asWallClock, daysBetween } from './schedule';

export interface TemplateTask {
  /** Local to the template: `t1`, `t2`… What the edges refer to. */
  key: string;
  title: string;
  estimateMinutes: number | null;
  isMilestone: boolean;
  /** Days from the anchor, or null when the task has no start. */
  startOffsetDays: number | null;
  /** Minutes into the local day, so the time of day survives the move. */
  startMinute: number | null;
  dueOffsetDays: number | null;
  dueMinute: number | null;
}

export interface TemplateEdge {
  blockerKey: string;
  blockedKey: string;
}

/** What a template stores. JSON-shaped; `readBody` checks it on the way in. */
export interface TemplateBody {
  tasks: TemplateTask[];
  edges: TemplateEdge[];
}

export interface Template {
  id: string;
  name: string;
  body: TemplateBody;
  createdAt: string;
}

// ── Capturing ──────────────────────────────────────────────────────────────

/**
 * A template from tasks that exist.
 *
 * The anchor is the earliest local day any of them carries, so every offset
 * is zero or more and the template reads forwards from its first date. Tasks
 * with no dates keep none. Only edges with both ends in the set survive: a
 * dependency on something outside the template is not the template's to
 * carry.
 */
export function capture(
  tasks: readonly Item[],
  edges: readonly Edge[],
  zone: string,
): TemplateBody {
  const keyOf = new Map(tasks.map((task, index) => [task.id, `t${index + 1}`]));

  const dated = tasks.flatMap((task) =>
    [task.startAt, task.dueAt].filter((value): value is string => value !== null),
  );
  const anchor = dated.length === 0 ? null : dated.reduce((a, b) => (a < b ? a : b));

  const place = (instant: string | null): { offset: number | null; minute: number | null } => {
    if (instant === null || anchor === null) return { offset: null, minute: null };
    const wall = asWallClock(instant, zone);
    return {
      offset: daysBetween(anchor, instant, zone),
      minute: wall.getHours() * 60 + wall.getMinutes(),
    };
  };

  return {
    tasks: tasks.map((task) => {
      const start = place(task.startAt);
      const due = place(task.dueAt);
      return {
        key: keyOf.get(task.id)!,
        title: task.title,
        estimateMinutes: task.estimateMinutes,
        isMilestone: task.isMilestone,
        startOffsetDays: start.offset,
        startMinute: start.minute,
        dueOffsetDays: due.offset,
        dueMinute: due.minute,
      };
    }),
    edges: edges
      .filter((edge) => keyOf.has(edge.blockerId) && keyOf.has(edge.blockedId))
      .map((edge) => ({
        blockerKey: keyOf.get(edge.blockerId)!,
        blockedKey: keyOf.get(edge.blockedId)!,
      })),
  };
}

// ── Applying ───────────────────────────────────────────────────────────────

/** A task ready to be created: the template's entry with its dates decided. */
export interface PlannedTask {
  key: string;
  title: string;
  estimateMinutes: number | null;
  isMilestone: boolean;
  startAt: string | null;
  dueAt: string | null;
}

export interface Instantiation {
  tasks: PlannedTask[];
  /** Still by key — the caller maps keys to the ids it was given back. */
  edges: TemplateEdge[];
}

/**
 * The template on a day.
 *
 * Every offset is added to `anchorDay` as calendar days and the stored minute
 * is put back on the wall clock in the zone, then turned into an instant. So
 * a task at 09:00 stays at 09:00 across a daylight-saving change, because
 * what was kept was the wall-clock time, not a number of hours.
 */
export function instantiate(body: TemplateBody, anchorDay: string, zone: string): Instantiation {
  const at = (offset: number | null, minute: number | null): string | null => {
    if (offset === null) return null;
    const day = addLocalDays(anchorDay, offset);
    const [year, month, date] = day.split('-').map(Number);
    const wall = new Date(0);
    wall.setFullYear(year!, month! - 1, date!);
    wall.setHours(Math.floor((minute ?? 0) / 60), (minute ?? 0) % 60, 0, 0);
    return asInstant(wall, zone);
  };

  return {
    tasks: body.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      estimateMinutes: task.estimateMinutes,
      isMilestone: task.isMilestone,
      startAt: at(task.startOffsetDays, task.startMinute),
      dueAt: at(task.dueOffsetDays, task.dueMinute),
    })),
    edges: body.edges.map((edge) => ({ ...edge })),
  };
}

// ── Describing and checking ────────────────────────────────────────────────

/** How many days the template spans, from its anchor to its last date. */
export function spanDays(body: TemplateBody): number {
  const offsets = body.tasks.flatMap((task) =>
    [task.startOffsetDays, task.dueOffsetDays].filter((value): value is number => value !== null),
  );
  return offsets.length === 0 ? 0 : Math.max(...offsets);
}

/** `5 tasks · 3 dependencies · over 12 days` */
export function describe(body: TemplateBody): string {
  const parts = [`${body.tasks.length} ${body.tasks.length === 1 ? 'task' : 'tasks'}`];
  if (body.edges.length > 0) {
    parts.push(`${body.edges.length} ${body.edges.length === 1 ? 'dependency' : 'dependencies'}`);
  }
  const span = spanDays(body);
  if (span > 0) parts.push(`over ${span + 1} days`);
  else if (body.tasks.some((task) => task.dueOffsetDays !== null || task.startOffsetDays !== null))
    parts.push('on one day');
  return parts.join(' · ');
}

/**
 * A body read from storage, checked.
 *
 * The database keeps the body as JSON it does not understand; this is where
 * the shape is enforced, so a row written by an older version or by hand
 * either reads as a template or reads as nothing — never as a template with
 * an edge to a key that is not there.
 */
export function readBody(raw: unknown): TemplateBody | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { tasks?: unknown; edges?: unknown };
  if (!Array.isArray(candidate.tasks) || !Array.isArray(candidate.edges)) return null;

  const tasks: TemplateTask[] = [];
  for (const entry of candidate.tasks) {
    const task = readTask(entry);
    if (task === null) return null;
    tasks.push(task);
  }
  const keys = new Set(tasks.map((task) => task.key));
  if (keys.size !== tasks.length) return null;

  const edges: TemplateEdge[] = [];
  for (const entry of candidate.edges) {
    if (typeof entry !== 'object' || entry === null) return null;
    const edge = entry as { blockerKey?: unknown; blockedKey?: unknown };
    if (typeof edge.blockerKey !== 'string' || typeof edge.blockedKey !== 'string') return null;
    if (!keys.has(edge.blockerKey) || !keys.has(edge.blockedKey)) return null;
    if (edge.blockerKey === edge.blockedKey) return null;
    edges.push({ blockerKey: edge.blockerKey, blockedKey: edge.blockedKey });
  }
  return { tasks, edges };
}

function readTask(raw: unknown): TemplateTask | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const task = raw as Record<string, unknown>;
  const optionalNumber = (value: unknown): value is number | null =>
    value === null || (typeof value === 'number' && Number.isFinite(value));
  if (typeof task.key !== 'string' || task.key === '') return null;
  if (typeof task.title !== 'string') return null;
  if (typeof task.isMilestone !== 'boolean') return null;
  if (
    !optionalNumber(task.estimateMinutes) ||
    !optionalNumber(task.startOffsetDays) ||
    !optionalNumber(task.startMinute) ||
    !optionalNumber(task.dueOffsetDays) ||
    !optionalNumber(task.dueMinute)
  ) {
    return null;
  }
  return {
    key: task.key,
    title: task.title,
    estimateMinutes: task.estimateMinutes,
    isMilestone: task.isMilestone,
    startOffsetDays: task.startOffsetDays,
    startMinute: task.startMinute,
    dueOffsetDays: task.dueOffsetDays,
    dueMinute: task.dueMinute,
  };
}

/** A name a template can be saved under: trimmed, not empty, not absurd. */
export function checkName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}
