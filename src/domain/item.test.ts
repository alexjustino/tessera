import { describe, expect, it } from 'vitest';

import { isValidKey } from './ordering';
import {
  checkTitle,
  isCompleted,
  MAX_TITLE_LENGTH,
  partitionByCompletion,
  positionForMove,
  positionForNewItem,
  sortItems,
  type Item,
} from './item';

function item(overrides: Partial<Item> & Pick<Item, 'id' | 'position'>): Item {
  return {
    collectionId: 'tasks',
    parentItemId: null,
    title: overrides.id,
    completedAt: null,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
    ...overrides,
  };
}

describe('checkTitle', () => {
  it('accepts an ordinary title', () => {
    expect(checkTitle('Review the contract')).toEqual({
      status: 'ok',
      title: 'Review the contract',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(checkTitle('   padded   ')).toEqual({ status: 'ok', title: 'padded' });
  });

  it('collapses internal whitespace, including newlines', () => {
    // A title pasted out of a document arrives with newlines in it. A list row
    // that silently grows to three lines is a worse surprise than a tidied one.
    expect(checkTitle('call\nthe\t\tplumber')).toEqual({
      status: 'ok',
      title: 'call the plumber',
    });
  });

  it('reports an empty input as empty, not as an error', () => {
    // An empty box is an ordinary state of the world; the interface must be able
    // to tell "not ready yet" apart from "you typed something wrong".
    expect(checkTitle('')).toEqual({ status: 'empty' });
    expect(checkTitle('    ')).toEqual({ status: 'empty' });
    expect(checkTitle('\n\t  \r')).toEqual({ status: 'empty' });
  });

  it('reports a title that is too long, with its length', () => {
    const long = 'a'.repeat(MAX_TITLE_LENGTH + 1);
    expect(checkTitle(long)).toEqual({ status: 'too-long', length: MAX_TITLE_LENGTH + 1 });
  });

  it('accepts a title exactly at the limit', () => {
    const exact = 'a'.repeat(MAX_TITLE_LENGTH);
    expect(checkTitle(exact)).toEqual({ status: 'ok', title: exact });
  });

  it('keeps accents and non-Latin scripts intact', () => {
    expect(checkTitle('Revisão da cláusula')).toEqual({
      status: 'ok',
      title: 'Revisão da cláusula',
    });
    expect(checkTitle('会議の準備')).toEqual({ status: 'ok', title: '会議の準備' });
  });
});

describe('sortItems', () => {
  it('orders by the fractional key, not by insertion', () => {
    const items = [item({ id: 'c', position: 'c' }), item({ id: 'a', position: 'a' })];
    expect(sortItems(items).map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('does not mutate its input', () => {
    const items = [item({ id: 'c', position: 'c' }), item({ id: 'a', position: 'a' })];
    const before = [...items];
    sortItems(items);
    expect(items).toEqual(before);
  });
});

describe('positionForNewItem', () => {
  it('produces a valid key for an empty list', () => {
    const position = positionForNewItem([]);
    expect(isValidKey(position)).toBe(true);
  });

  it('appends after the last item', () => {
    const existing = [item({ id: 'a', position: 'a' }), item({ id: 'b', position: 'b' })];
    const position = positionForNewItem(existing);
    expect(position > 'b').toBe(true);
  });

  it('appends after the last item even when the list arrives unsorted', () => {
    // A list that arrived unsorted would otherwise place the new item in the
    // middle, and nobody would notice until the order looked wrong.
    const scrambled = [
      item({ id: 'b', position: 'b' }),
      item({ id: 'z', position: 'z' }),
      item({ id: 'a', position: 'a' }),
    ];
    expect(positionForNewItem(scrambled) > 'z').toBe(true);
  });

  it('keeps producing ascending keys when called repeatedly', () => {
    const items: Item[] = [];
    for (let index = 0; index < 100; index += 1) {
      const position = positionForNewItem(items);
      items.push(item({ id: `i${index}`, position }));
    }
    const positions = items.map((i) => i.position);
    expect([...positions].sort()).toEqual(positions);
    expect(new Set(positions).size).toBe(100);
  });
});

describe('positionForMove', () => {
  const ordered = [
    item({ id: 'a', position: 'a' }),
    item({ id: 'b', position: 'b' }),
    item({ id: 'c', position: 'c' }),
  ];

  it('places an item at the head', () => {
    expect(positionForMove(ordered, 0) < 'a').toBe(true);
  });

  it('places an item between two others', () => {
    const position = positionForMove(ordered, 2);
    expect(position > 'b').toBe(true);
    expect(position < 'c').toBe(true);
  });

  it('places an item at the tail', () => {
    expect(positionForMove(ordered, ordered.length) > 'c').toBe(true);
  });

  it('handles an empty list', () => {
    expect(isValidKey(positionForMove([], 0))).toBe(true);
  });
});

describe('partitionByCompletion', () => {
  it('separates open from completed', () => {
    const items = [
      item({ id: 'open', position: 'a' }),
      item({ id: 'done', position: 'b', completedAt: '2026-09-01T10:00:00.000Z' }),
    ];

    const { open, completed } = partitionByCompletion(items);

    expect(open.map((i) => i.id)).toEqual(['open']);
    expect(completed.map((i) => i.id)).toEqual(['done']);
  });

  it('keeps open items in key order', () => {
    const items = [item({ id: 'second', position: 'b' }), item({ id: 'first', position: 'a' })];
    expect(partitionByCompletion(items).open.map((i) => i.id)).toEqual(['first', 'second']);
  });

  it('orders completed items most recently finished first', () => {
    // The order of completed work is chronological, not positional: what you
    // just ticked should be at the top, where you can undo it.
    const items = [
      item({ id: 'older', position: 'a', completedAt: '2026-09-01T09:00:00.000Z' }),
      item({ id: 'newer', position: 'b', completedAt: '2026-09-02T09:00:00.000Z' }),
    ];
    expect(partitionByCompletion(items).completed.map((i) => i.id)).toEqual(['newer', 'older']);
  });

  it('handles a list with nothing in it', () => {
    expect(partitionByCompletion([])).toEqual({ open: [], completed: [] });
  });
});

describe('isCompleted', () => {
  it('is driven by the timestamp, not by a separate flag', () => {
    expect(isCompleted(item({ id: 'a', position: 'a' }))).toBe(false);
    expect(
      isCompleted(item({ id: 'a', position: 'a', completedAt: '2026-09-01T09:00:00.000Z' })),
    ).toBe(true);
  });
});
