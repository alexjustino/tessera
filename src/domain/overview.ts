/**
 * The whole list at a glance: how much is open, how much of it is in trouble, and
 * how it divides up.
 *
 * Each trouble is also a slice of the list, so the figure and the rows it counts
 * come from one predicate and cannot disagree. Pure: no I/O, no React, no host.
 */

import type { Item } from './item';
import { optionsOf, type Property } from './property';
import { bucketOf, endOfLocalDay } from './schedule';

export type Slice = 'open' | 'overdue' | 'week' | 'undated' | 'waiting' | 'unestimated';

export const SLICES: ReadonlyArray<{ id: Slice; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'week', label: 'Due in 7 days' },
  { id: 'undated', label: 'No date' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'unestimated', label: 'No estimate' },
];

/** Whether a task is in a slice. A finished task is in none of them. */
export function inSlice(
  item: Item,
  slice: Slice,
  blocked: ReadonlySet<string>,
  now: string,
  zone: string,
): boolean {
  if (item.completedAt !== null) return false;
  switch (slice) {
    case 'open':
      return true;
    case 'overdue':
      return bucketOf(item.dueAt, now, zone) === 'overdue';
    case 'week': {
      if (item.dueAt === null) return false;
      if (bucketOf(item.dueAt, now, zone) === 'overdue') return false;
      return Date.parse(item.dueAt) <= Date.parse(endOfLocalDay(now, zone, 7));
    }
    case 'undated':
      return item.dueAt === null;
    case 'waiting':
      return blocked.has(item.id);
    case 'unestimated':
      return item.estimateMinutes === null && !item.isMilestone;
  }
}

export type SliceCounts = Record<Slice, number>;

export function countSlices(
  items: readonly Item[],
  blocked: ReadonlySet<string>,
  now: string,
  zone: string,
): SliceCounts {
  const counts: SliceCounts = {
    open: 0,
    overdue: 0,
    week: 0,
    undated: 0,
    waiting: 0,
    unestimated: 0,
  };
  for (const item of items) {
    for (const { id } of SLICES) if (inSlice(item, id, blocked, now, zone)) counts[id] += 1;
  }
  return counts;
}

export interface Portion {
  id: string;
  label: string;
  count: number;
  /** The option's stored colour, for the tone to come from. */
  color: string | null;
}

/**
 * Open work divided by one choice property, in the property's own order, with
 * what has no value counted too, so the portions add up to the open work.
 */
export function portionsOf(
  items: readonly Item[],
  property: Property,
  values: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Portion[] {
  const open = items.filter((item) => item.completedAt === null);
  const options = optionsOf(property);
  const counts = new Map<string, number>();
  let none = 0;
  for (const item of open) {
    const raw = values[item.id]?.[property.id];
    if (typeof raw === 'string' && options.some((option) => option.id === raw)) {
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    } else {
      none += 1;
    }
  }
  const portions: Portion[] = options.map((option) => ({
    id: option.id,
    label: option.label,
    count: counts.get(option.id) ?? 0,
    color: option.color ?? null,
  }));
  if (none > 0) portions.push({ id: '__none__', label: 'None', count: none, color: null });
  return portions;
}
