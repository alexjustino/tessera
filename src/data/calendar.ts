/**
 * The typed client for the calendar commands.
 *
 * The host stores instants and returns windows. Expanding a rule, applying an
 * exception and placing a box on the grid are the domain layer's job, where the
 * timezone arithmetic has a daylight-saving test (ADR-014).
 */

import { invoke } from '@tauri-apps/api/core';

import type { CalendarEvent, EventException, WorkHours } from '@/domain/calendar';

export interface Calendar {
  id: string;
  name: string;
  color: string | null;
  visible: boolean;
  position: string;
}

interface RawCalendar {
  id: string;
  name: string;
  color: string | null;
  visible: boolean;
  position: string;
}

interface RawEvent {
  id: string;
  calendar_id: string;
  title: string;
  location: string | null;
  starts_at_utc: string;
  ends_at_utc: string;
  tz: string;
  all_day: boolean;
  rrule: string | null;
  busy: boolean;
  item_id: string | null;
}

interface RawException {
  event_id: string;
  original_start_utc: string;
  kind: string;
  starts_at_utc: string | null;
  ends_at_utc: string | null;
}

interface RawWorkHours {
  weekday: number;
  starts_minute: number;
  ends_minute: number;
}

function toEvent(raw: RawEvent, colourOf: (calendarId: string) => string | null): CalendarEvent {
  return {
    id: raw.id,
    calendarId: raw.calendar_id,
    title: raw.title,
    startsAt: raw.starts_at_utc,
    endsAt: raw.ends_at_utc,
    tz: raw.tz,
    allDay: raw.all_day,
    rrule: raw.rrule,
    color: colourOf(raw.calendar_id),
    itemId: raw.item_id,
  };
}

export async function listCalendars(): Promise<Calendar[]> {
  return (await invoke<RawCalendar[]>('calendars_list')).map((raw) => ({ ...raw }));
}

export async function listWorkHours(): Promise<WorkHours[]> {
  const raw = await invoke<RawWorkHours[]>('work_hours_list');
  return raw.map((row) => ({
    weekday: row.weekday,
    startsMinute: row.starts_minute,
    endsMinute: row.ends_minute,
  }));
}

export async function listEvents(
  from: string,
  to: string,
  calendars: readonly Calendar[],
): Promise<CalendarEvent[]> {
  const raw = await invoke<RawEvent[]>('events_list', { from, to });
  const colourOf = (id: string) => calendars.find((c) => c.id === id)?.color ?? null;
  return raw.map((row) => toEvent(row, colourOf));
}

export async function listExceptions(): Promise<EventException[]> {
  const raw = await invoke<RawException[]>('event_exceptions_list');
  return raw.map((row) => ({
    eventId: row.event_id,
    originalStart: row.original_start_utc,
    kind: row.kind === 'cancelled' ? 'cancelled' : 'moved',
    startsAt: row.starts_at_utc,
    endsAt: row.ends_at_utc,
  }));
}

export async function createEvent(input: {
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  tz: string;
  allDay: boolean;
}): Promise<void> {
  await invoke<RawEvent>('event_create', {
    event: {
      calendar_id: input.calendarId,
      title: input.title,
      location: null,
      starts_at_utc: input.startsAt,
      ends_at_utc: input.endsAt,
      tz: input.tz,
      all_day: input.allDay,
      rrule: null,
    },
  });
}

export async function moveEvent(id: string, startsAt: string, endsAt: string): Promise<void> {
  await invoke<RawEvent>('event_move', { id, startsAtUtc: startsAt, endsAtUtc: endsAt });
}

export async function deleteEvent(id: string): Promise<void> {
  await invoke<void>('event_delete', { id });
}

/**
 * Move or cancel a single occurrence of a series.
 *
 * Keyed on the original start, so the exception keeps pointing at the right
 * occurrence however often the rule is re-expanded.
 */
export async function setException(input: {
  eventId: string;
  originalStart: string;
  kind: 'cancelled' | 'moved';
  startsAt: string | null;
  endsAt: string | null;
}): Promise<void> {
  await invoke<void>('event_set_exception', {
    eventId: input.eventId,
    originalStartUtc: input.originalStart,
    kind: input.kind,
    startsAtUtc: input.startsAt,
    endsAtUtc: input.endsAt,
  });
}

/** Reserve time for a task: the product's differentiator, in one transaction. */
export async function createTimeBlock(input: {
  itemId: string;
  calendarId: string;
  startsAt: string;
  endsAt: string;
  tz: string;
}): Promise<void> {
  await invoke<RawEvent>('time_block_create', {
    itemId: input.itemId,
    calendarId: input.calendarId,
    startsAtUtc: input.startsAt,
    endsAtUtc: input.endsAt,
    tz: input.tz,
  });
}

/** Items with time reserved for them anywhere — not only in the visible days. */
export async function listTimeBlockedItems(): Promise<string[]> {
  return invoke<string[]>('time_blocked_items');
}
