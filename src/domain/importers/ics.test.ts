import { describe, expect, it } from 'vitest';

import { expand, type CalendarEvent, type EventException } from '../calendar';
import { occurrencesBetween } from '../schedule';

import {
  fromIcs,
  ianaZone,
  looksLikeIcs,
  parseIcs,
  readDuration,
  readRule,
  readStamp,
  unescapeText,
} from './ics';

const ZONE = 'America/Sao_Paulo';

const file = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...lines, 'END:VCALENDAR'].join('\r\n');

const event = (...lines: string[]) => file('BEGIN:VEVENT', ...lines, 'END:VEVENT');

/** The occurrences the product itself would draw, for a plan's first event. */
function occurrencesOf(plan: ReturnType<typeof fromIcs>, from: string, to: string) {
  const imported = plan!.events[0]!;
  const calendarEvent: CalendarEvent = {
    id: 'event-1',
    calendarId: 'personal',
    title: imported.title,
    startsAt: imported.startsAt,
    endsAt: imported.endsAt,
    tz: imported.tz,
    allDay: imported.allDay,
    rrule: imported.rrule,
    color: null,
    itemId: null,
  };
  const exceptions: EventException[] = (imported.exceptions ?? []).map((exception) => ({
    eventId: 'event-1',
    originalStart: exception.originalStart,
    kind: exception.kind,
    startsAt: exception.startsAt,
    endsAt: exception.endsAt,
  }));
  return expand([calendarEvent], exceptions, from, to, (candidate, windowFrom, windowTo) =>
    occurrencesBetween(
      {
        startAt: null,
        dueAt: candidate.startsAt,
        remindAt: null,
        rule: candidate.rrule,
        mode: 'schedule',
      },
      windowFrom,
      windowTo,
      candidate.tz,
    ),
  );
}

/** The wall clock an instant shows in a zone, as `2026-10-27 09:00`. */
function wallClockIn(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const at = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
}

describe('reading the file', () => {
  it('knows a calendar file when it sees one', () => {
    expect(looksLikeIcs(file('BEGIN:VEVENT', 'END:VEVENT'))).toBe(true);
    expect(looksLikeIcs('\uFEFFBEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe(true);
    expect(looksLikeIcs('{"cards":[]}')).toBe(false);
    expect(looksLikeIcs('')).toBe(false);
  });

  it('undoes folding, so a long description arrives whole', () => {
    const [calendar] = parseIcs(
      file(
        'BEGIN:VEVENT',
        'SUMMARY:Quarterly review',
        'DESCRIPTION:Three things to decide',
        '  before Friday: the budget',
        '\t, the date and the room.',
        'END:VEVENT',
      ),
    );
    const description = calendar!.children[0]!.lines.find((line) => line.name === 'DESCRIPTION');
    expect(description!.value).toBe(
      'Three things to decide before Friday: the budget, the date and the room.',
    );
  });

  it('reads parameters, quoted or not, and never mistakes a colon inside them', () => {
    const [calendar] = parseIcs(
      event('DTSTART;TZID="Europe/London";VALUE=DATE-TIME:20261006T090000', 'SUMMARY:x'),
    );
    const start = calendar!.children[0]!.lines[0]!;
    expect(start.params).toEqual({ TZID: 'Europe/London', VALUE: 'DATE-TIME' });
    expect(start.value).toBe('20261006T090000');
  });

  it('undoes the escapes a TEXT value carries', () => {
    expect(unescapeText('Ana\\, Bruno\\; and a line\\nbreak\\\\')).toBe(
      'Ana, Bruno; and a line\nbreak\\',
    );
  });

  it('reads what it can of a file that is broken', () => {
    // A line with no colon, an END that closes nothing, and a component never
    // closed: the good event is still read.
    const plan = fromIcs(
      [
        'BEGIN:VCALENDAR',
        'this line is not a property',
        'END:VTODO',
        'BEGIN:VEVENT',
        'DTSTART:20261006T090000Z',
        'SUMMARY:Still here',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'DTSTART:20261007T090000Z',
        'SUMMARY:Never closed',
      ].join('\n'),
      'Broken',
      ZONE,
    );
    expect(plan!.events.map((entry) => entry.title)).toEqual(['Still here', 'Never closed']);
  });

  it('is not a calendar file, and says so by returning nothing', () => {
    expect(fromIcs('', 'x', ZONE)).toBeNull();
    expect(fromIcs('SUMMARY:no calendar here', 'x', ZONE)).toBeNull();
    expect(fromIcs('a'.repeat(65 * 1024 * 1024), 'x', ZONE)).toBeNull();
  });
});

describe('zones', () => {
  it('takes IANA as it is', () => {
    expect(ianaZone('Europe/London')).toBe('Europe/London');
    expect(ianaZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
  });

  it('maps the names Outlook writes', () => {
    expect(ianaZone('GMT Standard Time')).toBe('Europe/London');
    expect(ianaZone('E. South America Standard Time')).toBe('America/Sao_Paulo');
    expect(ianaZone('pacific standard time')).toBe('America/Los_Angeles');
  });

  it('digs an IANA zone out of a vendor prefix', () => {
    expect(ianaZone('/mozilla.org/20050126_1/Europe/London')).toBe('Europe/London');
    expect(ianaZone('/citadel.org/20190914_1/America/New_York')).toBe('America/New_York');
  });

  it('gives up on a zone it does not know, rather than guessing', () => {
    expect(ianaZone('Middle Earth Standard Time')).toBeNull();
    expect(ianaZone('')).toBeNull();
  });

  it('falls back to the workspace zone and says which zone it could not read', () => {
    const plan = fromIcs(
      event('UID:a', 'DTSTART;TZID=Mordor Standard Time:20261006T090000', 'SUMMARY:Meeting'),
      'Work',
      ZONE,
    );
    expect(plan!.events[0]!.tz).toBe(ZONE);
    expect(plan!.warnings[0]).toContain('“Mordor Standard Time”');
  });
});

describe('stamps and durations', () => {
  it('reads a UTC stamp as the instant it is', () => {
    expect(readStamp('20261006T083000Z', ZONE)).toEqual({
      instant: '2026-10-06T08:30:00.000Z',
      allDay: false,
    });
  });

  it('reads a wall clock in the zone it was written in', () => {
    // 09:00 in London on a summer day is 08:00 UTC.
    expect(readStamp('20261006T090000', 'Europe/London')!.instant).toBe('2026-10-06T08:00:00.000Z');
    // And on a winter day it is 09:00 UTC — the same file, the same number.
    expect(readStamp('20261127T090000', 'Europe/London')!.instant).toBe('2026-11-27T09:00:00.000Z');
  });

  it('reads a date with no time as local midnight, and says it is all day', () => {
    const stamp = readStamp('20261006', 'Europe/London')!;
    expect(stamp.allDay).toBe(true);
    expect(wallClockIn(stamp.instant, 'Europe/London')).toBe('2026-10-06 00:00');
  });

  it('refuses what is not a stamp', () => {
    for (const value of ['', 'tomorrow', '2026-10-06', '20261306T090000', '20261006T250000']) {
      expect(readStamp(value, ZONE)).toBeNull();
    }
  });

  it('reads the durations a calendar writes', () => {
    expect(readDuration('PT1H30M')).toBe(90 * 60_000);
    expect(readDuration('P1D')).toBe(86_400_000);
    expect(readDuration('P2W')).toBe(14 * 86_400_000);
    expect(readDuration('PT45S')).toBe(45_000);
    expect(readDuration('P')).toBeNull();
    expect(readDuration('an hour')).toBeNull();
  });

  it('ends an event by its duration when there is no DTEND', () => {
    const plan = fromIcs(
      event('UID:a', 'DTSTART:20261006T090000Z', 'DURATION:PT45M', 'SUMMARY:Call'),
      'Work',
      ZONE,
    );
    expect(plan!.events[0]!.endsAt).toBe('2026-10-06T09:45:00.000Z');
  });

  it('gives an all-day event the day, and a timed one no time, when the file says nothing', () => {
    const day = fromIcs(
      event('UID:a', 'DTSTART;VALUE=DATE:20261006', 'SUMMARY:Holiday'),
      'W',
      ZONE,
    );
    expect(day!.events[0]!.allDay).toBe(true);
    expect(new Date(day!.events[0]!.endsAt).getTime()).toBe(
      new Date(day!.events[0]!.startsAt).getTime() + 86_400_000,
    );

    const moment = fromIcs(event('UID:b', 'DTSTART:20261006T090000Z', 'SUMMARY:Ping'), 'W', ZONE);
    expect(moment!.events[0]!.endsAt).toBe(moment!.events[0]!.startsAt);
  });

  it('does not let an event end before it begins', () => {
    const plan = fromIcs(
      event('UID:a', 'DTSTART:20261006T100000Z', 'DTEND:20261006T090000Z', 'SUMMARY:Backwards'),
      'W',
      ZONE,
    );
    expect(plan!.events[0]!.endsAt).toBe(plan!.events[0]!.startsAt);
  });
});

describe('the rule', () => {
  it('keeps the rule the file wrote, UNTIL and all', () => {
    expect(readRule('FREQ=WEEKLY;BYDAY=TU,TH')).toBe('FREQ=WEEKLY;BYDAY=TU,TH');
    expect(readRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=31')).toBe('FREQ=MONTHLY;BYMONTHDAY=31');
    expect(readRule('FREQ=WEEKLY;UNTIL=20270330T080000Z')).toBe(
      'FREQ=WEEKLY;UNTIL=20270330T080000Z',
    );
    expect(readRule('')).toBeNull();
  });

  it('keeps the last occurrence a series says it has', () => {
    const plan = fromIcs(
      event(
        'UID:a',
        'DTSTART;TZID=Europe/London:20270316T090000',
        'DTEND;TZID=Europe/London:20270316T093000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270330T080000Z',
        'SUMMARY:Stand-up',
      ),
      'Work',
      ZONE,
    );
    const occurrences = occurrencesOf(plan, '2027-03-01T00:00:00.000Z', '2027-04-30T00:00:00.000Z');
    // The 30th is the last day the file names, and it is still there.
    expect(occurrences.map((entry) => wallClockIn(entry.startsAt, 'Europe/London'))).toEqual([
      '2027-03-16 09:00',
      '2027-03-23 09:00',
      '2027-03-30 09:00',
    ]);
  });

  it('imports an entry once when its rule cannot be read, and says so', () => {
    const plan = fromIcs(
      event('UID:a', 'DTSTART:20261006T090000Z', 'RRULE:FREQ=FORTNIGHTLY', 'SUMMARY:Odd'),
      'Work',
      ZONE,
    );
    expect(plan!.events[0]!.rrule).toBeNull();
    expect(plan!.warnings.some((warning) => warning.includes('repeat rule'))).toBe(true);
  });
});

describe('a series across the two daylight-saving days', () => {
  // The slice's proof of done. A weekly 09:00 meeting in London, over the
  // Sunday the clocks go back (2026-10-25) and the Sunday they go forward
  // (2027-03-28), with one occurrence cancelled and one moved.
  const source = event(
    'UID:standup@example.com',
    'DTSTART;TZID=Europe/London:20261006T090000',
    'DTEND;TZID=Europe/London:20261006T093000',
    'RRULE:FREQ=WEEKLY;BYDAY=TU',
    'EXDATE;TZID=Europe/London:20261124T090000',
    'SUMMARY:Stand-up',
  );

  it('stays at nine in the morning, in London, on both sides of both changes', () => {
    const plan = fromIcs(source, 'Work', ZONE);
    const occurrences = occurrencesOf(plan, '2026-10-01T00:00:00.000Z', '2027-04-30T00:00:00.000Z');

    const wall = occurrences.map((entry) => wallClockIn(entry.startsAt, 'Europe/London'));
    expect(wall.every((stamp) => stamp.endsWith(' 09:00'))).toBe(true);

    // And the instants move by an hour, which is the whole point: the same
    // wall clock is a different moment on either side of a change.
    const instantOf = (day: string) =>
      occurrences.find((entry) => entry.startsAt.startsWith(day))!.startsAt;
    expect(instantOf('2026-10-20')).toBe('2026-10-20T08:00:00.000Z'); // BST
    expect(instantOf('2026-10-27')).toBe('2026-10-27T09:00:00.000Z'); // GMT
    expect(instantOf('2027-03-23')).toBe('2027-03-23T09:00:00.000Z'); // GMT
    expect(instantOf('2027-03-30')).toBe('2027-03-30T08:00:00.000Z'); // BST
  });

  it('the cancelled Tuesday is not there, and no other one is missing', () => {
    const plan = fromIcs(source, 'Work', ZONE);
    expect(plan!.events[0]!.exceptions).toEqual([
      {
        originalStart: '2026-11-24T09:00:00.000Z',
        kind: 'cancelled',
        startsAt: null,
        endsAt: null,
      },
    ]);

    const days = occurrencesOf(plan, '2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z').map(
      (entry) => wallClockIn(entry.startsAt, 'Europe/London').slice(0, 10),
    );
    expect(days).toEqual(['2026-11-03', '2026-11-10', '2026-11-17']);
  });

  it('a moved occurrence is at its new time, and only that one moved', () => {
    const withOverride = file(
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'DTSTART;TZID=Europe/London:20261006T090000',
      'DTEND;TZID=Europe/London:20261006T093000',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'SUMMARY:Stand-up',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:standup@example.com',
      'RECURRENCE-ID;TZID=Europe/London:20261103T090000',
      'DTSTART;TZID=Europe/London:20261103T150000',
      'DTEND;TZID=Europe/London:20261103T153000',
      'SUMMARY:Stand-up',
      'END:VEVENT',
    );
    const plan = fromIcs(withOverride, 'Work', ZONE);
    expect(plan!.events).toHaveLength(1);
    expect(plan!.events[0]!.exceptions).toEqual([
      {
        originalStart: '2026-11-03T09:00:00.000Z',
        kind: 'moved',
        startsAt: '2026-11-03T15:00:00.000Z',
        endsAt: '2026-11-03T15:30:00.000Z',
      },
    ]);

    const times = occurrencesOf(plan, '2026-11-01T00:00:00.000Z', '2026-11-15T00:00:00.000Z').map(
      (entry) => wallClockIn(entry.startsAt, 'Europe/London'),
    );
    expect(times).toEqual(['2026-11-03 15:00', '2026-11-10 09:00']);
  });

  it('an occurrence called off by an override is a cancellation, not a move', () => {
    const plan = fromIcs(
      file(
        'BEGIN:VEVENT',
        'UID:a',
        'DTSTART;TZID=Europe/London:20261006T090000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'SUMMARY:Stand-up',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:a',
        'RECURRENCE-ID;TZID=Europe/London:20261013T090000',
        'DTSTART;TZID=Europe/London:20261013T090000',
        'STATUS:CANCELLED',
        'SUMMARY:Stand-up',
        'END:VEVENT',
      ),
      'Work',
      ZONE,
    );
    expect(plan!.events[0]!.exceptions![0]!.kind).toBe('cancelled');
  });

  it('an override whose series is not in the file becomes an event of its own', () => {
    const plan = fromIcs(
      event(
        'UID:elsewhere@example.com',
        'RECURRENCE-ID;TZID=Europe/London:20261013T090000',
        'DTSTART;TZID=Europe/London:20261013T110000',
        'SUMMARY:Moved from a series I do not have',
      ),
      'Work',
      ZONE,
    );
    expect(plan!.events).toHaveLength(1);
    expect(plan!.events[0]!.exceptions).toBeUndefined();
    expect(plan!.warnings.some((warning) => warning.includes('not in the file'))).toBe(true);
  });

  it('says when a change was meant for every occurrence after it too', () => {
    const plan = fromIcs(
      file(
        'BEGIN:VEVENT',
        'UID:a',
        'DTSTART;TZID=Europe/London:20261006T090000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'SUMMARY:Stand-up',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:a',
        'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=Europe/London:20261013T090000',
        'DTSTART;TZID=Europe/London:20261013T100000',
        'SUMMARY:Stand-up',
        'END:VEVENT',
      ),
      'Work',
      ZONE,
    );
    expect(plan!.warnings.some((warning) => warning.includes('every one after it'))).toBe(true);
    expect(plan!.events[0]!.exceptions).toHaveLength(1);
  });
});

describe('what a calendar carries that this product does not', () => {
  it('lists the reminders, the guests and the dates added by hand', () => {
    const plan = fromIcs(
      file(
        'BEGIN:VEVENT',
        'UID:a',
        'DTSTART:20261006T090000Z',
        'SUMMARY:Review',
        'ORGANIZER;CN=Ana:mailto:ana@example.com',
        'ATTENDEE;CN=Bruno:mailto:bruno@example.com',
        'RDATE;TZID=Europe/London:20261013T090000',
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        'END:VALARM',
        'END:VEVENT',
        'BEGIN:VJOURNAL',
        'SUMMARY:A diary entry',
        'END:VJOURNAL',
      ),
      'Work',
      ZONE,
    );
    const said = plan!.warnings.join(' ');
    expect(said).toContain('reminder');
    expect(said).toContain('guest');
    expect(said).toContain('RDATE');
    expect(said).toContain('VJOURNAL');
  });

  it('says when a calendar has nothing in it', () => {
    expect(fromIcs(file(), 'Empty', ZONE)!.warnings).toEqual(['The file has no events in it.']);
  });
});

describe('the tasks a calendar file can hold', () => {
  const todos = file(
    'X-WR-CALNAME:Reminders',
    'BEGIN:VTODO',
    'UID:t1',
    'SUMMARY:Renew the passport',
    'DESCRIPTION:Photos first.',
    'DUE;TZID=Europe/London:20261110T170000',
    'PRIORITY:1',
    'END:VTODO',
    'BEGIN:VTODO',
    'UID:t2',
    'SUMMARY:File the receipts',
    'STATUS:COMPLETED',
    'COMPLETED:20260901T120000Z',
    'PRIORITY:7',
    'END:VTODO',
    'BEGIN:VTODO',
    'UID:t3',
    'END:VTODO',
  );

  it('carries a VTODO as a task, in the collection the calendar names itself', () => {
    const plan = fromIcs(todos, 'ignored.ics', ZONE)!;
    expect(plan.collections).toEqual([{ name: 'Reminders', icon: null, color: null }]);
    expect(plan.source).toBe('a calendar file (Reminders)');

    const [passport, receipts] = plan.tasks;
    expect(passport).toMatchObject({
      collection: 'Reminders',
      title: 'Renew the passport',
      notes: 'Photos first.',
      dueAt: '2026-11-10T17:00:00.000Z',
      values: { Priority: 'urgent' },
    });
    expect(receipts).toMatchObject({
      title: 'File the receipts',
      completedAt: '2026-09-01T12:00:00.000Z',
      values: { Priority: 'low' },
    });
    // A task with no title is not a task.
    expect(plan.tasks).toHaveLength(2);
  });

  it('makes no collection when the file is only events', () => {
    const plan = fromIcs(event('UID:a', 'DTSTART:20261006T090000Z', 'SUMMARY:Call'), 'Work', ZONE)!;
    expect(plan.collections).toEqual([]);
    expect(plan.tasks).toEqual([]);
  });
});
