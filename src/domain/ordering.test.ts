import { describe, expect, it } from 'vitest';

import { between, firstKey, isValidKey, OrderingError, sequence, sortByKey } from './ordering';

describe('order key validity', () => {
  it('accepts an ordinary key', () => {
    expect(isValidKey('V')).toBe(true);
    expect(isValidKey('a0V')).toBe(true);
  });

  it('rejects an empty key', () => {
    expect(isValidKey('')).toBe(false);
  });

  it('rejects a key ending in the lowest digit', () => {
    // A trailing '0' leaves no room below it, which would break the guarantee
    // that a key can always be generated between any two keys.
    expect(isValidKey('a0')).toBe(false);
    expect(isValidKey('0')).toBe(false);
  });

  it('rejects a character outside the alphabet', () => {
    expect(isValidKey('a-b')).toBe(false);
    expect(isValidKey('á')).toBe(false);
    expect(isValidKey('a b')).toBe(false);
  });
});

describe('between', () => {
  it('produces a key for an empty list', () => {
    const key = firstKey();
    expect(isValidKey(key)).toBe(true);
  });

  it('appends after a key', () => {
    const first = firstKey();
    const second = between(first, null);
    expect(second > first).toBe(true);
  });

  it('prepends before a key', () => {
    const first = firstKey();
    const earlier = between(null, first);
    expect(earlier < first).toBe(true);
  });

  it('inserts strictly between two keys', () => {
    const a = firstKey();
    const b = between(a, null);
    const middle = between(a, b);
    expect(a < middle).toBe(true);
    expect(middle < b).toBe(true);
  });

  it('still finds room between keys that look adjacent', () => {
    // The interesting case: two keys with no digit left between them. The
    // algorithm must grow the key rather than give up.
    const low = firstKey();
    let high = between(low, null);
    for (let i = 0; i < 50; i += 1) {
      const middle = between(low, high);
      expect(low < middle).toBe(true);
      expect(middle < high).toBe(true);
      expect(isValidKey(middle)).toBe(true);
      high = middle;
    }
    expect(low < high).toBe(true);
  });

  it('survives repeated insertion at the head', () => {
    let head = firstKey();
    for (let i = 0; i < 200; i += 1) {
      const earlier = between(null, head);
      expect(earlier < head).toBe(true);
      expect(isValidKey(earlier)).toBe(true);
      head = earlier;
    }
  });

  it('survives repeated insertion at the tail', () => {
    let tail = firstKey();
    for (let i = 0; i < 200; i += 1) {
      const later = between(tail, null);
      expect(later > tail).toBe(true);
      expect(isValidKey(later)).toBe(true);
      tail = later;
    }
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('refuses bounds that are the wrong way round', () => {
    const a = firstKey();
    const b = between(a, null);
    expect(() => between(b, a)).toThrow(OrderingError);
  });

  it('refuses equal bounds', () => {
    const a = firstKey();
    expect(() => between(a, a)).toThrow(OrderingError);
  });

  it('refuses a malformed bound rather than inventing a key', () => {
    expect(() => between('a0', null)).toThrow(OrderingError);
    expect(() => between(null, '')).toThrow(OrderingError);
    expect(() => between('~', null)).toThrow(OrderingError);
  });
});

describe('sequence', () => {
  it('returns nothing for a count of zero', () => {
    expect(sequence(null, null, 0)).toEqual([]);
  });

  it('returns ascending keys inside the bounds', () => {
    const low = firstKey();
    const high = between(low, null);
    const keys = sequence(low, high, 10);

    expect(keys).toHaveLength(10);
    for (const key of keys) {
      expect(isValidKey(key)).toBe(true);
      expect(low < key).toBe(true);
      expect(key < high).toBe(true);
    }
    expect([...keys].sort()).toEqual(keys);
  });

  it('returns ascending keys with open bounds', () => {
    const keys = sequence(null, null, 25);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(25);
  });

  it('refuses a negative or fractional count', () => {
    expect(() => sequence(null, null, -1)).toThrow(OrderingError);
    expect(() => sequence(null, null, 1.5)).toThrow(OrderingError);
  });
});

describe('sortByKey', () => {
  it('orders records by their key and leaves the input untouched', () => {
    const keys = sequence(null, null, 5);
    const shuffled = [
      { id: 'e', position: keys[4]! },
      { id: 'a', position: keys[0]! },
      { id: 'c', position: keys[2]! },
      { id: 'b', position: keys[1]! },
      { id: 'd', position: keys[3]! },
    ];
    const original = [...shuffled];

    const sorted = sortByKey(shuffled, (item) => item.position);

    expect(sorted.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shuffled).toEqual(original);
  });
});

describe('the drag-and-drop invariant', () => {
  // This is the property the board depends on: whatever sequence of moves a
  // person performs, the list stays totally ordered and every key stays valid.
  it('holds across a thousand random moves', () => {
    let seed = 20260902;
    const random = () => {
      // A deterministic generator, so a failure is reproducible rather than
      // "it failed once on somebody's machine".
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const list: string[] = sequence(null, null, 20);

    for (let move = 0; move < 1000; move += 1) {
      const from = Math.floor(random() * list.length);
      const to = Math.floor(random() * (list.length + 1));

      const lower = to > 0 ? (list[to - 1] ?? null) : null;
      const upper = to < list.length ? (list[to] ?? null) : null;
      if (lower !== null && upper !== null && lower >= upper) continue;

      const moved = between(lower, upper);
      list.splice(from, 1);
      list.splice(from < to ? to - 1 : to, 0, moved);

      expect(isValidKey(moved)).toBe(true);
    }

    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1]! < list[i]!).toBe(true);
    }
    expect(new Set(list).size).toBe(list.length);
  });
});
