/**
 * The weekly review — the one screen that asks questions instead of answering
 * them.
 *
 * Everything else in this product shows what is there. The review shows what
 * is **missing**: a goal nobody can act on, a task that was waiting for
 * something that has since been finished, work that is due with no time set
 * aside for it. Those three gaps are what a person actually goes looking for
 * once a week, and each of them is invisible on every other screen precisely
 * because it is an absence.
 *
 * # It keeps nothing
 *
 * There is no "reviewed" flag, no last-reviewed date, no state of any kind
 * (ADR-032). The review is a query, and it is finished when the query comes
 * back empty — which is a fact about the workspace rather than a claim about
 * the person. Marking a review done while the gaps are still there is the one
 * outcome a review must not allow.
 *
 * Pure: no I/O, no React, no host.
 */

import { daysIn, summed, type Figure, type Period, type ReportRow } from './report';
import { capacityOf } from './capacity';
import type { WorkHours } from './calendar';
import { blockersOf, type Edge } from './graph';
import { isCompleted, type Item } from './item';
import { itemsOf, isAchieved, progressOf, type Goal, type GoalLink } from './goal';
import { localDay } from './schedule';

/** Why a goal has nothing to act on. */
export type GapReason = 'empty' | 'blocked' | 'finished';

export interface ProjectGap {
  goal: Goal;
  reason: GapReason;
  /** How many tasks it holds, so the sentence can be specific. */
  held: number;
}

export interface WaitingRow {
  item: Item;
  /** What it was waiting for — all of it finished, or it would not be here. */
  blockers: string[];
}

export interface Review {
  /** Goals with nothing anybody could pick up next. */
  projects: ProjectGap[];
  /** Tasks whose blockers are all finished and which nobody has claimed. */
  waiting: WaitingRow[];
  /** Estimated work due in the period with no time reserved for it. */
  unscheduled: Figure;
  /** Working minutes the period still has, from today onwards. */
  capacityLeft: number;
}

export interface ReviewInput {
  goals: readonly Goal[];
  goalLinks: readonly GoalLink[];
  items: readonly Item[];
  edges: readonly Edge[];
  /** Ids of tasks with time reserved on the calendar. */
  reserved: ReadonlySet<string>;
  period: Period;
  hours: readonly WorkHours[];
}

/**
 * The three gaps, in the order a person works through them.
 *
 * Projects first, because a goal with no next action is the one that quietly
 * stops moving; then the tasks something has freed, because they are the
 * cheapest thing to pick up; then the arithmetic of what is due against the
 * time there is.
 */
export function buildReview(input: ReviewInput, now: string, zone: string): Review {
  const complete = (id: string) => input.items.some((item) => item.id === id && isCompleted(item));

  return {
    projects: projectGaps(input, now, zone, complete),
    waiting: waitingOnNothing(input, complete),
    unscheduled: unscheduledWork(input, zone),
    capacityLeft: capacityLeft(input, now, zone),
  };
}

/** Is there anything left to do about it? */
export function isFinished(review: Review): boolean {
  return review.projects.length === 0 && review.waiting.length === 0;
}

// ── A goal with nothing to act on ──────────────────────────────────────────

function projectGaps(
  input: ReviewInput,
  now: string,
  zone: string,
  complete: (id: string) => boolean,
): ProjectGap[] {
  const gaps: ProjectGap[] = [];

  for (const goal of input.goals) {
    const held = itemsOf(goal, input.goalLinks, input.items);
    // A goal that is reached is not waiting for anything.
    if (isAchieved(progressOf(goal, held, [], now, zone), goal)) continue;

    const actionable = held.filter(
      (item) => !isCompleted(item) && !blockersOf(input.edges, item.id).some((id) => !complete(id)),
    );
    if (actionable.length > 0) continue;

    const unfinished = held.filter((item) => !isCompleted(item));
    const reason: GapReason =
      held.length === 0 ? 'empty' : unfinished.length === 0 ? 'finished' : 'blocked';
    gaps.push({ goal, reason, held: held.length });
  }

  return gaps;
}

/** What a gap means, in a sentence a person can act on. */
export function describeGap(gap: ProjectGap): string {
  switch (gap.reason) {
    case 'empty':
      return 'Nothing is in it yet.';
    case 'finished':
      return `Every one of its ${gap.held} ${gap.held === 1 ? 'task is' : 'tasks are'} finished, and it has not reached its target.`;
    case 'blocked':
      return `Everything in it is waiting for something else.`;
  }
}

// ── A task waiting for nothing ─────────────────────────────────────────────

/**
 * Tasks that were waiting and are not any more.
 *
 * The distinction that matters: a task with no blockers at all was never
 * waiting, and belongs on the list like any other. A task whose blockers are
 * *now all finished* was released by somebody else's work, and nothing on any
 * other screen announces that — which is exactly why the review exists.
 *
 * A task somebody has already picked up — given a date, or reserved time for —
 * is not waiting either. It is being dealt with.
 */
function waitingOnNothing(input: ReviewInput, complete: (id: string) => boolean): WaitingRow[] {
  const titleOf = new Map(input.items.map((item) => [item.id, item.title]));

  return input.items
    .filter((item) => {
      if (isCompleted(item)) return false;
      if (input.reserved.has(item.id)) return false;
      if (item.startAt !== null || item.dueAt !== null) return false;
      const blockers = blockersOf(input.edges, item.id);
      return blockers.length > 0 && blockers.every(complete);
    })
    .map((item) => ({
      item,
      blockers: blockersOf(input.edges, item.id).map(
        (id) => titleOf.get(id) ?? 'a task that is gone',
      ),
    }));
}

// ── Planned, but not scheduled ─────────────────────────────────────────────

/**
 * Work that is due in the period and has no time reserved for it.
 *
 * A figure, so the total opens onto the tasks it came from (ADR-024). Only
 * tasks with an estimate can be counted — a task nobody has sized contributes
 * nothing to an hour count, and pretending otherwise would make the number a
 * guess dressed as arithmetic.
 */
function unscheduledWork(input: ReviewInput, zone: string): Figure {
  const rows: ReportRow[] = input.items
    .filter(
      (item) =>
        !isCompleted(item) &&
        !input.reserved.has(item.id) &&
        item.estimateMinutes !== null &&
        item.estimateMinutes > 0 &&
        item.dueAt !== null &&
        inPeriod(localDay(item.dueAt, zone), input.period),
    )
    .map((item) => ({
      key: `task:${item.id}`,
      itemId: item.id,
      title: item.title,
      day: item.dueAt === null ? null : localDay(item.dueAt, zone),
      minutes: item.estimateMinutes ?? 0,
    }))
    .sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : 0));

  return summed('review:unscheduled', 'Planned but not scheduled', rows);
}

/** Working minutes the period has left, counting today and after. */
function capacityLeft(input: ReviewInput, now: string, zone: string): number {
  const today = localDay(now, zone);
  return daysIn(input.period)
    .filter((day) => day >= today)
    .reduce((total, day) => total + capacityOf(day, input.hours), 0);
}

function inPeriod(day: string, period: Period): boolean {
  return day >= period.firstDay && day <= period.lastDay;
}
