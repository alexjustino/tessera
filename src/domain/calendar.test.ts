import { describe, expect, it } from 'vitest';

import {
  addLocalDays,
  daysOf,
  expand,
  layoutDay,
  minutesInto,
  overlapsWindow,
  startOfWeek,
  step,
  weekdayOf,
  workingSpan,
  type CalendarEvent,
  type EventException,
  type Occurrence,
} from './calendar';

const ZONE = 'America/Sao_Paulo'; // UTC-3, no daylight saving since 2019
const DAY = '2026-09-07'; // a Monday

function event(id: string, startsAt: string, endsAt: string, over: Partial<CalendarEvent> = {}) {
  return {
    id,
    calendarId: 'personal',
    title: id,
    startsAt,
    endsAt,
    tz: ZONE,
    allDay: false,
    rrule: null,
    color: null,
    itemId: null,
    ...over,
  } satisfies CalendarEvent;
}

/** `09:00` on the test day, in São Paulo, as a UTC instant. */
function at(hour: number, minute = 0, day = DAY): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return new Date(`${day}T${pad(hour)}:${pad(minute)}:00-03:00`).toISOString();
}

function occurrence(id: string, from: number, to: number, over: Partial<CalendarEvent> = {}) {
  const startsAt = at(from);
  const endsAt = at(to);
  return {
    event: event(id, startsAt, endsAt, over),
    originalStart: startsAt,
    startsAt,
    endsAt,
  } satisfies Occurrence;
}

// ── Windows ────────────────────────────────────────────────────────────────

describe('overlapping a window', () => {
  it('is half-open at both ends', () => {
    // Without this a 09:00-10:00 meeting appears on two days.
    const from = at(9);
    const to = at(10);

    expect(overlapsWindow(at(8), from, from, to)).toBe(false);
    expect(overlapsWindow(to, at(11), from, to)).toBe(false);
    expect(overlapsWindow(at(9, 30), at(9, 45), from, to)).toBe(true);
    expect(overlapsWindow(at(8), at(9, 30), from, to)).toBe(true);
  });
});

// ── Expanding ──────────────────────────────────────────────────────────────

describe('expanding a series', () => {
  const dayStart = at(0);
  const dayEnd = at(0, 0, addLocalDays(DAY, 1));

  const weekly = event('weekly', at(9), at(10), { rrule: 'FREQ=WEEKLY' });
  /** Stands in for the recurrence engine, which is tested in schedule.test.ts. */
  const everyWeek = (subject: CalendarEvent, from: string, to: string) => {
    const starts: string[] = [];
    let cursor = new Date(subject.startsAt);
    while (cursor.toISOString() < to) {
      if (cursor.toISOString() >= from) starts.push(cursor.toISOString());
      cursor = new Date(cursor.getTime() + 7 * 24 * 3600 * 1000);
    }
    return starts;
  };

  it('returns a one-off event when it touches the window', () => {
    const single = event('single', at(9), at(10));
    const found = expand([single], [], dayStart, dayEnd, everyWeek);
    expect(found.map((o) => o.event.id)).toEqual(['single']);
  });

  it('leaves out a one-off event that does not', () => {
    const elsewhere = event('elsewhere', at(9, 0, '2026-10-01'), at(10, 0, '2026-10-01'));
    expect(expand([elsewhere], [], dayStart, dayEnd, everyWeek)).toEqual([]);
  });

  it('drops a cancelled occurrence and keeps the rest', () => {
    // "Cancel just this Tuesday" — one of the two sentences every person
    // expects a calendar to be able to say.
    const cancelled: EventException = {
      eventId: 'weekly',
      originalStart: at(9),
      kind: 'cancelled',
      startsAt: null,
      endsAt: null,
    };

    expect(expand([weekly], [cancelled], dayStart, dayEnd, everyWeek)).toEqual([]);

    const nextWeek = addLocalDays(DAY, 7);
    const later = expand(
      [weekly],
      [cancelled],
      at(0, 0, nextWeek),
      at(0, 0, addLocalDays(nextWeek, 1)),
      everyWeek,
    );
    expect(later).toHaveLength(1);
  });

  it('moves a single occurrence without moving the series', () => {
    // "Move only next Thursday to 15:00" — the other sentence.
    const moved: EventException = {
      eventId: 'weekly',
      originalStart: at(9),
      kind: 'moved',
      startsAt: at(15),
      endsAt: at(16),
    };

    const found = expand([weekly], [moved], dayStart, dayEnd, everyWeek);
    expect(found).toHaveLength(1);
    expect(found[0]!.startsAt).toBe(at(15));
    // The key it was matched on is still the original, so the exception keeps
    // applying to the right occurrence however often the series is re-expanded.
    expect(found[0]!.originalStart).toBe(at(9));
  });

  it('keeps an occurrence moved out of the window out of it', () => {
    const movedAway: EventException = {
      eventId: 'weekly',
      originalStart: at(9),
      kind: 'moved',
      startsAt: at(9, 0, '2026-10-01'),
      endsAt: at(10, 0, '2026-10-01'),
    };
    expect(expand([weekly], [movedAway], dayStart, dayEnd, everyWeek)).toEqual([]);
  });

  it('keeps the original duration when only the start was moved', () => {
    const moved: EventException = {
      eventId: 'weekly',
      originalStart: at(9),
      kind: 'moved',
      startsAt: at(15),
      endsAt: null,
    };
    const found = expand([weekly], [moved], dayStart, dayEnd, everyWeek);
    expect(found[0]!.endsAt).toBe(at(16));
  });

  it('returns occurrences in time order, whatever order the events arrived', () => {
    const later = event('later', at(14), at(15));
    const earlier = event('earlier', at(8), at(9));
    const found = expand([later, earlier], [], dayStart, dayEnd, everyWeek);
    expect(found.map((o) => o.event.id)).toEqual(['earlier', 'later']);
  });

  it('applies an exception to the right event only', () => {
    const other = event('other', at(9), at(10));
    const cancelled: EventException = {
      eventId: 'weekly',
      originalStart: at(9),
      kind: 'cancelled',
      startsAt: null,
      endsAt: null,
    };
    const found = expand([weekly, other], [cancelled], dayStart, dayEnd, everyWeek);
    expect(found.map((o) => o.event.id)).toEqual(['other']);
  });
});

// ── Position on the grid ───────────────────────────────────────────────────

describe('minutes into a day', () => {
  it('measures from local midnight', () => {
    expect(minutesInto(at(9, 30), DAY, ZONE)).toBe(9 * 60 + 30);
    expect(minutesInto(at(0), DAY, ZONE)).toBe(0);
  });

  it('clamps an event that began yesterday to the top of the grid', () => {
    // Otherwise it is drawn at a negative offset, which is to say off-screen.
    expect(minutesInto(at(22, 0, addLocalDays(DAY, -1)), DAY, ZONE)).toBe(0);
  });

  it('clamps an event that ends tomorrow to the bottom', () => {
    expect(minutesInto(at(2, 0, addLocalDays(DAY, 1)), DAY, ZONE)).toBe(24 * 60);
  });
});

// ── The layout ─────────────────────────────────────────────────────────────

describe('laying out a day', () => {
  const layout = (occurrences: Occurrence[]) => layoutDay(occurrences, DAY, ZONE);

  /** An occurrence anywhere, not only on the test day. */
  const spanning = (id: string, startsAt: string, endsAt: string): Occurrence => ({
    event: event(id, startsAt, endsAt),
    originalStart: startsAt,
    startsAt,
    endsAt,
  });

  it('lays out only what touches the day', () => {
    // Every occurrence in a window is handed to every day's layout. A layout
    // that clamped instead of filtering drew a sliver at midnight on every
    // column for every event of every other day — invisible in an empty week,
    // wrong in a full one.
    const tomorrow = spanning(
      'tomorrow',
      at(9, 0, addLocalDays(DAY, 1)),
      at(10, 0, addLocalDays(DAY, 1)),
    );
    const yesterday = spanning(
      'yesterday',
      at(9, 0, addLocalDays(DAY, -1)),
      at(10, 0, addLocalDays(DAY, -1)),
    );
    const today = occurrence('today', 9, 10);

    expect(layout([tomorrow, yesterday, today]).map((box) => box.occurrence.event.id)).toEqual([
      'today',
    ]);
  });

  it('keeps an event that spans midnight on both days', () => {
    const overnight = spanning('overnight', at(22, 0), at(2, 0, addLocalDays(DAY, 1)));

    const first = layout([overnight]);
    expect(first).toHaveLength(1);
    expect(first[0]!.topMinutes).toBe(22 * 60);
    expect(first[0]!.heightMinutes).toBe(2 * 60);

    const second = layoutDay([overnight], addLocalDays(DAY, 1), ZONE);
    expect(second).toHaveLength(1);
    expect(second[0]!.topMinutes).toBe(0);
    expect(second[0]!.heightMinutes).toBe(2 * 60);
  });

  it('an event ending exactly at midnight belongs to the day that is ending', () => {
    const untilMidnight = spanning('late', at(22, 0), at(0, 0, addLocalDays(DAY, 1)));

    expect(layout([untilMidnight])).toHaveLength(1);
    expect(layoutDay([untilMidnight], addLocalDays(DAY, 1), ZONE)).toHaveLength(0);
  });

  it('gives a lone event the full width', () => {
    const [box] = layout([occurrence('alone', 9, 10)]);
    expect(box!.left).toBe(0);
    expect(box!.width).toBe(1);
    expect(box!.topMinutes).toBe(540);
    expect(box!.heightMinutes).toBe(60);
  });

  it('gives two events that do not overlap the full width each', () => {
    // The trap: treating "same day" as "same cluster" makes a morning and an
    // afternoon meeting share the width for no reason.
    const boxes = layout([occurrence('morning', 9, 10), occurrence('afternoon', 14, 15)]);
    expect(boxes.every((box) => box.width === 1)).toBe(true);
  });

  it('splits the width between two that overlap', () => {
    const boxes = layout([occurrence('a', 9, 11), occurrence('b', 10, 12)]);
    expect(boxes.map((box) => box.width)).toEqual([0.5, 0.5]);
    expect(boxes.map((box) => box.left)).toEqual([0, 0.5]);
  });

  it('uses as few columns as it can', () => {
    // Three events, but the third starts after the first has ended, so it
    // reuses that column: two columns, not three.
    const boxes = layout([occurrence('a', 9, 10), occurrence('b', 9, 12), occurrence('c', 10, 11)]);
    expect(new Set(boxes.map((box) => box.left)).size).toBe(2);
  });

  it('widens an event into the space beside it', () => {
    // Without this step a day is thin slivers with white space next to them:
    // technically correct, visibly wrong.
    const boxes = layout([
      occurrence('long', 9, 17),
      occurrence('short', 9, 10),
      occurrence('later', 14, 15),
    ]);

    const later = boxes.find((box) => box.occurrence.event.id === 'later')!;
    const short = boxes.find((box) => box.occurrence.event.id === 'short')!;

    // `later` has nothing beside it, so it takes the rest of the row.
    expect(later.left + later.width).toBeCloseTo(1);
    // `short` shares its span with `long`, so it does not.
    expect(short.width).toBeLessThan(1);
  });

  it('keeps two clusters independent', () => {
    const boxes = layout([
      occurrence('a', 9, 11),
      occurrence('b', 10, 12),
      occurrence('c', 14, 15),
    ]);
    const alone = boxes.find((box) => box.occurrence.event.id === 'c')!;
    expect(alone.width).toBe(1);
    expect(alone.left).toBe(0);
  });

  it('draws a very short event tall enough to read', () => {
    const [box] = layout([
      {
        ...occurrence('brief', 9, 9),
        endsAt: at(9, 5),
      },
    ]);
    expect(box!.heightMinutes).toBeGreaterThanOrEqual(20);
  });

  it('leaves all-day events out of the grid', () => {
    // They belong in their own lane above it, not stretched over twenty-four
    // hours of the timed area.
    expect(layout([occurrence('holiday', 0, 24, { allDay: true })])).toEqual([]);
  });

  it('returns the boxes in reading order, top-left first', () => {
    const boxes = layout([
      occurrence('late', 14, 15),
      occurrence('early-b', 9, 11),
      occurrence('early-a', 9, 10),
    ]);
    expect(boxes[0]!.topMinutes).toBeLessThanOrEqual(boxes[1]!.topMinutes);
    expect(boxes.at(-1)!.occurrence.event.id).toBe('late');
  });

  it('handles a day with nothing on it', () => {
    expect(layout([])).toEqual([]);
  });
});

// ── Which days a scale shows ───────────────────────────────────────────────

describe('the days a scale shows', () => {
  it('adds days without crossing the date line', () => {
    // `new Date('2026-03-15')` is midnight UTC, which is the 14th west of
    // Greenwich. Building from parts avoids the classic off-by-one.
    expect(addLocalDays('2026-03-15', 1)).toBe('2026-03-16');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows the weekday', () => {
    expect(weekdayOf('2026-09-07')).toBe(1); // Monday
    expect(weekdayOf('2026-09-06')).toBe(0); // Sunday
  });

  it('shows one day for the day scale', () => {
    expect(daysOf('day', DAY)).toEqual([DAY]);
  });

  it('shows Monday to Friday for a work week, whatever day it is anchored on', () => {
    const week = daysOf('workWeek', '2026-09-10'); // a Thursday
    expect(week).toHaveLength(5);
    expect(week[0]).toBe('2026-09-07');
    expect(week[4]).toBe('2026-09-11');
  });

  it('starts the week where the country starts it', () => {
    expect(daysOf('week', DAY, 1)[0]).toBe('2026-09-07'); // Monday
    expect(daysOf('week', DAY, 0)[0]).toBe('2026-09-06'); // Sunday
  });

  it('shows whole weeks for a month, including the days either side', () => {
    const month = daysOf('month', '2026-09-15', 1);
    expect(month.length % 7).toBe(0);
    expect(month[0]).toBe('2026-08-31'); // the Monday before the 1st
    expect(month).toContain('2026-09-30');
  });

  it('finds the start of the week across a month boundary', () => {
    expect(startOfWeek('2026-09-01', 1)).toBe('2026-08-31');
  });

  it('moves by the right amount for each scale', () => {
    expect(step('day', DAY, 1)).toBe('2026-09-08');
    expect(step('week', DAY, 1)).toBe('2026-09-14');
    expect(step('workWeek', DAY, -1)).toBe('2026-08-31');
    expect(step('month', '2026-09-15', 1)).toBe('2026-10-01');
    expect(step('month', '2026-01-15', -1)).toBe('2025-12-01');
  });
});

describe('working hours', () => {
  const hours = [
    { weekday: 1, startsMinute: 540, endsMinute: 1080 },
    { weekday: 2, startsMinute: 540, endsMinute: 1080 },
  ];

  it('finds the span for a working day', () => {
    expect(workingSpan('2026-09-07', hours)?.startsMinute).toBe(540);
  });

  it('has nothing to say about a day that is not one', () => {
    expect(workingSpan('2026-09-12', hours)).toBeNull(); // Saturday
  });
});
