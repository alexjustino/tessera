import { describe, expect, it } from 'vitest';

import type { Item } from './item';
import { allDone, nextStep, progressOf, stepsFromText, subtasksByParent } from './subtasks';

const step = (id: string, position: string, over: Partial<Item> = {}): Item =>
  ({ id, title: id, position, parentItemId: 'p', completedAt: null, ...over }) as Item;

describe('the steps of a task', () => {
  it('sorts each task its own steps, in their order', () => {
    const grouped = subtasksByParent([
      step('b', 'b'),
      step('x', 'a', { parentItemId: 'q' }),
      step('a', 'a'),
    ]);
    expect(grouped.get('p')?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(grouped.get('q')?.map((s) => s.id)).toEqual(['x']);
  });

  it('counts how far along they are', () => {
    expect(progressOf([step('a', 'a', { completedAt: 'now' }), step('b', 'b')])).toEqual({
      done: 1,
      total: 2,
    });
  });

  it('finds the next one to do, in order, whichever were ticked', () => {
    expect(
      nextStep([step('c', 'c'), step('a', 'a', { completedAt: 'now' }), step('b', 'b')])?.id,
    ).toBe('b');
  });

  it('knows when they are all done', () => {
    expect(allDone([step('a', 'a', { completedAt: 'now' })])).toBe(true);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('does not call a task with no steps done', () => {
    expect(allDone([])).toBe(false);
  });

  it('does not call it done with one still open', () => {
    expect(allDone([step('a', 'a', { completedAt: 'now' }), step('b', 'b')])).toBe(false);
  });

  it('has no next step when none is left', () => {
    expect(nextStep([step('a', 'a', { completedAt: 'now' })])).toBeNull();
    expect(nextStep([])).toBeNull();
  });

  it('ignores an item with no parent', () => {
    expect(subtasksByParent([step('a', 'a', { parentItemId: null })]).size).toBe(0);
  });
});

describe('steps from pasted text', () => {
  it('takes one to a line, without the marks of the list they came from', () => {
    expect(
      stepsFromText('- first\n* second\n• third\n1. fourth\n2) fifth\n- [ ] sixth\n- [x] seventh'),
    ).toEqual(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']);
  });

  it('copes with Windows line ends and blank lines', () => {
    expect(stepsFromText('one\r\n\r\n  two  \r\n')).toEqual(['one', 'two']);
  });

  it('leaves a single line as it is', () => {
    expect(stepsFromText('Call the vendor')).toEqual(['Call the vendor']);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('does not cut a word that only starts like a mark', () => {
    expect(stepsFromText('-5 degrees test\n3.5 volts')).toEqual(['-5 degrees test', '3.5 volts']);
  });

  it('gives nothing for nothing', () => {
    expect(stepsFromText('  \n\n')).toEqual([]);
  });
});
