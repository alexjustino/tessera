/**
 * Items — the rules about a unit of work.
 *
 * Pure: no I/O, no React, no host. What lives here is what has to be true about
 * an item regardless of where it is stored or how it is drawn, which is exactly
 * the part worth testing without a window.
 */

import { between, sortByKey } from './ordering';

/** The longest title that will be stored. Mirrors the host's limit. */
export const MAX_TITLE_LENGTH = 2_000;

/** A unit of work, as the interface sees it. */
export interface Item {
  id: string;
  collectionId: string;
  parentItemId: string | null;
  title: string;
  position: string;
  /** ISO-8601 UTC, or null while the item is open. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A list, board or database. */
export interface Collection {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: string;
}

export function isCompleted(item: Item): boolean {
  return item.completedAt !== null;
}

/**
 * The outcome of checking something a person typed.
 *
 * A discriminated union rather than an exception: an empty input box is an
 * ordinary state of the world, not an error, and the interface needs to tell
 * "not ready yet" apart from "you typed something wrong".
 */
export type TitleCheck =
  | { readonly status: 'ok'; readonly title: string }
  | { readonly status: 'empty' }
  | { readonly status: 'too-long'; readonly length: number };

/**
 * Normalise and check a title as it is typed.
 *
 * Whitespace is collapsed, not merely trimmed: a title pasted out of a document
 * arrives with newlines in it, and a list row that silently grows to three lines
 * is a worse surprise than a tidied one.
 */
export function checkTitle(raw: string): TitleCheck {
  const title = raw.replace(/\s+/g, ' ').trim();

  if (title.length === 0) return { status: 'empty' };
  if (title.length > MAX_TITLE_LENGTH) return { status: 'too-long', length: title.length };

  return { status: 'ok', title };
}

/** Items in the order they should be shown. */
export function sortItems(items: readonly Item[]): Item[] {
  return sortByKey(items, (item) => item.position);
}

/**
 * The order key for a new item appended to `items`.
 *
 * The caller passes whatever it has; this reads the last key rather than
 * assuming the list is already sorted, because a list that arrived unsorted
 * would otherwise place the new item in the middle without anyone noticing.
 */
export function positionForNewItem(items: readonly Item[]): string {
  if (items.length === 0) return between(null, null);

  const last = sortItems(items).at(-1);
  return between(last ? last.position : null, null);
}

/**
 * The order key for an item dropped at `index` in the shown order.
 *
 * `index` is the slot the item lands in, counted in the list as it appears
 * *without* the dragged item. Used by the board and by list reordering.
 */
export function positionForMove(ordered: readonly Item[], index: number): string {
  const lower = index > 0 ? (ordered[index - 1]?.position ?? null) : null;
  const upper = index < ordered.length ? (ordered[index]?.position ?? null) : null;
  return between(lower, upper);
}

/** Open items first, in order, then completed ones — most recently done first. */
export function partitionByCompletion(items: readonly Item[]): {
  open: Item[];
  completed: Item[];
} {
  const sorted = sortItems(items);
  return {
    open: sorted.filter((item) => !isCompleted(item)),
    completed: sorted
      .filter(isCompleted)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
  };
}
