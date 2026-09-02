/**
 * Fractional indexing — how Tessera orders anything a person can drag.
 *
 * The naive way to order rows is an integer `position`. Dragging one card then
 * rewrites the position of every card after it: a hundred rows moved becomes a
 * hundred UPDATEs, a visible stutter, and a large diff to synchronise later.
 *
 * A fractional index is a string key chosen so that a new key can always be
 * generated *between* any two existing keys, without touching either. Moving a
 * card is one UPDATE of one row, whatever the list length. Ordering the list is
 * a plain lexicographic sort — the database can do it, and so can the browser.
 *
 * Keys are digit strings over a 62-character alphabet whose ASCII order is also
 * its logical order, so string comparison and key comparison never disagree.
 *
 * Invariant: a key never ends in the lowest digit. A trailing `'0'` would leave
 * no room below it and would break the "always insertable between" guarantee,
 * so it is rejected rather than quietly accepted.
 *
 * This module is pure: no I/O, no React, no host. See ADR-006.
 */

/** Digits in ascending order. ASCII order equals logical order, by construction. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const FIRST = DIGITS[0]!;

/** Thrown when a caller asks for something the ordering cannot express. */
export class OrderingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderingError';
  }
}

/** True when `key` is a well-formed order key. */
export function isValidKey(key: string): boolean {
  if (key.length === 0) return false;
  if (key.endsWith(FIRST)) return false;
  for (const character of key) {
    if (!DIGITS.includes(character)) return false;
  }
  return true;
}

function assertValid(key: string | null, role: string): void {
  if (key === null) return;
  if (!isValidKey(key)) {
    throw new OrderingError(`the ${role} order key ${JSON.stringify(key)} is not a valid key`);
  }
}

/**
 * The recursive core: a digit string strictly between `lower` and `upper`.
 *
 * `lower` is `''` for "before everything"; `upper` is `null` for "after
 * everything". Both are digit strings without an integer part.
 */
function midpoint(lower: string, upper: string | null): string {
  if (upper !== null) {
    // Strip the longest common prefix and solve the remainder. Missing digits
    // on the left read as the lowest digit, which is what makes `'a'` sort
    // before `'a5'`.
    let shared = 0;
    while (shared < upper.length && (lower[shared] ?? FIRST) === upper[shared]) {
      shared += 1;
    }
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }

  const lowerDigit = lower.length > 0 ? DIGITS.indexOf(lower[0]!) : 0;
  const upperDigit = upper !== null ? DIGITS.indexOf(upper[0]!) : DIGITS.length;

  if (upperDigit - lowerDigit > 1) {
    // There is room for a digit in between; take the middle one.
    const middle = Math.round((lowerDigit + upperDigit) / 2);
    return DIGITS[middle]!;
  }

  // The two digits are adjacent, so the answer has to be longer than one digit.
  if (upper !== null && upper.length > 1) {
    // `upper` has more to it, so its own first digit is already strictly above
    // `lower` and strictly below `upper`.
    return upper.slice(0, 1);
  }

  // Descend: keep the lower digit and find room in the next position.
  return DIGITS[lowerDigit]! + midpoint(lower.slice(1), null);
}

/**
 * Generate an order key strictly between `lower` and `upper`.
 *
 * Pass `null` for an open end: `between(null, first)` prepends,
 * `between(last, null)` appends, `between(null, null)` starts an empty list.
 *
 * @throws OrderingError if either key is malformed, or if `lower` is not
 *   strictly below `upper` — an impossible request is a bug in the caller, and
 *   silently inventing a key would corrupt the order.
 */
export function between(lower: string | null, upper: string | null): string {
  assertValid(lower, 'lower');
  assertValid(upper, 'upper');

  if (lower !== null && upper !== null && lower >= upper) {
    throw new OrderingError(
      `cannot order between ${JSON.stringify(lower)} and ${JSON.stringify(upper)}: ` +
        'the lower key must sort strictly before the upper key',
    );
  }

  return midpoint(lower ?? '', upper);
}

/**
 * Generate `count` keys, in ascending order, strictly between `lower` and
 * `upper`. Used when several items are inserted or pasted at once.
 */
export function sequence(lower: string | null, upper: string | null, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new OrderingError(`cannot generate ${count} keys: the count must be a whole number`);
  }
  if (count === 0) return [];

  // Split the interval by repeated bisection towards `upper`, so the keys come
  // out ascending and each one stays strictly inside the original bounds.
  const keys: string[] = [];
  let cursor = lower;
  for (let index = 0; index < count; index += 1) {
    const key = between(cursor, upper);
    keys.push(key);
    cursor = key;
  }
  return keys;
}

/** The first key for an empty list. */
export function firstKey(): string {
  return between(null, null);
}

/** Sort a list of records by their order key, ascending, without mutating it. */
export function sortByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
