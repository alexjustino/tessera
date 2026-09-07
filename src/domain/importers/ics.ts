/**
 * ICS — the calendar file every calendar writes (RFC 5545).
 *
 * One file is a `VCALENDAR` holding `VEVENT`s and, in the files task apps
 * export, `VTODO`s. The events are the hard half, and the difficulty is not
 * the syntax:
 *
 * **A time is not an instant until you know the zone it was written in.**
 * `DTSTART;TZID=Europe/London:20270330T090000` is nine in the morning in
 * London, which is 08:00 UTC in summer and 09:00 UTC in winter. Reading it as
 * either one and keeping the number is how a weekly meeting drifts an hour
 * twice a year. Every stamp here is resolved to an instant **and** the event
 * keeps the zone it was written in, because the rule has to expand in
 * wall-clock afterwards (ADR-013).
 *
 * **A series is a rule plus its exceptions.** `EXDATE` cancels an occurrence;
 * a second `VEVENT` with the same `UID` and a `RECURRENCE-ID` moves one. Both
 * are keyed on the occurrence's original start, which is the instant this
 * product's own expansion produces — so the key is computed the same way,
 * from the wall clock in the event's zone.
 *
 * **`UNTIL` is written in UTC and this product expands in wall clock.** RFC
 * 5545 requires `UNTIL` to be a UTC instant when `DTSTART` has a zone, and a
 * rule ending `UNTIL=20270330T080000Z` was dropping its last occurrence here.
 * The rule is kept exactly as the file wrote it and the expansion was fixed
 * instead (`sameFrame` in `schedule.ts`): the mismatch is the product's, not
 * the file's, and a rule typed by hand has it too.
 *
 * It never throws, is capped, and lists what it could not carry (SPEC §4).
 */

import type { ImportPlan, ImportedEvent, ImportedException, ImportedTask } from '../importing';
import { asInstant, isValidRule } from '../schedule';

/** The largest file this reads; beyond it nothing is read at all. */
export const MAX_ICS_CHARS = 64 * 1024 * 1024;

/** The most components read from one file, malformed or not. */
const MAX_COMPONENTS = 20_000;

/** RFC 5545 priorities, onto the scale the product has. */
const TODO_PRIORITY: ReadonlyArray<{ upTo: number; value: string }> = [
  { upTo: 2, value: 'urgent' },
  { upTo: 4, value: 'high' },
  { upTo: 5, value: 'medium' },
  { upTo: 9, value: 'low' },
];

/**
 * Windows' zone names, as Outlook writes them, onto IANA's.
 *
 * Outlook does not write `Europe/London`; it writes `GMT Standard Time`, and a
 * `VTIMEZONE` block describing the rules. Reading that block means
 * implementing a second timezone database beside the one the platform already
 * has, so the names are mapped instead — the ones an export actually contains
 * — and anything unrecognised falls back to the workspace's zone and says so.
 */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'w. europe standard time': 'Europe/Berlin',
  'romance standard time': 'Europe/Paris',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'e. europe standard time': 'Europe/Chisinau',
  'gtb standard time': 'Europe/Athens',
  'fle standard time': 'Europe/Kiev',
  'israel standard time': 'Asia/Jerusalem',
  'russian standard time': 'Europe/Moscow',
  'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Argentina/Buenos_Aires',
  'sa pacific standard time': 'America/Bogota',
  'sa eastern standard time': 'America/Cayenne',
  'pacific sa standard time': 'America/Santiago',
  'eastern standard time': 'America/New_York',
  'us eastern standard time': 'America/Indiana/Indianapolis',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai',
  'singapore standard time': 'Asia/Singapore',
  'tokyo standard time': 'Asia/Tokyo',
  'korea standard time': 'Asia/Seoul',
  'aus eastern standard time': 'Australia/Sydney',
  'e. australia standard time': 'Australia/Brisbane',
  'aus central standard time': 'Australia/Darwin',
  'w. australia standard time': 'Australia/Perth',
  'new zealand standard time': 'Pacific/Auckland',
  'south africa standard time': 'Africa/Johannesburg',
  utc: 'UTC',
};

// ── Reading the file ───────────────────────────────────────────────────────

/** One content line: its name, its parameters, and its value. */
export interface IcsLine {
  name: string;
  /** Parameter names upper-cased; values unquoted. */
  params: Record<string, string>;
  /** The raw value, unescaped for TEXT by the caller that wants text. */
  value: string;
}

/** One component — `VEVENT`, `VTODO`, `VTIMEZONE` — with what is inside it. */
export interface IcsComponent {
  name: string;
  lines: IcsLine[];
  children: IcsComponent[];
}

/** Does this text look like a calendar file? */
export function looksLikeIcs(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text.slice(0, 4096).replace(/^\uFEFF/, ''));
}

/**
 * The file's components, as a tree.
 *
 * Folding is undone first: RFC 5545 breaks long lines and continues them with
 * a leading space or tab, and a `DESCRIPTION` of any length arrives folded.
 * A line that is not `NAME:VALUE`, an `END` that closes nothing, a component
 * never closed — none of it throws; what cannot be read is skipped.
 */
export function parseIcs(text: string): IcsComponent[] {
  if (text.length > MAX_ICS_CHARS) return [];
  const source = text.replace(/^\uFEFF/, '');

  const roots: IcsComponent[] = [];
  const stack: IcsComponent[] = [];
  let components = 0;

  for (const raw of unfold(source)) {
    const line = readLine(raw);
    if (line === null) continue;

    const name = line.name.toUpperCase();
    if (name === 'BEGIN') {
      if (components >= MAX_COMPONENTS) break;
      components += 1;
      const component: IcsComponent = {
        name: line.value.trim().toUpperCase(),
        lines: [],
        children: [],
      };
      const parent = stack.at(-1);
      if (parent === undefined) roots.push(component);
      else parent.children.push(component);
      stack.push(component);
      continue;
    }
    if (name === 'END') {
      // An END that closes something else is still an END: unwinding to the
      // matching name keeps a truncated component from swallowing the rest.
      const closing = line.value.trim().toUpperCase();
      for (let at = stack.length - 1; at >= 0; at -= 1) {
        if (stack[at]!.name !== closing) continue;
        stack.length = at;
        break;
      }
      continue;
    }
    stack.at(-1)?.lines.push(line);
  }

  return roots;
}

/** Content lines, with RFC 5545's folding undone. */
function unfold(source: string): string[] {
  const lines: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    if (raw.startsWith(' ') || raw.startsWith('\t')) {
      if (lines.length > 0) lines[lines.length - 1] += raw.slice(1);
      continue;
    }
    lines.push(raw);
  }
  return lines.filter((line) => line.trim() !== '');
}

/** `DTSTART;TZID="Europe/London":20270330T090000` in three parts. */
function readLine(raw: string): IcsLine | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon < 0) return null;

  const value = raw.slice(colon + 1);
  const parts = splitOutsideQuotes(raw.slice(0, colon), ';');
  const name = (parts[0] ?? '').trim();
  if (name === '') return null;

  const params: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const equals = part.indexOf('=');
    if (equals < 0) continue;
    params[part.slice(0, equals).trim().toUpperCase()] = unquote(part.slice(equals + 1).trim());
  }
  return { name, params, value };
}

function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === separator && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

/** A TEXT value, with RFC 5545's escapes undone. */
export function unescapeText(value: string): string {
  let text = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      text += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    if (next === 'n' || next === 'N') text += '\n';
    else if (next === undefined) text += '\\';
    else text += next;
  }
  return text;
}

function first(component: IcsComponent, name: string): IcsLine | undefined {
  return component.lines.find((line) => line.name.toUpperCase() === name);
}

function textOf(component: IcsComponent, name: string): string {
  const line = first(component, name);
  return line === undefined ? '' : unescapeText(line.value).trim();
}

// ── Zones and stamps ───────────────────────────────────────────────────────

/** Is this a zone this machine's date library knows? */
function knownZone(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * A `TZID` as an IANA zone, or null when it is not one this machine knows.
 *
 * Three shapes arrive: IANA already (`Europe/London`), a Windows name
 * (`GMT Standard Time`), and IANA behind a vendor prefix, which is what older
 * Mozilla and Apple files write (`/mozilla.org/20050126_1/Europe/London`).
 */
export function ianaZone(tzid: string): string | null {
  const trimmed = tzid.trim();
  if (trimmed === '') return null;
  if (knownZone(trimmed)) return trimmed;

  const windows = WINDOWS_ZONES[trimmed.toLowerCase()];
  if (windows !== undefined) return windows;

  // Drop leading segments until what is left is a zone: the vendor prefix is
  // one or two segments and the zone itself can be two or three.
  const segments = trimmed.replace(/^\/+/, '').split('/');
  for (let start = 1; start < segments.length; start += 1) {
    const candidate = segments.slice(start).join('/');
    if (knownZone(candidate)) return candidate;
  }
  return null;
}

/** A stamp resolved: the instant it denotes, and whether it was a plain date. */
export interface Stamp {
  instant: string;
  allDay: boolean;
}

/**
 * `20270330T090000`, `20270330T080000Z` or `20270330`, in the zone the
 * parameters name.
 *
 * A value with `Z` is already an instant. A value with a `TZID` is wall clock
 * in that zone. A value with neither is floating — "09:00 wherever you are" —
 * and is read in the workspace's zone, which is what floating means.
 */
export function readStamp(value: string, zone: string): Stamp | null {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (match === null) return null;

  const [, year, month, day, hour, minute, second, utc] = match;
  const numbers = [year, month, day].map(Number) as [number, number, number];
  if (numbers[1] < 1 || numbers[1] > 12 || numbers[2] < 1 || numbers[2] > 31) return null;

  if (hour === undefined) {
    // A date with no time: local midnight, in the workspace's zone. An all-day
    // event has no instant of its own (ADR-013, the declared exception), and
    // the day it lands on has to be the day the file wrote.
    return {
      instant: asInstant(new Date(numbers[0], numbers[1] - 1, numbers[2], 0, 0, 0, 0), zone),
      allDay: true,
    };
  }

  const hours = Number(hour);
  const minutes = Number(minute ?? '0');
  const seconds = Number(second ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 60) return null;

  if (utc === 'Z') {
    return {
      instant: new Date(
        Date.UTC(numbers[0], numbers[1] - 1, numbers[2], hours, minutes, seconds),
      ).toISOString(),
      allDay: false,
    };
  }
  return {
    instant: asInstant(
      new Date(numbers[0], numbers[1] - 1, numbers[2], hours, minutes, seconds),
      zone,
    ),
    allDay: false,
  };
}

/** `PT1H30M`, `P1D`, `P2W` — in milliseconds, or null. */
export function readDuration(value: string): number | null {
  const match = value
    .trim()
    .match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (match === null) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  if ([weeks, days, hours, minutes, seconds].every((part) => part === undefined)) return null;

  const total =
    (Number(weeks ?? 0) * 7 + Number(days ?? 0)) * 86_400_000 +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1_000;
  return sign === '-' ? -total : total;
}

// ── The rule ───────────────────────────────────────────────────────────────

/**
 * The rule, as the file wrote it.
 *
 * Nothing is rewritten. `UNTIL` is a UTC instant inside a rule this product
 * expands in wall clock, which is a real mismatch — but it is one the
 * expansion resolves (`sameFrame` in `schedule.ts`), because a rule a person
 * typed here has it too. A rule that cannot be parsed at all is dropped, and
 * the event keeps its first date.
 */
export function readRule(value: string): string | null {
  const rule = value.trim().replace(/^RRULE:/i, '');
  if (rule === '') return null;
  return isValidRule(rule) ? rule : null;
}

// ── The plan ───────────────────────────────────────────────────────────────

interface Counter {
  alarms: number;
  attendees: number;
  rdates: number;
  thisAndFuture: number;
  unreadableZones: Set<string>;
  badRules: string[];
  orphans: number;
  skipped: string[];
}

/**
 * The plan for a calendar file.
 *
 * `calendarName` names the collection any `VTODO`s land in — the file's own
 * name, or the calendar's `X-WR-CALNAME` when it has one. `zone` is the
 * workspace's, used for floating times and for all-day dates.
 */
export function fromIcs(text: string, calendarName: string, zone: string): ImportPlan | null {
  if (text.length > MAX_ICS_CHARS) return null;
  const roots = parseIcs(text);
  const calendar = roots.find((component) => component.name === 'VCALENDAR');
  if (calendar === undefined) return null;

  const named = textOf(calendar, 'X-WR-CALNAME');
  const collection = (named !== '' ? named : calendarName).trim() || 'Calendar';

  const counter: Counter = {
    alarms: 0,
    attendees: 0,
    rdates: 0,
    thisAndFuture: 0,
    unreadableZones: new Set(),
    badRules: [],
    orphans: 0,
    skipped: [],
  };

  const components = calendar.children;
  const events: ImportedEvent[] = [];
  const byUid = new Map<string, ImportedEvent>();
  const overrides: IcsComponent[] = [];

  for (const component of components) {
    if (component.name === 'VEVENT') {
      if (first(component, 'RECURRENCE-ID') !== undefined) {
        overrides.push(component);
        continue;
      }
      const event = readEvent(component, events.length, zone, counter);
      if (event === null) continue;
      events.push(event);
      const uid = textOf(component, 'UID');
      if (uid !== '' && !byUid.has(uid)) byUid.set(uid, event);
      continue;
    }
    if (component.name === 'VTIMEZONE' || component.name === 'VTODO') continue;
    if (component.name !== '') counter.skipped.push(component.name);
  }

  for (const component of overrides) {
    const uid = textOf(component, 'UID');
    const series = byUid.get(uid);
    if (series === undefined) {
      // An override whose series is not in the file — half an export, or an
      // invitation to a single occurrence. It is a real appointment either
      // way, so it is imported as one event of its own.
      counter.orphans += 1;
      const event = readEvent(component, events.length, zone, counter);
      if (event !== null) events.push(event);
      continue;
    }
    const exception = readOverride(component, series, zone, counter);
    if (exception === null) continue;
    series.exceptions = [...(series.exceptions ?? []), exception];
  }

  const tasks: ImportedTask[] = [];
  for (const component of components) {
    if (component.name !== 'VTODO') continue;
    const task = readTodo(component, collection, tasks.length, zone, counter);
    if (task !== null) tasks.push(task);
  }

  return {
    source: `a calendar file (${collection})`,
    collections: tasks.length > 0 ? [{ name: collection, icon: null, color: null }] : [],
    tasks,
    events,
    warnings: describe(counter, events),
  };
}

function readEvent(
  component: IcsComponent,
  index: number,
  zone: string,
  counter: Counter,
): ImportedEvent | null {
  const startLine = first(component, 'DTSTART');
  if (startLine === undefined) return null;

  const eventZone = zoneOf(startLine, zone, counter);
  const start = readStamp(startLine.value, eventZone);
  if (start === null) return null;

  const endLine = first(component, 'DTEND');
  const durationLine = first(component, 'DURATION');
  let end: string;
  if (endLine !== undefined) {
    const stamp = readStamp(endLine.value, zoneOf(endLine, eventZone, counter));
    end = stamp?.instant ?? start.instant;
  } else if (durationLine !== undefined) {
    const length = readDuration(durationLine.value);
    end =
      length === null
        ? start.instant
        : new Date(new Date(start.instant).getTime() + Math.max(length, 0)).toISOString();
  } else {
    // No end and no duration: a date lasts the day, a time lasts no time —
    // RFC 5545 §3.6.1, and the only sane reading of a calendar's own file.
    end = start.allDay
      ? new Date(new Date(start.instant).getTime() + 86_400_000).toISOString()
      : start.instant;
  }
  if (end < start.instant) end = start.instant;

  count(component, counter);
  const ruleLine = first(component, 'RRULE');
  let rrule: string | null = null;
  if (ruleLine !== undefined) {
    rrule = readRule(ruleLine.value);
    if (rrule === null) counter.badRules.push(ruleLine.value.trim());
  }

  const exceptions = readExdates(component, eventZone, counter);

  return {
    key: `ics:event:${index}`,
    title: textOf(component, 'SUMMARY'),
    startsAt: start.instant,
    endsAt: end,
    tz: eventZone,
    allDay: start.allDay,
    rrule,
    ...(exceptions.length > 0 ? { exceptions } : {}),
  };
}

/** Every `EXDATE` of a component, as cancelled occurrences. */
function readExdates(
  component: IcsComponent,
  eventZone: string,
  counter: Counter,
): ImportedException[] {
  const exceptions: ImportedException[] = [];
  for (const line of component.lines) {
    if (line.name.toUpperCase() !== 'EXDATE') continue;
    const zoneHere = zoneOf(line, eventZone, counter);
    for (const value of line.value.split(',')) {
      const stamp = readStamp(value, zoneHere);
      if (stamp === null) continue;
      exceptions.push({
        originalStart: stamp.instant,
        kind: 'cancelled',
        startsAt: null,
        endsAt: null,
      });
    }
  }
  return exceptions;
}

/** A `VEVENT` with a `RECURRENCE-ID`: one occurrence moved, or called off. */
function readOverride(
  component: IcsComponent,
  series: ImportedEvent,
  zone: string,
  counter: Counter,
): ImportedException | null {
  const line = first(component, 'RECURRENCE-ID');
  if (line === undefined) return null;
  if ((line.params.RANGE ?? '').toUpperCase() === 'THISANDFUTURE') counter.thisAndFuture += 1;

  const original = readStamp(line.value, zoneOf(line, series.tz, counter));
  if (original === null) return null;

  if (textOf(component, 'STATUS').toUpperCase() === 'CANCELLED') {
    return {
      originalStart: original.instant,
      kind: 'cancelled',
      startsAt: null,
      endsAt: null,
    };
  }

  const moved = readEvent(component, 0, zone, counter);
  if (moved === null) return null;
  return {
    originalStart: original.instant,
    kind: 'moved',
    startsAt: moved.startsAt,
    endsAt: moved.endsAt,
  };
}

function readTodo(
  component: IcsComponent,
  collection: string,
  index: number,
  zone: string,
  counter: Counter,
): ImportedTask | null {
  const title = textOf(component, 'SUMMARY');
  if (title === '') return null;
  count(component, counter);

  const stamp = (name: string): string | null => {
    const line = first(component, name);
    if (line === undefined) return null;
    return readStamp(line.value, zoneOf(line, zone, counter))?.instant ?? null;
  };

  const completed =
    stamp('COMPLETED') ??
    (textOf(component, 'STATUS').toUpperCase() === 'COMPLETED' ? stamp('DTSTAMP') : null);

  const priority = Number(textOf(component, 'PRIORITY'));
  const mapped =
    Number.isFinite(priority) && priority > 0
      ? TODO_PRIORITY.find((entry) => priority <= entry.upTo)?.value
      : undefined;

  const notes = textOf(component, 'DESCRIPTION');
  if (first(component, 'RRULE') !== undefined) counter.badRules.push(`the task “${title}”`);

  return {
    key: `ics:todo:${index}`,
    collection,
    title,
    notes: notes === '' ? null : notes,
    startAt: stamp('DTSTART'),
    dueAt: stamp('DUE'),
    completedAt: completed,
    estimateMinutes: null,
    isMilestone: false,
    values: mapped === undefined ? {} : { Priority: mapped },
  };
}

/** The zone a line names, falling back and remembering what it could not read. */
function zoneOf(line: IcsLine, fallback: string, counter: Counter): string {
  const tzid = line.params.TZID;
  if (tzid === undefined || tzid.trim() === '') return fallback;
  const zone = ianaZone(tzid);
  if (zone !== null) return zone;
  counter.unreadableZones.add(tzid.trim());
  return fallback;
}

/** What a component carries that this product does not. */
function count(component: IcsComponent, counter: Counter): void {
  counter.alarms += component.children.filter((child) => child.name === 'VALARM').length;
  counter.attendees += component.lines.filter((line) =>
    ['ATTENDEE', 'ORGANIZER'].includes(line.name.toUpperCase()),
  ).length;
  counter.rdates += component.lines.filter((line) => line.name.toUpperCase() === 'RDATE').length;
}

function describe(counter: Counter, events: readonly ImportedEvent[]): string[] {
  const warnings: string[] = [];
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

  if (counter.unreadableZones.size > 0) {
    const names = [...counter.unreadableZones];
    warnings.push(
      `${plural(names.length, 'A timezone was', `${names.length} timezones were`)} not recognised and ${plural(names.length, 'its times were', 'their times were')} read in this workspace's zone: ${names
        .slice(0, 5)
        .map((name) => `“${name}”`)
        .join(', ')}${names.length > 5 ? ', …' : ''}.`,
    );
  }
  if (counter.badRules.length > 0) {
    warnings.push(
      `${counter.badRules.length} ${plural(counter.badRules.length, 'repeat rule was', 'repeat rules were')} not understood; ${plural(counter.badRules.length, 'that entry was', 'those entries were')} imported once, on ${plural(counter.badRules.length, 'its', 'their')} first date.`,
    );
  }
  if (counter.rdates > 0) {
    warnings.push(
      `${counter.rdates} extra ${plural(counter.rdates, 'date was', 'dates were')} added to a series by hand (RDATE); ${plural(counter.rdates, 'it was', 'they were')} not carried — the rule and its cancellations were.`,
    );
  }
  if (counter.thisAndFuture > 0) {
    warnings.push(
      `${counter.thisAndFuture} ${plural(counter.thisAndFuture, 'change applied', 'changes applied')} to an occurrence and every one after it; only that occurrence was moved.`,
    );
  }
  if (counter.orphans > 0) {
    warnings.push(
      `${counter.orphans} ${plural(counter.orphans, 'occurrence belongs', 'occurrences belong')} to a series that is not in the file; ${plural(counter.orphans, 'it was', 'they were')} imported as ${plural(counter.orphans, 'an event of its own', 'events of their own')}.`,
    );
  }
  if (counter.alarms > 0) {
    warnings.push(
      `${counter.alarms} ${plural(counter.alarms, 'reminder was', 'reminders were')} left out; reminders are set here, not carried in.`,
    );
  }
  if (counter.attendees > 0) {
    warnings.push(
      `${counter.attendees} ${plural(counter.attendees, 'guest was', 'guests were')} left out; this product has one person in it.`,
    );
  }
  const skipped = [...new Set(counter.skipped)];
  if (skipped.length > 0) {
    warnings.push(`${skipped.join(', ')} entries are not events or tasks and were left out.`);
  }
  if (events.length === 0 && warnings.length === 0) {
    warnings.push('The file has no events in it.');
  }
  return warnings;
}
