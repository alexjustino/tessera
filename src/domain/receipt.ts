/**
 * The price of yes: what a commitment costs before it is made (M1).
 *
 * A list will always take one more line. A week will not. This module answers
 * the question every list avoids — "if I say yes to this, what moves?" — with
 * arithmetic a person can check by hand, and nothing else.
 *
 * **The projection.** Each working day has free minutes: its capacity (the
 * working hours, ADR-023) less what the calendar has already reserved. Open
 * tasks with an estimate claim those minutes, earliest due day first, a task
 * never before its start day nor before the tasks that block it (ADR-019).
 * Where a task's minutes run out is the day it is projected to finish. That
 * is the whole model: one person, one stream of free time, filled in order.
 *
 * **The receipt.** The same projection run twice — before and after the
 * proposed change — and the difference named: which tasks and goals finish on
 * a different day, by how many days, and which of them now finish after their
 * due day. Each line names its task or goal, so the receipt carries its rows
 * (ADR-024) and a person can open every one of them.
 *
 * **What it never does.** It does not move, refuse or reschedule anything: it
 * shows the cost and the person decides (SPEC 1.3, "show the cost; never
 * decide"). A task with no estimate is not in the arithmetic and is counted
 * as such rather than guessed at (ADR-020). Committed time — an estimate — is
 * kept apart from reserved time — a calendar block — and never added to it
 * (SPEC 1.3, "committed is not reserved").
 *
 * **What it simplifies, said once.** Today counts as a whole working day; the
 * hours already gone are not subtracted, because the domain has no clock
 * finer than the day here. Minutes already tracked against a task reduce what
 * it still needs; time reserved for it on the calendar reduces it too, and the
 * task cannot be projected to finish before its last reserved block. The
 * horizon is a year: work that does not fit in it has no finish day.
 */

import { addLocalDays, type Occurrence, type WorkHours } from './calendar';
import { capacityOf, plannedByDay } from './capacity';
import type { Goal, GoalLink } from './goal';
import type { Edge } from './graph';
import type { Item } from './item';
import { localDay } from './schedule';

/** How far ahead the projection looks. */
export const HORIZON_DAYS = 366;

/** The id a proposed new task carries while it is only being considered. */
export const PROPOSED_ID = '__proposed__';

export interface LedgerInput {
  /** The local day the projection starts on. */
  today: string;
  zone: string;
  hours: readonly WorkHours[];
  /** Calendar occurrences from today onward; earlier ones are ignored. */
  occurrences: readonly Occurrence[];
  items: readonly Item[];
  edges: readonly Edge[];
  goals: readonly Goal[];
  goalLinks: readonly GoalLink[];
  /** Minutes already tracked, per item. */
  tracked: ReadonlyMap<string, number>;
  horizonDays?: number;
  /**
   * What every remaining estimate is multiplied by — 1 unless a confidence
   * range is being drawn (M2, `confidence.ts`). The receipt itself always
   * prices the estimates as typed.
   */
  scale?: number;
}

/** A change being considered. Nothing is saved by considering it. */
export type Proposal =
  | { kind: 'estimate'; itemId: string; minutes: number | null }
  | { kind: 'due'; itemId: string; dueAt: string | null }
  | { kind: 'task'; title: string; minutes: number; dueAt: string | null };

/** Where the projection puts every task it can count. */
export interface Projection {
  /** Item → the day its minutes run out, or null when it does not fit in the horizon. */
  finishes: Map<string, string | null>;
  /** Item → minutes it still needs from free time. */
  demand: Map<string, number>;
  /** Item → its due day, for the ones that have one. */
  dueDays: Map<string, string>;
  /** Open tasks left out because nobody has said how long they take. */
  unestimated: number;
  horizonEnd: string;
}

/** One task whose projected finish moved. */
export interface Shift {
  itemId: string;
  title: string;
  dueDay: string | null;
  before: string | null;
  after: string | null;
  /** Days later (positive) or earlier (negative); null when one side has no finish. */
  days: number | null;
  /** True when it finished in time before and does not now. */
  becameLate: boolean;
}

/** One goal whose projected completion moved. */
export interface GoalShift {
  goalId: string;
  name: string;
  dueDay: string | null;
  before: string | null;
  after: string | null;
  days: number | null;
  becameLate: boolean;
}

export interface Receipt {
  /** Minutes of free time the change claims (negative when it gives time back). */
  costMinutes: number;
  /** The task being changed or added: where it lands. */
  own: { itemId: string; finish: string | null; dueDay: string | null; late: boolean };
  /** Every other task whose finish moved, latest-moved first. */
  shifts: Shift[];
  /** Every goal with a due day whose completion moved. */
  goals: GoalShift[];
  unestimated: number;
  horizonEnd: string;
}

// ── The projection ─────────────────────────────────────────────────────────

/** Whole days from `from` to `to`; both are local days. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function counts(item: Item): boolean {
  return item.completedAt === null && !item.isMilestone;
}

/**
 * Where every open, estimated task is projected to finish.
 *
 * Deterministic: the same input always gives the same projection, so a
 * receipt's "before" and "after" differ only by the change.
 */
export function project(input: LedgerInput): Projection {
  const horizon = input.horizonDays ?? HORIZON_DAYS;
  const horizonEnd = addLocalDays(input.today, horizon - 1);
  const days: string[] = [];
  for (let i = 0; i < horizon; i++) days.push(addLocalDays(input.today, i));
  const index = new Map(days.map((day, i) => [day, i]));

  // Free minutes per day: capacity less what the calendar reserved.
  const future = input.occurrences.filter((o) => localDay(o.endsAt, input.zone) >= input.today);
  const reserved = plannedByDay(future, input.zone);
  const free = days.map((day) =>
    Math.max(0, capacityOf(day, input.hours) - (reserved.get(day) ?? 0)),
  );

  // Time already reserved for a task, and the last day it is reserved on.
  const blocked = new Map<string, number>();
  const lastBlock = new Map<string, string>();
  for (const [itemId, minutes, day] of blocksOf(future, input.zone, input.today)) {
    blocked.set(itemId, (blocked.get(itemId) ?? 0) + minutes);
    const last = lastBlock.get(itemId);
    if (last === undefined || day > last) lastBlock.set(itemId, day);
  }

  const open = input.items.filter(counts);
  const unestimated = open.filter((item) => item.estimateMinutes === null).length;
  const tasks = open.filter((item) => item.estimateMinutes !== null);

  const demand = new Map<string, number>();
  const dueDays = new Map<string, string>();
  for (const task of tasks) {
    const need =
      Math.round((task.estimateMinutes ?? 0) * (input.scale ?? 1)) -
      (input.tracked.get(task.id) ?? 0) -
      (blocked.get(task.id) ?? 0);
    demand.set(task.id, Math.max(0, need));
    if (task.dueAt !== null) dueDays.set(task.id, localDay(task.dueAt, input.zone));
  }

  const order = orderOf(tasks, input.edges, dueDays);
  const blockers = new Map<string, string[]>();
  const ids = new Set(tasks.map((task) => task.id));
  for (const edge of input.edges) {
    if (!ids.has(edge.blockerId) || !ids.has(edge.blockedId)) continue;
    blockers.set(edge.blockedId, [...(blockers.get(edge.blockedId) ?? []), edge.blockerId]);
  }

  const finishes = new Map<string, string | null>();
  for (const task of order) {
    // The earliest day this task may take minutes on.
    let from = 0;
    if (task.startAt !== null) {
      const start = localDay(task.startAt, input.zone);
      if (start > input.today) from = index.get(start) ?? horizon;
    }
    let blockedForever = false;
    for (const blocker of blockers.get(task.id) ?? []) {
      const finish = finishes.get(blocker);
      if (finish === null) blockedForever = true;
      else if (finish !== undefined) from = Math.max(from, index.get(finish) ?? horizon);
    }
    if (blockedForever) {
      finishes.set(task.id, null);
      continue;
    }

    let need = demand.get(task.id) ?? 0;
    let at = from;
    let finish: number | null = need === 0 ? Math.min(from, horizon - 1) : null;
    while (need > 0 && at < horizon) {
      const take = Math.min(need, free[at] ?? 0);
      free[at] = (free[at] ?? 0) - take;
      need -= take;
      if (need === 0) finish = at;
      else at++;
    }

    let day = finish === null ? null : (days[finish] ?? null);
    const last = lastBlock.get(task.id);
    if (day !== null && last !== undefined && last > day) day = last;
    finishes.set(task.id, day);
  }

  return { finishes, demand, dueDays, unestimated, horizonEnd };
}

/** Minutes reserved for a task on each day from today: [itemId, minutes, day]. */
function blocksOf(
  occurrences: readonly Occurrence[],
  zone: string,
  today: string,
): Array<[string, number, string]> {
  const out: Array<[string, number, string]> = [];
  for (const occurrence of occurrences) {
    const itemId = occurrence.event.itemId;
    if (itemId === null || occurrence.event.allDay) continue;
    const day = localDay(occurrence.startsAt, zone);
    if (day < today) continue;
    const minutes = Math.round(
      (Date.parse(occurrence.endsAt) - Date.parse(occurrence.startsAt)) / 60_000,
    );
    if (minutes > 0) out.push([itemId, minutes, day]);
  }
  return out;
}

/**
 * The order tasks claim free time in: earliest due day first, undated last,
 * then by position and id so ties never depend on the order rows arrived in —
 * and never a task before one that blocks it.
 */
function orderOf(
  tasks: readonly Item[],
  edges: readonly Edge[],
  dueDays: ReadonlyMap<string, string>,
): Item[] {
  const rank = (a: Item, b: Item): number => {
    const da = dueDays.get(a.id);
    const db = dueDays.get(b.id);
    if (da !== db) {
      if (da === undefined) return 1;
      if (db === undefined) return -1;
      return da < db ? -1 : 1;
    }
    if (a.position !== b.position) return a.position < b.position ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const waiting = new Map<string, number>();
  const after = new Map<string, string[]>();
  for (const task of tasks) waiting.set(task.id, 0);
  for (const edge of edges) {
    if (!byId.has(edge.blockerId) || !byId.has(edge.blockedId)) continue;
    waiting.set(edge.blockedId, (waiting.get(edge.blockedId) ?? 0) + 1);
    after.set(edge.blockerId, [...(after.get(edge.blockerId) ?? []), edge.blockedId]);
  }

  const ready = tasks.filter((task) => waiting.get(task.id) === 0);
  const out: Item[] = [];
  while (ready.length > 0) {
    ready.sort(rank);
    const next = ready.shift();
    if (next === undefined) break;
    out.push(next);
    for (const blockedId of after.get(next.id) ?? []) {
      const left = (waiting.get(blockedId) ?? 1) - 1;
      waiting.set(blockedId, left);
      const blocked = byId.get(blockedId);
      if (left === 0 && blocked !== undefined) ready.push(blocked);
    }
  }
  // The graph is acyclic (ADR-019); anything left would be a cycle, and is
  // appended rather than lost so it still shows up as not fitting.
  for (const task of tasks) if (!out.includes(task)) out.push(task);
  return out;
}

// ── The receipt ────────────────────────────────────────────────────────────

/** The items with the proposal applied. Returns null for a change to an unknown task. */
export function applyProposal(
  items: readonly Item[],
  proposal: Proposal,
  now: string,
): { items: Item[]; itemId: string } | null {
  if (proposal.kind === 'task') {
    const proposed: Item = {
      id: PROPOSED_ID,
      collectionId: '',
      parentItemId: null,
      title: proposal.title,
      // Ahead of every real position, so among equal due days the new task
      // does not claim time before work that was already there.
      position: '￿',
      startAt: null,
      dueAt: proposal.dueAt,
      remindAt: null,
      recurrenceRule: null,
      recurrenceMode: 'schedule',
      completedAt: null,
      estimateMinutes: proposal.minutes,
      isMilestone: false,
      createdAt: now,
      updatedAt: now,
    };
    return { items: [...items, proposed], itemId: PROPOSED_ID };
  }

  const target = items.find((item) => item.id === proposal.itemId);
  if (target === undefined) return null;
  const changed: Item =
    proposal.kind === 'estimate'
      ? { ...target, estimateMinutes: proposal.minutes }
      : { ...target, dueAt: proposal.dueAt };
  return {
    items: items.map((item) => (item.id === target.id ? changed : item)),
    itemId: target.id,
  };
}

function shiftDays(before: string | null, after: string | null): number | null {
  return before === null || after === null ? null : daysBetween(before, after);
}

function isLate(finish: string | null, due: string | null | undefined): boolean {
  if (due === null || due === undefined) return false;
  return finish === null || finish > due;
}

/** When a goal's linked tasks are all done, by the projection; null if one never is. */
function goalFinish(
  goal: Goal,
  links: readonly GoalLink[],
  projection: Projection,
): string | null | undefined {
  let latest: string | undefined;
  for (const link of links) {
    if (link.goalId !== goal.id) continue;
    if (!projection.finishes.has(link.itemId)) continue;
    const finish = projection.finishes.get(link.itemId);
    if (finish === null || finish === undefined) return null;
    if (latest === undefined || finish > latest) latest = finish;
  }
  return latest;
}

/**
 * What saying yes to `proposal` costs: the projection before and after, and
 * every task and goal that lands on a different day.
 *
 * Returns null when the proposal names a task that does not exist.
 */
export function receiptOf(input: LedgerInput, proposal: Proposal, now: string): Receipt | null {
  const applied = applyProposal(input.items, proposal, now);
  if (applied === null) return null;

  const before = project(input);
  const after = project({ ...input, items: applied.items });

  let costMinutes = 0;
  for (const minutes of after.demand.values()) costMinutes += minutes;
  for (const minutes of before.demand.values()) costMinutes -= minutes;

  const titles = new Map(applied.items.map((item) => [item.id, item.title]));
  const shifts: Shift[] = [];
  for (const [itemId, finishAfter] of after.finishes) {
    if (itemId === applied.itemId) continue;
    const finishBefore = before.finishes.get(itemId);
    if (finishBefore === undefined || finishBefore === finishAfter) continue;
    const dueDay = after.dueDays.get(itemId) ?? null;
    shifts.push({
      itemId,
      title: titles.get(itemId) ?? '',
      dueDay,
      before: finishBefore,
      after: finishAfter,
      days: shiftDays(finishBefore, finishAfter),
      becameLate: !isLate(finishBefore, dueDay) && isLate(finishAfter, dueDay),
    });
  }
  shifts.sort((a, b) => {
    if (a.becameLate !== b.becameLate) return a.becameLate ? -1 : 1;
    const da = a.days ?? Number.MAX_SAFE_INTEGER;
    const db = b.days ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return db - da;
    return a.title.localeCompare(b.title);
  });

  const links = input.goalLinks;
  const goals: GoalShift[] = [];
  for (const goal of input.goals) {
    if (goal.dueDay === null) continue;
    const finishBefore = goalFinish(goal, links, before);
    const finishAfter = goalFinish(goal, links, after);
    if (finishBefore === undefined || finishAfter === undefined) continue;
    if (finishBefore === finishAfter) continue;
    goals.push({
      goalId: goal.id,
      name: goal.name,
      dueDay: goal.dueDay,
      before: finishBefore,
      after: finishAfter,
      days: shiftDays(finishBefore, finishAfter),
      becameLate: !isLate(finishBefore, goal.dueDay) && isLate(finishAfter, goal.dueDay),
    });
  }

  const ownFinish = after.finishes.get(applied.itemId) ?? null;
  const ownDue = after.dueDays.get(applied.itemId) ?? null;
  return {
    costMinutes,
    own: {
      itemId: applied.itemId,
      finish: after.finishes.has(applied.itemId) ? ownFinish : null,
      dueDay: ownDue,
      late: after.finishes.has(applied.itemId) && isLate(ownFinish, ownDue),
    },
    shifts,
    goals,
    unestimated: after.unestimated,
    horizonEnd: after.horizonEnd,
  };
}

/** True when nothing else moves and nothing is late because of the change. */
export function isFree(receipt: Receipt): boolean {
  return receipt.shifts.length === 0 && receipt.goals.length === 0 && !receipt.own.late;
}
