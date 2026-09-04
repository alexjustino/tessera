import { describe, expect, it } from 'vitest';

import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import { capacityOf, dayLoad, LEVELS, levelOf, plannedByDay, weekOf, yearOf } from './capacity';

const ZONE = 'America/Sao_Paulo'; // UTC−3, no daylight saving since 2019
const NEW_YORK = 'America/New_York'; // still changes its clocks

/** Nine to six, Monday to Friday: what migration 007 seeds. */
const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 540,
  endsMinute: 1080,
}));

/** An instant at a local wall-clock time in São Paulo. */
const at = (day: string, hour: number, minute = 0): string =>
  new Date(
    `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`,
  ).toISOString();

const event = (id: string, allDay = false): CalendarEvent => ({
  id,
  calendarId: 'personal',
  title: id,
  startsAt: '',
  endsAt: '',
  tz: ZONE,
  allDay,
  rrule: null,
  color: null,
  itemId: null,
});

const block = (id: string, startsAt: string, endsAt: string, allDay = false): Occurrence => ({
  event: { ...event(id, allDay), startsAt, endsAt },
  originalStart: startsAt,
  startsAt,
  endsAt,
});

describe('capacity', () => {
  it('is the working span on a working day and nothing on a day off', () => {
    expect(capacityOf('2026-09-07', HOURS)).toBe(540); // Monday
    expect(capacityOf('2026-09-12', HOURS)).toBe(0); // Saturday
    expect(capacityOf('2026-09-07', [])).toBe(0);
  });
});

describe('what is planned', () => {
  it('adds up the timed occurrences on a day', () => {
    const planned = plannedByDay(
      [
        block('a', at('2026-09-07', 9), at('2026-09-07', 10, 30)),
        block('b', at('2026-09-07', 14), at('2026-09-07', 15)),
      ],
      ZONE,
    );
    expect(planned.get('2026-09-07')).toBe(150);
  });

  it('leaves all-day events out: a birthday does not use up a working day', () => {
    const planned = plannedByDay(
      [block('holiday', at('2026-09-07', 0), at('2026-09-08', 0), true)],
      ZONE,
    );
    expect(planned.size).toBe(0);
  });

  it('loads both days when a block crosses midnight', () => {
    const planned = plannedByDay([block('late', at('2026-09-07', 22), at('2026-09-08', 1))], ZONE);
    expect(planned.get('2026-09-07')).toBe(120);
    expect(planned.get('2026-09-08')).toBe(60);
  });

  it('splits at the midnight the zone has, not at twenty-four hours', () => {
    // The clocks go back in New York on 1 November 2026: that day is 25 hours.
    const wholeDay = block(
      'long',
      new Date('2026-11-01T04:00:00Z').toISOString(), // local midnight, EDT
      new Date('2026-11-02T05:00:00Z').toISOString(), // local midnight, EST
    );
    const planned = plannedByDay([wholeDay], NEW_YORK);
    expect(planned.get('2026-11-01')).toBe(25 * 60);
    expect(planned.has('2026-11-02')).toBe(false);
  });

  it('is empty when nothing is reserved', () => {
    expect(plannedByDay([], ZONE).size).toBe(0);
  });
});

describe('the level', () => {
  it('is a word for each quarter, and a distinct one past the whole day', () => {
    expect(levelOf(0, 540)).toBe('free');
    expect(levelOf(135, 540)).toBe('light'); // exactly a quarter
    expect(levelOf(136, 540)).toBe('half');
    expect(levelOf(270, 540)).toBe('half');
    expect(levelOf(405, 540)).toBe('busy');
    expect(levelOf(540, 540)).toBe('full');
    expect(levelOf(541, 540)).toBe('over');
  });

  it('calls a day off "off", unless something was reserved on it anyway', () => {
    expect(levelOf(0, 0)).toBe('off');
    expect(levelOf(30, 0)).toBe('over');
  });

  it('has a label for every level, so a legend can be built from the list', () => {
    const ids = LEVELS.map((level) => level.id);
    expect(ids).toEqual(['off', 'free', 'light', 'half', 'busy', 'full', 'over']);
    for (const level of LEVELS) expect(level.label.length).toBeGreaterThan(0);
  });
});

describe('a year', () => {
  it('has twelve months and every day of each', () => {
    const year = yearOf(2026, [], HOURS, ZONE);
    expect(year.months).toHaveLength(12);
    expect(year.months.map((month) => month.days.length)).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(year.months[0]!.month).toBe('2026-01');
    expect(year.months[11]!.days.at(-1)!.day).toBe('2026-12-31');
  });

  it('gives February its 29th in a leap year', () => {
    const leap = yearOf(2028, [], HOURS, ZONE);
    expect(leap.months[1]!.days).toHaveLength(29);
    expect(leap.months.reduce((sum, month) => sum + month.days.length, 0)).toBe(366);
    // The century rule: 2100 is not a leap year, 2000 was.
    expect(yearOf(2100, [], HOURS, ZONE).months[1]!.days).toHaveLength(28);
    expect(yearOf(2000, [], HOURS, ZONE).months[1]!.days).toHaveLength(29);
  });

  it('starts each month on the week day the caller says weeks start on', () => {
    // 1 September 2026 is a Tuesday.
    const monday = yearOf(2026, [], HOURS, ZONE, 1);
    expect(monday.months[8]!.leading).toBe(1);
    const sunday = yearOf(2026, [], HOURS, ZONE, 0);
    expect(sunday.months[8]!.leading).toBe(2);
    // 1 June 2026 is a Monday: no leading cells.
    expect(monday.months[5]!.leading).toBe(0);
  });

  it('adds capacity and planned time up per month and for the year', () => {
    const occurrences = [
      block('a', at('2026-09-07', 9), at('2026-09-07', 12)),
      block('b', at('2026-09-12', 9), at('2026-09-12', 10)), // a Saturday
    ];
    const year = yearOf(2026, occurrences, HOURS, ZONE);
    const september = year.months[8]!;

    // September 2026 has 22 weekdays.
    expect(september.capacity).toBe(22 * 540);
    expect(september.planned).toBe(240);
    expect(year.planned).toBe(240);
    expect(year.capacity).toBe(year.months.reduce((sum, month) => sum + month.capacity, 0));

    const saturday = september.days.find((day) => day.day === '2026-09-12')!;
    expect(saturday.capacity).toBe(0);
    expect(saturday.level).toBe('over');
    expect(year.overloaded).toBe(1);
  });

  it('reads the working hours it is given, not a built-in week', () => {
    const fourDay: WorkHours[] = [1, 2, 3, 4].map((weekday) => ({
      weekday,
      startsMinute: 480,
      endsMinute: 1080,
    }));
    const year = yearOf(2026, [], fourDay, ZONE);
    const friday = year.months[8]!.days.find((day) => day.day === '2026-09-11')!;
    const thursday = year.months[8]!.days.find((day) => day.day === '2026-09-10')!;
    expect(friday.level).toBe('off');
    expect(thursday.capacity).toBe(600);
  });
});

describe('one day', () => {
  it('answers with the same words the year does', () => {
    const occurrences = [block('a', at('2026-09-07', 9), at('2026-09-07', 18))];
    expect(dayLoad('2026-09-07', occurrences, HOURS, ZONE)).toEqual({
      day: '2026-09-07',
      capacity: 540,
      planned: 540,
      level: 'full',
    });
  });
});

describe('the week around a day', () => {
  it('runs from the first day of the week the caller uses', () => {
    expect(weekOf('2026-09-09', 1)).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(weekOf('2026-09-09', 0)[0]).toBe('2026-09-06');
  });
});
