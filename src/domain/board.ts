/**
 * The board — a grouped query, arranged as columns you can drag between.
 *
 * A board is not a different kind of data. It is the query engine's grouping
 * turned sideways: each group becomes a column, and dropping a card into one
 * *is* setting that field on that item. That equivalence is the whole design.
 * It is why the board needs no store of its own, why an empty column still has
 * to exist (it is the drop target), and why "move to Done" and "set status to
 * Done" cannot drift apart — they are the same write.
 *
 * What lives here is the part that is easy to get wrong and impossible to see:
 * given a card, a column and a slot, what exactly should be written. It is a
 * pure function, and the tests are the ones that matter in this slice.
 *
 * Pure: no I/O, no React, no host.
 */

import { between } from './ordering';
import type { Property, PropertyValue } from './property';
import type { FieldRef, Group, Row } from './query';

/** A column, and what the view says about how full it may be. */
export interface Column {
  readonly key: string | null;
  readonly label: string;
  readonly color: string | null;
  readonly rows: readonly Row[];
  /** From the view's configuration. Null means no limit was set. */
  readonly wipLimit: number | null;
  readonly collapsed: boolean;
}

/** How a column stands against its limit. */
export type WipState = 'none' | 'under' | 'at' | 'over';

export function wipState(column: Column): WipState {
  if (column.wipLimit === null) return 'none';
  if (column.rows.length > column.wipLimit) return 'over';
  if (column.rows.length === column.wipLimit) return 'at';
  return 'under';
}

/** Per-column settings a board view stores alongside its query. */
export interface BoardConfig {
  /** Column key to limit. A key of `""` stands for the "no value" column. */
  readonly wipLimits: Readonly<Record<string, number>>;
  readonly collapsed: readonly string[];
  /** Which properties appear on a card, in order. Empty means none. */
  readonly cardProperties: readonly string[];
}

export const EMPTY_BOARD_CONFIG: BoardConfig = {
  wipLimits: {},
  collapsed: [],
  cardProperties: [],
};

/** JSON keys cannot be null, so the "no value" column is stored as `""`. */
export function columnKeyToStorage(key: string | null): string {
  return key ?? '';
}

/** Turn the engine's groups into columns, applying the board's settings. */
export function toColumns(groups: readonly Group[], config: BoardConfig): Column[] {
  return groups.map((group) => {
    const storageKey = columnKeyToStorage(group.key);
    return {
      key: group.key,
      label: group.label,
      color: group.color,
      rows: group.rows,
      wipLimit: config.wipLimits[storageKey] ?? null,
      collapsed: config.collapsed.includes(storageKey),
    };
  });
}

/**
 * What a drop should write.
 *
 * `null` for `value` means the field is cleared — dropping into the "no value"
 * column is how a person un-sets a status, and it has to be expressible.
 */
export interface Move {
  readonly itemId: string;
  readonly position: string;
  /** The field the columns group by, or null when nothing needs setting. */
  readonly field: FieldRef | null;
  readonly value: PropertyValue;
  /** True when the card changed column, rather than only moving within one. */
  readonly changedColumn: boolean;
}

export interface DropTarget {
  /** The column dropped into. */
  readonly columnKey: string | null;
  /** The slot within that column, counted with the dragged card removed. */
  readonly index: number;
}

/**
 * Compute the single write a drop implies.
 *
 * The subtlety worth stating: `index` counts the column *without* the card
 * being dragged. Computing the neighbours from the column as displayed — which
 * still contains the card — puts a card dragged one slot down back exactly
 * where it started, because its own key becomes one of the two bounds.
 *
 * Returns null when there is nothing to write: a drop onto the card's own
 * position is a no-op, and writing anyway would touch `updated_at` and reorder
 * a stable list for nothing.
 */
export function planMove(
  row: Row,
  target: DropTarget,
  columns: readonly Column[],
  groupBy: FieldRef | null,
): Move | null {
  const destination = columns.find((column) => column.key === target.columnKey);
  if (destination === undefined) return null;

  // The column as it will be, with the dragged card taken out.
  const others = destination.rows.filter((candidate) => candidate.item.id !== row.item.id);
  const slot = Math.max(0, Math.min(target.index, others.length));

  const lower = slot > 0 ? (others[slot - 1]?.item.position ?? null) : null;
  const upper = slot < others.length ? (others[slot]?.item.position ?? null) : null;

  const changedColumn = !destination.rows.some((candidate) => candidate.item.id === row.item.id);

  // Nothing moved: same column, and the neighbours are already the card's own.
  if (!changedColumn && lower !== null && upper !== null) {
    const currentIndex = destination.rows.findIndex(
      (candidate) => candidate.item.id === row.item.id,
    );
    if (currentIndex === slot || currentIndex === slot - 1) return null;
  }

  return {
    itemId: row.item.id,
    position: between(lower, upper),
    field: groupBy,
    value: target.columnKey,
    changedColumn,
  };
}

/**
 * A card dropped into a column whose key the field no longer declares.
 *
 * The engine keeps such a column so its rows stay visible, but it is not a
 * legal destination: writing a value that is not an option would spread bad
 * data rather than contain it.
 */
export function isDroppable(column: Column, property: Property | null): boolean {
  if (column.key === null) return true;
  if (property === null) return true;
  const options = property.config.options ?? [];
  if (property.type === 'priority') return true;
  return options.some((option) => option.id === column.key);
}

/** Which properties a card shows, in the order the board declares. */
export function cardProperties(config: BoardConfig, properties: readonly Property[]): Property[] {
  return config.cardProperties
    .map((id) => properties.find((property) => property.id === id))
    .filter((property): property is Property => property !== undefined);
}
