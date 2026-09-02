/**
 * The query engine — filters, sorting and grouping over a collection.
 *
 * This is what makes a view a view. The same items, read once, become a list, a
 * table, a board or a calendar depending only on the query saved against them.
 * Nothing here knows which of those is asking.
 *
 * # Where this runs, and when that stops being true
 *
 * In memory, in TypeScript, over items already hydrated from SQLite (ADR-004).
 * At tens of thousands of items the cost is irrelevant, and keeping it here
 * keeps every rule in one pure, testable place instead of split across two
 * languages with dynamic SQL in between.
 *
 * The exit is designed in rather than hoped for: the contract is
 * `run(input) -> Result`. When the volume outgrows memory, a compiler emits SQL
 * behind that same contract and nothing above it changes. The measured trigger
 * is in `query.bench.test.ts`.
 *
 * Pure: no I/O, no React, no host.
 */

import { compareValues, isEmpty, optionsOf, parseValueOrEmpty, rawComparatorFor } from './property';
import type { Property, PropertyValue } from './property';
import { isCompleted, type Item } from './item';

// ── What a query can point at ──────────────────────────────────────────────

/**
 * A field is either something every item has, or a property the collection
 * declared.
 *
 * Built-in fields are columns rather than properties because they exist for
 * every item in every collection and the scheduler and cross-collection views
 * read them directly.
 */
export type FieldRef =
  | { readonly kind: 'builtin'; readonly field: BuiltinField }
  | { readonly kind: 'property'; readonly propertyId: string };

export const BUILTIN_FIELDS = ['title', 'completed', 'createdAt', 'updatedAt'] as const;
export type BuiltinField = (typeof BUILTIN_FIELDS)[number];

export const BUILTIN_LABELS: Record<BuiltinField, string> = {
  title: 'Title',
  completed: 'Completed',
  createdAt: 'Created',
  updatedAt: 'Updated',
};

export function fieldKey(field: FieldRef): string {
  return field.kind === 'builtin' ? `builtin:${field.field}` : `property:${field.propertyId}`;
}

export function sameField(a: FieldRef, b: FieldRef): boolean {
  return fieldKey(a) === fieldKey(b);
}

// ── Filters ────────────────────────────────────────────────────────────────

export const OPERATORS = [
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
  'gt',
  'lt',
  'has_any_of',
] as const;

export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: 'is after',
  lt: 'is before',
  has_any_of: 'has any of',
};

/** Operators that read no value: the field's emptiness is the whole question. */
export const VALUELESS: ReadonlySet<Operator> = new Set(['is_empty', 'is_not_empty']);

export interface Filter {
  readonly id: string;
  readonly field: FieldRef;
  readonly operator: Operator;
  readonly value: PropertyValue;
}

export interface Sort {
  readonly field: FieldRef;
  readonly direction: 'asc' | 'desc';
}

export interface Query {
  readonly filters: readonly Filter[];
  /** Whether every filter must match, or any one of them. */
  readonly match: 'all' | 'any';
  readonly sorts: readonly Sort[];
  readonly groupBy: FieldRef | null;
  readonly includeCompleted: boolean;
}

export const EMPTY_QUERY: Query = {
  filters: [],
  match: 'all',
  sorts: [],
  groupBy: null,
  includeCompleted: true,
};

/**
 * The operators that make sense for a field.
 *
 * Offering "is after" on a checkbox is how a filter builder becomes a puzzle.
 */
export function operatorsFor(property: Property | null, builtin?: BuiltinField): Operator[] {
  if (property === null) {
    switch (builtin) {
      case 'title':
        return ['contains', 'does_not_contain', 'is', 'is_not', 'is_empty', 'is_not_empty'];
      case 'completed':
        return ['is'];
      case 'createdAt':
      case 'updatedAt':
        return ['gt', 'lt'];
      default:
        return ['is'];
    }
  }

  switch (property.type) {
    case 'text':
    case 'url':
      return ['contains', 'does_not_contain', 'is', 'is_not', 'is_empty', 'is_not_empty'];
    case 'number':
    case 'duration':
    case 'date':
    case 'datetime':
      return ['is', 'is_not', 'gt', 'lt', 'is_empty', 'is_not_empty'];
    case 'checkbox':
      return ['is'];
    case 'select':
    case 'status':
    case 'priority':
      return ['is', 'is_not', 'is_empty', 'is_not_empty'];
    case 'multi_select':
      return ['has_any_of', 'is_empty', 'is_not_empty'];
  }
}

// ── The input ──────────────────────────────────────────────────────────────

/** One item and everything stored against it. */
export interface Row {
  readonly item: Item;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface Group {
  /** The option id, `true`/`false` for a checkbox, or null for "no value". */
  readonly key: string | null;
  readonly label: string;
  /** A token name for the group's colour, when the field has one. */
  readonly color: string | null;
  readonly rows: readonly Row[];
}

export interface Result {
  readonly groups: readonly Group[];
  /** How many rows the collection holds, before filtering. */
  readonly total: number;
  /** How many survived the filters. */
  readonly matched: number;
}

/** The single group used when a query does not group. */
const UNGROUPED = '__all__';

// ── Reading a field off a row ──────────────────────────────────────────────

function propertyOf(properties: readonly Property[], id: string): Property | null {
  return properties.find((property) => property.id === id) ?? null;
}

/**
 * The comparable value of a field on a row.
 *
 * Built-in fields answer as their own natural type; property values are read
 * through the property that owns them, so an unreadable one degrades to empty
 * rather than throwing (see `parseValue`).
 */
function readField(row: Row, field: FieldRef, properties: readonly Property[]): PropertyValue {
  if (field.kind === 'builtin') {
    switch (field.field) {
      case 'title':
        return row.item.title;
      case 'completed':
        return isCompleted(row.item);
      case 'createdAt':
        return row.item.createdAt;
      case 'updatedAt':
        return row.item.updatedAt;
    }
  }

  const property = propertyOf(properties, field.propertyId);
  if (property === null) return null;
  return parseValueOrEmpty(property, row.values[field.propertyId]);
}

// ── Filtering ──────────────────────────────────────────────────────────────

function textOf(value: PropertyValue): string {
  if (value === null) return '';
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
}

/**
 * Does one filter accept one row?
 *
 * A filter with no value is a filter the person has not finished writing, and
 * it accepts everything rather than hiding the whole list while they type.
 * That single decision is the difference between a filter builder that feels
 * alive and one that flashes an empty screen at every keystroke.
 */
export function accepts(row: Row, filter: Filter, properties: readonly Property[]): boolean {
  const actual = readField(row, filter.field, properties);

  if (filter.operator === 'is_empty') return isEmpty(actual);
  if (filter.operator === 'is_not_empty') return !isEmpty(actual);

  if (isEmpty(filter.value)) return true;

  const property =
    filter.field.kind === 'property' ? propertyOf(properties, filter.field.propertyId) : null;

  switch (filter.operator) {
    case 'is':
      return equal(actual, filter.value);
    case 'is_not':
      return !equal(actual, filter.value);

    case 'contains':
      return textOf(actual).toLowerCase().includes(textOf(filter.value).toLowerCase());
    case 'does_not_contain':
      return !textOf(actual).toLowerCase().includes(textOf(filter.value).toLowerCase());

    case 'gt':
    case 'lt': {
      if (isEmpty(actual)) return false;
      const order = property
        ? compareValues(property, actual, filter.value)
        : String(actual).localeCompare(String(filter.value));
      return filter.operator === 'gt' ? order > 0 : order < 0;
    }

    case 'has_any_of': {
      const held = new Set(Array.isArray(actual) ? actual : []);
      const wanted = Array.isArray(filter.value) ? filter.value : [String(filter.value)];
      return wanted.some((candidate) => held.has(candidate));
    }
  }
}

function equal(a: PropertyValue, b: PropertyValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  }
  // Loose on purpose at exactly one point: a checkbox filter arrives from a
  // select as the string "true", and a person means the boolean.
  if (typeof a === 'boolean') return a === (b === true || b === 'true');
  return a === b;
}

// ── Sorting ────────────────────────────────────────────────────────────────

/** A sort with its comparator built once, rather than on every comparison. */
interface ResolvedSort {
  readonly sort: Sort;
  readonly compare: ((a: PropertyValue, b: PropertyValue) => number) | null;
}

/** A row with its sort keys already read. */
interface Decorated {
  readonly row: Row;
  readonly keys: readonly PropertyValue[];
}

function compareDecorated(a: Decorated, b: Decorated, sorts: readonly ResolvedSort[]): number {
  for (let index = 0; index < sorts.length; index += 1) {
    const { sort, compare } = sorts[index]!;
    const left = a.keys[index] ?? null;
    const right = b.keys[index] ?? null;

    // Keys are already normalised: null means empty, and empty sorts last
    // whichever way the sort points.
    if (left === null || right === null) {
      if (left === null && right === null) continue;
      return left === null ? 1 : -1;
    }

    let order: number;
    if (compare !== null) {
      order = compare(left, right);
    } else if (typeof left === 'boolean') {
      order = Number(left === true) - Number(right === true);
    } else {
      order = String(left).localeCompare(String(right), undefined, { numeric: true });
    }

    // Empty stays last whichever way the sort points. A row with nothing in the
    // column is "not answered", not "smallest", and flipping the direction must
    // not drag every blank row to the top.
    if (order !== 0) return sort.direction === 'desc' ? -order : order;
  }

  // Ties break on the manual order, never on nothing: two rows that compare
  // equal must still come out in the same sequence every time, or the list
  // reshuffles itself on every render.
  return comparePositions(a.row, b.row);
}

function comparePositions(a: Row, b: Row): number {
  return a.item.position < b.item.position ? -1 : a.item.position > b.item.position ? 1 : 0;
}

/**
 * Sort by reading each field once per row rather than once per comparison.
 *
 * Sorting is n log n comparisons — around 800,000 of them at fifty thousand
 * rows — and reading a field means finding its property and reinterpreting the
 * stored JSON. Doing that inside the comparator meant 1.6 million parses and
 * measured 113 ms against a 50 ms target. Reading the keys up front makes it
 * 50,000 parses.
 *
 * The classic decorate-sort-undecorate, and the reason the benchmark exists:
 * the cost was invisible at twenty rows.
 */
function sortRows(
  rows: readonly Row[],
  sorts: readonly Sort[],
  properties: readonly Property[],
): Row[] {
  const resolved: ResolvedSort[] = sorts.map((sort) => {
    const property =
      sort.field.kind === 'property' ? propertyOf(properties, sort.field.propertyId) : null;
    return { sort, compare: property === null ? null : rawComparatorFor(property) };
  });

  // Emptiness is decided once per row, here, and recorded as a null key. The
  // comparator then never has to ask again — which is what took 1.6 million
  // string trims out of a fifty-thousand-row sort.
  const decorated: Decorated[] = rows.map((row) => ({
    row,
    keys: sorts.map((sort) => {
      const value = readField(row, sort.field, properties);
      return isEmpty(value) ? null : value;
    }),
  }));

  decorated.sort((a, b) => compareDecorated(a, b, resolved));
  return decorated.map((entry) => entry.row);
}

// ── Grouping ───────────────────────────────────────────────────────────────

function groupKeyOf(value: PropertyValue): string | null {
  if (isEmpty(value)) return null;
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  return String(value);
}

/**
 * The groups a field defines, in the order they should appear, whether or not
 * any row falls into them.
 *
 * An empty column on a board still has to be there — it is where a card is
 * dragged to. A grouping that only shows non-empty groups is a board you cannot
 * move anything into.
 */
function groupsFor(field: FieldRef, properties: readonly Property[]): Group[] {
  if (field.kind === 'builtin') {
    if (field.field === 'completed') {
      return [
        { key: 'false', label: 'Open', color: null, rows: [] },
        { key: 'true', label: 'Completed', color: 'success', rows: [] },
      ];
    }
    return [];
  }

  const property = propertyOf(properties, field.propertyId);
  if (property === null) return [];

  return optionsOf(property).map((option) => ({
    key: option.id,
    label: option.label,
    color: option.color,
    rows: [],
  }));
}

// ── Running ────────────────────────────────────────────────────────────────

export interface RunInput {
  readonly rows: readonly Row[];
  readonly properties: readonly Property[];
  readonly query: Query;
}

/**
 * Filter, sort and group in one pass over the rows.
 *
 * The result always holds at least one group. A caller that does not group
 * reads `groups[0].rows` and never has to special-case the ungrouped shape.
 */
export function run({ rows, properties, query }: RunInput): Result {
  const total = rows.length;

  const matched: Row[] = [];
  for (const row of rows) {
    if (!query.includeCompleted && isCompleted(row.item)) continue;

    if (query.filters.length > 0) {
      const verdicts = query.filters.map((filter) => accepts(row, filter, properties));
      const passes = query.match === 'all' ? verdicts.every(Boolean) : verdicts.some(Boolean);
      if (!passes) continue;
    }

    matched.push(row);
  }

  // With no sort, the manual order is the order: sorting by the fractional key
  // keeps a dragged card where it was dropped.
  //
  // Both branches sort the rows directly. An earlier version sorted the items
  // and then looked each row up with `find`, which is quadratic — invisible at
  // twenty rows and about two billion comparisons at fifty thousand.
  const ordered =
    query.sorts.length > 0
      ? sortRows(matched, query.sorts, properties)
      : [...matched].sort(comparePositions);

  if (query.groupBy === null) {
    return {
      groups: [{ key: UNGROUPED, label: '', color: null, rows: ordered }],
      total,
      matched: ordered.length,
    };
  }

  const declared = groupsFor(query.groupBy, properties);
  const buckets = new Map<string | null, Row[]>();
  for (const group of declared) buckets.set(group.key, []);

  for (const row of ordered) {
    const key = groupKeyOf(readField(row, query.groupBy, properties));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push(row);
  }

  const groups: Group[] = [];
  for (const group of declared) {
    groups.push({ ...group, rows: buckets.get(group.key) ?? [] });
    buckets.delete(group.key);
  }

  // Whatever is left is a value the field no longer declares — an option that
  // was deleted, say. It is shown rather than dropped, because the rows in it
  // are real and would otherwise vanish from the view entirely.
  const leftover = [...buckets.entries()].filter(([key]) => key !== null);
  for (const [key, rowsInGroup] of leftover) {
    groups.push({ key, label: `${key} (removed)`, color: null, rows: rowsInGroup });
  }

  // "No value" is always present for a field that can be empty, for the same
  // reason a declared group is: on a board it is the column a card is dragged
  // into to clear the field, and a group that only appears once something is in
  // it cannot be dragged to.
  //
  // A field that cannot be empty does not get one. Completion is true or false
  // and never absent, so a permanently empty column there is just noise.
  const rowsWithNoValue = buckets.get(null) ?? [];
  if (canBeEmpty(query.groupBy) || rowsWithNoValue.length > 0) {
    groups.push({ key: null, label: 'No value', color: null, rows: rowsWithNoValue });
  }

  return { groups, total, matched: ordered.length };
}

/**
 * Can a field hold nothing?
 *
 * A property can always be cleared. Completion is true or false and never
 * absent, so grouping by it produces exactly two columns.
 */
function canBeEmpty(field: FieldRef): boolean {
  return !(field.kind === 'builtin' && field.field === 'completed');
}

/** Every row a result holds, flattened back into view order. */
export function flatten(result: Result): Row[] {
  return result.groups.flatMap((group) => [...group.rows]);
}
