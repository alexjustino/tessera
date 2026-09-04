import { useMemo } from 'react';

import type { Occurrence, WorkHours } from '@/domain/calendar';
import { LEVELS, yearOf, type DayLoad, type Level } from '@/domain/capacity';

/**
 * A year at a glance: twelve months, every day a cell, each cell coloured by
 * how much of its working hours the calendar has reserved.
 *
 * The colour is never the only cue. Every cell carries the day and the load
 * in words as its accessible name and its tooltip, the legend spells out what
 * each shade means, and an overloaded day gets a ring as well as a colour —
 * the one level that asks for attention should not depend on telling two
 * tints apart.
 *
 * A cell is a button that opens the day, so the map is a way in as well as a
 * way to look.
 */
export function YearView({
  year,
  occurrences,
  workHours,
  zone,
  today,
  onOpenDay,
}: {
  year: number;
  occurrences: Occurrence[];
  workHours: WorkHours[];
  zone: string;
  today: string;
  onOpenDay: (day: string) => void;
}) {
  const load = useMemo(
    () => yearOf(year, occurrences, workHours, zone),
    [year, occurrences, workHours, zone],
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-fg-tertiary" data-testid="year-summary">
        {summarise(load.planned, load.capacity)}
        {load.overloaded > 0 &&
          ` · ${load.overloaded} ${load.overloaded === 1 ? 'day' : 'days'} with more reserved than the day has`}
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
        {load.months.map((month) => (
          <section key={month.month} aria-label={monthName(month.month, 'long')}>
            <h3 className="mb-1 flex items-baseline justify-between text-caption font-semibold text-fg-secondary">
              <span>{monthName(month.month, 'short')}</span>
              <span className="font-normal text-fg-tertiary">
                {month.capacity === 0 ? '' : `${hours(month.planned)} of ${hours(month.capacity)}`}
              </span>
            </h3>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: month.leading }, (_, index) => (
                <span key={`lead-${index}`} aria-hidden="true" />
              ))}
              {month.days.map((day) => (
                <DayCell
                  key={day.day}
                  load={day}
                  isToday={day.day === today}
                  onOpen={() => onOpenDay(day.day)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <Legend />
    </div>
  );
}

/**
 * Shades of the accent, deepening with the load; a day off is the layer
 * itself; over is the danger tint with a ring. The words for each are in the
 * legend and on every cell.
 */
const SHADE: Record<Level, string> = {
  off: 'bg-layer-alt',
  free: 'bg-card',
  light: 'bg-accent/20',
  half: 'bg-accent/40',
  busy: 'bg-accent/60',
  full: 'bg-accent/85',
  over: 'bg-danger-subtle ring-1 ring-danger ring-inset',
};

function DayCell({
  load,
  isToday,
  onOpen,
}: {
  load: DayLoad;
  isToday: boolean;
  onOpen: () => void;
}) {
  const label = describe(load, isToday);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-level={load.level}
      data-day={load.day}
      aria-current={isToday ? 'date' : undefined}
      onClick={onOpen}
      className={[
        'aspect-square min-w-0 rounded-sm text-caption tabular-nums',
        'transition-colors duration-100 ease-easy hover:brightness-110',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        isToday ? 'outline-2 outline-offset-1 outline-fg' : '',
        load.level === 'full' ? 'text-fg-on-accent' : 'text-fg-secondary',
        SHADE[load.level],
      ].join(' ')}
    >
      {Number(load.day.slice(-2))}
    </button>
  );
}

function Legend() {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-tertiary"
      aria-label="Legend"
    >
      {LEVELS.map((level) => (
        <li key={level.id} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block size-3 rounded-sm ${SHADE[level.id]}`}
          />
          {level.label}
        </li>
      ))}
    </ul>
  );
}

/** `Monday 7 September: 3h reserved of 9h — up to half` */
function describe(load: DayLoad, isToday: boolean): string {
  const [year, month, date] = load.day.split('-').map(Number);
  const when = new Date(year!, month! - 1, date!).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const word = LEVELS.find((level) => level.id === load.level)?.label ?? load.level;
  const figure =
    load.capacity === 0
      ? load.planned === 0
        ? 'not a working day'
        : `${hours(load.planned)} reserved on a day off`
      : `${hours(load.planned)} reserved of ${hours(load.capacity)}`;
  return `${isToday ? 'Today, ' : ''}${when}: ${figure} — ${word.toLowerCase()}`;
}

function summarise(planned: number, capacity: number): string {
  if (capacity === 0) return 'No working hours set, so there is nothing to measure against.';
  const percent = Math.round((planned / capacity) * 100);
  return `${hours(planned)} reserved of ${hours(capacity)} working time this year (${percent}%).`;
}

/**
 * Minutes as hours: `45m`, `1.5h`, `2,340h`.
 *
 * Not `formatDuration`, which counts eight-hour days — the plan's unit, where
 * "3d" means three days of work. Capacity is measured against the clock, and
 * "293d 5h of working time this year" is a sentence nobody can check.
 */
function hours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const total = minutes / 60;
  if (total < 10) return `${Number(total.toFixed(1))}h`;
  return `${Math.round(total).toLocaleString()}h`;
}

function monthName(month: string, style: 'short' | 'long'): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(year!, index! - 1, 15).toLocaleDateString(undefined, {
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
  });
}
