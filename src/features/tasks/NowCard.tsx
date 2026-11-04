import {
  CalendarAdd20Regular,
  CalendarClock20Regular,
  Clock20Regular,
  Open20Regular,
  Play20Regular,
  Stop20Regular,
  Target20Regular,
} from '@fluentui/react-icons';
import { useMemo } from 'react';

import {
  useCalendars,
  useCreateTimeBlock,
  useEventExceptions,
  useEvents,
  useStartTimer,
  useStopTimer,
  useTimeEntries,
} from '@/data/hooks';
import { suggestPlan } from '@/domain/autoPlan';
import { addLocalDays, todayIn } from '@/domain/calendar';
import type { Item } from '@/domain/item';
import { pickNow, type NowPick } from '@/domain/now';
import { systemZone } from '@/domain/schedule';
import { expandEvents } from '@/features/calendar/occurrences';
import { useLedger } from '@/features/receipt/useLedger';
import { describeDay, describeHours } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

function clockOf(instant: string): string {
  return new Date(instant).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** The heading and the line under it, for each answer. */
function wordsFor(pick: NowPick, now: string, zone: string): { head: string; line: string } {
  const today = todayIn(now, zone);
  const when = (instant: string) => {
    const day = todayIn(instant, zone);
    return day === today ? clockOf(instant) : `${describeDay(day)}, ${clockOf(instant)}`;
  };
  switch (pick.kind) {
    case 'running':
      return {
        head: pick.title,
        line: `On the clock for ${describeHours(
          Math.max(0, Math.round((Date.parse(now) - Date.parse(pick.startedAt)) / 60_000)),
        )}`,
      };
    case 'reserved':
      return { head: pick.title, line: `Reserved until ${clockOf(pick.endsAt)}` };
    case 'event':
      return { head: pick.title, line: `On the calendar until ${clockOf(pick.endsAt)}` };
    case 'next':
      return { head: pick.title, line: `Next, at ${when(pick.startsAt)}` };
    case 'suggested':
      return {
        head: pick.suggestion.title,
        line: `Suggested for ${when(pick.suggestion.startsAt)}, ${describeHours(pick.suggestion.minutes)}`,
      };
  }
}

/**
 * One answer to "what do I do now", and the press that starts it. What it picks is
 * explained in `domain/now.ts`.
 */
export function NowCard({
  items,
  onFocus,
  onOpen,
}: {
  items: readonly Item[];
  onFocus?: ((id: string) => void) | undefined;
  onOpen: (id: string) => void;
}) {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const from = useMemo(() => new Date(`${today}T00:00:00`).toISOString(), [today]);
  const to = useMemo(() => new Date(`${addLocalDays(today, 2)}T00:00:00`).toISOString(), [today]);

  const calendars = useCalendars();
  const events = useEvents(from, to, calendars.data ?? []);
  const exceptions = useEventExceptions();
  const entries = useTimeEntries();
  const ledger = useLedger(now);

  const start = useStartTimer();
  const stop = useStopTimer();
  const reserve = useCreateTimeBlock();

  const pick = useMemo(
    () =>
      pickNow({
        now,
        items,
        entries: entries.data ?? [],
        occurrences: expandEvents(events.data ?? [], exceptions.data ?? [], from, to),
        suggestions: ledger === null ? [] : suggestPlan(ledger).suggestions,
      }),
    [now, items, entries.data, events.data, exceptions.data, from, to, ledger],
  );

  if (pick === null) return null;

  const { head, line } = wordsFor(pick, now, zone);
  const itemId =
    pick.kind === 'suggested' ? pick.suggestion.itemId : pick.kind === 'event' ? null : pick.itemId;
  const busy = start.isPending || stop.isPending || reserve.isPending;

  return (
    <section
      aria-label="What to do now"
      data-testid="now-card"
      data-now={pick.kind}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent bg-accent-subtle px-4 py-3"
    >
      <span aria-hidden="true" className="flex shrink-0 text-accent">
        {pick.kind === 'running' ? <Clock20Regular /> : <CalendarClock20Regular />}
      </span>
      <div className="min-w-48 flex-1">
        <p className="text-caption font-semibold text-accent uppercase">
          {pick.kind === 'running' || pick.kind === 'reserved' || pick.kind === 'event'
            ? 'Now'
            : 'Up next'}
        </p>
        <p className="truncate text-body-lg font-semibold text-fg" title={head}>
          {head}
        </p>
        <p className="text-caption text-fg-secondary">{line}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {pick.kind === 'running' ? (
          <Button
            appearance="accent"
            icon={<Stop20Regular />}
            disabled={busy}
            onClick={() =>
              stop.mutate(undefined, { onSuccess: () => announce(`Stopped ${pick.title}`) })
            }
          >
            Stop the clock
          </Button>
        ) : (
          itemId !== null && (
            <Button
              appearance="accent"
              icon={<Play20Regular />}
              disabled={busy}
              onClick={() => start.mutate(itemId, { onSuccess: () => announce(`Timing ${head}`) })}
            >
              Start the clock
            </Button>
          )
        )}
        {pick.kind === 'suggested' && (
          <Button
            icon={<CalendarAdd20Regular />}
            disabled={busy}
            onClick={() =>
              reserve.mutate(
                {
                  itemId: pick.suggestion.itemId,
                  calendarId: calendars.data?.[0]?.id ?? 'personal',
                  startsAt: pick.suggestion.startsAt,
                  endsAt: pick.suggestion.endsAt,
                  tz: zone,
                },
                { onSuccess: () => announce(`Reserved ${head}`) },
              )
            }
          >
            Reserve it
          </Button>
        )}
        {itemId !== null && onFocus !== undefined && (
          <Button appearance="subtle" icon={<Target20Regular />} onClick={() => onFocus(itemId)}>
            Focus
          </Button>
        )}
        {itemId !== null && (
          <Button appearance="subtle" icon={<Open20Regular />} onClick={() => onOpen(itemId)}>
            Open
          </Button>
        )}
      </div>
    </section>
  );
}
