/**
 * Focus: one task at a time, and which one.
 *
 * The screen shows one task, its timer, and nothing else. This module decides
 * the *one*. The rule is short and stated so it can be argued with:
 *
 * 1. the task the person asked for, if it is still open;
 * 2. otherwise the task whose clock is running — a clock going is a claim on
 *    attention, and switching away from it silently is how time gets filed
 *    under the wrong task;
 * 3. otherwise the first task that is ready to start, in list order: open,
 *    not waiting on anything unfinished, and not a milestone, since a
 *    milestone is a moment and not work anyone can sit down to.
 *
 * "Next" is the same rule from the current task onwards. `readyToStart` from
 * the graph is the reading the dependency slice wrote and deferred a screen
 * for; this is that screen's arithmetic.
 */

import { readyToStart, type Edge } from './graph';
import { sortItems, type Item } from './item';

/** Everything that could be focused on, in the order it would be offered. */
export function focusQueue(items: readonly Item[], edges: readonly Edge[]): Item[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const isComplete = (id: string) => byId.get(id)?.completedAt !== null;
  const ready = new Set(
    readyToStart(
      items.map((item) => item.id),
      edges,
      isComplete,
    ),
  );
  return sortItems(items).filter((item) => ready.has(item.id) && !item.isMilestone);
}

/**
 * The task to show.
 *
 * `preferredId` is what the person pointed at; `runningId` is what the clock
 * is on. Either wins over the queue only while it is still open — a completed
 * task is not something to focus on, whoever asked.
 */
export function pickFocus(
  items: readonly Item[],
  edges: readonly Edge[],
  runningId: string | null,
  preferredId: string | null,
): Item | null {
  const open = (id: string | null) => {
    if (id === null) return null;
    const item = items.find((candidate) => candidate.id === id);
    return item === undefined || item.completedAt !== null ? null : item;
  };
  return open(preferredId) ?? open(runningId) ?? focusQueue(items, edges)[0] ?? null;
}

/**
 * What comes after the current task: the first ready task that is not it.
 * Null when the current task is the only thing left, or nothing is.
 */
export function nextAfter(
  items: readonly Item[],
  edges: readonly Edge[],
  currentId: string,
): Item | null {
  return focusQueue(items, edges).find((item) => item.id !== currentId) ?? null;
}

/** `3 more ready to start` — what the screen says under the task. */
export function describeQueue(items: readonly Item[], edges: readonly Edge[], currentId: string) {
  const others = focusQueue(items, edges).filter((item) => item.id !== currentId).length;
  if (others === 0) return 'Nothing else is ready to start.';
  return `${others} more ready to start.`;
}
