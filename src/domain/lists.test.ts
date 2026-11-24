import { describe, expect, it } from 'vitest';

import type { Collection, Item } from './item';
import { checkListName, INBOX, openByList, orderedLists, positionForNewList } from './lists';

const list = (id: string, name: string, position: string): Collection => ({
  id,
  name,
  icon: null,
  color: null,
  position,
});

const LISTS = [list(INBOX, 'Tasks', 'V'), list('w', 'Work', 'W')];

let next = 0;
const item = (collectionId: string, over: Partial<Item> = {}): Item =>
  ({
    id: `i${(next += 1)}`,
    collectionId,
    completedAt: null,
    parentItemId: null,
    ...over,
  }) as Item;

describe('a list name', () => {
  it('is taken trimmed', () => {
    expect(checkListName('  Home  ', LISTS)).toEqual({ status: 'ok', name: 'Home' });
  });

  it('may stay what it is when renaming', () => {
    expect(checkListName('Work', LISTS, 'w')).toEqual({ status: 'ok', name: 'Work' });
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('cannot be empty', () => {
    expect(checkListName('   ', LISTS).status).toBe('invalid');
  });

  it('cannot be another list’s, whatever its case', () => {
    expect(checkListName('work', LISTS)).toEqual({
      status: 'invalid',
      reason: 'There is already a list with that name.',
    });
    expect(checkListName('TASKS', LISTS).status).toBe('invalid');
  });

  it('cannot be longer than sixty characters', () => {
    expect(checkListName('x'.repeat(61), LISTS).status).toBe('invalid');
    expect(checkListName('x'.repeat(60), LISTS).status).toBe('ok');
  });
});

describe('the lists', () => {
  it('put a new one after the last', () => {
    const position = positionForNewList(LISTS);
    expect(position > 'W').toBe(true);
  });

  it('put Tasks first, whatever its key', () => {
    const ordered = orderedLists([list('a', 'Alpha', 'A'), list(INBOX, 'Tasks', 'V')]);
    expect(ordered.map((l) => l.id)).toEqual([INBOX, 'a']);
  });

  it('count the open tasks in each, and no subtask or finished one', () => {
    const counts = openByList([
      item(INBOX),
      item('w'),
      item('w'),
      item('w', { completedAt: 'now' }),
      item('w', { parentItemId: 'x' }),
    ]);
    expect(counts.get(INBOX)).toBe(1);
    expect(counts.get('w')).toBe(2);
  });

  it('give a first key with nothing there yet', () => {
    expect(positionForNewList([])).toBeTypeOf('string');
  });
});
