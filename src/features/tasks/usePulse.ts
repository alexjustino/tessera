import { useMemo } from 'react';

import {
  useCalendars,
  useDaysOffSet,
  useEventExceptions,
  useEvents,
  useTimeBlockedItems,
  useTimeEntries,
  useWorkHours,
} from '@/data/hooks';
import { addLocalDays, todayIn } from '@/domain/calendar';
import type { Item } from '@/domain/item';
import { pulseOf, type Pulse } from '@/domain/pulse';
import { systemZone } from '@/domain/schedule';
import { expandEvents } from '@/features/calendar/occurrences';
import { useNow } from '@/ui/useNow';

/** Today's figures, from what the workspace holds. One read for the whole page. */
export function usePulse(items: readonly Item[]): Pulse {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const from = useMemo(() => new Date(`${today}T00:00:00`).toISOString(), [today]);
  const to = useMemo(() => new Date(`${addLocalDays(today, 1)}T00:00:00`).toISOString(), [today]);

  const calendars = useCalendars();
  const events = useEvents(from, to, calendars.data ?? []);
  const exceptions = useEventExceptions();
  const entries = useTimeEntries();
  const hours = useWorkHours();
  const daysOff = useDaysOffSet();
  const blocked = useTimeBlockedItems();

  return useMemo(
    () =>
      pulseOf({
        items,
        entries: entries.data ?? [],
        occurrences: expandEvents(events.data ?? [], exceptions.data ?? [], from, to),
        hours: hours.data ?? [],
        daysOff,
        reserved: new Set(blocked.data ?? []),
        now,
        zone,
      }),
    [
      items,
      entries.data,
      events.data,
      exceptions.data,
      from,
      to,
      hours.data,
      daysOff,
      blocked.data,
      now,
      zone,
    ],
  );
}
