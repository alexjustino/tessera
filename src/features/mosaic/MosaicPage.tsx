import {
  Calendar16Regular,
  Checkmark16Filled,
  Checkmark20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  CalendarToday20Regular,
  Clock16Regular,
  Grid16Regular,
  TaskListSquareLtr16Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from 'react';

import { describeError } from '@/data/errors';
import {
  useCalendars,
  useCreateTimeBlock,
  useDaysOffSet,
  useGoalLinks,
  useGoals,
  useEventExceptions,
  useEvents,
  useItems,
  useTimeBlockedItems,
  useTimeEntries,
  useWorkHours,
  useProperties,
  usePropertyValues,
} from '@/data/hooks';
import { suggestPlan } from '@/domain/autoPlan';
import { addLocalDays, todayIn } from '@/domain/calendar';
import type { Goal, GoalLink } from '@/domain/goal';
import {
  envelopesOf,
  isPastWeek,
  mosaicOf,
  TILE_STATES,
  type Envelopes,
  type Mosaic,
  type MosaicDay,
  type Split,
  type Tile,
  type TileState,
} from '@/domain/mosaic';
import {
  goalsOfItem,
  HEAT_WORDS,
  historyOf,
  SERIES,
  seriesOf,
  type HeatLevel,
  type HistoryWeek,
} from '@/domain/mosaicHistory';
import { project } from '@/domain/receipt';
import { daysIn, periodOf, shiftPeriod, traceable } from '@/domain/report';
import type { Item } from '@/domain/item';
import { systemZone } from '@/domain/schedule';
import { expandEvents } from '@/features/calendar/occurrences';
import { TaskDetail } from '@/features/tasks/TaskDetail';
import { FillTheWeek } from './FillTheWeek';
import { ReserveHour, type HourChoice } from './ReserveHour';
import { useLedger } from '@/features/receipt/useLedger';
import { FigureRow } from '@/features/reports/FigureRow';
import { describeDay, describeHours as hoursOf, describePeriod } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Meter } from '@/ui/Meter';
import { Page } from '@/ui/Page';
import { StackBar } from '@/ui/StackBar';
import { Stat, StatRow } from '@/ui/Stat';
import { TileGrid, type TileCell } from '@/ui/TileGrid';
import { announce } from '@/ui/announce';
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

const COLLECTION = 'tasks';

/** A task being dragged from the queue, the same way the calendar carries one. */
const DRAG_TASK = 'application/x-tessera-task';

/** How many weeks the history shows. */
const HISTORY_WEEKS = 16;

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
/** `Thesis` to `T`, `Release 1.3` to `R1`: a goal's mark on its tiles. */
function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase() ?? '')
    .join('');
}

function cellOf(
  tile: Tile,
  continued: boolean,
  goals: readonly string[],
  slot: number | undefined,
): TileCell {
  if (tile.split !== null) return splitCellOf(tile, tile.split);
  const look = LOOK[tile.state];
  const span = tile.minutes < 60 ? ` (${tile.minutes} minutes)` : '';
  return {
    id: `${tile.day}@${tile.startMinute}`,
    label: `${weekdayOf(tile.day)} ${clock(tile.startMinute)}${span}: ${STATE_LABEL[tile.state]}${
      tile.label === null ? '' : ` — ${tile.label}`
    }${goals.length > 0 ? `, for ${goals.join(' and ')}` : ''}${tile.current ? '. Now.' : ''}`,
    className: `${look.className}${tile.current ? ' ring-2 ring-fg ring-offset-1 ring-offset-layer' : ''}`,
    current: tile.current,
    // A goal's colour on its own work: tinted while it is only committed, solid
    // once it is lived. The mark and the words say the goal too.
    style:
      slot === undefined
        ? undefined
        : tile.state === 'committed'
          ? {
              background: `color-mix(in srgb, var(--series-${slot}) 22%, transparent)`,
              borderColor: `var(--series-${slot})`,
            }
          : tile.state === 'lived'
            ? {
                background: `var(--series-${slot})`,
                borderColor: `var(--series-${slot})`,
                color: `var(--series-${slot}-ink, var(--series-ink))`,
              }
            : tile.state === 'reserved'
              ? { borderColor: `var(--series-${slot})` }
              : undefined,
    content: (
      <span className="flex h-full items-start gap-1" data-state={tile.state}>
        {look.glyph}
        {tile.label !== null && !continued && <span className="truncate">{tile.label}</span>}
        {goals.length > 0 && !continued && (
          <span
            aria-hidden="true"
            className="ml-auto shrink-0 rounded-sm border border-current px-1 text-[10px] leading-4"
            title={goals.join(', ')}
          >
            {initialsOf(goals[0] ?? '')}
          </span>
        )}
      </span>
    ),
  };
}

/**
 * The split tile (M6): a past hour set aside for a task. Plan above, life
 * below; when they match, the halves close into one whole tile. The halves
 * are told apart by a dashed line and a word as well as a fill.
 */
function splitCellOf(tile: Tile, split: Split): TileCell {
  const when = `${weekdayOf(tile.day)} ${clock(tile.startMinute)}`;
  if (split.closed) {
    return {
      id: `${tile.day}@${tile.startMinute}`,
      label: `${when}: planned ${split.planLabel}, lived ${split.planLabel} — closed`,
      className: LOOK.lived.className,
      content: (
        <span className="flex items-center gap-1" data-state="closed">
          {LOOK.lived.glyph}
          <span className="truncate">{split.planLabel}</span>
        </span>
      ),
    };
  }
  return {
    id: `${tile.day}@${tile.startMinute}`,
    label: `${when}: planned ${split.planLabel}, ${
      split.livedLabel === null ? 'nothing tracked' : `lived ${split.livedLabel}`
    } — split`,
    className: 'border border-stroke-strong',
    content: (
      <span className="flex h-full flex-col text-[11px] leading-none" data-state="split">
        <span className="flex h-1/2 items-center gap-1 truncate text-fg">
          <Calendar16Regular aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="truncate">{split.planLabel}</span>
        </span>
        <span
          className={[
            'flex h-1/2 items-center gap-1 truncate border-t border-dashed border-stroke',
            split.livedLabel === null ? 'text-fg-disabled' : 'text-accent',
          ].join(' ')}
        >
          {split.livedLabel === null ? (
            'nothing tracked'
          ) : (
            <>
              <Checkmark16Filled aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="truncate">{split.livedLabel}</span>
            </>
          )}
        </span>
      </span>
    ),
  };
}

export function MosaicPage({ onOpenPage }: { onOpenPage?: (pageId: string) => void } = {}) {
  const [picked, setPicked] = useState<HourChoice | null>(null);
  // A task opens here, over the week, so closing it comes back to the week.
  const [openId, setOpenId] = useState<string | null>(null);
  const properties = useProperties(COLLECTION);
  const values = usePropertyValues(COLLECTION);
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
  const goals = useGoals();
  const goalLinks = useGoalLinks();

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

  // The envelope goals a task spends from — named on its tiles (M5).
  const reserved = useCreateTimeBlock();
  const blocked = useTimeBlockedItems();
  const reservedIds = useMemo(() => new Set(blocked.data ?? []), [blocked.data]);
  const series = useMemo(() => seriesOf(goals.data ?? []), [goals.data]);

  const history = useMemo(
    () =>
      historyOf({
        firstDay: periodOf('week', today).firstDay,
        today,
        weeks: HISTORY_WEEKS,
        entries: entries.data ?? [],
        hours: hours.data ?? [],
        daysOff,
        zone,
        now,
      }),
    [today, entries.data, hours.data, daysOff, zone, now],
  );

  // The plan for the days on screen: what "Reserve this week" would take.
  const toTake = useMemo(() => {
    if (ledger === null) return [];
    const shown = new Set(week);
    return suggestPlan(ledger).suggestions.filter((suggestion) => shown.has(suggestion.day));
  }, [ledger, week]);

  const takeWeek = async () => {
    for (const suggestion of toTake) {
      await reserved.mutateAsync({
        itemId: suggestion.itemId,
        calendarId: calendars.data?.[0]?.id ?? 'personal',
        startsAt: suggestion.startsAt,
        endsAt: suggestion.endsAt,
        tz: zone,
      });
    }
    announce(`Reserved ${toTake.length} ${toTake.length === 1 ? 'block' : 'blocks'} of time`);
  };

  const dropTask = useCallback(
    (itemId: string, hour: HourChoice) => {
      const startMinute = String(Math.floor(hour.startMinute / 60)).padStart(2, '0');
      const startsAt = new Date(
        `${hour.day}T${startMinute}:${String(hour.startMinute % 60).padStart(2, '0')}:00`,
      );
      reserved.mutate({
        itemId,
        calendarId: calendars.data?.[0]?.id ?? 'personal',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + hour.minutes * 60_000).toISOString(),
        tz: zone,
      });
    },
    [reserved, calendars.data, zone],
  );

  const failure = hours.error ?? events.error ?? entries.error ?? items.error ?? reserved.error;

  return (
    <Page>
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
          {toTake.length > 0 && (
            <Button
              appearance="accent"
              icon={<Checkmark20Regular />}
              className="ml-3"
              disabled={reserved.isPending}
              title="Puts the suggested plan for this week on the calendar. Each block can be moved or deleted afterwards."
              onClick={() => void takeWeek()}
            >
              Reserve this week ({toTake.length})
            </Button>
          )}
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
        <MosaicBody
          mosaic={mosaic}
          week={week}
          past={isPastWeek(week, now, zone)}
          envelopes={envelopesOf(mosaic, goals.data ?? [], goalLinks.data ?? [])}
          goals={goals.data ?? []}
          goalLinks={goalLinks.data ?? []}
          items={items.data ?? []}
          reservedIds={reservedIds}
          today={today}
          history={history}
          series={series}
          onOpenItem={setOpenId}
          onPickHour={setPicked}
          onDropTask={dropTask}
          onWeek={setAnchor}
        />
      )}

      <ReserveHour hour={picked} items={items.data ?? []} onClose={() => setPicked(null)} />

      <TaskDetail
        task={(items.data ?? []).find((item) => item.id === openId) ?? null}
        items={items.data ?? []}
        timing={undefined}
        properties={properties.data ?? []}
        values={openId === null ? {} : (values.data?.[openId] ?? {})}
        onClose={() => setOpenId(null)}
        onOpenPage={onOpenPage}
      />
    </Page>
  );
}

function MosaicBody({
  mosaic,
  week,
  past,
  envelopes,
  goals,
  goalLinks,
  items,
  reservedIds,
  today,
  history,
  series,
  onOpenItem,
  onPickHour,
  onDropTask,
  onWeek,
}: {
  items: readonly Item[];
  /** Open a task, from a tile that names one. */
  onOpenItem: (itemId: string) => void;
  /** A free hour was pressed. */
  onPickHour: (hour: HourChoice) => void;
  /** A task from the queue was dropped on a free hour. */
  onDropTask: (itemId: string, hour: HourChoice) => void;
  /** Go to the week that starts on this day. */
  onWeek: (firstDay: string) => void;
  mosaic: Mosaic;
  week: string[];
  past: boolean;
  envelopes: Envelopes;
  goals: readonly Goal[];
  goalLinks: readonly GoalLink[];
  /** Tasks with time reserved on the calendar. */
  reservedIds: ReadonlySet<string>;
  today: string;
  history: readonly HistoryWeek[];
  /** Which colour each goal wears. */
  series: ReadonlyMap<string, number>;
}) {
  const workingDays = useMemo(() => mosaic.days.filter((day) => !day.off), [mosaic]);
  const lastWorkingDay = workingDays.at(-1)?.day ?? week.at(-1) ?? '';
  const broken = [mosaic.capacity, mosaic.reserved, mosaic.needs, mosaic.available].filter(
    (figure) => !traceable(figure),
  );
  const [inspected, setInspected] = useState<Tile | null>(null);

  const goalsOf = useMemo(() => {
    const byItem = new Map<string, Goal[]>();
    for (const link of goalLinks) {
      if (!byItem.has(link.itemId)) {
        byItem.set(link.itemId, goalsOfItem(link.itemId, goals, goalLinks));
      }
    }
    return (itemId: string) => byItem.get(itemId) ?? [];
  }, [goals, goalLinks]);

  const hoveredItem = inspected?.itemId ?? null;

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
          const itemId = tile.itemId;
          const owners = itemId === null ? [] : goalsOf(itemId);
          const slot = owners[0] === undefined ? undefined : series.get(owners[0].id);
          const cell = cellOf(
            tile,
            continued,
            owners.map((goal) => goal.name),
            slot,
          );
          const hour = { day: tile.day, startMinute: tile.startMinute, minutes: tile.minutes };
          return {
            ...cell,
            className: `${cell.className}${
              itemId !== null && itemId === hoveredItem
                ? ' outline-2 outline-offset-1 outline-fg-secondary'
                : ''
            }`,
            onInspect: () => setInspected(tile),
            onDropOn:
              tile.state === 'free'
                ? (event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault();
                    const task = event.dataTransfer.getData(DRAG_TASK);
                    if (task !== '') onDropTask(task, hour);
                  }
                : undefined,
            onActivate:
              itemId !== null
                ? () => onOpenItem(itemId)
                : tile.state === 'free'
                  ? () => onPickHour(hour)
                  : undefined,
          };
        }),
      });
    }
    return out;
  }, [mosaic, workingDays, goalsOf, series, hoveredItem, onOpenItem, onPickHour, onDropTask]);

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

  const kept =
    mosaic.planned.value > 0
      ? Math.round((mosaic.closed.value / mosaic.planned.value) * 100)
      : null;

  return (
    <>
      <StatRow label="The week in figures">
        <Stat
          testId="stat-tiles"
          label="Working hours"
          icon={<Grid16Regular />}
          value={mosaic.tileCount}
          note="One tile each"
        />
        <Stat
          testId="stat-reserved"
          label="On the calendar"
          icon={<Calendar16Regular />}
          value={hoursOf(mosaic.reserved.value)}
          note={mosaic.reserved.value === 0 ? 'Nothing reserved' : 'Already spoken for'}
        />
        <Stat
          testId="stat-needs"
          label="Work due this week"
          icon={<TaskListSquareLtr16Regular />}
          value={hoursOf(mosaic.needs.value)}
          note={`By ${describeDay(lastWorkingDay)}`}
        />
        <Stat
          testId="stat-free"
          label="Hours left"
          icon={<Clock16Regular />}
          value={hoursOf(mosaic.available.value)}
          tone={mosaic.shortTiles > 0 && !past ? 'danger' : 'neutral'}
          note={
            mosaic.shortTiles > 0 && !past
              ? `${mosaic.shortTiles} short of what is due`
              : 'Enough for what is due'
          }
        />
        <Stat
          testId="stat-kept"
          label="Plan kept"
          icon={<Checkmark16Filled />}
          value={kept === null ? '—' : `${kept}%`}
          note={
            kept === null
              ? 'No past hour was set aside'
              : `${mosaic.closed.value} of ${mosaic.planned.value} hours as planned`
          }
        />
      </StatRow>

      <section
        aria-label="Where the week goes"
        className="rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
      >
        <h2 className="mb-2 text-body-lg font-semibold text-fg">Where the week goes</h2>
        <StackBar
          label="Where the week goes"
          parts={[
            {
              id: 'lived',
              label: 'Tracked',
              value: mosaic.counts.lived + mosaic.splits.closed,
              text: `${mosaic.counts.lived + mosaic.splits.closed}h`,
              className: 'bg-accent',
            },
            {
              id: 'reserved',
              label: 'Reserved',
              value: mosaic.counts.reserved,
              text: `${mosaic.counts.reserved}h`,
              className: 'bg-stroke-strong',
            },
            {
              id: 'committed',
              label: 'Committed',
              value: mosaic.counts.committed,
              text: `${mosaic.counts.committed}h`,
              className: '',
              style: { background: 'var(--heat-2)' },
            },
            {
              id: 'free',
              label: 'Free',
              value: mosaic.counts.free,
              text: `${mosaic.counts.free}h`,
              className: 'bg-card-active',
            },
            {
              id: 'gone',
              label: 'Gone',
              value: mosaic.counts.past + mosaic.splits.open,
              text: `${mosaic.counts.past + mosaic.splits.open}h`,
              className: 'bg-stroke',
            },
          ]}
        />
        <div
          aria-label="This week in hours"
          data-testid="mosaic-summary"
          role="group"
          className="mt-3"
        >
          <p className="text-body text-fg-secondary">
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
                {mosaic.needs.value === 0
                  ? `No estimated work is due by ${describeDay(lastWorkingDay)}, and `
                  : `Work due by ${describeDay(lastWorkingDay)} needs ${hoursOf(mosaic.needs.value)}, and `}
                {mosaic.available.value === 0
                  ? 'no working hours are left'
                  : `${hoursOf(mosaic.available.value)} is left`}
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
        </div>
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          aria-label="The week, tile by tile"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-stroke-subtle bg-card p-4 shadow-card"
        >
          <TileGrid
            label="The working week, one tile per hour"
            rowHeight="h-12"
            columns={workingDays.map((day) => ({
              id: day.day,
              header: <DayHeader day={day} today={today} />,
            }))}
            rows={rows}
          />
          {!past && (
            <p className="text-caption text-fg-tertiary">
              Press a tile to open its task, or a free hour to set it aside for one. Tasks can be
              dragged onto a free hour from the list beside the week.
            </p>
          )}
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
            {mosaic.planned.value > 0 && (
              <>
                <li className="flex items-center gap-1.5 text-caption text-fg-secondary">
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-4 w-6 rounded-sm ${LOOK.lived.className}`}
                  />
                  Closed — plan matched ({mosaic.splits.closed})
                </li>
                <li className="flex items-center gap-1.5 text-caption text-fg-secondary">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-4 w-6 flex-col overflow-hidden rounded-sm border border-stroke-strong"
                  >
                    <span className="h-1/2 border-b border-dashed border-stroke" />
                  </span>
                  Split — plan above, life below ({mosaic.splits.open})
                </li>
              </>
            )}
            {goals.slice(0, SERIES).map((goal) => (
              <li
                key={goal.id}
                data-goal-key={goal.id}
                className="flex items-center gap-1.5 text-caption text-fg-secondary"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-6 rounded-sm"
                  style={{ background: `var(--series-${series.get(goal.id) ?? 1})` }}
                />
                {goal.name}
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
        </section>

        <aside aria-label="About the week" className="flex min-w-0 flex-col gap-3">
          <Inspector
            tile={inspected}
            goalsOf={goalsOf}
            onOpenItem={onOpenItem}
            onPickHour={onPickHour}
          />
          {!past && <TaskQueue items={items} reservedIds={reservedIds} onOpen={onOpenItem} />}
          {!past && <FillTheWeek items={items} onOpen={onOpenItem} />}
          <EnvelopesCard envelopes={envelopes} series={series} />
        </aside>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <HistoryCard history={history} today={today} shownWeek={week[0] ?? ''} onWeek={onWeek} />
        <div className="flex min-w-0 flex-col gap-4">
          {mosaic.planned.value > 0 && (
            <Card title="Plan and life">
              <div className="flex flex-col gap-2">
                <p className="text-body text-fg" data-testid="closure-summary">
                  Of {mosaic.planned.value} {mosaic.planned.value === 1 ? 'hour' : 'hours'} set
                  aside for a task, {mosaic.closed.value} closed — life matched the plan (
                  {Math.round((mosaic.closed.value / mosaic.planned.value) * 100)}%).
                </p>
                <FigureRow figure={mosaic.open} broken={[]} noun={{ one: 'hour', many: 'hours' }} />
                <p className="text-caption text-fg-tertiary">
                  A split tile shows the plan above and what was tracked below; when they match, the
                  tile closes into one.
                </p>
              </div>
            </Card>
          )}
          <Card title="The numbers, and what they add up">
            <div className="flex flex-col gap-1">
              <FigureRow figure={mosaic.capacity} broken={broken} format={hoursOf} />
              <FigureRow figure={mosaic.reserved} broken={broken} format={hoursOf} />
              <FigureRow figure={mosaic.needs} broken={broken} format={hoursOf} />
              <FigureRow figure={mosaic.available} broken={broken} format={hoursOf} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** A day at the head of its column: its name, and how much of it is spoken for. */
function DayHeader({ day, today }: { day: MosaicDay; today: string }) {
  const held = day.tiles.filter((tile) => tile.state !== 'free' && tile.state !== 'past').length;
  const words = `${held} of ${day.tiles.length} hours spoken for`;
  return (
    <span className="flex flex-col gap-1 pb-1" title={words}>
      <span className={day.day === today ? 'font-semibold text-accent' : undefined}>
        {describeDay(day.day)}
      </span>
      <Meter
        value={held}
        max={day.tiles.length}
        label={`${describeDay(day.day)}: how full`}
        valueText={words}
        tone="accent"
      />
    </span>
  );
}

/** What the tile under the pointer or the focus is, in words, with what can be done to it. */
function Inspector({
  tile,
  goalsOf,
  onOpenItem,
  onPickHour,
}: {
  tile: Tile | null;
  goalsOf: (itemId: string) => Goal[];
  onOpenItem: (itemId: string) => void;
  onPickHour: (hour: HourChoice) => void;
}) {
  if (tile === null) {
    return (
      <Card title="This hour">
        <p className="text-body text-fg-tertiary" data-testid="inspector-empty">
          Point at a tile to see what is in that hour.
        </p>
      </Card>
    );
  }
  const owners = tile.itemId === null ? [] : goalsOf(tile.itemId);
  const itemId = tile.itemId;
  return (
    <Card title={`${describeDay(tile.day)}, ${clock(tile.startMinute)}`}>
      <div className="flex flex-col gap-2" data-testid="inspector">
        <p className="flex items-center gap-1.5 text-caption font-semibold text-fg-secondary">
          {LOOK[tile.state].glyph}
          {tile.split === null
            ? STATE_LABEL[tile.state]
            : tile.split.closed
              ? 'Closed, as planned'
              : 'Split, not as planned'}
          {tile.current ? ' · now' : ''}
        </p>
        {tile.label !== null && (
          <p className="truncate text-body-lg font-semibold text-fg" title={tile.label}>
            {tile.label}
          </p>
        )}
        {tile.split !== null && !tile.split.closed && (
          <p className="text-caption text-fg-tertiary">
            Planned {tile.split.planLabel};{' '}
            {tile.split.livedLabel === null
              ? 'nothing was tracked'
              : `tracked ${tile.split.livedLabel}`}
            .
          </p>
        )}
        {owners.length > 0 && (
          <p className="text-caption text-fg-secondary">
            Towards {owners.map((goal) => goal.name).join(' and ')}
          </p>
        )}
        {itemId !== null ? (
          <div>
            <Button onClick={() => onOpenItem(itemId)}>Open the task</Button>
          </div>
        ) : tile.state === 'free' ? (
          <div>
            <Button
              onClick={() =>
                onPickHour({
                  day: tile.day,
                  startMinute: tile.startMinute,
                  minutes: tile.minutes,
                })
              }
            >
              Set this hour aside
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** How many tasks the queue lists before it says how many more. */
const QUEUE_SHOWN = 8;

/** The open work with no time reserved, soonest first, ready to drag onto the week. */
function TaskQueue({
  items,
  reservedIds,
  onOpen,
}: {
  items: readonly Item[];
  reservedIds: ReadonlySet<string>;
  onOpen: (itemId: string) => void;
}) {
  const waiting = useMemo(
    () =>
      items
        .filter(
          (item) => item.completedAt === null && !item.isMilestone && !reservedIds.has(item.id),
        )
        .sort((a, b) => {
          if (a.dueAt === b.dueAt) return a.position < b.position ? -1 : 1;
          if (a.dueAt === null) return 1;
          if (b.dueAt === null) return -1;
          return Date.parse(a.dueAt) - Date.parse(b.dueAt);
        }),
    [items, reservedIds],
  );

  return (
    <Card title="To place">
      {waiting.length === 0 ? (
        <p className="text-body text-fg-tertiary">Every open task has time set aside.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1" data-testid="task-queue">
            {waiting.slice(0, QUEUE_SHOWN).map((item) => (
              <li
                key={item.id}
                draggable
                data-queue-task={item.id}
                onDragStart={(event) => event.dataTransfer.setData(DRAG_TASK, item.id)}
                className="flex cursor-grab items-center gap-2 rounded-md border border-stroke-subtle bg-layer-alt px-2 py-1 active:cursor-grabbing"
              >
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="min-w-0 flex-1 truncate text-left text-body text-fg"
                >
                  {item.title}
                </button>
                <span className="shrink-0 text-caption tabular-nums text-fg-tertiary">
                  {item.estimateMinutes === null ? 'no size' : hoursOf(item.estimateMinutes)}
                </span>
              </li>
            ))}
          </ul>
          {waiting.length > QUEUE_SHOWN && (
            <p className="mt-1 text-caption text-fg-tertiary">
              And {waiting.length - QUEUE_SHOWN} more.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

const HEAT: Record<HeatLevel, string> = {
  0: 'var(--surface-card-active)',
  1: 'var(--heat-1)',
  2: 'var(--heat-2)',
  3: 'var(--heat-3)',
  4: 'var(--heat-4)',
};

/** Three months of days, one small tile each. Pressing a week goes to it. */
function HistoryCard({
  history,
  today,
  shownWeek,
  onWeek,
}: {
  history: readonly HistoryWeek[];
  today: string;
  shownWeek: string;
  onWeek: (firstDay: string) => void;
}) {
  const tracked = history.reduce((sum, week) => sum + week.tracked, 0);
  return (
    <Card
      title={`The last ${history.length} weeks`}
      description={
        tracked === 0
          ? 'How much of each working day had a clock running. Nothing has been tracked yet.'
          : `How much of each working day had a clock running: ${hoursOf(tracked)} in all.`
      }
    >
      <div className="flex gap-1 overflow-x-auto" data-testid="mosaic-history">
        {history.map((week) => (
          <button
            key={week.firstDay}
            type="button"
            aria-label={`The week of ${describeDay(week.firstDay)}: ${hoursOf(week.tracked)} tracked`}
            aria-current={week.firstDay === shownWeek ? 'true' : undefined}
            title={`${describeDay(week.firstDay)}: ${hoursOf(week.tracked)} tracked`}
            onClick={() => onWeek(week.firstDay)}
            className={[
              'flex min-w-6 flex-1 flex-col gap-1 rounded-md p-1 hover:bg-card-hover',
              week.firstDay === shownWeek ? 'bg-card-active' : '',
            ].join(' ')}
          >
            {week.days.map((day) => (
              <span
                key={day.day}
                data-heat={day.future || day.hole ? undefined : day.level}
                title={
                  day.future || day.hole
                    ? undefined
                    : `${describeDay(day.day)}: ${hoursOf(day.tracked)}, ${HEAT_WORDS[day.level]}`
                }
                className={[
                  'block h-3 w-full rounded-sm',
                  day.day === today ? 'outline-1 outline-offset-1 outline-fg-secondary' : '',
                ].join(' ')}
                style={day.future || day.hole ? undefined : { background: HEAT[day.level] }}
              />
            ))}
          </button>
        ))}
      </div>
      <ul aria-label="What the shades mean" className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <li key={level} className="flex items-center gap-1 text-caption text-fg-tertiary">
            <span
              aria-hidden="true"
              className="size-3 rounded-sm"
              style={{ background: HEAT[level] }}
            />
            {HEAT_WORDS[level]}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Envelopes (M5): goals that hold a weekly budget of tiles, what this week's
 * tiles spend of each, and the margin promised to no goal. Every tile has a
 * destination; going over is said, never refused (SPEC 1.3).
 */
function EnvelopesCard({
  envelopes,
  series,
}: {
  envelopes: Envelopes;
  series: ReadonlyMap<string, number>;
}) {
  if (envelopes.envelopes.length === 0) {
    return (
      <Card title="Envelopes">
        <p className="text-body text-fg-secondary" data-testid="envelopes-empty">
          No goal holds a weekly budget yet. Give one in Goals — &ldquo;Hours each week&rdquo; — and
          its tiles are counted here.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Envelopes">
      <div className="flex flex-col gap-3">
        {envelopes.overPromised > 0 && (
          <InfoBar severity="caution" title="The envelopes promise more than the week has open">
            Together they hold {hoursOf(envelopes.budgeted)}, {hoursOf(envelopes.overPromised)} more
            than the hours the calendar has left free.
          </InfoBar>
        )}
        <ul className="flex flex-col gap-3">
          {envelopes.envelopes.map((envelope) => {
            const share = Math.min(1, envelope.used.value / envelope.budget);
            return (
              <li
                key={envelope.goalId}
                data-envelope={envelope.goalId}
                className="flex flex-col gap-1"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 self-center rounded-sm"
                    style={{ background: `var(--series-${series.get(envelope.goalId) ?? 1})` }}
                  />
                  <span className="min-w-0 flex-1 truncate text-body font-semibold text-fg">
                    {envelope.name}
                  </span>
                  <span
                    className="shrink-0 text-caption tabular-nums text-fg-secondary"
                    data-testid="envelope-spent"
                  >
                    {hoursOf(envelope.used.value)} of {hoursOf(envelope.budget)}
                    {envelope.over > 0 ? ` — ${hoursOf(envelope.over)} over` : ''}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${envelope.name} envelope`}
                  aria-valuemin={0}
                  aria-valuemax={envelope.budget}
                  aria-valuenow={Math.min(envelope.used.value, envelope.budget)}
                  aria-valuetext={`${hoursOf(envelope.used.value)} of ${hoursOf(envelope.budget)}${
                    envelope.over > 0 ? `, ${hoursOf(envelope.over)} over` : ''
                  }`}
                  className="h-1.5 overflow-hidden rounded-full border border-stroke bg-card-hover"
                >
                  <div
                    className={`h-full ${envelope.over > 0 ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${Math.round(share * 100)}%` }}
                  />
                </div>
                <p className="text-caption text-fg-tertiary">
                  {hoursOf(envelope.committed)} committed, {hoursOf(envelope.lived)} tracked.
                </p>
              </li>
            );
          })}
        </ul>
        <p className="text-body text-fg-secondary" data-testid="envelopes-margin">
          Margin: {hoursOf(envelopes.margin)} of open time is promised to no goal.
        </p>
      </div>
    </Card>
  );
}
