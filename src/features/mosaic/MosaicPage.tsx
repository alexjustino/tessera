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
  useGoalLinks,
  useGoals,
  useEventExceptions,
  useEvents,
  useItems,
  useTimeEntries,
  useWorkHours,
  useProperties,
  usePropertyValues,
} from '@/data/hooks';
import { addLocalDays, todayIn } from '@/domain/calendar';
import {
  envelopesOf,
  isPastWeek,
  mosaicOf,
  TILE_STATES,
  type Envelopes,
  type Mosaic,
  type Split,
  type Tile,
  type TileState,
} from '@/domain/mosaic';
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
import { Card } from '@/ui/Card';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Page } from '@/ui/Page';
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

const COLLECTION = 'tasks';

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

function cellOf(tile: Tile, continued: boolean, goals: readonly string[]): TileCell {
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
    content: (
      <span className="flex items-center gap-1" data-state={tile.state}>
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

export function MosaicPage() {
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
  const goalsOf = useMemo(() => {
    const byItem = new Map<string, string[]>();
    for (const link of goalLinks.data ?? []) {
      const goal = (goals.data ?? []).find((candidate) => candidate.id === link.goalId);
      if (goal === undefined || (goal.weeklyMinutes ?? 0) <= 0) continue;
      byItem.set(link.itemId, [...(byItem.get(link.itemId) ?? []), goal.name]);
    }
    return (itemId: string) => byItem.get(itemId) ?? [];
  }, [goals.data, goalLinks.data]);

  const failure = hours.error ?? events.error ?? entries.error ?? items.error;

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
          goalsOf={goalsOf}
          items={items.data ?? []}
          onOpenItem={setOpenId}
          onPickHour={setPicked}
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
      />
    </Page>
  );
}

function MosaicBody({
  mosaic,
  week,
  past,
  envelopes,
  goalsOf,
  items,
  onOpenItem,
  onPickHour,
}: {
  items: readonly Item[];
  /** Open a task, from a tile that names one. */
  onOpenItem: (itemId: string) => void;
  /** A free hour was pressed. */
  onPickHour: (hour: HourChoice) => void;
  mosaic: Mosaic;
  week: string[];
  past: boolean;
  envelopes: Envelopes;
  /** The envelope goals a task spends from. */
  goalsOf: (itemId: string) => string[];
}) {
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
          const itemId = tile.itemId;
          return {
            ...cellOf(tile, continued, itemId === null ? [] : goalsOf(itemId)),
            onActivate:
              itemId !== null
                ? () => onOpenItem(itemId)
                : tile.state === 'free'
                  ? () =>
                      onPickHour({
                        day: tile.day,
                        startMinute: tile.startMinute,
                        minutes: tile.minutes,
                      })
                  : undefined,
          };
        }),
      });
    }
    return out;
  }, [mosaic, workingDays, goalsOf, onOpenItem, onPickHour]);

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
      </section>

      {!past && <FillTheWeek items={items} onOpen={onOpenItem} />}

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
          {!past && (
            <p className="text-caption text-fg-tertiary">
              Press a tile to open its task, or a free hour to set it aside for one.
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

      {mosaic.planned.value > 0 && (
        <Card title="Plan and life">
          <div className="flex flex-col gap-2">
            <p className="text-body text-fg" data-testid="closure-summary">
              Of {mosaic.planned.value} {mosaic.planned.value === 1 ? 'hour' : 'hours'} set aside
              for a task, {mosaic.closed.value} closed — life matched the plan (
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

      <EnvelopesCard envelopes={envelopes} />

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

/**
 * Envelopes (M5): goals that hold a weekly budget of tiles, what this week's
 * tiles spend of each, and the margin promised to no goal. Every tile has a
 * destination; going over is said, never refused (SPEC 1.3).
 */
function EnvelopesCard({ envelopes }: { envelopes: Envelopes }) {
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
                <div className="flex items-baseline gap-3">
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
