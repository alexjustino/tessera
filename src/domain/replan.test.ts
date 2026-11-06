import { describe, expect, it } from 'vitest';

import type { CalendarEvent, Occurrence, WorkHours } from './calendar';
import type { Item } from './item';
import type { LedgerInput } from './receipt';
import { lateTasks, planReplan } from './replan';

const SP = 'America/Sao_Paulo';

/** Monday to Friday, nine to five. 2026-11-04 is a Wednesday. */
const HOURS: WorkHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startsMinute: 9 * 60,
  endsMinute: 17 * 60,
}));

/** A local wall clock in Sao Paulo (UTC-3) as an instant. */
const at = (day: string, hour: number, minute = 0) =>
  new Date(
    `${day}T${String(hour + 3).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
  ).toISOString();

/** Wednesday, 10:00. */
const NOW = at('2026-11-04', 10);

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    position: id,
    startAt: null,
    dueAt: at('2026-11-02', 17),
    remindAt: null,
    recurrenceRule: null,
    completedAt: null,
    isMilestone: false,
    estimateMinutes: 60,
    ...over,
  }) as Item;

const event = (id: string, day: string, from: number, to: number, itemId: string | null = null) =>
  ({
    event: { id, title: id, allDay: false, itemId } as unknown as CalendarEvent,
    startsAt: at(day, from),
    endsAt: at(day, to),
    originalStart: at(day, from),
  }) as Occurrence;

const input = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  today: '2026-11-04',
  zone: SP,
  hours: HOURS,
  occurrences: [],
  items: [],
  edges: [],
  goals: [],
  goalLinks: [],
  tracked: new Map(),
  minuteNow: 10 * 60,
  ...over,
});

describe('what is late', () => {
  it('is open work whose date has gone', () => {
    const late = lateTasks(
      [
        item('late'),
        item('ahead', { dueAt: at('2026-11-05', 9) }),
        item('done', { completedAt: NOW }),
        item('milestone', { isMilestone: true }),
        item('undated', { dueAt: null }),
      ],
      NOW,
    );
    expect(late.map((task) => task.id)).toEqual(['late']);
  });
});

describe('replanning late work', () => {
  it('gives each late task the next free time, and moves its date to that day', () => {
    const plan = planReplan(input({ items: [item('a'), item('b')] }), NOW);
    expect(plan.changes.map((c) => [c.itemId, c.blocks, c.day])).toEqual([
      ['a', [{ startsAt: at('2026-11-04', 10), endsAt: at('2026-11-04', 11) }], '2026-11-04'],
      ['b', [{ startsAt: at('2026-11-04', 11), endsAt: at('2026-11-04', 12) }], '2026-11-04'],
    ]);
  });

  it('lists the moves in the order the time comes, whatever the ids', () => {
    const plan = planReplan(
      input({
        items: [
          // Same date, so both new dates are the same: only the blocks tell them apart.
          item('z-first', { position: 'a' }),
          item('a-second', { position: 'b' }),
        ],
      }),
      NOW,
    );
    expect(plan.changes.map((c) => c.itemId)).toEqual(['z-first', 'a-second']);
  });

  it('keeps the time of day the date was set for, when the day still allows it', () => {
    const [change] = planReplan(input({ items: [item('a')] }), NOW).changes;
    // Due at five; the block ends at eleven, so five still stands.
    expect(change?.dueAt).toBe(at('2026-11-04', 17));
    expect(change?.previousDueAt).toBe(at('2026-11-02', 17));
  });

  it('dates it when its block ends, when the old time of day comes before that', () => {
    const [change] = planReplan(
      input({ items: [item('a', { dueAt: at('2026-11-02', 9) })] }),
      NOW,
    ).changes;
    expect(change?.dueAt).toBe(at('2026-11-04', 11));
  });

  it('moves a reminder by as much as the date, so it rings as far ahead', () => {
    const [change] = planReplan(
      input({ items: [item('a', { remindAt: at('2026-11-02', 16) })] }),
      NOW,
    ).changes;
    expect(change?.remindAt).toBe(at('2026-11-04', 16));
    expect(change?.previousRemindAt).toBe(at('2026-11-02', 16));
  });

  it('goes round what the calendar holds, and never on top of it', () => {
    const plan = planReplan(
      input({ items: [item('a')], occurrences: [event('meeting', '2026-11-04', 10, 12)] }),
      NOW,
    );
    expect(plan.changes[0]?.blocks).toEqual([
      { startsAt: at('2026-11-04', 12), endsAt: at('2026-11-04', 13) },
    ]);
  });

  it('plans late work before work that is not late', () => {
    const plan = planReplan(
      input({ items: [item('ahead', { dueAt: at('2026-11-04', 12) }), item('late')] }),
      NOW,
    );
    expect(plan.changes.map((c) => c.itemId)).toEqual(['late']);
    expect(plan.changes[0]?.blocks[0]?.startsAt).toBe(at('2026-11-04', 10));
  });

  it('gives what is left of an estimate, not all of it', () => {
    const plan = planReplan(
      input({
        items: [item('a', { estimateMinutes: 180 })],
        tracked: new Map([['a', 120]]),
      }),
      NOW,
    );
    expect(plan.changes[0]?.blocks).toEqual([
      { startsAt: at('2026-11-04', 10), endsAt: at('2026-11-04', 11) },
    ]);
  });

  it('says when a length is assumed', () => {
    const plan = planReplan(input({ items: [item('a', { estimateMinutes: null })] }), NOW);
    expect(plan.changes[0]?.assumed).toBe(true);
    expect(plan.changes[0]?.blocks).toHaveLength(1);
  });

  it('a task with time set aside ahead keeps it, and only its date moves', () => {
    const plan = planReplan(
      input({ items: [item('a')], occurrences: [event('block', '2026-11-05', 14, 15, 'a')] }),
      NOW,
    );
    expect(plan.changes[0]?.blocks).toEqual([]);
    expect(plan.changes[0]?.day).toBe('2026-11-05');
    expect(plan.changes[0]?.dueAt).toBe(at('2026-11-05', 17));
  });

  it('a task whose blocks have all gone is planned again', () => {
    const plan = planReplan(
      input({
        items: [item('a', { estimateMinutes: null })],
        occurrences: [event('missed', '2026-11-04', 9, 10, 'a')],
        tracked: new Map([['a', 30]]),
      }),
      NOW,
    );
    expect(plan.changes[0]?.blocks).toHaveLength(1);
  });

  it('a late task waiting on late work comes after it', () => {
    const plan = planReplan(
      input({
        items: [item('second'), item('first')],
        edges: [{ blockerId: 'first', blockedId: 'second' }] as LedgerInput['edges'],
      }),
      NOW,
    );
    expect(plan.changes.map((c) => c.itemId)).toEqual(['first', 'second']);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves a repeating task alone, and says so', () => {
    const plan = planReplan(
      input({ items: [item('weekly', { recurrenceRule: 'FREQ=WEEKLY' })] }),
      NOW,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.repeating.map((l) => l.itemId)).toEqual(['weekly']);
  });

  it('leaves a task waiting on open work that is not late, and what waits on it', () => {
    const plan = planReplan(
      input({
        items: [item('ahead', { dueAt: at('2026-11-09', 9) }), item('blocked'), item('after')],
        edges: [
          { blockerId: 'ahead', blockedId: 'blocked' },
          { blockerId: 'blocked', blockedId: 'after' },
        ] as LedgerInput['edges'],
      }),
      NOW,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.waiting.map((l) => l.itemId).sort()).toEqual(['after', 'blocked']);
  });

  it('a finished blocker does not hold anything back', () => {
    const plan = planReplan(
      input({
        items: [item('done', { completedAt: NOW, dueAt: null }), item('blocked')],
        edges: [{ blockerId: 'done', blockedId: 'blocked' }] as LedgerInput['edges'],
      }),
      NOW,
    );
    expect(plan.changes.map((c) => c.itemId)).toEqual(['blocked']);
  });

  it('lists a task with no room, and changes nothing about it', () => {
    const plan = planReplan(input({ items: [item('a')], hours: [] }), NOW);
    expect(plan.changes).toEqual([]);
    expect(plan.noRoom.map((l) => l.itemId)).toEqual(['a']);
  });

  it('has nothing to do when nothing is late', () => {
    const plan = planReplan(input({ items: [item('a', { dueAt: at('2026-11-06', 9) })] }), NOW);
    expect(plan).toEqual({ changes: [], noRoom: [], repeating: [], waiting: [] });
  });

  it('never moves a milestone', () => {
    const plan = planReplan(input({ items: [item('m', { isMilestone: true })] }), NOW);
    expect(plan.changes).toEqual([]);
  });
});
