import { describe, expect, it } from 'vitest';

import {
  against,
  elapsedClock,
  isRunning,
  minutesByDay,
  minutesForItem,
  minutesOf,
  minutesOnDay,
  runningEntry,
  splitByLocalDay,
  type Entry,
} from './time';

const ZONE = 'America/Sao_Paulo'; // UTC−3, no daylight saving since 2019
const NEW_YORK = 'America/New_York'; // still changes its clocks

/** An instant at a local wall-clock time in São Paulo. */
const at = (day: string, hour: number, minute = 0): string =>
  new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`,
  ).toISOString();

const entry = (id: string, startedAt: string, endedAt: string | null = null): Entry => ({
  id,
  itemId: 'task',
  startedAt,
  endedAt,
});

const NOW = at('2026-09-08', 12);

describe('one entry', () => {
  it('lasts from its start to its end', () => {
    expect(minutesOf(entry('a', at('2026-09-07', 9), at('2026-09-07', 10, 30)), NOW)).toBe(90);
  });

  it('is measured to now while it runs', () => {
    expect(minutesOf(entry('a', at('2026-09-08', 11, 30)), NOW)).toBe(30);
    expect(isRunning(entry('a', at('2026-09-08', 11)))).toBe(true);
    expect(isRunning(entry('a', at('2026-09-08', 11), at('2026-09-08', 12)))).toBe(false);
  });

  it('is zero rather than negative when the clock disagrees', () => {
    expect(minutesOf(entry('a', at('2026-09-07', 10), at('2026-09-07', 9)), NOW)).toBe(0);
    expect(minutesOf(entry('a', 'not a date'), NOW)).toBe(0);
    // A running entry started in the future — a clock that moved backwards.
    expect(minutesOf(entry('a', at('2026-09-09', 9)), NOW)).toBe(0);
  });

  it('finds the one that is running, and storage allows only one', () => {
    const entries = [
      entry('done', at('2026-09-07', 9), at('2026-09-07', 10)),
      entry('live', at('2026-09-08', 11)),
    ];
    expect(runningEntry(entries)?.id).toBe('live');
    expect(runningEntry([entries[0]!])).toBeNull();
    expect(runningEntry([])).toBeNull();
  });
});

describe('crossing midnight', () => {
  it('divides between the two days it touches', () => {
    // 22:00 to 01:30: two hours on the seventh, ninety minutes on the eighth.
    const overnight = entry('a', at('2026-09-07', 22), at('2026-09-08', 1, 30));
    expect(splitByLocalDay(overnight, ZONE, NOW)).toEqual([
      { day: '2026-09-07', minutes: 120 },
      { day: '2026-09-08', minutes: 90 },
    ]);
  });

  it('divides across as many days as it spans', () => {
    const marathon = entry('a', at('2026-09-06', 23), at('2026-09-09', 1));
    const shares = splitByLocalDay(marathon, ZONE, NOW);
    expect(shares.map((share) => share.day)).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ]);
    expect(shares[0]!.minutes).toBe(60);
    expect(shares[1]!.minutes).toBe(24 * 60);
    expect(shares[3]!.minutes).toBe(60);
    // The parts add up to the whole.
    expect(shares.reduce((sum, share) => sum + share.minutes, 0)).toBe(minutesOf(marathon, NOW));
  });

  it('is one share for the ordinary case', () => {
    const shares = splitByLocalDay(
      entry('a', at('2026-09-07', 9), at('2026-09-07', 17)),
      ZONE,
      NOW,
    );
    expect(shares).toEqual([{ day: '2026-09-07', minutes: 480 }]);
  });

  it('splits a running entry at midnight too', () => {
    // Started last night, still going at noon today.
    const running = entry('a', at('2026-09-07', 23));
    const shares = splitByLocalDay(running, ZONE, NOW);
    expect(shares).toEqual([
      { day: '2026-09-07', minutes: 60 },
      { day: '2026-09-08', minutes: 12 * 60 },
    ]);
  });

  it('is empty when there is nothing to divide', () => {
    expect(splitByLocalDay(entry('a', NOW, NOW), ZONE, NOW)).toEqual([]);
    expect(splitByLocalDay(entry('a', 'rubbish', NOW), ZONE, NOW)).toEqual([]);
  });

  it('the day the clocks go back really is twenty-five hours', () => {
    // New York returns to standard time at 02:00 on 1 November 2026.
    const wholeDay = entry(
      'a',
      new Date('2026-11-01T04:00:00Z').toISOString(), // midnight, still EDT
      new Date('2026-11-02T05:00:00Z').toISOString(), // midnight, now EST
    );
    const shares = splitByLocalDay(wholeDay, NEW_YORK, NOW);
    expect(shares).toHaveLength(1);
    expect(shares[0]!.day).toBe('2026-11-01');
    expect(shares[0]!.minutes).toBe(25 * 60);
  });

  it('and the day they go forward is twenty-three', () => {
    // The clocks jump forward at 02:00 on 8 March 2026.
    const wholeDay = entry(
      'a',
      new Date('2026-03-08T05:00:00Z').toISOString(), // midnight EST
      new Date('2026-03-09T04:00:00Z').toISOString(), // midnight EDT
    );
    const shares = splitByLocalDay(wholeDay, NEW_YORK, NOW);
    expect(shares).toHaveLength(1);
    expect(shares[0]!.minutes).toBe(23 * 60);
  });
});

describe('totals', () => {
  const entries: Entry[] = [
    { id: '1', itemId: 'a', startedAt: at('2026-09-07', 9), endedAt: at('2026-09-07', 11) },
    { id: '2', itemId: 'a', startedAt: at('2026-09-08', 9), endedAt: at('2026-09-08', 9, 30) },
    { id: '3', itemId: 'b', startedAt: at('2026-09-07', 14), endedAt: at('2026-09-07', 15) },
    // Crosses midnight, so it lands on two days.
    { id: '4', itemId: 'b', startedAt: at('2026-09-07', 23), endedAt: at('2026-09-08', 0, 30) },
  ];

  it('add up per task', () => {
    expect(minutesForItem(entries, 'a', NOW)).toBe(150);
    expect(minutesForItem(entries, 'b', NOW)).toBe(150);
    expect(minutesForItem(entries, 'nobody', NOW)).toBe(0);
  });

  it('add up per day, with the overnight entry counted where it happened', () => {
    expect(minutesByDay(entries, ZONE, NOW)).toEqual([
      { day: '2026-09-07', minutes: 120 + 60 + 60 },
      { day: '2026-09-08', minutes: 30 + 30 },
    ]);
    expect(minutesOnDay(entries, '2026-09-07', ZONE, NOW)).toBe(240);
    expect(minutesOnDay(entries, '2026-09-08', ZONE, NOW)).toBe(60);
    expect(minutesOnDay(entries, '2026-09-09', ZONE, NOW)).toBe(0);
  });

  it('leave a day with nothing tracked out rather than reporting a zero', () => {
    const days = minutesByDay(entries, ZONE, NOW).map((share) => share.day);
    expect(days).not.toContain('2026-09-06');
  });

  it('are nothing at all when there is nothing', () => {
    expect(minutesByDay([], ZONE, NOW)).toEqual([]);
    expect(minutesForItem([], 'a', NOW)).toBe(0);
  });
});

describe('the running clock', () => {
  it('counts seconds, and hours only once there are any', () => {
    expect(elapsedClock(entry('a', at('2026-09-08', 11, 59)), at('2026-09-08', 12))).toBe('1:00');
    expect(elapsedClock(entry('a', at('2026-09-08', 11)), at('2026-09-08', 12))).toBe('1:00:00');
    expect(
      elapsedClock(
        { id: 'a', itemId: 'x', startedAt: at('2026-09-08', 11), endedAt: null },
        new Date(Date.parse(at('2026-09-08', 12)) + 9_000).toISOString(),
      ),
    ).toBe('1:00:09');
  });

  it('never runs backwards', () => {
    expect(elapsedClock(entry('a', at('2026-09-09', 9)), NOW)).toBe('0:00');
  });
});

describe('against the estimate', () => {
  it('says how far over or under', () => {
    expect(against(150, 120)).toEqual({ overBy: 30, ratio: 1.25 });
    expect(against(60, 120)).toEqual({ overBy: -60, ratio: 0.5 });
  });

  it('is nothing when there is no estimate to compare against', () => {
    expect(against(150, null)).toBeNull();
    expect(against(150, 0)).toBeNull();
  });
});
