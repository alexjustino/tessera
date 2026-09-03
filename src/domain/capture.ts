/**
 * Quick capture: one line of English becomes a task with a date, a time, a
 * repeat rule, a priority and a reminder.
 *
 * The grammar is deliberately small and stated here in full, because a parser
 * that guesses is worse than one that asks. Every recognised phrase becomes a
 * chip the interface shows *before* the task is created, so the person sees
 * exactly what was understood and what stays in the title — and can put a
 * phrase back into the title by removing the chip.
 *
 *   date      today · tomorrow · tonight · monday … sunday (full names anywhere,
 *             abbreviations only after "on"/"next") · next week · next month ·
 *             in N days/weeks/months/hours/minutes · 5 sep · sep 5 · on sep 5th
 *   time      at 5pm · at 17:30 · 5pm · 17:30 · at 14 · at noon · at midnight
 *   repeat    every day/weekday/week/month/year · every monday · every 2 weeks ·
 *             daily · weekly · monthly · yearly
 *   priority  !urgent !high !medium !low  or  !1 !2 !3 !4
 *   reminder  remind me · remind me 15m before · remind 1h before · remind 1d before
 *
 * Resolution rules, all of them visible in the tests:
 * - a date without a time is due at the end of that day (23:59 local), so it
 *   stays "today" for the whole day rather than turning overdue at 09:00;
 * - a time without a date is today if that is still ahead, otherwise tomorrow;
 * - "tonight" is 20:00 unless a time was given;
 * - a weekday means the coming one, never today; "next" changes nothing;
 * - a repeat with no date is anchored on today (or the coming weekday);
 * - a reminder needs a date to be relative to — with none, the words stay in
 *   the title, because a chip that does nothing is a lie.
 *
 * Pure: `now` and the zone come in as arguments (ADR-003, ADR-013).
 */

import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  getDay,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
  startOfDay,
  startOfMonth,
} from 'date-fns';

import { asInstant, asWallClock } from './schedule';

export type ChipKind = 'date' | 'time' | 'repeat' | 'priority' | 'remind';

export interface Chip {
  kind: ChipKind;
  /** The phrase as typed, e.g. `tomorrow`. */
  text: string;
  /** What it was understood as, e.g. `Tomorrow` or `Every week`. */
  label: string;
  /** Where the phrase sits in the source text — `[start, end)`. */
  start: number;
  end: number;
}

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface Capture {
  title: string;
  dueAt: string | null;
  remindAt: string | null;
  rule: string | null;
  priority: Priority | null;
  chips: readonly Chip[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const RRULE_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const WEEKDAY_FULL = WEEKDAYS.join('|');
const WEEKDAY_ANY = [...WEEKDAYS, ...WEEKDAY_SHORT, 'tues', 'thur', 'thurs'].join('|');
const MONTH_ANY = [...MONTHS, ...MONTHS.map((m) => m.slice(0, 3)), 'sept'].join('|');

const END_OF_DAY_HOUR = 23;
const END_OF_DAY_MINUTE = 59;
const TONIGHT_HOUR = 20;

interface Span {
  start: number;
  end: number;
}

interface Phrase extends Span {
  text: string;
}

interface DatePhrase extends Phrase {
  /** Resolve to a local wall-clock day, given the wall-clock "now". */
  resolve: (nowWall: Date) => Date;
  /** Some phrases carry their own clock: "in 2 hours", "tonight". */
  clock?: 'relative' | 'tonight';
  /** For a relative phrase: the offset from now, in minutes. */
  offsetMinutes?: number;
}

interface TimePhrase extends Phrase {
  hour: number;
  minute: number;
}

interface RepeatPhrase extends Phrase {
  rule: string;
  label: string;
  /** For "every monday": the weekday that anchors the first occurrence. */
  weekday?: number;
}

interface PriorityPhrase extends Phrase {
  level: Priority;
}

interface RemindPhrase extends Phrase {
  leadMinutes: number;
  label: string;
}

interface Pattern<T extends Phrase> {
  regex: RegExp;
  build: (match: RegExpExecArray) => T | null;
}

function weekdayIndex(word: string): number {
  const lower = word.toLowerCase();
  const full = WEEKDAYS.indexOf(lower);
  if (full !== -1) return full;
  return WEEKDAY_SHORT.indexOf(lower.slice(0, 3));
}

function monthIndex(word: string): number {
  const lower = word.toLowerCase();
  const full = MONTHS.indexOf(lower);
  if (full !== -1) return full;
  return MONTHS.findIndex((m) => m.slice(0, 3) === lower.slice(0, 3));
}

function comingWeekday(nowWall: Date, weekday: number): Date {
  const today = getDay(nowWall);
  const ahead = (weekday - today + 7) % 7 || 7;
  return startOfDay(addDays(nowWall, ahead));
}

function overlaps(span: Span, taken: readonly Span[]): boolean {
  return taken.some((other) => span.start < other.end && other.start < span.end);
}

function span(match: RegExpExecArray): Phrase {
  return { start: match.index, end: match.index + match[0].length, text: match[0] };
}

/**
 * The earliest phrase of one kind in the text that does not overlap a span
 * already claimed by another kind. One phrase per kind: a second date in the
 * same line stays in the title, where the person can see it was not read.
 */
function first<T extends Phrase>(
  text: string,
  patterns: ReadonlyArray<Pattern<T>>,
  taken: readonly Span[],
): T | null {
  let best: T | null = null;
  for (const { regex, build } of patterns) {
    const scanner = new RegExp(
      regex.source,
      regex.flags.includes('g') ? regex.flags : `${regex.flags}g`,
    );
    for (let match = scanner.exec(text); match !== null; match = scanner.exec(text)) {
      const phrase = build(match);
      if (phrase === null || overlaps(phrase, taken)) continue;
      if (best === null || phrase.start < best.start) best = phrase;
      break;
    }
  }
  return best;
}

// ── Repeat ─────────────────────────────────────────────────────────────────

const UNIT_RULES: Record<string, [string, string]> = {
  day: ['FREQ=DAILY', 'Every day'],
  daily: ['FREQ=DAILY', 'Every day'],
  weekday: ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
  week: ['FREQ=WEEKLY', 'Every week'],
  weekly: ['FREQ=WEEKLY', 'Every week'],
  month: ['FREQ=MONTHLY', 'Every month'],
  monthly: ['FREQ=MONTHLY', 'Every month'],
  year: ['FREQ=YEARLY', 'Every year'],
  yearly: ['FREQ=YEARLY', 'Every year'],
  annually: ['FREQ=YEARLY', 'Every year'],
};

const INTERVAL_FREQ: Record<string, string> = {
  days: 'DAILY',
  weeks: 'WEEKLY',
  months: 'MONTHLY',
  years: 'YEARLY',
};

const REPEAT_PATTERNS: ReadonlyArray<Pattern<RepeatPhrase>> = [
  {
    regex: /\bevery\s+(day|weekday|week|month|year)\b/i,
    build: (m) => {
      const found = UNIT_RULES[(m[1] ?? '').toLowerCase()];
      return found ? { ...span(m), rule: found[0], label: found[1] } : null;
    },
  },
  {
    regex: /\bevery\s+(\d{1,3})\s+(days|weeks|months|years)\b/i,
    build: (m) => {
      const n = Number(m[1]);
      const unit = (m[2] ?? '').toLowerCase();
      const freq = INTERVAL_FREQ[unit];
      if (n < 1 || !freq) return null;
      return { ...span(m), rule: `FREQ=${freq};INTERVAL=${n}`, label: `Every ${n} ${unit}` };
    },
  },
  {
    regex: new RegExp(`\\bevery\\s+(${WEEKDAY_ANY})\\b`, 'i'),
    build: (m) => {
      const weekday = weekdayIndex(m[1] ?? '');
      if (weekday === -1) return null;
      const name = WEEKDAYS[weekday] ?? '';
      return {
        ...span(m),
        rule: `FREQ=WEEKLY;BYDAY=${RRULE_DAY[weekday]}`,
        label: `Every ${name.charAt(0).toUpperCase()}${name.slice(1)}`,
        weekday,
      };
    },
  },
  {
    regex: /\b(daily|weekly|monthly|yearly|annually)\b/i,
    build: (m) => {
      const found = UNIT_RULES[(m[1] ?? '').toLowerCase()];
      return found ? { ...span(m), rule: found[0], label: found[1] } : null;
    },
  },
];

// ── Date ───────────────────────────────────────────────────────────────────

const DATE_PATTERNS: ReadonlyArray<Pattern<DatePhrase>> = [
  {
    regex: /\b(today|tomorrow|tonight)\b/i,
    build: (m) => {
      const word = (m[1] ?? '').toLowerCase();
      const phrase: DatePhrase = {
        ...span(m),
        resolve: (now) => startOfDay(word === 'tomorrow' ? addDays(now, 1) : now),
      };
      if (word === 'tonight') phrase.clock = 'tonight';
      return phrase;
    },
  },
  {
    regex: /\bnext\s+(week|month)\b/i,
    build: (m) => {
      const unit = (m[1] ?? '').toLowerCase();
      return {
        ...span(m),
        resolve: (now) =>
          unit === 'week' ? comingWeekday(now, 1) : startOfMonth(addMonths(now, 1)),
      };
    },
  },
  {
    // Full weekday names stand alone; abbreviations need "on" or "next" in
    // front, so "I sat down" is not a Saturday.
    regex: new RegExp(`\\b(?:(?:on|next)\\s+(${WEEKDAY_ANY})|(${WEEKDAY_FULL}))\\b`, 'i'),
    build: (m) => {
      const weekday = weekdayIndex(m[1] ?? m[2] ?? '');
      if (weekday === -1) return null;
      return { ...span(m), resolve: (now) => comingWeekday(now, weekday) };
    },
  },
  {
    regex: /\bin\s+(\d{1,3})\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/i,
    build: (m) => {
      const n = Number(m[1]);
      const unit = (m[2] ?? '').toLowerCase();
      if (unit.startsWith('min') || unit.startsWith('h')) {
        return {
          ...span(m),
          resolve: (now) => now,
          clock: 'relative',
          offsetMinutes: unit.startsWith('h') ? n * 60 : n,
        };
      }
      return {
        ...span(m),
        resolve: (now) => {
          if (unit.startsWith('d')) return startOfDay(addDays(now, n));
          if (unit.startsWith('w')) return startOfDay(addWeeks(now, n));
          return startOfDay(addMonths(now, n));
        },
      };
    },
  },
  {
    regex: new RegExp(
      `\\b(?:on\\s+)?(?:(${MONTH_ANY})\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ANY}))\\b`,
      'i',
    ),
    build: (m) => {
      const month = monthIndex(m[1] ?? m[4] ?? '');
      const day = Number(m[2] ?? m[3]);
      if (month === -1 || day < 1 || day > 31) return null;
      // A day the month does not have (31 Feb) is not a date at all.
      if (new Date(2001, month, day).getMonth() !== month) return null;
      return {
        ...span(m),
        resolve: (now) => {
          const thisYear = new Date(now.getFullYear(), month, day);
          return thisYear.getTime() < startOfDay(now).getTime()
            ? new Date(now.getFullYear() + 1, month, day)
            : thisYear;
        },
      };
    },
  },
];

// ── Time ───────────────────────────────────────────────────────────────────

const TIME_PATTERNS: ReadonlyArray<Pattern<TimePhrase>> = [
  {
    regex: /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
    build: (m) => {
      let hour = Number(m[1]);
      const minute = Number(m[2] ?? '0');
      const meridiem = (m[3] ?? '').toLowerCase();
      if (hour < 1 || hour > 12 || minute > 59) return null;
      if (meridiem === 'pm' && hour !== 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      return { ...span(m), hour, minute };
    },
  },
  {
    regex: /\b(?:at\s+)?(\d{1,2}):(\d{2})\b/,
    build: (m) => {
      const hour = Number(m[1]);
      const minute = Number(m[2]);
      if (hour > 23 || minute > 59) return null;
      return { ...span(m), hour, minute };
    },
  },
  {
    regex: /\bat\s+(\d{1,2})\b(?!\s*(?:am|pm|:))/i,
    build: (m) => {
      const hour = Number(m[1]);
      return hour > 23 ? null : { ...span(m), hour, minute: 0 };
    },
  },
  {
    regex: /\bat\s+(noon|midnight)\b/i,
    build: (m) => ({
      ...span(m),
      hour: (m[1] ?? '').toLowerCase() === 'noon' ? 12 : 0,
      minute: 0,
    }),
  },
];

// ── Priority ───────────────────────────────────────────────────────────────

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: 'urgent',
  u: 'urgent',
  '1': 'urgent',
  high: 'high',
  h: 'high',
  '2': 'high',
  medium: 'medium',
  med: 'medium',
  m: 'medium',
  '3': 'medium',
  low: 'low',
  l: 'low',
  '4': 'low',
};

const PRIORITY_PATTERNS: ReadonlyArray<Pattern<PriorityPhrase>> = [
  {
    regex: /(?:^|\s)!(urgent|high|medium|med|low|u|h|m|l|[1-4])\b/i,
    build: (m) => {
      const level = PRIORITY_WORDS[(m[1] ?? '').toLowerCase()];
      if (!level) return null;
      // The span excludes the leading whitespace so the title keeps its spacing.
      const lead = m[0].length - m[0].trimStart().length;
      return {
        start: m.index + lead,
        end: m.index + m[0].length,
        text: m[0].trimStart(),
        level,
      };
    },
  },
];

// ── Reminder ───────────────────────────────────────────────────────────────

const REMIND_PATTERNS: ReadonlyArray<Pattern<RemindPhrase>> = [
  {
    regex:
      /\bremind(?:\s+me)?(?:\s+(\d{1,3})\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)(?:\s+(?:before|earlier|ahead))?)?\b/i,
    build: (m) => {
      if (m[1] === undefined) {
        return { ...span(m), leadMinutes: 0, label: 'Remind at due time' };
      }
      const n = Number(m[1]);
      if (n < 1) return null;
      const unit = (m[2] ?? '').toLowerCase();
      const [factor, noun] = unit.startsWith('h')
        ? [60, 'h']
        : unit.startsWith('d')
          ? [1440, 'd']
          : [1, ' min'];
      return { ...span(m), leadMinutes: n * factor, label: `Remind ${n}${noun} before` };
    },
  },
];

// ── Assembly ───────────────────────────────────────────────────────────────

function atTime(day: Date, hour: number, minute: number): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(day, hour), minute), 0), 0);
}

function capitalise(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function dateLabel(day: Date, nowWall: Date): string {
  const days = Math.round((startOfDay(day).getTime() - startOfDay(nowWall).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  const weekday = capitalise((WEEKDAYS[getDay(day)] ?? '').slice(0, 3));
  const month = capitalise((MONTHS[day.getMonth()] ?? '').slice(0, 3));
  const year = day.getFullYear() === nowWall.getFullYear() ? '' : ` ${day.getFullYear()}`;
  return `${weekday} ${day.getDate()} ${month}${year}`;
}

function timeLabel(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function removeSpans(text: string, spans: readonly Span[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const s of sorted) {
    out += text.slice(cursor, s.start);
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out.replace(/\s+/g, ' ').trim();
}

function chip(kind: ChipKind, phrase: Phrase, label: string): Chip {
  return { kind, text: phrase.text, label, start: phrase.start, end: phrase.end };
}

/** Text in square brackets is left alone: how a removed chip stays as words. */
const PROTECTED = /\[[^\]]*\]/g;

/** Parse one line. `now` is a UTC instant; `zone` an IANA name. */
export function parseCapture(text: string, now: string, zone: string): Capture {
  // Spans no pattern may claim. Bracketed text is protected but not removed.
  const taken: Span[] = [];
  for (let m = PROTECTED.exec(text); m !== null; m = PROTECTED.exec(text)) {
    taken.push({ start: m.index, end: m.index + m[0].length });
  }
  const protectedCount = taken.length;

  // Repeat goes first so "every monday" is a rule, not a Monday.
  const repeat = first(text, REPEAT_PATTERNS, taken);
  if (repeat) taken.push(repeat);
  const date = first(text, DATE_PATTERNS, taken);
  if (date) taken.push(date);
  const time = first(text, TIME_PATTERNS, taken);
  if (time) taken.push(time);
  const priority = first(text, PRIORITY_PATTERNS, taken);
  if (priority) taken.push(priority);

  const nowWall = asWallClock(now, zone);

  // The day, if any phrase names one: an explicit date, or the weekday a
  // repeat rule starts on. A time then sits on that day; with no day a time
  // means today-or-tomorrow; with neither, a bare repeat starts today.
  let day: Date | null = null;
  if (date && date.clock !== 'relative') day = date.resolve(nowWall);
  else if (!date && repeat?.weekday !== undefined) day = comingWeekday(nowWall, repeat.weekday);
  else if (!date && repeat) day = startOfDay(nowWall);

  let dueWall: Date | null = null;
  if (date?.clock === 'relative') {
    dueWall = addMinutes(nowWall, date.offsetMinutes ?? 0);
    if (time) dueWall = atTime(dueWall, time.hour, time.minute);
  } else if (day) {
    if (time) dueWall = atTime(day, time.hour, time.minute);
    else if (date?.clock === 'tonight') dueWall = atTime(day, TONIGHT_HOUR, 0);
    else dueWall = atTime(day, END_OF_DAY_HOUR, END_OF_DAY_MINUTE);
  } else if (time) {
    dueWall = atTime(startOfDay(nowWall), time.hour, time.minute);
    if (dueWall.getTime() <= nowWall.getTime()) dueWall = addDays(dueWall, 1);
  }

  const chips: Chip[] = [];
  if (repeat) chips.push(chip('repeat', repeat, repeat.label));
  if (date) {
    const label =
      date.clock === 'relative'
        ? `In ${date.text.replace(/^in\s+/i, '')}`
        : dateLabel(date.resolve(nowWall), nowWall);
    chips.push(chip('date', date, label));
  }
  if (time) chips.push(chip('time', time, timeLabel(time.hour, time.minute)));
  if (priority) chips.push(chip('priority', priority, `${capitalise(priority.level)} priority`));

  // A reminder is only understood once there is a date for it to be relative to.
  let remindWall: Date | null = null;
  if (dueWall) {
    const remind = first(text, REMIND_PATTERNS, taken);
    if (remind) {
      taken.push(remind);
      remindWall = addMinutes(dueWall, -remind.leadMinutes);
      chips.push(chip('remind', remind, remind.label));
    }
  }

  chips.sort((a, b) => a.start - b.start);

  return {
    title: removeSpans(text, taken.slice(protectedCount)),
    dueAt: dueWall ? asInstant(dueWall, zone) : null,
    remindAt: remindWall ? asInstant(remindWall, zone) : null,
    rule: repeat?.rule ?? null,
    priority: priority?.level ?? null,
    chips,
  };
}

/**
 * The source text with one chip's phrase kept as words: what "remove this
 * chip" means. Brackets stop the parser reading the phrase again while keeping
 * it visible, and the person can delete them.
 */
export function withoutChip(text: string, chip: Chip): string {
  return `${text.slice(0, chip.start)}[${chip.text}]${text.slice(chip.end)}`;
}
