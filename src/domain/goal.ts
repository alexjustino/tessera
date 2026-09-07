/**
 * Goals — an intention with a finish line.
 *
 * A goal is a name, a number to reach, and the tasks a person put in it. Its
 * progress is a `Figure` (ADR-024): a value that carries the rows it was made
 * from, so the number can be opened and checked by the person reading it. That
 * is the whole slice in one sentence — the report's rule, applied to intent.
 *
 * # What counts, and why it is not a filter
 *
 * The rows are the tasks somebody chose, one at a time, the way a dependency
 * is made (ADR-030). A goal defined by a saved filter would be a number whose
 * rows change when the filter changes, and "why did my progress go down?"
 * would have an answer nobody could see. Membership is a decision, and this
 * product stores decisions.
 *
 * A goal holds **no total of its own**. Progress is computed from the tasks
 * and the time entries every time it is shown, so it cannot drift from the
 * work the way a stored counter does.
 *
 * Pure: no I/O, no React, no host.
 */

import { isCompleted, type Item } from './item';
import { counted, summed, type Figure, type ReportRow } from './report';
import { localDay } from './schedule';
import { minutesOf, type Entry } from './time';

/** What a goal's number means. */
export type Measure = 'tasks' | 'minutes';

export const MEASURES: ReadonlyArray<{ id: Measure; label: string; unit: string }> = [
  { id: 'tasks', label: 'Tasks finished', unit: 'tasks' },
  { id: 'minutes', label: 'Time tracked', unit: 'hours' },
];

export interface Goal {
  id: string;
  name: string;
  measure: Measure;
  /** Tasks to finish, or minutes to track. Always more than zero. */
  target: number;
  /** A local day, or null. */
  dueDay: string | null;
  position: string;
}

/** One task counting towards one goal. */
export interface GoalLink {
  goalId: string;
  itemId: string;
}

/** The longest a name may be. */
export const MAX_NAME = 200;

/** What is wrong with a name, in a sentence, or null when nothing is. */
export function checkName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'A goal needs a name.';
  if (trimmed.length > MAX_NAME) return `A name can be at most ${MAX_NAME} characters.`;
  return null;
}

/** What is wrong with a target, in a sentence, or null when nothing is. */
export function checkTarget(target: number): string | null {
  if (!Number.isFinite(target) || Math.floor(target) !== target) {
    return 'A target is a whole number.';
  }
  if (target <= 0) return 'A goal needs something to reach.';
  return null;
}

// ── What is in a goal ──────────────────────────────────────────────────────

/** The tasks put in a goal, in the order the list keeps them. */
export function itemsOf(goal: Goal, links: readonly GoalLink[], items: readonly Item[]): Item[] {
  const inside = new Set(
    links.filter((link) => link.goalId === goal.id).map((link) => link.itemId),
  );
  return items.filter((item) => inside.has(item.id));
}

/** The goals a task counts towards — what a task's own screen would show. */
export function goalsOf(
  itemId: string,
  links: readonly GoalLink[],
  goals: readonly Goal[],
): Goal[] {
  const ids = new Set(links.filter((link) => link.itemId === itemId).map((link) => link.goalId));
  return goals.filter((goal) => ids.has(goal.id));
}

// ── Progress ───────────────────────────────────────────────────────────────

/**
 * How far a goal has got, as a figure that carries its rows.
 *
 * For a goal counted in **tasks**, the rows are the ones that are finished —
 * a goal at 3 of 12 opens onto exactly three tasks, each with the day it was
 * completed. For one counted in **minutes**, the rows are the time entries
 * against its tasks, each with its own minutes, so the total is the sum of
 * what is listed and nothing else. A running timer counts up to `now`, the
 * same way it does everywhere else in the product.
 */
export function progressOf(
  goal: Goal,
  items: readonly Item[],
  entries: readonly Entry[],
  now: string,
  zone: string,
): Figure {
  if (goal.measure === 'minutes') {
    const inside = new Set(items.map((item) => item.id));
    const titleOf = new Map(items.map((item) => [item.id, item.title]));
    const rows: ReportRow[] = entries
      .filter((entry) => inside.has(entry.itemId))
      .map((entry) => ({
        key: `entry:${entry.id}`,
        itemId: entry.itemId,
        title: titleOf.get(entry.itemId) ?? 'a task that is gone',
        day: localDay(entry.startedAt, zone),
        minutes: minutesOf(entry, now),
      }))
      .filter((row) => row.minutes > 0)
      .sort((a, b) => (a.day! < b.day! ? 1 : a.day! > b.day! ? -1 : 0));
    return summed(`goal:${goal.id}`, goal.name, rows);
  }

  const rows: ReportRow[] = items.filter(isCompleted).map((item) => ({
    key: `task:${item.id}`,
    itemId: item.id,
    title: item.title,
    day: item.completedAt === null ? null : localDay(item.completedAt, zone),
    minutes: 0,
  }));
  return counted(`goal:${goal.id}`, goal.name, rows);
}

/** How much of the target is done, from 0 to 1. Never more than one. */
export function shareOf(figure: Figure, goal: Goal): number {
  if (goal.target <= 0) return 0;
  return Math.min(1, figure.value / goal.target);
}

/** Is it done? */
export function isAchieved(figure: Figure, goal: Goal): boolean {
  return figure.value >= goal.target;
}

/** What is left to do: tasks, or minutes. Never below zero. */
export function remainingOf(figure: Figure, goal: Goal): number {
  return Math.max(0, goal.target - figure.value);
}

/**
 * Days until the goal is due: negative when the day has passed, null when it
 * has no day. Counted in calendar days, because "by Friday" is a date.
 */
export function daysLeft(goal: Goal, now: string, zone: string): number | null {
  if (goal.dueDay === null) return null;
  const today = localDay(now, zone);
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${goal.dueDay}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export type GoalState = 'achieved' | 'due' | 'overdue' | 'open';

/**
 * Where a goal stands, in one word.
 *
 * Achieved wins over everything: a goal reached the day after it was due is
 * reached, and telling somebody they are late for something they finished is
 * how a product loses an argument it should not be having.
 */
export function stateOf(figure: Figure, goal: Goal, now: string, zone: string): GoalState {
  if (isAchieved(figure, goal)) return 'achieved';
  const left = daysLeft(goal, now, zone);
  if (left === null) return 'open';
  if (left < 0) return 'overdue';
  return 'due';
}

/** A goal's progress said out loud: `3 of 12 tasks`, `2h 30m of 10h`. */
export function describeProgress(figure: Figure, goal: Goal, hours: (m: number) => string): string {
  return goal.measure === 'minutes'
    ? `${hours(figure.value)} of ${hours(goal.target)}`
    : `${figure.value} of ${goal.target} ${goal.target === 1 ? 'task' : 'tasks'}`;
}
