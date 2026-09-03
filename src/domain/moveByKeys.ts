/**
 * Moving a block of time with the keyboard.
 *
 * The calendar's mouse drag is HTML5 drag-and-drop, which the keyboard cannot
 * reach. This is the other route: pick a thing up, nudge it with the arrows,
 * put it down. Up and down move by the grid's snap; left and right by a day
 * inside the visible range; Home and End go to the start and end of the
 * working day. Nothing here touches the DOM — the screen asks what a key means
 * and draws the answer.
 *
 * Instants are UTC; days are local `YYYY-MM-DD` in the calendar's zone, the
 * same convention the calendar layout uses (ADR-013).
 */

import { addLocalDays } from './calendar';
import { asInstant, localPlace } from './schedule';

export const SNAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

export type MoveKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageUp' | 'PageDown';

export function isMoveKey(key: string): key is MoveKey {
  return (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown'
  );
}

/** What is being carried: where it starts, how long it is. */
export interface Carried {
  startsAt: string;
  durationMs: number;
}

export interface MoveBounds {
  /** The visible days, in order. Left and right never leave them. */
  days: readonly string[];
  zone: string;
  /** Working hours for Home and End, as minutes from midnight. */
  workStartsMinute: number;
  workEndsMinute: number;
}

/** The local day and minute-of-day an instant falls on. */
export function placeOf(instant: string, zone: string): { day: string; minute: number } {
  return localPlace(instant, zone);
}

/** The instant at a local day and minute-of-day. */
export function instantOf(day: string, minute: number, zone: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const wall = new Date(0);
  wall.setFullYear(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  wall.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return asInstant(wall, zone);
}

/**
 * Apply one key to what is carried. Returns the new start, or the same one
 * when the key would leave the visible range or the day.
 */
export function moveByKey(carried: Carried, key: MoveKey, bounds: MoveBounds): string {
  const { day, minute } = placeOf(carried.startsAt, bounds.zone);
  const durationMinutes = Math.max(SNAP_MINUTES, Math.round(carried.durationMs / 60_000));
  const lastStart = DAY_MINUTES - durationMinutes;

  const clamp = (m: number) => Math.min(Math.max(m, 0), lastStart);
  const snapped = Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;

  switch (key) {
    case 'ArrowUp':
      return instantOf(day, clamp(snapped - SNAP_MINUTES), bounds.zone);
    case 'ArrowDown':
      return instantOf(day, clamp(snapped + SNAP_MINUTES), bounds.zone);
    case 'PageUp':
      return instantOf(day, clamp(snapped - 60), bounds.zone);
    case 'PageDown':
      return instantOf(day, clamp(snapped + 60), bounds.zone);
    case 'Home':
      return instantOf(day, clamp(bounds.workStartsMinute), bounds.zone);
    case 'End':
      return instantOf(day, clamp(bounds.workEndsMinute - durationMinutes), bounds.zone);
    case 'ArrowLeft':
    case 'ArrowRight': {
      const index = bounds.days.indexOf(day);
      const next = key === 'ArrowLeft' ? index - 1 : index + 1;
      if (index === -1 || next < 0 || next >= bounds.days.length) return carried.startsAt;
      return instantOf(bounds.days[next] ?? addLocalDays(day, 0), minute, bounds.zone);
    }
  }
}

/**
 * Where a task lands when picked up from the side panel: the start of the
 * working day on the first visible day that is today or later, else the first
 * visible day.
 */
export function firstSlot(bounds: MoveBounds, today: string): string {
  const day = bounds.days.find((candidate) => candidate >= today) ?? bounds.days[0] ?? today;
  return instantOf(day, bounds.workStartsMinute, bounds.zone);
}

/** "Wed 3 Sep, 09:15 to 10:15" — what the live region says after each nudge. */
export function describePlacement(carried: Carried, zone: string): string {
  const start = new Date(carried.startsAt);
  const end = new Date(start.getTime() + carried.durationMs);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).format(start);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  });
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}, ${time.format(start)} to ${time.format(end)}`;
}
