/**
 * The critical path: which work decides when the project finishes.
 *
 * The classical method, over the graph P1 stored. Two passes:
 *
 * 1. **Forward.** A task can start when everything blocking it has finished,
 *    so `earliestStart` is the largest `earliestFinish` among its blockers.
 * 2. **Backward.** A task must finish before anything it blocks may start, so
 *    `latestFinish` is the smallest `latestStart` among its successors — and
 *    the last tasks must finish by the end of the project.
 *
 * **Slack** is the difference: how long a task could slip without moving the
 * end. Zero slack means it decides the end, which is what "critical" means.
 * Not "important" — a critical task can be trivial, and an urgent one can have
 * a fortnight of slack. The word is about the arithmetic.
 *
 * ## Where duration comes from, and what it costs to be honest
 *
 * From `estimateMinutes`, which has been a column since the first migration
 * and has never been written. A task without one contributes nothing, and that
 * is a real problem for the answer rather than a small one: a plan where
 * nothing is estimated has a length of zero, and *every* task then has zero
 * slack, so a naive reading marks the whole workspace critical and says
 * nothing at all.
 *
 * So `plan` reports what it had to work with. `estimatedCount` and
 * `unestimatedOnPath` are not decoration — they are what lets a screen say
 * "eleven days, but four tasks on the path have no estimate" instead of
 * showing a confident number that was invented.
 */

import { blockedBy, blockersOf, topologicalOrder, type Edge } from './graph';

/** What the plan needs to know about one task. */
export interface Planned {
  id: string;
  /** Minutes of work. Null when nobody has said. A milestone is zero. */
  estimateMinutes: number | null;
  /** A marker in the plan rather than work: zero duration, always. */
  isMilestone: boolean;
}

export interface Timing {
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  /** Minutes this task could slip without moving the end of the project. */
  slack: number;
  /** Zero slack: this task decides when the project finishes. */
  critical: boolean;
  durationMinutes: number;
}

export interface Plan {
  /** Timing per task id. Every task given is present. */
  timing: Map<string, Timing>;
  /** How long the whole thing takes, in minutes, from its estimates. */
  durationMinutes: number;
  /** Every task with zero slack. */
  critical: Set<string>;
  /**
   * One longest chain through the critical tasks, in order — the path a
   * timeline draws and a person reads. Others of equal length may exist.
   */
  longestChain: string[];
  /** How many tasks carried an estimate. */
  estimatedCount: number;
  /** Critical tasks with no estimate: the holes in the number above. */
  unestimatedOnPath: string[];
  /**
   * True when nothing was estimated at all. The timings are then all zero and
   * "critical" means nothing — a screen must say so rather than show them.
   */
  unplanned: boolean;
  /**
   * Set when the edges given hold a cycle, which storage refuses but a
   * corrupted file could carry. The timings are then not to be trusted.
   */
  cyclic: boolean;
}

/** A milestone marks a moment; work takes time. */
function durationOf(task: Planned): number {
  if (task.isMilestone) return 0;
  return task.estimateMinutes ?? 0;
}

/**
 * Compute the plan.
 *
 * Tasks arrive in whatever order; the passes run over a topological one, so a
 * task is always reached after everything blocking it. Edges pointing outside
 * the given set are ignored, which is what makes it safe to plan one
 * collection, or one filtered view, without the graph elsewhere leaking in.
 */
export function plan(tasks: readonly Planned[], edges: readonly Edge[]): Plan {
  const ids = tasks.map((task) => task.id);
  const present = new Set(ids);
  const relevant = edges.filter(
    (edge) => present.has(edge.blockerId) && present.has(edge.blockedId),
  );
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const ordered = topologicalOrder(ids, relevant);
  const cyclic = hasCycle(ids, relevant);

  const duration = new Map(ids.map((id) => [id, durationOf(byId.get(id) as Planned)]));
  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();

  // ── Forward ──────────────────────────────────────────────────────────────
  for (const id of ordered) {
    const start = blockersOf(relevant, id).reduce(
      (latest, blocker) => Math.max(latest, earliestFinish.get(blocker) ?? 0),
      0,
    );
    earliestStart.set(id, start);
    earliestFinish.set(id, start + (duration.get(id) ?? 0));
  }

  const durationMinutes = ids.reduce(
    (longest, id) => Math.max(longest, earliestFinish.get(id) ?? 0),
    0,
  );

  // ── Backward ─────────────────────────────────────────────────────────────
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();

  for (const id of [...ordered].reverse()) {
    const successors = blockedBy(relevant, id);
    const finish =
      successors.length === 0
        ? durationMinutes
        : successors.reduce(
            (earliest, next) => Math.min(earliest, latestStart.get(next) ?? durationMinutes),
            Number.POSITIVE_INFINITY,
          );
    latestFinish.set(id, finish);
    latestStart.set(id, finish - (duration.get(id) ?? 0));
  }

  const timing = new Map<string, Timing>();
  const critical = new Set<string>();
  for (const id of ids) {
    const slack = (latestStart.get(id) ?? 0) - (earliestStart.get(id) ?? 0);
    const isCritical = slack === 0;
    if (isCritical) critical.add(id);
    timing.set(id, {
      earliestStart: earliestStart.get(id) ?? 0,
      earliestFinish: earliestFinish.get(id) ?? 0,
      latestStart: latestStart.get(id) ?? 0,
      latestFinish: latestFinish.get(id) ?? 0,
      slack,
      critical: isCritical,
      durationMinutes: duration.get(id) ?? 0,
    });
  }

  const estimatedCount = tasks.filter(
    (task) => !task.isMilestone && task.estimateMinutes !== null,
  ).length;
  const unplanned = durationMinutes === 0;

  return {
    timing,
    durationMinutes,
    critical,
    longestChain: unplanned ? [] : chainThrough(ordered, relevant, critical),
    estimatedCount,
    unestimatedOnPath: unplanned
      ? []
      : [...critical].filter((id) => {
          const task = byId.get(id);
          return task !== undefined && !task.isMilestone && task.estimateMinutes === null;
        }),
    unplanned,
    cyclic,
  };
}

/** Whether the edges given close a loop among the ids given. */
export function hasCycle(ids: readonly string[], edges: readonly Edge[]): boolean {
  const present = new Set(ids);
  const relevant = edges.filter(
    (edge) => present.has(edge.blockerId) && present.has(edge.blockedId),
  );
  const remaining = new Map(ids.map((id) => [id, 0]));
  for (const edge of relevant) {
    remaining.set(edge.blockedId, (remaining.get(edge.blockedId) ?? 0) + 1);
  }
  const ready = ids.filter((id) => remaining.get(id) === 0);
  let placed = 0;
  while (ready.length > 0) {
    const id = ready.shift() as string;
    placed += 1;
    for (const next of blockedBy(relevant, id)) {
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return placed < ids.length;
}

/**
 * One chain through the critical tasks, longest first.
 *
 * Zero-slack tasks can form several parallel chains — two independent runs of
 * work that happen to be the same length both decide the end. Walking greedily
 * from every critical task with no critical blocker and keeping the longest
 * result gives one real path rather than a set that looks like a path and is
 * not.
 */
function chainThrough(
  ordered: readonly string[],
  edges: readonly Edge[],
  critical: ReadonlySet<string>,
): string[] {
  const criticalOrdered = ordered.filter((id) => critical.has(id));
  const longestFrom = new Map<string, string[]>();

  // In reverse topological order, the longest chain from a task is itself plus
  // the longest chain from its best critical successor.
  for (const id of [...criticalOrdered].reverse()) {
    let best: string[] = [];
    for (const next of blockedBy(edges, id)) {
      if (!critical.has(next)) continue;
      const chain = longestFrom.get(next) ?? [];
      if (chain.length > best.length) best = chain;
    }
    longestFrom.set(id, [id, ...best]);
  }

  let longest: string[] = [];
  for (const id of criticalOrdered) {
    const chain = longestFrom.get(id) ?? [];
    if (chain.length > longest.length) longest = chain;
  }
  return longest;
}

/** `2h 30m`, `3d`, `45m` — minutes as a person would say them. */
export function formatDuration(minutes: number, hoursPerDay = 8): string {
  if (minutes <= 0) return '0m';
  const perDay = hoursPerDay * 60;
  const days = Math.floor(minutes / perDay);
  const hours = Math.floor((minutes % perDay) / 60);
  const rest = minutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (rest > 0) parts.push(`${rest}m`);
  return parts.join(' ');
}

/**
 * `2h 30m`, `1d`, `45`, `90m` — what a person types, as minutes.
 *
 * Bare numbers are minutes, because that is the unit the field is in and a
 * person who types `30` means half an hour rather than thirty days. Returns
 * null for anything it does not understand, so the caller can leave the field
 * alone instead of turning a typo into a number.
 *
 * The product already reads "in 3 days" when capturing a task; asking for
 * minutes here and nothing else would be the odd one out.
 */
export function parseDuration(text: string, hoursPerDay = 8): number | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const parts = trimmed.match(/\d+\s*[dhm]/g);
  if (parts === null) return null;
  // Every character must belong to a part, or it was not understood at all.
  if (parts.join('').replace(/\s+/g, '') !== trimmed.replace(/\s+/g, '')) return null;

  let minutes = 0;
  for (const part of parts) {
    const amount = Number(part.replace(/[^\d]/g, ''));
    const unit = part.trim().slice(-1);
    if (unit === 'd') minutes += amount * hoursPerDay * 60;
    else if (unit === 'h') minutes += amount * 60;
    else minutes += amount;
  }
  return minutes;
}
