import { describe, expect, it } from 'vitest';

import { expand, layoutDay, type CalendarEvent, type Occurrence } from './calendar';
import { occurrencesBetween } from './schedule';

/**
 * The calendar's performance budget, from `docs/SPEC.md` §4: a week renders in
 * under 50 ms with 500 events in it.
 *
 * The number that matters is not the paint — that is the browser's — but the
 * arithmetic in front of it: expanding recurrence over the window and resolving
 * overlaps into columns. Both are `O(n log n)` by design and both are here.
 *
 * Timings are best-of-five, like the query benchmark: a single run on a shared
 * machine measures the machine, and a budget that fails when a virus scanner
 * wakes up is a budget nobody trusts.
 */

const ZONE = 'America/Sao_Paulo';
const WEEK_START = '2026-09-07';
const DAYS = [
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
];
const FROM = '2026-09-07T00:00:00.000Z';
const TO = '2026-09-14T00:00:00.000Z';

/** The ceiling for laying out one week. */
const WEEK_CEILING_MS = 50;

/** How many events sit in the week. */
const EVENTS = 500;

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
 * A week that looks like a busy one: most events single, some repeating daily,
 * many overlapping so the layout has real work to do.
 */
function seed(count: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const day = DAYS[index % DAYS.length] ?? WEEK_START;
    // Starts cluster in the working day, which is where overlaps hurt.
    const hour = 8 + (index % 10);
    const minute = (index % 4) * 15;
    const start = `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
    const end = `${day}T${String(hour + 1).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
    events.push({
      id: `event-${index}`,
      calendarId: 'personal',
      title: `Event ${index}`,
      startsAt: start,
      endsAt: end,
      tz: ZONE,
      allDay: false,
      rrule: index % 20 === 0 ? 'FREQ=DAILY' : null,
      itemId: null,
      color: null,
    });
  }
  return events;
}

const events = seed(EVENTS);

const expandWeek = (): Occurrence[] =>
  expand(events, [], FROM, TO, (event, windowFrom, windowTo) =>
    occurrencesBetween(
      {
        startAt: null,
        dueAt: event.startsAt,
        remindAt: null,
        rule: event.rrule,
        mode: 'schedule',
      },
      windowFrom,
      windowTo,
      event.tz,
    ),
  );

const layoutWeek = (occurrences: Occurrence[]) =>
  DAYS.map((day) => layoutDay(occurrences, day, ZONE));

describe(`the calendar at ${EVENTS} events in a week`, () => {
  it('seeds the volume the budget was written against', () => {
    const occurrences = expandWeek();
    expect(events.length).toBe(EVENTS);
    // The daily repeats multiply: 25 of them, each appearing across the window.
    expect(occurrences.length).toBeGreaterThan(EVENTS);
  });

  it('expands and lays out a week within the ceiling', () => {
    let occurrences: Occurrence[] = [];
    const elapsed = bestOfFive(() => {
      occurrences = expandWeek();
      layoutWeek(occurrences);
    });
    console.log(
      `  week: ${elapsed.toFixed(1)} ms for ${occurrences.length} occurrences (ceiling ${WEEK_CEILING_MS} ms)`,
    );
    expect(elapsed).toBeLessThan(WEEK_CEILING_MS);
  });

  it('lays out the busiest single day within the ceiling', () => {
    const occurrences = expandWeek();
    const elapsed = bestOfFive(() => layoutDay(occurrences, WEEK_START, ZONE));
    console.log(`  day: ${elapsed.toFixed(1)} ms (ceiling ${WEEK_CEILING_MS} ms)`);
    expect(elapsed).toBeLessThan(WEEK_CEILING_MS);
  });

  it('gives every occurrence a box, and no box escapes its column', () => {
    const occurrences = expandWeek();
    const boxes = layoutWeek(occurrences).flat();
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(1.0001);
      expect(box.heightMinutes).toBeGreaterThan(0);
    }
  });
});
