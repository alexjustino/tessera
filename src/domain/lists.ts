/**
 * Lists: more than one place to keep tasks (ADR-053).
 *
 * A list is a collection. Tasks is the inbox, where capture writes, and every other
 * list is the same kind of place with its own name. Today, the plan, the score and
 * every figure read across all of them; a list decides where a task lives, not
 * whether it counts.
 *
 * Pure: no I/O, no React, no host.
 */

import type { Collection, Item } from './item';
import { between, sortByKey } from './ordering';

/** The list every workspace starts with. Quick capture writes here. */
export const INBOX = 'tasks';

export const LONGEST_LIST_NAME = 60;

export type NameCheck = { status: 'ok'; name: string } | { status: 'invalid'; reason: string };

/** A name a list can have: not empty, not too long, and not another list's. */
export function checkListName(
  name: string,
  lists: readonly Collection[],
  except: string | null = null,
): NameCheck {
  const clean = name.trim();
  if (clean === '') return { status: 'invalid', reason: 'A list needs a name.' };
  if ([...clean].length > LONGEST_LIST_NAME) {
    return { status: 'invalid', reason: `Keep it to ${LONGEST_LIST_NAME} characters.` };
  }
  const taken = lists.some(
    (list) => list.id !== except && list.name.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) return { status: 'invalid', reason: 'There is already a list with that name.' };
  return { status: 'ok', name: clean };
}

/** Where a new list goes: after the last one. */
export function positionForNewList(lists: readonly Collection[]): string {
  const last = sortByKey([...lists], (list) => list.position).at(-1);
  return between(last?.position ?? null, null);
}

/** Open tasks in each list, by the list's id. */
export function openByList(items: readonly Item[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.completedAt !== null || item.parentItemId !== null) continue;
    counts.set(item.collectionId, (counts.get(item.collectionId) ?? 0) + 1);
  }
  return counts;
}

/** The lists in order, Tasks first, because it is where new work arrives. */
export function orderedLists(lists: readonly Collection[]): Collection[] {
  const sorted = sortByKey([...lists], (list) => list.position);
  return [
    ...sorted.filter((list) => list.id === INBOX),
    ...sorted.filter((list) => list.id !== INBOX),
  ];
}
