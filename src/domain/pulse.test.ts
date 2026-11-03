import { describe, expect, it } from 'vitest';

import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import type { Item } from './item';
import { pulseOf, todayMarkOf, wordFor, type PulseInput } from './pulse';
import type { Entry } from './time';

const SP = 'America/Sao_Paulo';
const NOW = '2026-11-02T15:00:00.000Z'; // Monday, noon in Sao Paulo

const HOURS: WorkHours[] = [{ weekday: 1, startsMinute: 9 * 60, endsMinute: 18 * 60 }];

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    dueAt: null,
    completedAt: null,
    isMilestone: false,
    estimateMinutes: null,
    ...over,
  }) as Item;

const entry = (id: string, startedAt: string, endedAt: string | null): Entry =>
  ({ id, itemId: 'a', startedAt, endedAt }) as Entry;

const occurrence = (id: string, startsAt: string, endsAt: string, allDay = false): Occurrence => ({
  event: { id, title: id, allDay, itemId: null } as unknown as CalendarEvent,
  startsAt,
  endsAt,
  originalStart: startsAt,
});

const input = (over: Partial<PulseInput> = {}): PulseInput => ({
  items: [],
  entries: [],
  occurrences: [],
  hours: HOURS,
  reserved: new Set(),
  now: NOW,
  zone: SP,
  ...over,
});

const TODAY_DUE = '2026-11-02T20:00:00.000Z';
const LATE = '2026-10-30T20:00:00.000Z';
const THIS_WEEK = '2026-11-05T20:00:00.000Z';

describe('the figures for today', () => {
  it('sorts the work into due, late and finished', () => {
    const pulse = pulseOf(
      input({
        items: [
          item('due', { dueAt: TODAY_DUE }),
          item('late', { dueAt: LATE }),
          item('done', { dueAt: TODAY_DUE, completedAt: '2026-11-02T14:00:00.000Z' }),
          item('later', { dueAt: THIS_WEEK }),
        ],
      }),
    );
    expect(pulse.due.map((task) => task.id)).toEqual(['due']);
    expect(pulse.overdue.map((task) => task.id)).toEqual(['late']);
    expect(pulse.done.map((task) => task.id)).toEqual(['done']);
  });

  it('counts what the calendar leaves free of the rest of the day', () => {
    const pulse = pulseOf(
      input({
        occurrences: [occurrence('talk', '2026-11-02T17:00:00.000Z', '2026-11-02T18:00:00.000Z')],
      }),
    );
    // Noon to 18:00 is six hours; the 14:00 meeting takes one of them.
    expect(pulse.free).toBe(5 * 60);
    expect(pulse.next?.event.id).toBe('talk');
  });

  it('does not take off the part of a meeting that has already gone', () => {
    const pulse = pulseOf(
      input({
        occurrences: [occurrence('talk', '2026-11-02T14:30:00.000Z', '2026-11-02T15:30:00.000Z')],
      }),
    );
    expect(pulse.free).toBe(6 * 60 - 30);
  });

  it('reads seven days, today last, with the gaps filled', () => {
    const pulse = pulseOf(
      input({
        items: [item('done', { completedAt: '2026-10-31T14:00:00.000Z' })],
        entries: [entry('e', '2026-11-02T13:00:00.000Z', '2026-11-02T14:00:00.000Z')],
      }),
    );
    expect(pulse.week).toHaveLength(7);
    expect(pulse.week.at(-1)).toEqual({ day: '2026-11-02', done: 0, tracked: 60 });
    expect(pulse.week.find((reading) => reading.day === '2026-10-31')?.done).toBe(1);
    expect(pulse.week[0]?.day).toBe('2026-10-27');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('has no free time on a day off, whatever the weekday says', () => {
    const pulse = pulseOf(input({ daysOff: new Set(['2026-11-02']) }));
    expect(pulse.capacity).toBe(0);
    expect(pulse.free).toBe(0);
  });

  it('leaves a milestone out of the work, because it takes no doing', () => {
    expect(
      pulseOf(input({ items: [item('m', { dueAt: TODAY_DUE, isMilestone: true })] })).due,
    ).toEqual([]);
  });

  it('does not offer a meeting that is over as what comes next', () => {
    const pulse = pulseOf(
      input({
        occurrences: [occurrence('gone', '2026-11-02T12:00:00.000Z', '2026-11-02T13:00:00.000Z')],
      }),
    );
    expect(pulse.next).toBeNull();
  });
});

describe('the score', () => {
  it('is half of the delivered points when half is delivered, and says the arithmetic', () => {
    const pulse = pulseOf(
      input({
        items: [
          item('due', { dueAt: TODAY_DUE }),
          item('done', { dueAt: TODAY_DUE, completedAt: '2026-11-02T14:00:00.000Z' }),
        ],
        reserved: new Set(['due']),
      }),
    );
    const delivered = pulse.parts.find((part) => part.id === 'delivered');
    expect(delivered?.share).toBe(0.5);
    expect(delivered?.says).toBe('1 of 2 tasks finished.');
    // Delivered 50 × 0.5 + Planned 25 × 1, over the 75 points that were measured.
    expect(pulse.score).toBe(67);
    expect(pulse.word).toBe('Steady');
  });

  it('counts the clock against the working time gone so far', () => {
    const pulse = pulseOf(
      input({
        entries: [entry('e', '2026-11-02T12:00:00.000Z', '2026-11-02T13:30:00.000Z')],
      }),
    );
    // 09:00 to noon is three hours gone; 90 minutes tracked is half.
    expect(pulse.parts.find((part) => part.id === 'focus')?.share).toBe(0.5);
    expect(pulse.score).toBe(50);
  });

  it('takes a late task as work not delivered, and says it is late', () => {
    const pulse = pulseOf(input({ items: [item('late', { dueAt: LATE })] }));
    const delivered = pulse.parts.find((part) => part.id === 'delivered');
    expect(delivered?.share).toBe(0);
    expect(delivered?.says).toBe('0 of 1 task finished, 1 of them late.');
    expect(pulse.word).toBe('Behind');
  });

  it('names each band of the score', () => {
    expect([wordFor(0), wordFor(50), wordFor(75), wordFor(90)]).toEqual([
      'Behind',
      'Steady',
      'On track',
      'Ahead',
    ]);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('gives no score when nothing could be measured, rather than a zero', () => {
    const pulse = pulseOf(input());
    expect(pulse.score).toBeNull();
    expect(pulse.word).toBeNull();
  });

  it('leaves focus out for someone who does not use the clock', () => {
    const pulse = pulseOf(input({ items: [item('due', { dueAt: TODAY_DUE })] }));
    const focus = pulse.parts.find((part) => part.id === 'focus');
    expect(focus?.share).toBeNull();
    expect(focus?.says).toContain('Not counted');
  });

  it('does not score focus before the working day has really started', () => {
    const early = '2026-11-02T12:05:00.000Z'; // 09:05 in Sao Paulo
    const pulse = pulseOf(
      input({
        now: early,
        entries: [entry('e', '2026-11-01T12:00:00.000Z', '2026-11-01T13:00:00.000Z')],
      }),
    );
    expect(pulse.parts.find((part) => part.id === 'focus')?.share).toBeNull();
  });

  it('does not reward more clock than the time that has gone', () => {
    const pulse = pulseOf(
      input({
        entries: [entry('e', '2026-11-02T03:00:00.000Z', '2026-11-02T15:00:00.000Z')],
      }),
    );
    expect(pulse.parts.find((part) => part.id === 'focus')?.share).toBe(1);
  });
});

describe('why a card matters today', () => {
  const mark = (task: Item, reserved: string[] = [], running: string | null = null) =>
    todayMarkOf(task, new Set(reserved), running, NOW, SP);

  it('names each reason, the strongest first', () => {
    expect(mark(item('a', { dueAt: LATE }), ['a'], 'a')).toBe('late');
    expect(mark(item('a', { dueAt: TODAY_DUE }), ['a'], 'a')).toBe('running');
    expect(mark(item('a', { dueAt: TODAY_DUE }), ['a'])).toBe('today');
    expect(mark(item('a', { dueAt: THIS_WEEK }), ['a'])).toBe('reserved');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves alone a task with nothing to do with today', () => {
    expect(mark(item('a', { dueAt: THIS_WEEK }))).toBeNull();
    expect(mark(item('a'))).toBeNull();
  });

  it('does not call finished work late', () => {
    expect(mark(item('a', { dueAt: LATE, completedAt: NOW }))).toBeNull();
  });
});
