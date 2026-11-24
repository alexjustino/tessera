import { describe, expect, it } from 'vitest';

import type { Suggestion } from './autoPlan';
import type { CalendarEvent, Occurrence } from './calendar';
import type { Item } from './item';
import { pickNow } from './now';
import type { Entry } from './time';

const NOW = '2026-11-02T15:00:00.000Z';

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({ id, title: `Task ${id}`, completedAt: null, ...over }) as Item;

const occurrence = (
  id: string,
  startsAt: string,
  endsAt: string,
  itemId: string | null = null,
  allDay = false,
): Occurrence => ({
  event: { id, title: id, allDay, itemId } as unknown as CalendarEvent,
  startsAt,
  endsAt,
  originalStart: startsAt,
});

const suggestion = (itemId: string, startsAt: string): Suggestion =>
  ({ key: itemId, itemId, title: `Task ${itemId}`, startsAt, minutes: 60 }) as Suggestion;

const input = (over: Partial<Parameters<typeof pickNow>[0]> = {}) => ({
  now: NOW,
  entries: [] as Entry[],
  items: [item('a'), item('b')],
  occurrences: [] as Occurrence[],
  suggestions: [] as Suggestion[],
  ...over,
});

const DURING = ['2026-11-02T14:30:00.000Z', '2026-11-02T15:30:00.000Z'] as const;
const LATER = ['2026-11-02T17:00:00.000Z', '2026-11-02T18:00:00.000Z'] as const;

describe('what to do now', () => {
  it('a running clock comes first, whatever the calendar says', () => {
    const pick = pickNow(
      input({
        entries: [{ id: 'e', itemId: 'b', startedAt: NOW, endedAt: null } as Entry],
        occurrences: [occurrence('block', ...DURING, 'a')],
      }),
    );
    expect(pick).toMatchObject({ kind: 'running', itemId: 'b', title: 'Task b' });
  });

  it('then the time reserved for a task right now', () => {
    const pick = pickNow(input({ occurrences: [occurrence('block', ...DURING, 'a')] }));
    expect(pick).toMatchObject({ kind: 'reserved', itemId: 'a', endsAt: DURING[1] });
  });

  it('prefers the work over a meeting at the same time, since the work can be started', () => {
    const pick = pickNow(
      input({
        occurrences: [occurrence('meeting', ...DURING), occurrence('block', ...DURING, 'a')],
      }),
    );
    expect(pick?.kind).toBe('reserved');
  });

  it('says you are in a meeting, with nothing to start', () => {
    const pick = pickNow(input({ occurrences: [occurrence('meeting', ...DURING)] }));
    expect(pick).toMatchObject({ kind: 'event', title: 'meeting' });
  });

  it('otherwise whichever comes sooner of what is reserved and what is suggested', () => {
    const soon = suggestion('b', '2026-11-02T16:00:00.000Z');
    expect(
      pickNow(input({ occurrences: [occurrence('block', ...LATER, 'a')], suggestions: [soon] })),
    ).toMatchObject({ kind: 'suggested', suggestion: soon });

    const late = suggestion('b', '2026-11-02T20:00:00.000Z');
    expect(
      pickNow(input({ occurrences: [occurrence('block', ...LATER, 'a')], suggestions: [late] })),
    ).toMatchObject({ kind: 'next', itemId: 'a', title: 'Task a' });
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('has nothing to say when there is nothing', () => {
    expect(pickNow(input())).toBeNull();
  });

  it('does not offer time reserved for a task that is already finished', () => {
    const pick = pickNow(
      input({
        items: [item('a', { completedAt: NOW })],
        occurrences: [occurrence('block', ...DURING, 'a')],
      }),
    );
    expect(pick).toBeNull();
  });

  it('does not take an all-day event for what is happening now', () => {
    const pick = pickNow(input({ occurrences: [occurrence('holiday', ...DURING, null, true)] }));
    expect(pick).toBeNull();
  });

  it('does not offer what has already ended', () => {
    const pick = pickNow(
      input({
        occurrences: [occurrence('gone', '2026-11-02T12:00:00.000Z', '2026-11-02T13:00:00.000Z')],
      }),
    );
    expect(pick).toBeNull();
  });

  it('a finished clock is not a running one', () => {
    const pick = pickNow(
      input({ entries: [{ id: 'e', itemId: 'b', startedAt: NOW, endedAt: NOW } as Entry] }),
    );
    expect(pick).toBeNull();
  });
});
