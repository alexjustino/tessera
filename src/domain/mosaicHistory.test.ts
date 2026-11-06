import { describe, expect, it } from 'vitest';

import type { WorkHours } from './calendar';
import type { Goal, GoalLink } from './goal';
import { goalsOfItem, historyOf, seriesOf } from './mosaicHistory';
import type { Entry } from './time';

const SP = 'America/Sao_Paulo';
const NOW = '2026-11-04T15:00:00.000Z'; // Wednesday
const WEEK = '2026-11-02'; // Monday

const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * 60,
  endsMinute: 17 * 60,
}));

const entry = (id: string, startedAt: string, minutes: number): Entry =>
  ({
    id,
    itemId: 'a',
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(),
  }) as Entry;

const history = (entries: Entry[], daysOff?: ReadonlySet<string>) =>
  historyOf({
    firstDay: WEEK,
    today: '2026-11-04',
    weeks: 2,
    entries,
    hours: HOURS,
    zone: SP,
    now: NOW,
    ...(daysOff === undefined ? {} : { daysOff }),
  });

describe('the weeks behind this one', () => {
  it('runs oldest first, seven days a week, ending on this week', () => {
    const weeks = history([]);
    expect(weeks.map((week) => week.firstDay)).toEqual(['2026-10-26', '2026-11-02']);
    expect(weeks[1]?.days).toHaveLength(7);
  });

  it('shades a day by how much of it had a clock running', () => {
    const weeks = history([
      entry('a', '2026-11-02T12:00:00.000Z', 60), // 1h of 8: a quarter or less
      entry('b', '2026-11-03T12:00:00.000Z', 4 * 60), // half
      entry('c', '2026-11-04T12:00:00.000Z', 7 * 60), // most
    ]);
    expect(weeks[1]?.days.slice(0, 3).map((day) => day.level)).toEqual([1, 2, 4]);
    expect(weeks[1]?.tracked).toBe(12 * 60);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves a weekend with nothing on it as a hole, not a bad day', () => {
    const sunday = history([])[1]?.days[6];
    expect(sunday?.hole).toBe(true);
    expect(sunday?.level).toBe(0);
  });

  it('counts a Saturday someone worked, with no capacity to divide by', () => {
    const saturday = history([entry('a', '2026-10-31T12:00:00.000Z', 60)])[0]?.days[5];
    expect(saturday?.hole).toBe(false);
    expect(saturday?.level).toBe(4);
  });

  it('does not call the days to come empty', () => {
    const days = history([])[1]?.days ?? [];
    expect(days.find((day) => day.day === '2026-11-04')?.future).toBe(false);
    expect(days.find((day) => day.day === '2026-11-05')?.future).toBe(true);
  });

  it('takes a day off out of the capacity', () => {
    const week = history([], new Set(['2026-11-02']))[1];
    expect(week?.capacity).toBe(4 * 8 * 60);
    expect(week?.days[0]?.hole).toBe(true);
  });
});

describe('what tells goals apart', () => {
  const goal = (id: string) => ({ id, name: id }) as Goal;

  it('gives each goal a colour in order, and it stays with the goal', () => {
    const series = seriesOf([goal('a'), goal('b')]);
    expect(series.get('a')).toBe(1);
    expect(series.get('b')).toBe(2);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('gives a seventh goal no colour rather than a hue nobody can tell apart', () => {
    const series = seriesOf(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(goal));
    expect(series.get('f')).toBe(6);
    expect(series.has('g')).toBe(false);
  });

  it('finds a task’s goals in the goals’ own order', () => {
    const links = [
      { goalId: 'b', itemId: 'x' },
      { goalId: 'a', itemId: 'x' },
      { goalId: 'a', itemId: 'y' },
    ] as GoalLink[];
    expect(goalsOfItem('x', [goal('a'), goal('b')], links).map((g) => g.id)).toEqual(['a', 'b']);
    expect(goalsOfItem('z', [goal('a')], links)).toEqual([]);
  });
});
