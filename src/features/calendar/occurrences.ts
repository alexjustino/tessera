import {
  expand,
  type CalendarEvent,
  type EventException,
  type Occurrence,
} from '@/domain/calendar';
import { occurrencesBetween } from '@/domain/schedule';

/**
 * Every occurrence of the given events inside a window, exceptions applied.
 *
 * The calendar draws these and the receipt counts them (M1); both have to
 * expand a series the same way, or the hours one screen shows as reserved
 * would not be the hours the other subtracts. One function is how they agree.
 */
export function expandEvents(
  events: readonly CalendarEvent[],
  exceptions: readonly EventException[],
  from: string,
  to: string,
): Occurrence[] {
  return expand(events, exceptions, from, to, (event, windowFrom, windowTo) =>
    occurrencesBetween(
      {
        startAt: null,
        dueAt: event.startsAt,
        remindAt: null,
        rule: event.rrule,
        mode: 'schedule',
      },
      windowFrom,
      windowTo,
      event.tz,
    ),
  );
}
