/**
 * Typed properties — the fields a collection declares and an item fills in.
 *
 * This is the engine that lets one product be a to-do list, a Kanban board and
 * a small database at the same time: a collection declares what its items have,
 * and every view reads the same declaration. Notion has this and it is why it
 * is powerful; Microsoft To Do does not and it is why it is a dumb list.
 *
 * Two rules shape the whole module.
 *
 * **The property carries the type; the value is plain data.** A value is a
 * string, a number, a boolean, a list of strings, or nothing. It is never a
 * tagged union that repeats what the property already says, because that
 * duplication is exactly where a schema change and stored data drift apart.
 *
 * **Reading is total.** `parseValue` never throws. Values in the database were
 * written by an older build, or by a property whose type has since changed, or
 * by a hand-edited file. A parser that throws on the unexpected turns one bad
 * row into a blank screen. This one reports what it could not read and lets the
 * interface show the rest.
 *
 * Pure: no I/O, no React, no host.
 */

/** The property types this release stores. */
export const PROPERTY_TYPES = [
  'text',
  'number',
  'checkbox',
  'url',
  'select',
  'multi_select',
  'status',
  'priority',
  'date',
  'datetime',
  'duration',
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value);
}

/** A choice in a select, multi-select or status property. */
export interface SelectOption {
  id: string;
  label: string;
  /** A token name, never a raw colour — the token layer owns the palette. */
  color: string | null;
  /**
   * Which end of a workflow this option means. Only status properties use it,
   * and it is what lets "done" mean the same thing across differently-named
   * columns on a board.
   */
  group?: 'todo' | 'doing' | 'done';
}

/** Per-type configuration. Absent keys mean the type takes no configuration. */
export interface PropertyConfig {
  options?: SelectOption[];
  /** `number` only: digits after the decimal point. */
  precision?: number;
  /** `number` only: shown after the value, never stored in it. */
  unit?: string;
}

export interface Property {
  id: string;
  collectionId: string;
  /** Stable across renames. What code refers to; `name` is what people read. */
  key: string;
  name: string;
  type: PropertyType;
  config: PropertyConfig;
  position: string;
  /** Seeded by a migration and not deletable, though it can be renamed. */
  isSystem: boolean;
}

/** Everything a property value can be. Plain data, by design. */
export type PropertyValue = string | number | boolean | readonly string[] | null;

/** Item values, keyed by property id. */
export type PropertyValues = Readonly<Record<string, PropertyValue>>;

/**
 * The fixed priority scale.
 *
 * Fixed rather than configurable on purpose: priority means the same thing
 * everywhere in the product, so a cross-collection view can sort by it. A
 * collection that wants its own scale uses a select.
 */
export const PRIORITY_LEVELS: readonly SelectOption[] = [
  { id: 'urgent', label: 'Urgent', color: 'danger' },
  { id: 'high', label: 'High', color: 'caution' },
  { id: 'medium', label: 'Medium', color: 'info' },
  { id: 'low', label: 'Low', color: null },
];

/** The options a property offers, whether they are configured or built in. */
export function optionsOf(property: Property): readonly SelectOption[] {
  if (property.type === 'priority') return PRIORITY_LEVELS;
  return property.config.options ?? [];
}

function optionIds(property: Property): Set<string> {
  return new Set(optionsOf(property).map((option) => option.id));
}

// ── Reading ────────────────────────────────────────────────────────────────

export type ParseResult =
  | { readonly status: 'ok'; readonly value: PropertyValue }
  | { readonly status: 'unreadable'; readonly reason: string; readonly raw: unknown };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Interpret a stored value against the property that owns it.
 *
 * Never throws. An unreadable value is reported, not raised: one row written by
 * an older build must not blank the screen for every other row.
 */
export function parseValue(property: Property, raw: unknown): ParseResult {
  if (raw === null || raw === undefined) return { status: 'ok', value: null };

  const unreadable = (reason: string): ParseResult => ({ status: 'unreadable', reason, raw });

  switch (property.type) {
    case 'text':
    case 'url':
      return typeof raw === 'string' ? { status: 'ok', value: raw } : unreadable('expected text');

    case 'number':
    case 'duration':
      return isRealNumber(raw)
        ? { status: 'ok', value: raw }
        : unreadable('expected a finite number');

    case 'checkbox':
      return typeof raw === 'boolean'
        ? { status: 'ok', value: raw }
        : unreadable('expected true or false');

    case 'select':
    case 'status':
    case 'priority': {
      if (typeof raw !== 'string') return unreadable('expected one option');
      // An option the property no longer offers is kept, not silently dropped:
      // deleting an option must not quietly rewrite everybody's data.
      return { status: 'ok', value: raw };
    }

    case 'multi_select': {
      if (!Array.isArray(raw)) return unreadable('expected a list of options');
      if (!raw.every((entry) => typeof entry === 'string')) {
        return unreadable('expected a list of options');
      }
      return { status: 'ok', value: [...new Set(raw as string[])] };
    }

    case 'date':
      return typeof raw === 'string' && ISO_DATE.test(raw)
        ? { status: 'ok', value: raw }
        : unreadable('expected a calendar date');

    case 'datetime': {
      if (typeof raw !== 'string') return unreadable('expected an instant');
      return Number.isNaN(Date.parse(raw))
        ? unreadable('expected an instant')
        : { status: 'ok', value: raw };
    }
  }
}

/** Read a value, falling back to empty when it cannot be understood. */
export function parseValueOrEmpty(property: Property, raw: unknown): PropertyValue {
  const result = parseValue(property, raw);
  return result.status === 'ok' ? result.value : emptyValue(property);
}

/** What "nothing set" looks like for a property. */
export function emptyValue(property: Property): PropertyValue {
  return property.type === 'multi_select' ? [] : null;
}

export function isEmpty(value: PropertyValue): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

// ── Writing ────────────────────────────────────────────────────────────────

/**
 * The JSON the host stores.
 *
 * Serialising goes through `parseValue` first, so a value that could not be
 * read back is never written in the first place.
 */
export function serialiseValue(property: Property, value: PropertyValue): string {
  const result = parseValue(property, value);
  return JSON.stringify(result.status === 'ok' ? result.value : emptyValue(property));
}

// ── Validating what a person typed ─────────────────────────────────────────

export type ValueCheck =
  | { readonly status: 'ok'; readonly value: PropertyValue }
  | { readonly status: 'invalid'; readonly reason: string };

/**
 * Check a value a person is entering.
 *
 * Stricter than `parseValue`, and deliberately so: reading tolerates history,
 * writing does not create it. A select value must be an option the property
 * actually offers, and a URL must look like one.
 */
export function checkValue(property: Property, value: PropertyValue): ValueCheck {
  if (isEmpty(value)) return { status: 'ok', value: emptyValue(property) };

  const parsed = parseValue(property, value);
  if (parsed.status !== 'ok') return { status: 'invalid', reason: parsed.reason };
  const clean = parsed.value;

  switch (property.type) {
    case 'url': {
      const text = String(clean);
      try {
        const url = new URL(text);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return { status: 'invalid', reason: 'only http and https links are stored' };
        }
        return { status: 'ok', value: text };
      } catch {
        return { status: 'invalid', reason: 'that is not a link' };
      }
    }

    case 'duration': {
      const minutes = Number(clean);
      if (minutes < 0) return { status: 'invalid', reason: 'a duration cannot be negative' };
      return { status: 'ok', value: minutes };
    }

    case 'select':
    case 'status':
    case 'priority': {
      const ids = optionIds(property);
      return ids.has(String(clean))
        ? { status: 'ok', value: clean }
        : { status: 'invalid', reason: 'that is not one of the options' };
    }

    case 'multi_select': {
      const ids = optionIds(property);
      const chosen = clean as readonly string[];
      const unknown = chosen.filter((id) => !ids.has(id));
      return unknown.length > 0
        ? { status: 'invalid', reason: 'those are not options' }
        : { status: 'ok', value: chosen };
    }

    default:
      return { status: 'ok', value: clean };
  }
}

// ── Showing ────────────────────────────────────────────────────────────────

/**
 * A value as a person reads it.
 *
 * An option id that the property no longer offers is shown as itself rather
 * than hidden: the data is still there, and pretending otherwise is how a
 * person loses track of what they wrote.
 */
export function formatValue(property: Property, value: PropertyValue, locale = 'en'): string {
  if (isEmpty(value)) return '';

  const label = (id: string) => optionsOf(property).find((o) => o.id === id)?.label ?? id;

  switch (property.type) {
    case 'checkbox':
      return value === true ? 'Yes' : 'No';

    case 'number': {
      const precision = property.config.precision ?? 0;
      const text = Number(value).toLocaleString(locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });
      return property.config.unit ? `${text} ${property.config.unit}` : text;
    }

    case 'duration':
      return formatDuration(Number(value));

    case 'select':
    case 'status':
    case 'priority':
      return label(String(value));

    case 'multi_select':
      return (value as readonly string[]).map(label).join(', ');

    case 'date':
      // Parsed as parts, not as a string: `new Date('2026-03-15')` is midnight
      // UTC, which is the previous day for anyone west of Greenwich.
      return formatCalendarDate(String(value), locale);

    case 'datetime':
      return new Date(String(value)).toLocaleString(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

    default:
      return String(value);
  }
}

function formatCalendarDate(iso: string, locale: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(locale, { dateStyle: 'medium' });
}

/** Minutes as a person writes them: `90` becomes `1h 30m`. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

// ── Ordering ───────────────────────────────────────────────────────────────

/**
 * Compare two values of the same property, for sorting.
 *
 * Empty always sorts last, whichever direction the caller asked for: a row with
 * nothing in the column is not "the smallest", it is "not answered", and
 * burying it under the answered rows is what a person expects.
 *
 * Options compare by their declared order, not alphabetically — Urgent comes
 * before High because that is what the property says, not because U precedes H.
 */
/**
 * Build a comparator for a property, doing the per-property work once.
 *
 * The expensive part of comparing two options is knowing their declared order,
 * and that does not change between comparisons. Rebuilding it inside the
 * comparator costs an allocation and two linear scans *per pair* — invisible in
 * a unit test, and the dominant cost when sorting fifty thousand rows.
 *
 * `compareValues` remains the one-shot form for the places that compare a
 * single pair. Anything that sorts should ask for the comparator once.
 */
export function comparatorFor(property: Property): (a: PropertyValue, b: PropertyValue) => number {
  const compare = rawComparatorFor(property);
  return (a, b) => {
    const aEmpty = isEmpty(a);
    const bEmpty = isEmpty(b);
    if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
    return compare(a, b);
  };
}

/**
 * A comparator for two values that are both known to be present.
 *
 * Emptiness is a property of a row, not of a pair, so deciding it inside the
 * comparator re-decides it on every comparison — and `isEmpty` trims strings,
 * which allocates. At fifty thousand rows that was 1.6 million trims and the
 * single largest cost in a sort.
 *
 * A caller that sorts should read emptiness once per row and use this; a caller
 * comparing one pair should use `comparatorFor`, which handles it.
 */
export function rawComparatorFor(
  property: Property,
): (a: PropertyValue, b: PropertyValue) => number {
  switch (property.type) {
    case 'number':
    case 'duration':
      return (a, b) => Number(a) - Number(b);

    case 'checkbox':
      // False before true, the way 0 sorts before 1. Ascending on a "Done"
      // column therefore puts the unfinished work at the top, which is the
      // whole reason somebody sorts by it.
      return (a, b) => Number(a === true) - Number(b === true);

    case 'select':
    case 'status':
    case 'priority': {
      // Built once. An option the property no longer offers ranks after every
      // one it does.
      const rank = new Map<string, number>();
      const options = optionsOf(property);
      options.forEach((option, index) => rank.set(option.id, index));
      const unknown = options.length;

      return (a, b) => (rank.get(a as string) ?? unknown) - (rank.get(b as string) ?? unknown);
    }

    case 'multi_select':
      return (a, b) => (a as readonly string[]).length - (b as readonly string[]).length;

    case 'date':
    case 'datetime':
      // Both formats sort correctly as strings, which is why they are stored
      // this way (ADR-013). A plain comparison beats localeCompare by an order
      // of magnitude and the answer is identical for an ISO-8601 string.
      return (a, b) => {
        // Both are ISO-8601 strings by construction; the cast records that this
        // comparator is only ever handed present values.
        const left = a as string;
        const right = b as string;
        return left < right ? -1 : left > right ? 1 : 0;
      };

    default:
      return (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  }
}

/**
 * Compare two values of the same property.
 *
 * Empty always sorts last, whichever direction the caller asked for: a row with
 * nothing in the column is not "the smallest", it is "not answered", and
 * burying it under the answered rows is what a person expects.
 *
 * Options compare by their declared order, not alphabetically — Urgent comes
 * before High because that is what the property says, not because U precedes H.
 */
export function compareValues(property: Property, a: PropertyValue, b: PropertyValue): number {
  return comparatorFor(property)(a, b);
}
