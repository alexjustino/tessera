import { describe, expect, it } from 'vitest';

import { expand, type CalendarEvent } from './calendar';
import { yearOf } from './capacity';
import { occurrencesBetween } from './schedule';

/**
 * The year view's budget, from the slice's proof of done: a year renders
 * inside the budget. The budget is the calendar's own, fifty milliseconds,
 * because the year is a calendar scale and a person switching to it expects
 * what the other scales cost.
 *
 * Two numbers, kept apart: expanding a year of events (recurrence over 365
 * days) and laying the year out from what was expanded. The first is shared
 * with every other scale and is the one that grows with rules; the second is
 * this slice's.
 *
 * Best-of-five, like the other benchmarks.
 */

const ZONE = 'America/Sao_Paulo';
const YEAR = 2026;
const FROM = `${YEAR}-01-01T03:00:00.000Z`;
const TO = `${YEAR + 1}-01-01T03:00:00.000Z`;
const CEILING_MS = 50;

const HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsMinute: 540, endsMinute: 1080 }));

function bestOfFive(work: () => void): number {
  let best = Infinity;
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    work();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * A year the shape a real one is: a few things every week, a standing meeting
 * or two, and a scatter of one-off blocks. Around two thousand occurrences.
 */
function seed(): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const base = Date.UTC(YEAR, 0, 5, 12); // the first Monday, 09:00 local

  // Weekly rules: five of them, one per weekday, each yielding ~52 occurrences.
  for (let weekday = 0; weekday < 5; weekday += 1) {
    const start = base + weekday * 86_400_000;
    events.push({
      id: `weekly-${weekday}`,
      calendarId: 'personal',
      title: `Standing ${weekday}`,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 3_600_000).toISOString(),
      tz: ZONE,
      allDay: false,
      rrule: 'FREQ=WEEKLY',
      color: null,
      itemId: null,
    });
  }
  // A daily one, ~365 occurrences.
  events.push({
    id: 'daily',
    calendarId: 'personal',
    title: 'Stand-up',
    startsAt: new Date(base + 3_600_000).toISOString(),
    endsAt: new Date(base + 3_600_000 + 900_000).toISOString(),
    tz: ZONE,
    allDay: false,
    rrule: 'FREQ=DAILY',
    color: null,
    itemId: null,
  });
  // One-off blocks: four a day on weekdays, ~1,000 of them.
  for (let day = 0; day < 365; day += 1) {
    const dayStart = Date.UTC(YEAR, 0, 1 + day, 12);
    if (new Date(dayStart).getUTCDay() % 6 === 0) continue;
    for (let slot = 0; slot < 4; slot += 1) {
      const start = dayStart + slot * 7_200_000;
      events.push({
        id: `block-${day}-${slot}`,
        calendarId: 'personal',
        title: `Block ${day}.${slot}`,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 5_400_000).toISOString(),
        tz: ZONE,
        allDay: false,
        rrule: null,
        color: null,
        itemId: `task-${day}-${slot}`,
      });
    }
  }
  return events;
}

const events = seed();

const expandYear = () =>
  expand(events, [], FROM, TO, (event, windowFrom, windowTo) =>
    occurrencesBetween(
      { startAt: null, dueAt: event.startsAt, remindAt: null, rule: event.rrule, mode: 'schedule' },
      windowFrom,
      windowTo,
      event.tz,
    ),
  );

describe('the year view', () => {
  const occurrences = expandYear();

  it('seeds the volume the budget was written against', () => {
    expect(occurrences.length).toBeGreaterThan(1_500);
  });

  it('expands a year of events, rules included, and reports what that costs', () => {
    const elapsed = bestOfFive(() => expandYear());
    console.log(`  expand: ${elapsed.toFixed(1)} ms for ${occurrences.length} occurrences`);
    // Not the slice's budget — recurrence is F7's — but a year is the widest
    // window any scale asks for, so it is measured here and kept honest.
    expect(elapsed).toBeLessThan(CEILING_MS * 4);
  });

  it('lays the year out inside the calendar budget', () => {
    const elapsed = bestOfFive(() => yearOf(YEAR, occurrences, HOURS, ZONE));
    console.log(
      `  yearOf: ${elapsed.toFixed(1)} ms for ${occurrences.length} occurrences (ceiling ${CEILING_MS} ms)`,
    );
    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('puts every occurrence on a day', () => {
    const year = yearOf(YEAR, occurrences, HOURS, ZONE);
    const planned = year.months.reduce((sum, month) => sum + month.planned, 0);
    const expected = occurrences.reduce(
      (sum, occurrence) =>
        sum + (Date.parse(occurrence.endsAt) - Date.parse(occurrence.startsAt)) / 60_000,
      0,
    );
    expect(planned).toBe(Math.round(expected));
  });
});
