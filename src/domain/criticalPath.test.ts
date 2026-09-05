import { describe, expect, it } from 'vitest';

import { formatDuration, hasCycle, parseDuration, plan, type Planned } from './criticalPath';
import type { Edge } from './graph';

const edge = (blockerId: string, blockedId: string): Edge => ({ blockerId, blockedId });
const task = (id: string, estimateMinutes: number | null, isMilestone = false): Planned => ({
  id,
  estimateMinutes,
  isMilestone,
});

/**
 * The graph the tests reason about, drawn so a person can check the answers by
 * hand — which is the proof of done this slice was given.
 *
 *              ┌── b (2h) ──┐
 *   a (1h) ────┤            ├──── d (1h)
 *              └── c (30m) ─┘
 *
 * a→b→d is 4h. a→c→d is 2h30m. So the project takes 4h, a, b and d are
 * critical, and c has 90 minutes of slack.
 */
const DIAMOND: Planned[] = [task('a', 60), task('b', 120), task('c', 30), task('d', 60)];
const DIAMOND_EDGES = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];

describe('the plan on a graph you can check by hand', () => {
  const result = plan(DIAMOND, DIAMOND_EDGES);

  it('takes as long as its longest route', () => {
    expect(result.durationMinutes).toBe(240);
    expect(result.unplanned).toBe(false);
    expect(result.cyclic).toBe(false);
  });

  it('starts each task when everything blocking it has finished', () => {
    expect(result.timing.get('a')!.earliestStart).toBe(0);
    expect(result.timing.get('b')!.earliestStart).toBe(60);
    expect(result.timing.get('c')!.earliestStart).toBe(60);
    // d waits for the slower of the two, not for c.
    expect(result.timing.get('d')!.earliestStart).toBe(180);
    expect(result.timing.get('d')!.earliestFinish).toBe(240);
  });

  it('gives the short branch exactly the slack the long one costs it', () => {
    expect(result.timing.get('c')!.slack).toBe(90);
    expect(result.timing.get('c')!.latestStart).toBe(150);
    expect(result.timing.get('c')!.critical).toBe(false);
  });

  it('marks only what decides the end', () => {
    expect([...result.critical].sort()).toEqual(['a', 'b', 'd']);
    expect(result.timing.get('a')!.slack).toBe(0);
    expect(result.timing.get('b')!.slack).toBe(0);
  });

  it('reports the path as a chain in order, not a bag of ids', () => {
    expect(result.longestChain).toEqual(['a', 'b', 'd']);
  });
});

describe('what the number is worth', () => {
  it('says when nothing was estimated, rather than calling everything critical', () => {
    // Every duration is zero, so every task has zero slack. A naive reading
    // marks the whole workspace critical and means nothing by it.
    const result = plan([task('a', null), task('b', null)], [edge('a', 'b')]);
    expect(result.unplanned).toBe(true);
    expect(result.durationMinutes).toBe(0);
    expect(result.longestChain).toEqual([]);
    expect(result.unestimatedOnPath).toEqual([]);
    expect(result.estimatedCount).toBe(0);
  });

  it('names the holes when some of the path is unestimated', () => {
    // a and c are estimated; b is not, and is on the path.
    const result = plan(
      [task('a', 60), task('b', null), task('c', 60)],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect(result.durationMinutes).toBe(120);
    expect(result.estimatedCount).toBe(2);
    expect(result.unestimatedOnPath).toEqual(['b']);
  });

  it('does not count a milestone as a hole: it is meant to take no time', () => {
    const result = plan(
      [task('a', 60), task('gate', null, true), task('c', 60)],
      [edge('a', 'gate'), edge('gate', 'c')],
    );
    expect(result.durationMinutes).toBe(120);
    expect(result.timing.get('gate')!.durationMinutes).toBe(0);
    expect(result.unestimatedOnPath).toEqual([]);
  });

  it('a milestone with an estimate is still zero: the flag wins', () => {
    const result = plan([task('gate', 999, true)], []);
    expect(result.timing.get('gate')!.durationMinutes).toBe(0);
    expect(result.durationMinutes).toBe(0);
  });
});

describe('shapes that are not a diamond', () => {
  it('a straight chain is entirely critical', () => {
    const result = plan(
      [task('a', 60), task('b', 60), task('c', 60)],
      [edge('a', 'b'), edge('b', 'c')],
    );
    expect(result.durationMinutes).toBe(180);
    expect(result.longestChain).toEqual(['a', 'b', 'c']);
    expect(result.critical.size).toBe(3);
  });

  it('unconnected work runs in parallel, and only the longest is critical', () => {
    const result = plan([task('long', 120), task('short', 30)], []);
    expect(result.durationMinutes).toBe(120);
    expect([...result.critical]).toEqual(['long']);
    expect(result.timing.get('short')!.slack).toBe(90);
  });

  it('two independent chains of the same length are both critical', () => {
    const result = plan(
      [task('a', 60), task('b', 60), task('x', 60), task('y', 60)],
      [edge('a', 'b'), edge('x', 'y')],
    );
    expect(result.durationMinutes).toBe(120);
    expect([...result.critical].sort()).toEqual(['a', 'b', 'x', 'y']);
    // The chain returned is one real path, not the four ids run together.
    expect(result.longestChain).toHaveLength(2);
    expect(result.longestChain).toEqual(['a', 'b']);
  });

  it('a single task is its own critical path', () => {
    const result = plan([task('only', 45)], []);
    expect(result.durationMinutes).toBe(45);
    expect(result.longestChain).toEqual(['only']);
  });

  it('an empty plan is empty rather than an error', () => {
    const result = plan([], []);
    expect(result.durationMinutes).toBe(0);
    expect(result.timing.size).toBe(0);
    expect(result.unplanned).toBe(true);
  });
});

describe('edges that point elsewhere', () => {
  it('are ignored, so one collection can be planned without the rest leaking in', () => {
    const result = plan(
      [task('a', 60), task('b', 60)],
      [edge('a', 'b'), edge('outside', 'a'), edge('b', 'outside')],
    );
    expect(result.durationMinutes).toBe(120);
    expect(result.timing.get('a')!.earliestStart).toBe(0);
    expect(result.timing.size).toBe(2);
  });
});

describe('a graph that should not exist', () => {
  it('is reported rather than trusted', () => {
    const looped = [edge('a', 'b'), edge('b', 'a')];
    expect(hasCycle(['a', 'b'], looped)).toBe(true);
    expect(hasCycle(['a', 'b'], [edge('a', 'b')])).toBe(false);

    const result = plan([task('a', 60), task('b', 60)], looped);
    expect(result.cyclic).toBe(true);
    // It still returns something for everything, rather than hanging or
    // dropping tasks a view would then fail to draw.
    expect(result.timing.size).toBe(2);
  });
});

describe('formatDuration', () => {
  it('says what a person would say', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(150)).toBe('2h 30m');
    expect(formatDuration(480)).toBe('1d');
    expect(formatDuration(510)).toBe('1d 30m');
    expect(formatDuration(1000)).toBe('2d 40m');
  });

  it('is zero, not empty, for nothing', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-5)).toBe('0m');
  });

  it('takes the length of a working day from the caller', () => {
    expect(formatDuration(360, 6)).toBe('1d');
    expect(formatDuration(360, 8)).toBe('6h');
  });
});

describe('parseDuration', () => {
  it('reads what a person would type', () => {
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('2h 30m')).toBe(150);
    expect(parseDuration('1d')).toBe(480);
    expect(parseDuration('1d 2h 30m')).toBe(630);
    expect(parseDuration('  3H  ')).toBe(180);
  });

  it('reads a bare number as minutes, which is the unit of the field', () => {
    expect(parseDuration('30')).toBe(30);
    expect(parseDuration('0')).toBe(0);
  });

  it('returns null rather than guessing', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('   ')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('2 weeks')).toBeNull();
    expect(parseDuration('2h and a bit')).toBeNull();
    expect(parseDuration('-30')).toBeNull();
  });

  it('round-trips with formatDuration', () => {
    for (const minutes of [45, 120, 150, 480, 630]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });

  it('takes the length of a working day from the caller, like its opposite', () => {
    expect(parseDuration('1d', 6)).toBe(360);
  });
});
