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

  it('appends after a key far longer than the call stack is deep', () => {
    // Appending used to add a digit every five appends and the descent takes a
    // step per digit. This overflowed the stack while it recursed, and such keys
    // can still be stored, so a key this long has to keep working.
    const long = `${'z'.repeat(100_000)}V`;
    const later = between(long, null);
    expect(later > long).toBe(true);
    expect(isValidKey(later)).toBe(true);
  });

  it('inserts between long keys that differ only at the end', () => {
    const shared = 'z'.repeat(100_000);
    const low = `${shared}V`;
    const high = `${shared}l`;
    const middle = between(low, high);
    expect(low < middle).toBe(true);
    expect(middle < high).toBe(true);
    expect(isValidKey(middle)).toBe(true);
  });

  it('mints exactly the keys ADR-006 says it does', () => {
    // Keys are persisted, and a stored key is never rewritten. A change here
    // changes the order new rows take among existing ones, so it is a data
    // decision and has to be taken as one. The last such decision was the counter,
    // which took over from zV, zl, zt so that appends stop lengthening keys.
    expect(sequence(null, null, 8)).toEqual(['V', 'l', 't', 'x', 'z', 'za1', 'za2', 'za3']);
    expect(between('z', null)).toBe('za1');
    expect(between('zzz', null)).toBe('zzza1');
    expect(between('za9', null)).toBe('zaA');
    expect(between('zaz', null)).toBe('zb01');
    expect(between('zb0z', null)).toBe('zb11');
    expect(between('zbzz', null)).toBe('zc001');
    expect(between('V', 'l')).toBe('d');
    expect(between('V', 'W')).toBe('VV');
    expect(between('a', 'a5')).toBe('a3');
    expect(between('zV', 'zl')).toBe('zd');
    expect(between(null, 'V')).toBe('G');
    expect(between(null, '1')).toBe('0V');
    expect(between(null, '0V')).toBe('0G');
  });

  describe('appending', () => {
    it('stays short however long the list gets', () => {
      // One digit every five appends took this to 10,001 digits.
      let tail = firstKey();
      for (let i = 0; i < 50_000; i += 1) {
        const later = between(tail, null);
        expect(later > tail).toBe(true);
        tail = later;
      }
      expect(tail).toHaveLength(5);
    });

    it('never ends a key in the lowest digit, across every carry', () => {
      let tail = 'z';
      for (let i = 0; i < 20_000; i += 1) {
        tail = between(tail, null);
        expect(isValidKey(tail)).toBe(true);
      }
    });

    it('keeps the keys a list with room in its first digit has always taken', () => {
      expect(between('V', null)).toBe('l');
      expect(between('a5', null)).toBe('n');
      expect(between('y', null)).toBe('z');
    });

    // ── Keys stored before the counter existed ───────────────────────────
    // Appending used to go z, zV, zl, zt, zx, zz, zzV. Those keys are in people's
    // workspaces, and each of them has to be carried on from.
    const oldAppends = (count: number): string[] => {
      const keys = ['V', 'l', 't', 'x', 'z'];
      for (let run = 'z'; keys.length < count; run += 'z') {
        keys.push(`${run}V`, `${run}l`, `${run}t`, `${run}x`, `${run}z`);
      }
      return keys.slice(0, count);
    };

    it('carries on from every stored tail, in order', () => {
      for (const tail of oldAppends(60)) {
        let cursor = tail;
        for (let i = 0; i < 100; i += 1) {
          const later = between(cursor, null);
          expect(later > cursor).toBe(true);
          expect(isValidKey(later)).toBe(true);
          cursor = later;
        }
      }
    });

    it('stops a stored list growing, though it cannot make it shorter', () => {
      // Nothing sorts above a run of the top digit without starting with it, so
      // a long list keeps its prefix. It gains a few digits and then no more.
      const tail = oldAppends(5_000).at(-1)!;
      expect(tail).toHaveLength(1_000);

      let cursor = tail;
      for (let i = 0; i < 20_000; i += 1) {
        cursor = between(cursor, null);
      }
      expect(cursor.length).toBeLessThanOrEqual(tail.length + 4);
      expect(cursor.startsWith(tail)).toBe(true);
    });

    it('stays in order when an older build appends to the same list', () => {
      // An older build reads a counter key as any other and bisects above it,
      // which still sorts after its bound. Whichever wrote the last key, the next
      // one follows it.
      const list = ['z', 'za1', 'za2', 'zn'];
      for (let i = 0; i < 10; i += 1) list.push(between(list.at(-1)!, null));

      expect([...list].sort()).toEqual(list);
      expect(new Set(list).size).toBe(list.length);
    });

    it('treats a stored key that only looks like a counter as one, harmlessly', () => {
      expect(between('za5', null)).toBe('za6');
      expect(between('zl123456789012', null)).toBe('zl123456789013');
    });

    it('clears what an insert left after the digits', () => {
      expect(between('zb05V', null)).toBe('zb06');
    });

    it('does not read a head with too few digits as a counter', () => {
      expect(between('za', null)).toBe('zn');
      expect(between('zb1', null)).toBe('zo');
      expect(between('zV', null)).toBe('zl');
    });

    it('leaves room between the keys it mints', () => {
      expect(between('za1', 'za2')).toBe('za1V');
      expect(between('zb05', 'zb06')).toBe('zb05V');
      expect(between(null, 'za1') < 'za1').toBe(true);
    });

    it('moves on rather than giving up when every counter is spent', () => {
      const spent = `zy${'z'.repeat(25)}`;
      const later = between(spent, null);
      expect(later).toBe('zza1');
      expect(later > spent).toBe(true);
    });

    it('follows any valid key with a valid key', () => {
      let seed = 20261102;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

      for (let i = 0; i < 20_000; i += 1) {
        let key = 'z'.repeat(Math.floor(random() * 4));
        if (random() < 0.5) key += String.fromCharCode(97 + Math.floor(random() * 25));
        const length = 1 + Math.floor(random() * 12);
        for (let digit = 0; digit < length; digit += 1) {
          key += ALPHABET[Math.floor(random() * ALPHABET.length)];
        }
        key = key.replace(/0+$/, '');
        if (!isValidKey(key)) continue;

        const later = between(key, null);
        expect(later > key).toBe(true);
        expect(isValidKey(later)).toBe(true);
      }
    });

    it('still refuses a malformed last key, counter or not', () => {
      expect(() => between('zb0', null)).toThrow(OrderingError);
      expect(() => between('za~', null)).toThrow(OrderingError);
      expect(() => between('z ', null)).toThrow(OrderingError);
    });
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
