import { describe, expect, it } from 'vitest';

import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import type { Item } from './item';
import { envelopesOf, isPastWeek, mosaicOf, type MosaicInput } from './mosaic';
import { project, type LedgerInput } from './receipt';
import type { Entry } from './time';

/*
 * The paper week again: Monday 2 to Friday 6 November 2026, 09:00–17:00,
 * eight tiles a day, forty in the week, in UTC.
 */

const H = 60;
const WEEK = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];
const BEFORE_WORK = '2026-11-02T08:00:00.000Z';
const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * H,
  endsMinute: 17 * H,
}));

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    collectionId: 'tasks',
    parentItemId: null,
    title: id,
    position: 'm',
    startAt: null,
    dueAt: null,
    remindAt: null,
    recurrenceRule: null,
    recurrenceMode: 'schedule',
    completedAt: null,
    estimateMinutes: null,
    isMilestone: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }) as Item;

const occurrence = (
  title: string,
  startsAt: string,
  endsAt: string,
  itemId: string | null = null,
): Occurrence => {
  const event: CalendarEvent = {
    id: `e-${title}`,
    calendarId: 'c',
    title,
    startsAt,
    endsAt,
    tz: 'UTC',
    allDay: false,
    rrule: null,
    color: null,
    itemId,
  };
  return { event, originalStart: startsAt, startsAt, endsAt };
};

const at = (day: string, hour: number, minute = 0) =>
  `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

/** A mosaic over the paper week, its projection computed from the same rows. */
function mosaic(over: Partial<MosaicInput & { ledger: Partial<LedgerInput> }> = {}) {
  const now = over.now ?? BEFORE_WORK;
  const items = over.items ?? [];
  const occurrences = over.occurrences ?? [];
  const ledger: LedgerInput = {
    today: now.slice(0, 10),
    zone: 'UTC',
    hours: HOURS,
    occurrences,
    items,
    edges: [],
    goals: [],
    goalLinks: [],
    tracked: new Map(),
    ...(over.daysOff === undefined ? {} : { daysOff: over.daysOff }),
    ...over.ledger,
  };
  return mosaicOf({
    week: WEEK,
    now,
    zone: 'UTC',
    hours: over.hours ?? HOURS,
    occurrences,
    entries: over.entries ?? [],
    items,
    projection: project(ledger),
    ...(over.daysOff === undefined ? {} : { daysOff: over.daysOff }),
  });
}

const states = (m: ReturnType<typeof mosaic>, day: string) =>
  m.days.find((d) => d.day === day)?.tiles.map((t) => t.state) ?? [];

describe('the week mosaic', () => {
  it('an empty working week is forty free tiles, and the figures say the same in hours', () => {
    const m = mosaic();
    expect(m.tileCount).toBe(40);
    expect(m.counts.free).toBe(40);
    expect(m.capacity.value).toBe(40 * H);
    expect(m.available.value).toBe(40 * H);
    expect(m.needs.value).toBe(0);
    expect(m.shortTiles).toBe(0);
    // Saturday and Sunday are outside the working week.
    expect(m.days.filter((d) => d.off).map((d) => d.day)).toEqual(['2026-11-07', '2026-11-08']);
    expect(m.firstMinute).toBe(9 * H);
    expect(m.lastMinute).toBe(17 * H);
  });

  it('a meeting reserves its tiles, names them, and leaves the rest free', () => {
    const m = mosaic({
      occurrences: [occurrence('Stand-up', at('2026-11-02', 9), at('2026-11-02', 11))],
    });
    const monday = m.days[0]?.tiles ?? [];
    expect(monday.slice(0, 3).map((t) => [t.state, t.label])).toEqual([
      ['reserved', 'Stand-up'],
      ['reserved', 'Stand-up'],
      ['free', null],
    ]);
    expect(m.reserved.value).toBe(2 * H);
    expect(m.reserved.rows.map((r) => r.title)).toEqual(['Stand-up']);
    expect(m.available.value).toBe(38 * H);
  });

  it('estimated work is laid on the free tiles it claims, after the reserved ones — never on them', () => {
    const m = mosaic({
      items: [item('Draft', { estimateMinutes: 3 * H })],
      occurrences: [occurrence('Stand-up', at('2026-11-02', 9), at('2026-11-02', 11))],
    });
    expect(states(m, '2026-11-02').slice(0, 6)).toEqual([
      'reserved',
      'reserved',
      'committed',
      'committed',
      'committed',
      'free',
    ]);
    expect(m.days[0]?.tiles[2]?.label).toBe('Draft');
    expect(m.counts.committed).toBe(3);
  });

  it('when the work due by Friday needs more than the week has left, the difference is tiles', () => {
    const m = mosaic({
      items: [
        item('Draft', { estimateMinutes: 3 * H, dueAt: at('2026-11-04', 17) }),
        item('Build', { estimateMinutes: 50 * H, dueAt: at('2026-11-06', 17) }),
        item('Later', { estimateMinutes: 10 * H, dueAt: at('2026-11-20', 17) }),
      ],
    });
    // Needs 53h by Friday; the week has 40h left. 13 hours short. "Later" is not due this week.
    expect(m.needs.value).toBe(53 * H);
    expect(m.needs.rows.map((r) => r.title)).toEqual(['Draft', 'Build']);
    expect(m.shortTiles).toBe(13);
  });

  it('past tiles are lived when time was tracked in them, past when it was not', () => {
    const entries: Entry[] = [
      { id: 'e1', itemId: 'Draft', startedAt: at('2026-11-02', 9), endedAt: at('2026-11-02', 10) },
    ];
    const m = mosaic({
      now: at('2026-11-02', 11, 30),
      items: [item('Draft', { estimateMinutes: 4 * H })],
      entries,
      ledger: { tracked: new Map([['Draft', H]]) },
    });
    const monday = m.days[0]?.tiles ?? [];
    expect(monday.slice(0, 4).map((t) => [t.state, t.current])).toEqual([
      ['lived', false],
      ['past', false],
      ['committed', true],
      ['committed', false],
    ]);
    expect(monday[0]?.label).toBe('Draft');
  });

  it('today keeps the hours already gone out of what is left, and says what did not fit', () => {
    // At 16:00 on Monday, one working hour is left; the projection puts eight on today.
    const m = mosaic({
      now: at('2026-11-02', 16),
      items: [item('Big', { estimateMinutes: 8 * H })],
    });
    expect(states(m, '2026-11-02')).toEqual([
      'past',
      'past',
      'past',
      'past',
      'past',
      'past',
      'past',
      'committed',
    ]);
    expect(m.todayOverflow).toBe(7 * H);
  });

  it('a day off has no tiles', () => {
    const m = mosaic({ daysOff: new Set(['2026-11-04']) });
    expect(m.days.find((d) => d.day === '2026-11-04')).toEqual({
      day: '2026-11-04',
      off: true,
      tiles: [],
    });
    expect(m.tileCount).toBe(32);
  });

  it('a day that does not end on the hour has a shorter last tile, and says it rounded', () => {
    const short: WorkHours[] = HOURS.map((h) => ({ ...h, endsMinute: 16 * H + 30 }));
    const m = mosaic({ hours: short, ledger: { hours: short } });
    const monday = m.days[0]?.tiles ?? [];
    expect(monday.at(-1)?.minutes).toBe(30);
    expect(m.rounded).toBe(true);
    expect(m.tileCount).toBe(40);
    expect(m.capacity.value).toBe(5 * (7 * H + 30));
  });

  it('a week wholly gone is all past, and knows it', () => {
    const m = mosaic({ now: '2026-11-10T10:00:00.000Z' });
    expect(m.counts.past).toBe(40);
    expect(isPastWeek(WEEK, '2026-11-10T10:00:00.000Z', 'UTC')).toBe(true);
    expect(isPastWeek(WEEK, BEFORE_WORK, 'UTC')).toBe(false);
  });

  it('the tile counts and the tile total never disagree', () => {
    const m = mosaic({
      items: [item('Draft', { estimateMinutes: 12 * H })],
      occurrences: [occurrence('Review', at('2026-11-03', 14), at('2026-11-03', 16))],
    });
    const sum = Object.values(m.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(m.tileCount);
    expect(m.capacity.value).toBe(m.tileCount * H);
  });
});

describe('envelopes (M5)', () => {
  const THESIS = {
    id: 'thesis',
    name: 'Thesis',
    measure: 'tasks' as const,
    target: 1,
    dueDay: null,
    position: 'm',
  };
  const links = [{ goalId: 'thesis', itemId: 'Draft' }];
  const week = () =>
    mosaic({
      items: [item('Draft', { estimateMinutes: 3 * H }), item('Other', { estimateMinutes: 2 * H })],
      occurrences: [occurrence('Stand-up', at('2026-11-02', 9), at('2026-11-02', 11))],
    });

  it('an envelope spends the committed tiles of its own tasks, and only those', () => {
    const e = envelopesOf(week(), [{ ...THESIS, weeklyMinutes: 8 * H }], links);
    expect(e.envelopes).toHaveLength(1);
    expect(e.envelopes[0]).toMatchObject({ budget: 8 * H, committed: 3 * H, lived: 0, over: 0 });
    expect(e.envelopes[0]?.used.rows.map((r) => [r.title, r.minutes])).toEqual([['Draft', 3 * H]]);
    // 40h of capacity, 2h reserved, 8h promised: 30h of margin.
    expect(e.margin).toBe(30 * H);
    expect(e.overPromised).toBe(0);
  });

  it('going over the budget is recorded, never refused', () => {
    const e = envelopesOf(week(), [{ ...THESIS, weeklyMinutes: 2 * H }], links);
    expect(e.envelopes[0]?.over).toBe(H);
  });

  it('promises beyond the open week are said, and the margin is none', () => {
    const e = envelopesOf(week(), [{ ...THESIS, weeklyMinutes: 39 * H }], links);
    expect(e.overPromised).toBe(H);
    expect(e.margin).toBe(0);
  });

  it('a goal with no weekly budget has no envelope', () => {
    expect(
      envelopesOf(week(), [THESIS, { ...THESIS, id: 'x', weeklyMinutes: null }], links).envelopes,
    ).toEqual([]);
  });
});
