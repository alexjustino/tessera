import { describe, expect, it } from 'vitest';

import { ASSUMED_MINUTES, suggestPlan } from './autoPlan';
import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import type { Item } from './item';
import type { LedgerInput } from './receipt';

const SP = 'America/Sao_Paulo';

/** Monday to Friday, nine to five. 2026-11-02 is a Monday. */
const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * 60,
  endsMinute: 17 * 60,
}));

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    position: id,
    startAt: null,
    dueAt: null,
    completedAt: null,
    isMilestone: false,
    estimateMinutes: 60,
    ...over,
  }) as Item;

/** A local wall clock in Sao Paulo (UTC-3) as an instant. */
const at = (day: string, hour: number) =>
  new Date(`${day}T${String(hour + 3).padStart(2, '0')}:00:00.000Z`).toISOString();

const event = (id: string, day: string, from: number, to: number, itemId: string | null = null) =>
  ({
    event: { id, title: id, allDay: false, itemId } as unknown as CalendarEvent,
    startsAt: at(day, from),
    endsAt: at(day, to),
    originalStart: at(day, from),
  }) as Occurrence;

const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  today: '2026-11-02',
  zone: SP,
  hours: HOURS,
  occurrences: [],
  items: [],
  edges: [],
  goals: [],
  goalLinks: [],
  tracked: new Map(),
  minuteNow: 9 * 60,
  ...over,
});

const places = (plan: ReturnType<typeof suggestPlan>) =>
  plan.suggestions.map((s) => `${s.itemId} ${s.day} ${s.startMinute} ${s.minutes}`);

describe('laying the work into free time', () => {
  it('fills from now, earliest date first', () => {
    const plan = suggestPlan(
      input({
        items: [
          item('later', { dueAt: at('2026-11-06', 12) }),
          item('sooner', { dueAt: at('2026-11-03', 12) }),
        ],
      }),
    );
    expect(places(plan)).toEqual(['sooner 2026-11-02 540 60', 'later 2026-11-02 600 60']);
    expect(plan.minutes).toBe(120);
  });

  it('goes round what the calendar holds', () => {
    const plan = suggestPlan(
      input({
        occurrences: [event('meeting', '2026-11-02', 9, 11)],
        items: [item('a')],
      }),
    );
    expect(places(plan)).toEqual(['a 2026-11-02 660 60']);
  });

  it('splits a long task across the free time and into the next day', () => {
    const plan = suggestPlan(
      input({
        occurrences: [event('lunch', '2026-11-02', 12, 13)],
        items: [item('long', { estimateMinutes: 10 * 60 })],
      }),
    );
    expect(places(plan)).toEqual([
      'long 2026-11-02 540 180',
      'long 2026-11-02 780 240',
      'long 2026-11-03 540 180',
    ]);
  });

  it('starts from the next quarter hour, not from the top of the day', () => {
    const plan = suggestPlan(input({ minuteNow: 10 * 60 + 7, items: [item('a')] }));
    expect(places(plan)).toEqual(['a 2026-11-02 615 60']);
  });

  it('counts down what was already tracked and reserved', () => {
    const plan = suggestPlan(
      input({
        tracked: new Map([['a', 30]]),
        occurrences: [event('block', '2026-11-03', 9, 10, 'a')],
        items: [item('a', { estimateMinutes: 120 })],
      }),
    );
    expect(places(plan)).toEqual(['a 2026-11-02 540 30']);
  });

  it('plans a task with no estimate at an hour, and says it assumed so', () => {
    const plan = suggestPlan(input({ items: [item('a', { estimateMinutes: null })] }));
    expect(plan.suggestions[0]?.minutes).toBe(ASSUMED_MINUTES);
    expect(plan.suggestions[0]?.assumed).toBe(true);
    expect(plan.assumed).toBe(1);
  });

  it('puts work after what blocks it, even when its date is earlier', () => {
    const plan = suggestPlan(
      input({
        items: [
          item('blocker', { dueAt: at('2026-11-06', 12) }),
          item('blocked', { dueAt: at('2026-11-03', 12) }),
        ],
        edges: [{ blockerId: 'blocker', blockedId: 'blocked' }],
      }),
    );
    expect(places(plan)).toEqual(['blocker 2026-11-02 540 60', 'blocked 2026-11-02 600 60']);
  });

  it('waits for a start day', () => {
    const plan = suggestPlan(input({ items: [item('a', { startAt: at('2026-11-04', 9) })] }));
    expect(plan.suggestions[0]?.day).toBe('2026-11-04');
  });

  it('marks what lands after its date, and counts the task once', () => {
    const plan = suggestPlan(
      input({
        items: [item('a', { estimateMinutes: 16 * 60, dueAt: at('2026-11-02', 17) })],
      }),
    );
    expect(plan.suggestions.map((s) => s.late)).toEqual([false, true]);
    expect(plan.late).toBe(1);
  });

  it('uses the rank between tasks with the same date', () => {
    const due = at('2026-11-03', 12);
    const plan = suggestPlan(
      input({ items: [item('low', { dueAt: due }), item('high', { dueAt: due })] }),
      { rankOf: (id) => (id === 'high' ? 0 : 1) },
    );
    expect(plan.suggestions[0]?.itemId).toBe('high');
  });

  it('gives the same plan for the same input', () => {
    const make = () =>
      suggestPlan(input({ items: [item('b'), item('a'), item('c', { estimateMinutes: 90 })] }));
    expect(places(make())).toEqual(places(make()));
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('never touches a day off or a day outside the working week', () => {
    const plan = suggestPlan(
      input({
        today: '2026-11-06',
        daysOff: new Set(['2026-11-06']),
        items: [item('a')],
      }),
    );
    // Friday is off, the weekend has no hours: Monday.
    expect(plan.suggestions[0]?.day).toBe('2026-11-09');
  });

  it('lays nothing in the part of today that has gone', () => {
    const plan = suggestPlan(input({ minuteNow: 18 * 60, items: [item('a')] }));
    expect(plan.suggestions[0]?.day).toBe('2026-11-03');
  });

  it('never lays two things in the same minute', () => {
    const plan = suggestPlan(
      input({
        occurrences: [event('m', '2026-11-02', 10, 11)],
        items: Array.from({ length: 12 }, (_, n) => item(`t${n}`, { estimateMinutes: 45 })),
      }),
    );
    const byDay = new Map<string, Array<[number, number]>>();
    for (const s of plan.suggestions) {
      byDay.set(s.day, [...(byDay.get(s.day) ?? []), [s.startMinute, s.startMinute + s.minutes]]);
    }
    for (const spans of byDay.values()) {
      spans.sort((a, b) => a[0] - b[0]);
      spans.forEach((span, i) => {
        if (i > 0) expect(span[0]).toBeGreaterThanOrEqual(spans[i - 1]![1]);
      });
    }
    expect(plan.suggestions.some((s) => s.day === '2026-11-02' && s.startMinute === 600)).toBe(
      false,
    );
  });

  it('leaves out finished work, milestones and what the person left out', () => {
    const plan = suggestPlan(
      input({
        items: [
          item('done', { completedAt: at('2026-11-01', 9) }),
          item('flag', { isMilestone: true }),
          item('skip'),
        ],
      }),
      { leaveOut: new Set(['skip']) },
    );
    expect(plan.suggestions).toEqual([]);
  });

  it('does not suggest more for a task already fully reserved', () => {
    const plan = suggestPlan(
      input({
        occurrences: [event('block', '2026-11-03', 9, 10, 'a')],
        items: [item('a', { estimateMinutes: 60 })],
      }),
    );
    expect(plan.suggestions).toEqual([]);
    expect(plan.unplaced).toEqual([]);
  });

  it('does not assume anything for a task someone has already set time aside for', () => {
    const plan = suggestPlan(
      input({
        occurrences: [event('block', '2026-11-03', 9, 10, 'a')],
        items: [item('a', { estimateMinutes: null })],
      }),
    );
    expect(plan.suggestions).toEqual([]);
  });

  it('says what did not fit rather than dropping it', () => {
    const plan = suggestPlan(input({ items: [item('huge', { estimateMinutes: 100 * 60 })] }), {
      horizonDays: 5,
    });
    expect(plan.unplaced).toEqual([{ itemId: 'huge', title: 'huge', minutes: 60 * 60 }]);
  });

  it('does not place work after a blocker that found no room at all', () => {
    const plan = suggestPlan(
      input({
        minuteNow: 18 * 60,
        items: [item('blocker', { estimateMinutes: 60 }), item('blocked')],
        edges: [{ blockerId: 'blocker', blockedId: 'blocked' }],
      }),
      { horizonDays: 1 },
    );
    expect(plan.suggestions).toEqual([]);
    expect(plan.unplaced.map((u) => u.itemId)).toEqual(['blocker', 'blocked']);
  });

  it('skips a sliver too small to start on, unless it finishes the task', () => {
    const blocked = suggestPlan(
      input({
        occurrences: [event('m', '2026-11-02', 9, 16)],
        minuteNow: 9 * 60,
        items: [item('a', { estimateMinutes: 120 })],
      }),
    );
    // Sixteen to seventeen is an hour: fine. Then Tuesday.
    expect(places(blocked)).toEqual(['a 2026-11-02 960 60', 'a 2026-11-03 540 60']);

    const sliver = suggestPlan(
      input({
        occurrences: [event('m', '2026-11-02', 9, 16)],
        minuteNow: 16 * 60 + 45,
        items: [item('a', { estimateMinutes: 15 }), item('b', { estimateMinutes: 60 })],
      }),
    );
    expect(places(sliver)).toEqual(['a 2026-11-02 1005 15', 'b 2026-11-03 540 60']);
  });

  it('lays a thousand tasks well inside a frame', () => {
    const items = Array.from({ length: 1000 }, (_, n) =>
      item(`t${String(n).padStart(4, '0')}`, { estimateMinutes: 30 }),
    );
    const started = performance.now();
    suggestPlan(input({ items }));
    expect(performance.now() - started).toBeLessThan(150);
  });
});
