import {
  Calendar16Regular,
  Checkmark16Filled,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  CalendarToday20Regular,
  TaskListSquareLtr16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState, type ReactNode } from 'react';

import { describeError } from '@/data/errors';
import {
  useCalendars,
  useDaysOffSet,
  useEventExceptions,
  useEvents,
  useItems,
  useTimeEntries,
  useWorkHours,
} from '@/data/hooks';
import { addLocalDays, todayIn } from '@/domain/calendar';
import {
  isPastWeek,
  mosaicOf,
  TILE_STATES,
  type Mosaic,
  type Tile,
  type TileState,
} from '@/domain/mosaic';
import { project } from '@/domain/receipt';
import { daysIn, periodOf, shiftPeriod, traceable } from '@/domain/report';
import { systemZone } from '@/domain/schedule';
import { expandEvents } from '@/features/calendar/occurrences';
import { useLedger } from '@/features/receipt/useLedger';
import { FigureRow } from '@/features/reports/FigureRow';
import { describeDay, describeHours as hoursOf, describePeriod } from '@/features/reports/format';
import { Card } from '@/ui/Card';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { TileGrid, type TileCell } from '@/ui/TileGrid';
import { useNow } from '@/ui/useNow';

/**
 * The week mosaic (M4): the working week as one tile per hour.
 *
 * The name's own image — a _tessera_ is one tile of a mosaic. Each tile says
 * where an hour went or is going: reserved by the calendar, committed to
 * estimated work, lived with tracked time, gone, or free. The sentence above
 * says the same thing in hours, and every number in it opens onto the rows it
 * was added up from (ADR-024). When the work due by the end of the week needs
 * more than the week has left, the difference is drawn as tiles too — before
 * the week has had a chance to go wrong.
 *
 * It shows; it never moves anything (SPEC 1.3, ADR-034).
 */

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** How a tile looks: tokens only, and never colour alone — each has a glyph or a word. */
const LOOK: Record<TileState, { className: string; glyph: ReactNode }> = {
  free: { className: 'border border-stroke bg-layer-alt text-fg-tertiary', glyph: null },
  reserved: {
    className: 'border border-stroke-strong bg-card text-fg',
    glyph: <Calendar16Regular aria-hidden="true" className="shrink-0" />,
  },
  committed: {
    className: 'border border-accent bg-accent-subtle text-fg',
    glyph: <TaskListSquareLtr16Regular aria-hidden="true" className="shrink-0" />,
  },
  lived: {
    className: 'border border-accent bg-accent text-fg-on-accent',
    glyph: <Checkmark16Filled aria-hidden="true" className="shrink-0" />,
  },
  past: { className: 'border border-dashed border-stroke text-fg-disabled', glyph: null },
};

const STATE_LABEL = Object.fromEntries(TILE_STATES.map((s) => [s.id, s.label])) as Record<
  TileState,
  string
>;

function weekdayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, { weekday: 'long' });
}

/**
 * One tile as a grid cell. A tile that continues the block above it — same
 * state, same task or event — shows its glyph without repeating the name, so a
 * block of work reads as a block; its spoken name is always whole.
 */
function cellOf(tile: Tile, continued: boolean): TileCell {
  const look = LOOK[tile.state];
  const span = tile.minutes < 60 ? ` (${tile.minutes} minutes)` : '';
  return {
    id: `${tile.day}@${tile.startMinute}`,
    label: `${weekdayOf(tile.day)} ${clock(tile.startMinute)}${span}: ${STATE_LABEL[tile.state]}${
      tile.label === null ? '' : ` — ${tile.label}`
    }${tile.current ? '. Now.' : ''}`,
    className: `${look.className}${tile.current ? ' ring-2 ring-fg ring-offset-1 ring-offset-layer' : ''}`,
    current: tile.current,
    content: (
      <span className="flex items-center gap-1" data-state={tile.state}>
        {look.glyph}
        {tile.label !== null && !continued && <span className="truncate">{tile.label}</span>}
      </span>
    ),
  };
}

export function MosaicPage() {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const [anchor, setAnchor] = useState(today);
  const period = useMemo(() => periodOf('week', anchor), [anchor]);
  const week = useMemo(() => daysIn(period), [period]);

  const from = useMemo(() => new Date(`${period.firstDay}T00:00:00`).toISOString(), [period]);
  const to = useMemo(
    () => new Date(`${addLocalDays(period.lastDay, 1)}T00:00:00`).toISOString(),
    [period],
  );

  const hours = useWorkHours();
  const calendars = useCalendars();
  const events = useEvents(from, to, calendars.data ?? []);
  const exceptions = useEventExceptions();
  const entries = useTimeEntries();
  const items = useItems(null, true);
  const daysOff = useDaysOffSet();
  const ledger = useLedger(now);

  const mosaic: Mosaic | null = useMemo(() => {
    if (ledger === null || hours.data === undefined) return null;
    return mosaicOf({
      week,
      now,
      zone,
      hours: hours.data,
      daysOff,
      occurrences: expandEvents(events.data ?? [], exceptions.data ?? [], from, to),
      entries: entries.data ?? [],
      items: items.data ?? [],
      projection: project(ledger),
    });
  }, [
    ledger,
    hours.data,
    week,
    now,
    zone,
    daysOff,
    events.data,
    exceptions.data,
    from,
    to,
    entries.data,
    items.data,
  ]);

  const failure = hours.error ?? events.error ?? entries.error ?? items.error;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-fg">Mosaic</h1>
          <p className="mt-1 text-body text-fg-secondary">
            Your working week, one tile per hour — where each hour went, and where the rest is
            going.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label="The week before"
            icon={<ChevronLeft20Regular />}
            onClick={() => setAnchor(shiftPeriod(period, -1).firstDay)}
          />
          <IconButton
            label="This week"
            icon={<CalendarToday20Regular />}
            onClick={() => setAnchor(today)}
          />
          <IconButton
            label="The week after"
            icon={<ChevronRight20Regular />}
            onClick={() => setAnchor(shiftPeriod(period, 1).firstDay)}
          />
          <h2 className="ml-2 text-body-lg font-semibold text-fg" data-testid="mosaic-week">
            {describePeriod(period)}
          </h2>
        </div>
      </header>

      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="The week could not be read">
          {describeError(failure)}
        </InfoBar>
      )}

      {mosaic === null ? (
        <p className="text-body text-fg-tertiary">Laying the tiles…</p>
      ) : (
        <MosaicBody mosaic={mosaic} week={week} past={isPastWeek(week, now, zone)} />
      )}
    </div>
  );
}

function MosaicBody({ mosaic, week, past }: { mosaic: Mosaic; week: string[]; past: boolean }) {
  const workingDays = useMemo(() => mosaic.days.filter((day) => !day.off), [mosaic]);
  const lastWorkingDay = workingDays.at(-1)?.day ?? week.at(-1) ?? '';
  const broken = [mosaic.capacity, mosaic.reserved, mosaic.needs, mosaic.available].filter(
    (figure) => !traceable(figure),
  );

  const rows = useMemo(() => {
    const out: Array<{ id: string; header: string; cells: Array<TileCell | null> }> = [];
    for (let minute = mosaic.firstMinute; minute < mosaic.lastMinute; minute += 60) {
      out.push({
        id: `row-${minute}`,
        header: clock(minute),
        cells: workingDays.map((day) => {
          const index = day.tiles.findIndex((t) => t.startMinute === minute);
          const tile = day.tiles[index];
          if (tile === undefined) return null;
          const above = day.tiles[index - 1];
          const continued =
            above !== undefined &&
            above.state === tile.state &&
            above.label === tile.label &&
            above.itemId === tile.itemId;
          return cellOf(tile, continued);
        }),
      });
    }
    return out;
  }, [mosaic, workingDays]);

  if (mosaic.tileCount === 0) {
    return (
      <Card title="No working hours this week">
        <p className="text-body text-fg-secondary">
          Every day of this week is a day off or outside the working week, so there are no tiles to
          lay. Working hours and days off are in Settings.
        </p>
      </Card>
    );
  }

  return (
    <>
      <section aria-label="This week in hours" data-testid="mosaic-summary">
        <p className="text-body-lg text-fg">
          {past ? (
            <>
              This week has gone: {mosaic.counts.lived} of its {mosaic.tileCount} tiles had time
              tracked in them.
            </>
          ) : (
            <>
              This week has <strong data-testid="mosaic-tiles">{mosaic.tileCount} tiles</strong>.{' '}
              {mosaic.reserved.value === 0
                ? 'Nothing is on the calendar.'
                : `The calendar took ${hoursOf(mosaic.reserved.value)}.`}{' '}
              Work due by {describeDay(lastWorkingDay)} needs {hoursOf(mosaic.needs.value)}, and{' '}
              {hoursOf(mosaic.available.value)} is left
              {mosaic.shortTiles > 0 ? (
                <>
                  {' '}
                  — <strong data-testid="mosaic-short">{mosaic.shortTiles} short</strong>.
                </>
              ) : (
                '.'
              )}
            </>
          )}
        </p>
      </section>

      {mosaic.shortTiles > 0 && !past && (
        <InfoBar
          severity="caution"
          title={`${mosaic.shortTiles} ${mosaic.shortTiles === 1 ? 'hour' : 'hours'} short this week`}
        >
          <p>
            The work due by {describeDay(lastWorkingDay)} needs more than the hours left. Nothing
            has moved: this is the arithmetic, before the week has had a chance to go wrong.
          </p>
          <div
            className="mt-2 flex flex-wrap gap-1"
            role="img"
            aria-label={`${mosaic.shortTiles} tiles that do not fit`}
            data-testid="mosaic-short-tiles"
          >
            {Array.from({ length: Math.min(mosaic.shortTiles, 40) }, (_, i) => (
              <span key={i} className="h-4 w-6 rounded-sm border border-danger bg-danger-subtle" />
            ))}
            {mosaic.shortTiles > 40 && (
              <span className="text-caption">+{mosaic.shortTiles - 40} more</span>
            )}
          </div>
        </InfoBar>
      )}

      {mosaic.todayOverflow > 0 && !past && (
        <p className="text-caption text-fg-secondary">
          Today&apos;s share of the plan is {hoursOf(mosaic.todayOverflow)} more than what is left
          of today.
        </p>
      )}

      <Card title="The week, tile by tile">
        <div className="flex flex-col gap-3">
          <TileGrid
            label="The working week, one tile per hour"
            columns={workingDays.map((day) => ({ id: day.day, header: describeDay(day.day) }))}
            rows={rows}
          />
          <ul aria-label="What the tiles mean" className="flex flex-wrap gap-x-4 gap-y-1">
            {TILE_STATES.map((state) => (
              <li
                key={state.id}
                className="flex items-center gap-1.5 text-caption text-fg-secondary"
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-4 w-6 items-center justify-center rounded-sm ${LOOK[state.id].className}`}
                />
                {state.label} ({mosaic.counts[state.id]})
              </li>
            ))}
          </ul>
          {mosaic.days.some((day) => day.off) && (
            <p className="text-caption text-fg-tertiary">
              Days with no working hours are not drawn:{' '}
              {mosaic.days
                .filter((day) => day.off)
                .map((day) => describeDay(day.day))
                .join(', ')}
              .
            </p>
          )}
          {mosaic.rounded && (
            <p className="text-caption text-fg-tertiary">
              A day that does not end on the hour has a shorter last tile; the hours above are
              exact.
            </p>
          )}
        </div>
      </Card>

      <Card title="The numbers, and what they add up">
        <div className="flex flex-col gap-1">
          <FigureRow figure={mosaic.capacity} broken={broken} format={hoursOf} />
          <FigureRow figure={mosaic.reserved} broken={broken} format={hoursOf} />
          <FigureRow figure={mosaic.needs} broken={broken} format={hoursOf} />
          <FigureRow figure={mosaic.available} broken={broken} format={hoursOf} />
        </div>
      </Card>
    </>
  );
}
