import { describe, expect, it } from 'vitest';

import { notesTemplate, notesTitle, whenAndWhere, type Meeting } from './meetingNotes';

const SP = 'America/Sao_Paulo';

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  title: 'Weekly sync',
  location: 'Room 2',
  // 10:00–11:00 in Sao Paulo (UTC-3).
  startsAt: '2026-11-09T13:00:00.000Z',
  endsAt: '2026-11-09T14:00:00.000Z',
  allDay: false,
  ...over,
});

describe('a meeting’s notes', () => {
  it('are named for the meeting and its day', () => {
    expect(notesTitle(meeting(), SP)).toBe('Weekly sync — Mon, Nov 9');
  });

  it('name the day it is where the person is, not in UTC', () => {
    // 22:30 on Monday in Sao Paulo is already Tuesday in UTC.
    const late = meeting({
      startsAt: '2026-11-10T01:30:00.000Z',
      endsAt: '2026-11-10T02:00:00.000Z',
    });
    expect(notesTitle(late, SP)).toBe('Weekly sync — Mon, Nov 9');
  });

  it('say when and where', () => {
    expect(whenAndWhere(meeting(), SP)).toBe('Mon, Nov 9 · 10:00–11:00 · Room 2');
  });

  it('open with when, then notes, decisions and follow-ups', () => {
    const nodes = notesTemplate(meeting(), SP);
    const headings = nodes
      .filter((node) => node.type === 'heading')
      .map((node) => node.content?.[0]?.text);
    expect(headings).toEqual(['Notes', 'Decisions', 'Follow-ups']);
    expect(nodes[0]?.content?.[0]?.text).toBe('Mon, Nov 9 · 10:00–11:00 · Room 2');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leave out the hours of an all-day meeting', () => {
    expect(whenAndWhere(meeting({ allDay: true }), SP)).toBe('Mon, Nov 9 · Room 2');
  });

  it('leave out a place that is not known, or is only spaces', () => {
    expect(whenAndWhere(meeting({ location: null }), SP)).toBe('Mon, Nov 9 · 10:00–11:00');
    expect(whenAndWhere(meeting({ location: '  ' }), SP)).toBe('Mon, Nov 9 · 10:00–11:00');
  });

  it('call a meeting with no name a meeting', () => {
    expect(notesTitle(meeting({ title: '  ' }), SP)).toBe('Meeting — Mon, Nov 9');
  });
});
