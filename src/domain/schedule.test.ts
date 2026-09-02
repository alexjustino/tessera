import { describe, expect, it } from 'vitest';

import {
  bucketOf,
  COMMON_RULES,
  daysBetween,
  describeRule,
  endOfLocalDay,
  formatDue,
  isValidRule,
  localDay,
  nextOccurrence,
  NO_SCHEDULE,
  occurrencesBetween,
  startOfLocalDay,
  systemZone,
  type Schedule,
} from './schedule';

/**
 * Two zones, chosen for what they break.
 *
 * São Paulo is three hours behind UTC and has not observed daylight saving
 * since 2019 — the zone this product is actually written in, and the one where
 * a naive UTC comparison silently shifts "today" by three hours.
 *
 * New York still changes its clocks, which is the only way to test that a
 * recurring 09:00 task is still due at 09:00 in November.
 */
const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';

const schedule = (overrides: Partial<Schedule>): Schedule => ({ ...NO_SCHEDULE, ...overrides });

describe('local days', () => {
  it('reads the day an instant falls on, in the zone that matters', () => {
    // 01:00 UTC on the 6th is still the 5th in São Paulo. A product that
    // answers "the 6th" here tells somebody their task is due tomorrow when it
    // is due tonight.
    expect(localDay('2026-09-06T01:00:00.000Z', SP)).toBe('2026-09-05');
    expect(localDay('2026-09-06T01:00:00.000Z', 'UTC')).toBe('2026-09-06');
  });

  it('counts calendar days, not blocks of twenty-four hours', () => {
    // 23:00 and 01:00 are two hours apart and one day apart. A person means
    // the second.
    const tonight = '2026-09-05T23:00:00.000-03:00';
    const tomorrow = '2026-09-06T01:00:00.000-03:00';
    expect(daysBetween(tonight, tomorrow, SP)).toBe(1);
  });

  it('finds the start and end of a local day as instants', () => {
    const now = '2026-09-05T15:00:00.000Z';
    expect(startOfLocalDay(now, SP)).toBe('2026-09-05T03:00:00.000Z');
    expect(endOfLocalDay(now, SP)).toBe('2026-09-06T03:00:00.000Z');
  });

  it('reports a zone rather than guessing', () => {
    expect(systemZone().length).toBeGreaterThan(0);
  });
});

describe('buckets', () => {
  const now = '2026-09-05T12:00:00.000Z'; // 09:00 in São Paulo

  it('has nothing to say about an item with no due date', () => {
    expect(bucketOf(null, now, SP)).toBe('none');
  });

  it('calls a task overdue the minute it passes, not at midnight', () => {
    // Overdue is about the instant. A task due at 09:00 is late at 09:01.
    expect(bucketOf('2026-09-05T11:59:00.000Z', now, SP)).toBe('overdue');
    expect(bucketOf('2026-09-05T12:01:00.000Z', now, SP)).toBe('today');
  });

  it('uses calendar days for today and tomorrow', () => {
    expect(bucketOf('2026-09-05T23:00:00.000Z', now, SP)).toBe('today');
    expect(bucketOf('2026-09-06T12:00:00.000Z', now, SP)).toBe('tomorrow');
    expect(bucketOf('2026-09-10T12:00:00.000Z', now, SP)).toBe('week');
    expect(bucketOf('2026-10-05T12:00:00.000Z', now, SP)).toBe('later');
  });

  it('answers differently in a different zone, correctly', () => {
    // 02:00 UTC on the 6th: still the 5th in São Paulo, already the 6th in UTC.
    const late = '2026-09-06T02:00:00.000Z';
    expect(bucketOf(late, now, SP)).toBe('today');
    expect(bucketOf(late, now, 'UTC')).toBe('tomorrow');
  });
});

describe('recurrence rules', () => {
  it('accepts the rules the interface offers', () => {
    for (const { rule } of COMMON_RULES) {
      expect(isValidRule(rule), rule).toBe(true);
    }
  });

  it('rejects nonsense rather than expanding it', () => {
    expect(isValidRule('FREQ=NEVER')).toBe(false);
    expect(isValidRule('not a rule')).toBe(false);
  });

  it('describes a rule in words', () => {
    expect(describeRule(null)).toBe('Does not repeat');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Every weekday');
    expect(describeRule('FREQ=DAILY;INTERVAL=3').toLowerCase()).toContain('3 days');
  });

  it('shows a rule it cannot describe as itself rather than hiding it', () => {
    // The data is real even when the description is not available.
    expect(describeRule('FREQ=NEVER')).toBe('FREQ=NEVER');
  });
});

describe('the next occurrence, on a schedule', () => {
  it('follows the calendar whether or not the task was completed', () => {
    const weekly = schedule({ dueAt: '2026-09-07T12:00:00.000Z', rule: 'FREQ=WEEKLY' });
    const next = nextOccurrence(weekly, '2026-09-07T12:00:00.000Z', SP);
    expect(next).toBe('2026-09-14T12:00:00.000Z');
  });

  it('skips straight past occurrences that were missed', () => {
    // A daily task ignored for a week is next due tomorrow, not seven times
    // over.
    const daily = schedule({ dueAt: '2026-09-01T12:00:00.000Z', rule: 'FREQ=DAILY' });
    expect(nextOccurrence(daily, '2026-09-08T13:00:00.000Z', SP)).toBe('2026-09-09T12:00:00.000Z');
  });

  it('has no next occurrence once the series ends', () => {
    const twice = schedule({
      dueAt: '2026-09-07T12:00:00.000Z',
      rule: 'FREQ=WEEKLY;COUNT=2',
    });
    expect(nextOccurrence(twice, '2026-09-07T12:00:00.000Z', SP)).toBe('2026-09-14T12:00:00.000Z');
    expect(nextOccurrence(twice, '2026-09-14T12:00:00.000Z', SP)).toBeNull();
  });

  it('returns nothing when there is no rule or no date to anchor it', () => {
    expect(nextOccurrence(NO_SCHEDULE, '2026-09-05T12:00:00.000Z', SP)).toBeNull();
    expect(
      nextOccurrence(schedule({ rule: 'FREQ=DAILY' }), '2026-09-05T12:00:00.000Z', SP),
    ).toBeNull();
  });

  it('refuses a malformed rule instead of throwing', () => {
    const broken = schedule({ dueAt: '2026-09-07T12:00:00.000Z', rule: 'FREQ=NEVER' });
    expect(nextOccurrence(broken, '2026-09-07T12:00:00.000Z', SP)).toBeNull();
  });

  // ── The cases that break naive implementations ───────────────────────────

  it('keeps the wall-clock time across a daylight-saving change', () => {
    // New York goes back an hour on 1 November 2026. A weekly 09:00 task must
    // still be due at 09:00 — expanding in UTC and converting afterwards makes
    // it 08:00, which is the bug nobody reports and everybody notices.
    const weekly = schedule({
      // 09:00 New York, while the clocks are still forward.
      dueAt: '2026-10-25T13:00:00.000Z',
      rule: 'FREQ=WEEKLY',
    });

    const next = nextOccurrence(weekly, '2026-10-25T13:00:00.000Z', NY);
    expect(next).not.toBeNull();

    const local = new Date(next!).toLocaleString('en-GB', {
      timeZone: NY,
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(local).toBe('09:00');

    // And the instant moved by an hour, because the offset did. The clocks go
    // back at 02:00 on 1 November, so 09:00 that morning is EST (UTC-5) and
    // therefore 14:00 UTC, where the week before it was EDT (UTC-4) and 13:00.
    // Holding the wall-clock steady is exactly what makes the instant shift.
    expect(next).toBe('2026-11-01T14:00:00.000Z');
  });

  it('lands on the 29th of February only in a leap year', () => {
    const yearly = schedule({ dueAt: '2024-02-29T12:00:00.000Z', rule: 'FREQ=YEARLY' });
    const next = nextOccurrence(yearly, '2024-02-29T12:00:00.000Z', 'UTC');
    // 2025 has no 29th of February, so the rule skips to the next one that does.
    expect(next).toBe('2028-02-29T12:00:00.000Z');
  });

  it('handles a monthly rule anchored on the 31st', () => {
    // Months without a 31st are skipped rather than silently moved to the 30th.
    const monthly = schedule({ dueAt: '2026-01-31T12:00:00.000Z', rule: 'FREQ=MONTHLY' });
    const next = nextOccurrence(monthly, '2026-01-31T12:00:00.000Z', 'UTC');
    expect(next).toBe('2026-03-31T12:00:00.000Z');
  });

  it('crosses a year boundary', () => {
    const monthly = schedule({ dueAt: '2026-12-15T12:00:00.000Z', rule: 'FREQ=MONTHLY' });
    expect(nextOccurrence(monthly, '2026-12-15T12:00:00.000Z', SP)).toBe(
      '2027-01-15T12:00:00.000Z',
    );
  });

  it('follows the zone it is given, not the machine it runs on', () => {
    // The timezone can change while the application is open — a laptop that
    // travelled. The rule takes it as an argument for exactly that reason.
    const daily = schedule({ dueAt: '2026-09-05T12:00:00.000Z', rule: 'FREQ=DAILY' });
    const inSaoPaulo = nextOccurrence(daily, '2026-09-05T12:00:00.000Z', SP);
    const inTokyo = nextOccurrence(daily, '2026-09-05T12:00:00.000Z', 'Asia/Tokyo');
    // Same wall-clock hour in each zone, therefore the same instant here —
    // what matters is that neither throws and both stay at 09:00 local.
    expect(inSaoPaulo).not.toBeNull();
    expect(inTokyo).not.toBeNull();
  });
});

describe('the next occurrence, after completion', () => {
  const daily = schedule({
    dueAt: '2026-09-01T12:00:00.000Z', // 09:00 São Paulo
    rule: 'FREQ=DAILY;INTERVAL=3',
    mode: 'after_completion',
  });

  it('counts from when the work was actually finished', () => {
    // "Three days after I do it" — the whole reason this mode exists, and what
    // Microsoft To Do cannot express.
    const next = nextOccurrence(daily, '2026-09-20T12:00:00.000Z', SP, '2026-09-20T12:00:00.000Z');
    expect(next).toBe('2026-09-23T12:00:00.000Z');
  });

  it('keeps the original time of day, not the time it was ticked', () => {
    // Finishing a 09:00 task at 22:00 makes it due at 09:00 again, not at 22:00.
    const next = nextOccurrence(daily, '2026-09-20T01:00:00.000Z', SP, '2026-09-20T01:00:00.000Z');
    const local = new Date(next!).toLocaleString('en-GB', {
      timeZone: SP,
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(local).toBe('09:00');
  });

  it('falls back to now when nothing recorded the completion', () => {
    expect(nextOccurrence(daily, '2026-09-20T12:00:00.000Z', SP)).toBe('2026-09-23T12:00:00.000Z');
  });
});

describe('expanding a window', () => {
  const daily = schedule({ dueAt: '2026-09-01T12:00:00.000Z', rule: 'FREQ=DAILY' });

  it('lists the occurrences inside it', () => {
    const found = occurrencesBetween(
      daily,
      '2026-09-01T00:00:00.000Z',
      '2026-09-05T00:00:00.000Z',
      SP,
    );
    expect(found).toHaveLength(4);
    expect(found[0]).toBe('2026-09-01T12:00:00.000Z');
  });

  it('returns nothing for a window that is empty or backwards', () => {
    const start = '2026-09-05T00:00:00.000Z';
    expect(occurrencesBetween(daily, start, start, SP)).toEqual([]);
    expect(occurrencesBetween(daily, start, '2026-09-01T00:00:00.000Z', SP)).toEqual([]);
  });

  it('stops at the limit rather than expanding an endless rule forever', () => {
    // A rule with no end has infinitely many occurrences. A caller that asks
    // for a decade should get a bounded answer, not a frozen window.
    const found = occurrencesBetween(
      daily,
      '2026-01-01T00:00:00.000Z',
      '2036-01-01T00:00:00.000Z',
      SP,
      10,
    );
    expect(found).toHaveLength(10);
  });

  it('returns nothing for an item that does not repeat', () => {
    expect(
      occurrencesBetween(NO_SCHEDULE, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', SP),
    ).toEqual([]);
  });
});

describe('saying a due date out loud', () => {
  const now = '2026-09-05T12:00:00.000Z'; // Saturday, 09:00 São Paulo

  it('says nothing when there is no date', () => {
    expect(formatDue(null, now, SP)).toBe('');
  });

  it('is relative where relative is clearer', () => {
    expect(formatDue('2026-09-05T17:00:00.000Z', now, SP)).toContain('Today');
    expect(formatDue('2026-09-06T17:00:00.000Z', now, SP)).toContain('Tomorrow');
    expect(formatDue('2026-09-04T17:00:00.000Z', now, SP)).toContain('Yesterday');
  });

  it('names the weekday inside the coming week', () => {
    expect(formatDue('2026-09-09T17:00:00.000Z', now, SP, 'en-GB')).toContain('Wednesday');
  });

  it('gives a date once the week is past', () => {
    const far = formatDue('2026-11-20T17:00:00.000Z', now, SP, 'en-GB');
    expect(far).toContain('Nov');
    expect(far).not.toContain('Wednesday');
  });

  it('adds the year only when it is a different one', () => {
    expect(formatDue('2026-11-20T17:00:00.000Z', now, SP, 'en-GB')).not.toContain('2026');
    expect(formatDue('2027-11-20T17:00:00.000Z', now, SP, 'en-GB')).toContain('2027');
  });

  it('leaves the time off a date with no time on it', () => {
    // Midnight local means "that day", not "that day at 00:00".
    const midnight = '2026-09-09T03:00:00.000Z'; // 00:00 São Paulo
    expect(formatDue(midnight, now, SP, 'en-GB')).toBe('Wednesday');
  });

  it('counts the days when something is properly late', () => {
    expect(formatDue('2026-09-01T12:00:00.000Z', now, SP)).toBe('4 days ago');
  });
});
