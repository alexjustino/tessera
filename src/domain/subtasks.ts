/**
 * Subtasks: the steps inside a task (ADR-051).
 *
 * A subtask is an item with a parent, one level deep, and it is deliberately less
 * than a task. It has a name, a place in the order and a tick. Dates, estimates, the
 * clock and the calendar belong to the task it is part of, so every list, score and
 * plan goes on counting tasks, and a task with five steps is still one thing to do.
 *
 * Pure: no I/O, no React, no host.
 */

import { sortItems, type Item } from './item';

export interface Progress {
  done: number;
  total: number;
}

/** Each task's subtasks, in their order. */
export function subtasksByParent(subtasks: readonly Item[]): Map<string, Item[]> {
  const byParent = new Map<string, Item[]>();
  for (const subtask of subtasks) {
    if (subtask.parentItemId === null) continue;
    byParent.set(subtask.parentItemId, [...(byParent.get(subtask.parentItemId) ?? []), subtask]);
  }
  for (const [parent, steps] of byParent) byParent.set(parent, sortItems(steps));
  return byParent;
}

export function progressOf(steps: readonly Item[]): Progress {
  return { done: steps.filter((step) => step.completedAt !== null).length, total: steps.length };
}

/** The first step still to do, in order. */
export function nextStep(steps: readonly Item[]): Item | null {
  return sortItems(steps).find((step) => step.completedAt === null) ?? null;
}

/** All of them ticked, when there is at least one to tick. */
export function allDone(steps: readonly Item[]): boolean {
  return steps.length > 0 && steps.every((step) => step.completedAt !== null);
}

/** `- [ ] `, `* `, `• `, `3. ` and `3) `: what a list pasted from elsewhere starts its lines with. */
const LINE_MARK = /^\s*(?:[-*•]\s+)?(?:\[[ xX]\]\s+)?(?:\d+[.)]\s+)?/;

/**
 * The steps in what was pasted: one to a line, without the list marks it came with,
 * and without the blank lines. A single line gives one step, as typing it would.
 */
export function stepsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LINE_MARK, '').trim())
    .filter((line) => line !== '');
}
