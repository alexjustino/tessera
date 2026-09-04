import { describe, expect, it } from 'vitest';

import {
  blockedBy,
  blockersOf,
  cycleFrom,
  describeCycle,
  isBlocked,
  reachableFrom,
  readyToStart,
  topologicalOrder,
  wouldCycle,
  type Edge,
} from './graph';

const edge = (blockerId: string, blockedId: string): Edge => ({ blockerId, blockedId });

/** design → build → test → ship, a straight chain. */
const chain = [edge('design', 'build'), edge('build', 'test'), edge('test', 'ship')];

describe('reading the graph', () => {
  it('says what blocks a task and what waits on it', () => {
    expect(blockersOf(chain, 'test')).toEqual(['build']);
    expect(blockedBy(chain, 'build')).toEqual(['test']);
    expect(blockersOf(chain, 'design')).toEqual([]);
    expect(blockedBy(chain, 'ship')).toEqual([]);
  });

  it('follows the arrows to the end', () => {
    expect([...reachableFrom(chain, 'design')].sort()).toEqual(['build', 'ship', 'test']);
    expect([...reachableFrom(chain, 'test')]).toEqual(['ship']);
    expect([...reachableFrom(chain, 'ship')]).toEqual([]);
    expect([...reachableFrom(chain, 'nobody')]).toEqual([]);
  });

  it('visits a diamond once', () => {
    const diamond = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];
    expect([...reachableFrom(diamond, 'a')].sort()).toEqual(['b', 'c', 'd']);
  });

  it('terminates on a graph that already holds a cycle', () => {
    // Storage refuses these; a corrupted file could still carry one, and a
    // screen that hangs is worse than a screen that draws something odd.
    const looped = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    expect([...reachableFrom(looped, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('refusing a cycle', () => {
  it('names the chain the new edge would close', () => {
    // ship → design would mean design waits on ship, which waits on design.
    expect(cycleFrom(chain, 'ship', 'design')).toEqual([
      'design',
      'build',
      'test',
      'ship',
      'design',
    ]);
    expect(wouldCycle(chain, 'ship', 'design')).toBe(true);
  });

  it('refuses a task blocking itself', () => {
    expect(cycleFrom(chain, 'build', 'build')).toEqual(['build', 'build']);
    expect(wouldCycle([], 'alone', 'alone')).toBe(true);
  });

  it('allows an edge that only shortens an existing route', () => {
    // design already reaches ship through build and test; saying so directly
    // is redundant, not circular.
    expect(cycleFrom(chain, 'design', 'ship')).toBeNull();
    expect(wouldCycle(chain, 'design', 'ship')).toBe(false);
  });

  it('allows an edge into a branch that never comes back', () => {
    expect(wouldCycle(chain, 'ship', 'party')).toBe(false);
    expect(wouldCycle(chain, 'unrelated', 'build')).toBe(false);
  });

  it('finds the shortest chain when there are two ways round', () => {
    const two = [edge('a', 'b'), edge('b', 'z'), edge('a', 'z')];
    // a already reaches z twice over, so saying it again is redundant, not
    // circular. It is the reverse that closes the loop, and the message takes
    // the short way round rather than through b.
    expect(cycleFrom(two, 'a', 'z')).toBeNull();
    expect(cycleFrom(two, 'z', 'a')).toEqual(['a', 'z', 'a']);
  });

  it('reads as a sentence a person can act on', () => {
    const titles: Record<string, string> = {
      design: 'Ship it',
      build: 'Test it',
      test: 'Fix it',
    };
    expect(describeCycle(['design', 'build', 'test', 'design'], (id) => titles[id] ?? '')).toBe(
      'Ship it → Test it → Fix it → Ship it',
    );
    expect(describeCycle(['ghost'], () => '')).toBe('Untitled');
  });
});

describe('what is waiting and what can start', () => {
  const none = () => false;

  it('a task is blocked while any blocker is unfinished', () => {
    expect(isBlocked(chain, 'build', none)).toBe(true);
    expect(isBlocked(chain, 'design', none)).toBe(false);
    expect(isBlocked(chain, 'build', (id) => id === 'design')).toBe(false);
  });

  it('what can be started is what nothing unfinished is holding', () => {
    const ids = ['design', 'build', 'test', 'ship'];
    expect(readyToStart(ids, chain, none)).toEqual(['design']);
    expect(readyToStart(ids, chain, (id) => id === 'design')).toEqual(['build']);
    expect(readyToStart(ids, chain, (id) => id !== 'ship')).toEqual(['ship']);
    expect(readyToStart(ids, chain, () => true)).toEqual([]);
  });

  it('a task with no dependencies at all is always ready', () => {
    expect(readyToStart(['alone'], [], none)).toEqual(['alone']);
  });
});

describe('ordering', () => {
  it('puts every task after everything blocking it', () => {
    expect(topologicalOrder(['ship', 'test', 'build', 'design'], chain)).toEqual([
      'design',
      'build',
      'test',
      'ship',
    ]);
  });

  it('keeps the original order between tasks that do not block each other', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(topologicalOrder(ids, [])).toEqual(ids);
    // Only c → a is stated; b and d keep their places relative to the rest.
    expect(topologicalOrder(ids, [edge('c', 'a')])).toEqual(['b', 'c', 'a', 'd']);
  });

  it('ignores edges that point outside the list it was given', () => {
    expect(topologicalOrder(['build', 'test'], chain)).toEqual(['build', 'test']);
  });

  it('still returns everything when a cycle is present', () => {
    const looped = [edge('a', 'b'), edge('b', 'a'), edge('c', 'd')];
    const ordered = topologicalOrder(['a', 'b', 'c', 'd'], looped);
    expect(ordered.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is stable: the same input gives the same order', () => {
    const ids = ['ship', 'test', 'build', 'design'];
    expect(topologicalOrder(ids, chain)).toEqual(topologicalOrder(ids, chain));
  });
});
