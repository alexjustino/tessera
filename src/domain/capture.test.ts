import { describe, expect, it } from 'vitest';

import { parseCapture, withoutChip } from './capture';

// Thursday 3 September 2026, 10:00 in São Paulo (UTC−3) — 13:00Z.
const NOW = '2026-09-03T13:00:00.000Z';
const ZONE = 'America/Sao_Paulo';

const parse = (text: string) => parseCapture(text, NOW, ZONE);
const local = (iso: string | null) =>
  iso === null
    ? null
    : new Intl.DateTimeFormat('en-GB', {
        timeZone: ZONE,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(iso));

describe('parseCapture — nothing to understand', () => {
  it('leaves a plain title alone', () => {
    const c = parse('Call the plumber');
    expect(c).toMatchObject({ title: 'Call the plumber', dueAt: null, rule: null, priority: null });
    expect(c.chips).toEqual([]);
  });

  it('does not read numbers, brand names or ordinary words as phrases', () => {
    expect(parse('Buy 2 apples').title).toBe('Buy 2 apples');
    expect(parse('Meet the at&t rep').title).toBe('Meet the at&t rep');
    expect(parse('Email everyone').title).toBe('Email everyone');
    expect(parse('I sat down with Bob').title).toBe('I sat down with Bob');
    expect(parse('Fix !important CSS').title).toBe('Fix !important CSS');
    expect(parse('Arrive at 25').title).toBe('Arrive at 25');
  });
});

describe('parseCapture — dates', () => {
  it('today and tomorrow are due at the end of that local day', () => {
    expect(local(parse('Pay rent today').dueAt)).toBe('03/09/2026, 23:59');
    expect(local(parse('Pay rent tomorrow').dueAt)).toBe('04/09/2026, 23:59');
    expect(parse('Pay rent tomorrow').title).toBe('Pay rent');
    expect(parse('Pay rent tomorrow').chips).toEqual([
      { kind: 'date', text: 'tomorrow', label: 'Tomorrow', start: 9, end: 17 },
    ]);
  });

  it('tonight is 20:00 unless a time is given', () => {
    expect(local(parse('Read tonight').dueAt)).toBe('03/09/2026, 20:00');
    expect(local(parse('Read tonight at 9pm').dueAt)).toBe('03/09/2026, 21:00');
  });

  it('a weekday means the coming one, never today; "next" changes nothing', () => {
    // NOW is a Thursday.
    expect(local(parse('Gym on friday').dueAt)).toBe('04/09/2026, 23:59');
    expect(local(parse('Gym thursday').dueAt)).toBe('10/09/2026, 23:59');
    expect(local(parse('Gym next monday').dueAt)).toBe('07/09/2026, 23:59');
    expect(local(parse('Gym on mon').dueAt)).toBe('07/09/2026, 23:59');
    expect(parse('Gym on friday').title).toBe('Gym');
    // Friday is tomorrow from this Thursday, and the label says so.
    expect(parse('Gym on friday').chips[0]?.label).toBe('Tomorrow');
    expect(parse('Gym on saturday').chips[0]?.label).toBe('Sat 5 Sep');
  });

  it('next week is the coming Monday; next month is its first day', () => {
    expect(local(parse('Plan next week').dueAt)).toBe('07/09/2026, 23:59');
    expect(local(parse('Invoice next month').dueAt)).toBe('01/10/2026, 23:59');
  });

  it('in N days/weeks/months counts calendar units', () => {
    expect(local(parse('Follow up in 3 days').dueAt)).toBe('06/09/2026, 23:59');
    expect(local(parse('Follow up in 2 weeks').dueAt)).toBe('17/09/2026, 23:59');
    expect(local(parse('Follow up in 1 month').dueAt)).toBe('03/10/2026, 23:59');
    expect(parse('Follow up in 3 days').title).toBe('Follow up');
  });

  it('in N hours/minutes is relative to now, to the minute', () => {
    expect(local(parse('Stand up in 2 hours').dueAt)).toBe('03/09/2026, 12:00');
    expect(local(parse('Stand up in 45 min').dueAt)).toBe('03/09/2026, 10:45');
    expect(parse('Stand up in 2 hours').chips[0]?.label).toBe('In 2 hours');
  });

  it('a month and day this year, or next year once it has passed', () => {
    expect(local(parse('Renew passport on sep 20').dueAt)).toBe('20/09/2026, 23:59');
    expect(local(parse('Renew passport 20 sep').dueAt)).toBe('20/09/2026, 23:59');
    expect(local(parse('Renew passport on september 20th').dueAt)).toBe('20/09/2026, 23:59');
    expect(local(parse('Birthday on jan 5').dueAt)).toBe('05/01/2027, 23:59');
    expect(parse('Birthday on jan 5').chips[0]?.label).toBe('Tue 5 Jan 2027');
    expect(parse('Renew passport on sep 20').title).toBe('Renew passport');
  });

  it('refuses a day that does not exist in that month', () => {
    expect(parse('Party on feb 31').dueAt).toBeNull();
    expect(parse('Party on feb 31').title).toBe('Party on feb 31');
  });
});

describe('parseCapture — times', () => {
  it('a time alone is today if still ahead, otherwise tomorrow', () => {
    // NOW is 10:00 local.
    expect(local(parse('Call Bob at 5pm').dueAt)).toBe('03/09/2026, 17:00');
    expect(local(parse('Call Bob at 9am').dueAt)).toBe('04/09/2026, 09:00');
    expect(local(parse('Call Bob 5pm').dueAt)).toBe('03/09/2026, 17:00');
    expect(local(parse('Call Bob at 17:30').dueAt)).toBe('03/09/2026, 17:30');
    expect(local(parse('Call Bob at 14').dueAt)).toBe('03/09/2026, 14:00');
    expect(local(parse('Lunch at noon').dueAt)).toBe('03/09/2026, 12:00');
    expect(parse('Call Bob at 5pm').title).toBe('Call Bob');
    expect(parse('Call Bob at 5pm').chips[0]?.label).toBe('5:00 PM');
  });

  it('a date and a time combine, in either order', () => {
    expect(local(parse('Dentist tomorrow at 8:30am').dueAt)).toBe('04/09/2026, 08:30');
    expect(local(parse('Dentist at 8:30am tomorrow').dueAt)).toBe('04/09/2026, 08:30');
    expect(parse('Dentist at 8:30am tomorrow').title).toBe('Dentist');
    expect(parse('Dentist at 8:30am tomorrow').chips.map((c) => c.kind)).toEqual(['time', 'date']);
  });

  it('handles the twelve o clock edge cases', () => {
    expect(local(parse('x at 12am tomorrow').dueAt)).toBe('04/09/2026, 00:00');
    expect(local(parse('x at 12pm tomorrow').dueAt)).toBe('04/09/2026, 12:00');
    expect(local(parse('x at midnight tomorrow').dueAt)).toBe('04/09/2026, 00:00');
  });
});

describe('parseCapture — repeats', () => {
  it('every unit becomes an RRULE anchored on today', () => {
    const c = parse('Water plants every day');
    expect(c.rule).toBe('FREQ=DAILY');
    expect(local(c.dueAt)).toBe('03/09/2026, 23:59');
    expect(c.title).toBe('Water plants');
    expect(c.chips[0]).toMatchObject({ kind: 'repeat', label: 'Every day' });
    expect(parse('x every weekday').rule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(parse('x every 2 weeks').rule).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(parse('x monthly').rule).toBe('FREQ=MONTHLY');
    expect(parse('x annually').rule).toBe('FREQ=YEARLY');
  });

  it('every weekday-name anchors on the coming one and is not also a date', () => {
    const c = parse('Team sync every monday at 9am');
    expect(c.rule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(local(c.dueAt)).toBe('07/09/2026, 09:00');
    expect(c.title).toBe('Team sync');
    expect(c.chips.map((chip) => chip.kind)).toEqual(['repeat', 'time']);
  });

  it('a repeat with an explicit date anchors on that date', () => {
    expect(local(parse('Report every month starting on sep 30').dueAt)).toBe('30/09/2026, 23:59');
  });

  it('refuses a zero interval', () => {
    expect(parse('x every 0 days').rule).toBeNull();
  });
});

describe('parseCapture — priority and reminders', () => {
  it('reads the bang priority in words or numbers', () => {
    expect(parse('Ship it !high').priority).toBe('high');
    expect(parse('Ship it !1').priority).toBe('urgent');
    expect(parse('Ship it !med').priority).toBe('medium');
    expect(parse('!low Ship it').priority).toBe('low');
    expect(parse('!low Ship it').title).toBe('Ship it');
    expect(parse('Ship it !high').chips[0]).toMatchObject({
      label: 'High priority',
      text: '!high',
    });
  });

  it('a reminder is relative to the due time', () => {
    const at = parse('Dentist tomorrow at 9am remind me');
    expect(local(at.remindAt)).toBe('04/09/2026, 09:00');
    const lead = parse('Dentist tomorrow at 9am remind me 15m before');
    expect(local(lead.remindAt)).toBe('04/09/2026, 08:45');
    expect(lead.title).toBe('Dentist');
    expect(lead.chips.find((c) => c.kind === 'remind')?.label).toBe('Remind 15 min before');
    expect(local(parse('x tomorrow remind 1h before').remindAt)).toBe('04/09/2026, 22:59');
    expect(local(parse('x tomorrow remind me 1 day ahead').remindAt)).toBe('03/09/2026, 23:59');
  });

  it('a reminder with no date stays in the title', () => {
    const c = parse('Buy milk remind me');
    expect(c.remindAt).toBeNull();
    expect(c.title).toBe('Buy milk remind me');
    expect(c.chips).toEqual([]);
  });
});

describe('parseCapture — assembly', () => {
  it('everything at once, in any order, chips sorted by position', () => {
    const c = parse('!high Review contract every friday at 3pm remind me 1h before');
    expect(c.title).toBe('Review contract');
    expect(c.priority).toBe('high');
    expect(c.rule).toBe('FREQ=WEEKLY;BYDAY=FR');
    expect(local(c.dueAt)).toBe('04/09/2026, 15:00');
    expect(local(c.remindAt)).toBe('04/09/2026, 14:00');
    expect(c.chips.map((chip) => chip.kind)).toEqual(['priority', 'repeat', 'time', 'remind']);
    const positions = c.chips.map((chip) => chip.start);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('is deterministic for the same now and zone', () => {
    expect(parse('Dentist tomorrow at 9am')).toEqual(parse('Dentist tomorrow at 9am'));
  });

  it('respects the zone: the same words are different instants elsewhere', () => {
    const here = parseCapture('x tomorrow at 9am', NOW, 'America/Sao_Paulo').dueAt;
    const tokyo = parseCapture('x tomorrow at 9am', NOW, 'Asia/Tokyo').dueAt;
    expect(here).toBe('2026-09-04T12:00:00.000Z');
    expect(tokyo).toBe('2026-09-04T00:00:00.000Z');
  });

  it('withoutChip keeps the words and stops them being read again', () => {
    const c = parse('Pay rent tomorrow');
    const text = withoutChip('Pay rent tomorrow', c.chips[0]!);
    expect(text).toBe('Pay rent [tomorrow]');
    const again = parse(text);
    expect(again.dueAt).toBeNull();
    expect(again.title).toBe('Pay rent [tomorrow]');
  });
});
