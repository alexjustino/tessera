import { useMemo } from 'react';

import {
  useCalendars,
  useDaysOffSet,
  useDependencies,
  useEventExceptions,
  useEvents,
  useGoalLinks,
  useGoals,
  useItems,
  useTimeEntries,
  useWorkHours,
} from '@/data/hooks';
import { addLocalDays, todayIn } from '@/domain/calendar';
import { HORIZON_DAYS, type LedgerInput } from '@/domain/receipt';
import { localPlace, systemZone } from '@/domain/schedule';
import { minutesOf } from '@/domain/time';
import { expandEvents } from '@/features/calendar/occurrences';

/**
 * Everything the receipt needs, read from the workspace: the working hours,
 * a year of calendar from today, every task, the dependencies, the goals and
 * the time already tracked.
 *
 * Returns null until all of it has loaded. A receipt computed on half the
 * workspace would be a confident wrong answer, which is worse than a moment
 * with no answer at all.
 */
export function useLedger(now: string): LedgerInput | null {
  const zone = useMemo(() => systemZone(), []);
  const today = todayIn(now, zone);

  const from = useMemo(() => new Date(`${today}T00:00:00`).toISOString(), [today]);
  const to = useMemo(
    () => new Date(`${addLocalDays(today, HORIZON_DAYS)}T00:00:00`).toISOString(),
    [today],
  );

  const hours = useWorkHours();
  const calendars = useCalendars();
  const events = useEvents(from, to, calendars.data ?? []);
  const exceptions = useEventExceptions();
  const items = useItems(null, true);
  const dependencies = useDependencies();
  const goals = useGoals();
  const goalLinks = useGoalLinks();
  const entries = useTimeEntries();
  const daysOff = useDaysOffSet();

  return useMemo(() => {
    // Without calendars there are no events to wait for.
    const eventsReady =
      calendars.data !== undefined && (calendars.data.length === 0 || events.data !== undefined);
    if (
      hours.data === undefined ||
      !eventsReady ||
      exceptions.data === undefined ||
      items.data === undefined ||
      dependencies.data === undefined ||
      goals.data === undefined ||
      goalLinks.data === undefined ||
      entries.data === undefined
    ) {
      return null;
    }

    const tracked = new Map<string, number>();
    for (const entry of entries.data) {
      tracked.set(entry.itemId, (tracked.get(entry.itemId) ?? 0) + minutesOf(entry, now));
    }

    return {
      today,
      zone,
      hours: hours.data,
      occurrences: expandEvents(events.data ?? [], exceptions.data, from, to),
      items: items.data,
      edges: dependencies.data,
      goals: goals.data,
      goalLinks: goalLinks.data,
      tracked,
      daysOff,
      minuteNow: localPlace(now, zone).minute,
    };
  }, [
    today,
    zone,
    from,
    to,
    now,
    hours.data,
    calendars.data,
    events.data,
    exceptions.data,
    items.data,
    dependencies.data,
    goals.data,
    goalLinks.data,
    entries.data,
    daysOff,
  ]);
}
