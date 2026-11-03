import {
  CalendarClock16Regular,
  Checkmark16Regular,
  ClockAlarm16Regular,
  Target16Regular,
  Timer16Regular,
  WeatherSunny16Regular,
} from '@fluentui/react-icons';
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
import { pulseOf, type Pulse, type ScorePart } from '@/domain/pulse';
import { localDay, systemZone } from '@/domain/schedule';
import { expandEvents } from '@/features/calendar/occurrences';
import { describeHours } from '@/features/reports/format';
import { Card } from '@/ui/Card';
import { ColumnChart } from '@/ui/ColumnChart';
import { Meter } from '@/ui/Meter';
import { ProgressRing } from '@/ui/ProgressRing';
import { Stat, StatRow } from '@/ui/Stat';
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

function timeOf(instant: string): string {
  return new Date(instant).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, { weekday: 'short' });
}

function PartRow({ part }: { part: ScorePart }) {
  const points = part.share === null ? null : Math.round(part.share * part.weight);
  return (
    <li data-score-part={part.id}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body text-fg">{part.label}</span>
        <span className="shrink-0 text-caption tabular-nums text-fg-secondary">
          {points === null ? 'Not counted' : `${points} of ${part.weight}`}
        </span>
      </div>
      <Meter
        value={points ?? 0}
        max={part.weight}
        label={part.label}
        valueText={part.says}
        tone={part.share === null ? 'neutral' : 'accent'}
        className="my-1"
      />
      <p className="truncate text-caption text-fg-tertiary" title={part.says}>
        {part.says}
      </p>
    </li>
  );
}

/** The top of Today: one score and the figures it is read beside. */
export function TodayOverview({ pulse }: { pulse: Pulse }) {
  const tone =
    pulse.score === null || pulse.score >= 75
      ? ('success' as const)
      : pulse.score >= 50
        ? ('accent' as const)
        : ('danger' as const);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(22rem,2fr)_minmax(0,3fr)]">
      <section
        aria-label="Today's score"
        data-testid="today-score"
        className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
      >
        <div className="flex items-center gap-4">
          <ProgressRing
            size="lg"
            share={pulse.score === null ? null : pulse.score / 100}
            tone={tone}
            label="Today's score"
            valueText={
              pulse.score === null ? 'Nothing to score yet' : `${pulse.score} of 100, ${pulse.word}`
            }
            max={100}
            value={pulse.score ?? 0}
          >
            {pulse.score ?? '—'}
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className="text-caption font-semibold text-fg-tertiary uppercase">
              How today stands
            </h2>
            <p className="text-subtitle font-semibold text-fg" data-testid="today-word">
              {pulse.word ?? 'Nothing to score yet'}
            </p>
            <p className="text-caption text-fg-tertiary">
              {pulse.score === null
                ? 'A score needs something due, a clock running or a plan.'
                : 'Out of 100, from what you can check below.'}
            </p>
          </div>
        </div>
        <ul className="mt-3 flex flex-col gap-2 border-t border-stroke-subtle pt-3">
          {pulse.parts.map((part) => (
            <PartRow key={part.id} part={part} />
          ))}
        </ul>
      </section>

      <div className="flex min-w-0 flex-col gap-3">
        <StatRow label="Today in figures" columns={3}>
          <Stat
            testId="stat-due"
            label="Due today"
            icon={<Target16Regular />}
            value={pulse.due.length}
            note={pulse.due.length === 0 ? 'Nothing left' : 'Still to finish'}
          />
          <Stat
            testId="stat-overdue"
            label="Overdue"
            icon={<ClockAlarm16Regular />}
            value={pulse.overdue.length}
            tone={pulse.overdue.length > 0 ? 'danger' : 'neutral'}
            note={pulse.overdue.length === 0 ? 'Nothing is late' : 'Past their date'}
          />
          <Stat
            testId="stat-done"
            label="Done today"
            icon={<Checkmark16Regular />}
            value={pulse.done.length}
            tone={pulse.done.length > 0 ? 'success' : 'neutral'}
            note={`${pulse.week.reduce((sum, day) => sum + day.done, 0)} in 7 days`}
            trend={pulse.week.map((day) => day.done)}
            trendLabel="Tasks finished each day, the last seven days"
          />
          <Stat
            testId="stat-focus"
            label="On the clock"
            icon={<Timer16Regular />}
            value={describeHours(pulse.tracked)}
            note={`${describeHours(pulse.week.reduce((sum, day) => sum + day.tracked, 0))} in 7 days`}
            trend={pulse.week.map((day) => day.tracked)}
            trendLabel="Time on the clock each day, the last seven days"
          />
          <Stat
            testId="stat-free"
            label="Free today"
            icon={<WeatherSunny16Regular />}
            value={pulse.capacity === 0 ? '—' : describeHours(pulse.free)}
            note={pulse.capacity === 0 ? 'Not a working day' : 'Nothing has this time'}
          />
          <Stat
            testId="stat-next"
            label="Next"
            icon={<CalendarClock16Regular />}
            value={pulse.next === null ? '—' : timeOf(pulse.next.startsAt)}
            note={
              pulse.next === null
                ? 'Nothing else on the calendar'
                : pulse.next.event.title || 'Untitled'
            }
          />
        </StatRow>

        <Card title="The last seven days">
          <ColumnChart
            label="Tasks finished each day, the last seven days"
            height={72}
            columns={pulse.week.map((day) => ({
              id: day.day,
              label: shortDay(day.day),
              value: day.done,
              text: `${day.done}`,
              current: day.day === pulse.today,
            }))}
          />
          <p className="mt-1 text-caption text-fg-tertiary">Tasks finished each day.</p>
        </Card>
      </div>
    </div>
  );
}

/** What is on the calendar today, in order, with the moment you are in. */
export function TodayAgenda({ pulse, now }: { pulse: Pulse; now: string }) {
  const zone = systemZone();
  return (
    <Card title="On the calendar">
      {pulse.agenda.length === 0 ? (
        <p className="text-body text-fg-tertiary" data-testid="agenda-empty">
          Nothing is on the calendar today.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="today-agenda">
          {pulse.agenda.map((occurrence) => {
            const live =
              !occurrence.event.allDay &&
              Date.parse(occurrence.startsAt) <= Date.parse(now) &&
              Date.parse(occurrence.endsAt) > Date.parse(now);
            const gone =
              !occurrence.event.allDay && Date.parse(occurrence.endsAt) <= Date.parse(now);
            return (
              <li
                key={`${occurrence.event.id}-${occurrence.originalStart}`}
                className={[
                  'flex items-baseline gap-3 rounded-md border-l-2 px-2 py-1',
                  live ? 'border-accent bg-accent-subtle' : 'border-stroke-subtle',
                  gone ? 'opacity-60' : '',
                ].join(' ')}
              >
                <span className="shrink-0 text-caption tabular-nums whitespace-nowrap text-fg-secondary">
                  {occurrence.event.allDay
                    ? 'All day'
                    : `${timeOf(occurrence.startsAt)}–${
                        localDay(occurrence.endsAt, zone) === pulse.today
                          ? timeOf(occurrence.endsAt)
                          : ''
                      }`}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-fg">
                  {occurrence.event.title || 'Untitled'}
                </span>
                {live && (
                  <span className="shrink-0 text-caption font-semibold text-accent">Now</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** What has been finished today, which is what a day is made of. */
export function FinishedToday({ pulse }: { pulse: Pulse }) {
  if (pulse.done.length === 0) return null;
  return (
    <Card title="Finished today">
      <ul className="flex flex-col gap-1" data-testid="finished-today">
        {pulse.done.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-body text-fg-secondary">
            <Checkmark16Regular aria-hidden="true" className="shrink-0 text-success" />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
