import {
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Delete16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCalendars,
  useCreateTimeBlock,
  useDeleteEvent,
  useEventExceptions,
  useEvents,
  useMoveEvent,
  useWorkHours,
} from '@/data/hooks';
import {
  addLocalDays,
  CALENDAR_SCALES,
  daysOf,
  expand,
  layoutDay,
  minutesInto,
  step,
  todayIn,
  workingSpan,
  type CalendarScale,
  type Occurrence,
} from '@/domain/calendar';
import type { Item } from '@/domain/item';
import { occurrencesBetween, systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';

/** How tall an hour is, in pixels. Everything on the grid derives from this. */
const HOUR_HEIGHT = 48;

/** The grid a drag snaps to. Fifteen minutes is what a person means by "about". */
const SNAP_MINUTES = 15;

/** What a task takes when it is first dropped on the calendar. */
const DEFAULT_BLOCK_MINUTES = 60;

const DRAG_TASK = 'application/x-tessera-task';
const DRAG_EVENT = 'application/x-tessera-event';

/**
 * The calendar.
 *
 * Not a view of a different set of data — a view of the same one. Events are
 * units of time; the tasks in the side panel are units of work; and dragging
 * one onto the grid reserves time for it while it stays the same task. That
 * bridge is the thing none of the four products this competes with does well.
 */
export function CalendarView({
  unscheduled,
  onOpenItem,
}: {
  unscheduled: Item[];
  onOpenItem: (item: Item) => void;
}) {
  const zone = systemZone();
  const now = new Date().toISOString();

  const [scale, setScale] = useState<CalendarScale>('week');
  const [anchor, setAnchor] = useState(() => todayIn(now, zone));

  const days = useMemo(() => daysOf(scale, anchor), [scale, anchor]);
  const from = useMemo(() => new Date(`${days[0]}T00:00:00`).toISOString(), [days]);
  const to = useMemo(
    () => new Date(`${addLocalDays(days.at(-1)!, 1)}T00:00:00`).toISOString(),
    [days],
  );

  const calendars = useCalendars();
  const workHours = useWorkHours();
  const events = useEvents(from, to, calendars.data ?? []);
  const exceptions = useEventExceptions();

  const moveEvent = useMoveEvent();
  const deleteEvent = useDeleteEvent();
  const createBlock = useCreateTimeBlock();

  const occurrences = useMemo(
    () =>
      expand(events.data ?? [], exceptions.data ?? [], from, to, (event, windowFrom, windowTo) =>
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
      ),
    [events.data, exceptions.data, from, to],
  );

  const failure =
    calendars.error ?? events.error ?? exceptions.error ?? moveEvent.error ?? createBlock.error;

  /** Where a drop landed, as an instant. */
  const instantAt = (day: string, minutes: number): string => {
    const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const hours = String(Math.floor(snapped / 60)).padStart(2, '0');
    const rest = String(snapped % 60).padStart(2, '0');
    // Built from the local date and time, then read as an instant — the one
    // conversion, in one place.
    return new Date(`${day}T${hours}:${rest}:00`).toISOString();
  };

  const onDrop = (day: string, minutes: number, transfer: DataTransfer) => {
    const startsAt = instantAt(day, minutes);

    const itemId = transfer.getData(DRAG_TASK);
    if (itemId !== '') {
      createBlock.mutate({
        itemId,
        calendarId: calendars.data?.[0]?.id ?? 'personal',
        startsAt,
        endsAt: new Date(
          new Date(startsAt).getTime() + DEFAULT_BLOCK_MINUTES * 60_000,
        ).toISOString(),
        tz: zone,
      });
      return;
    }

    const dragged = transfer.getData(DRAG_EVENT);
    if (dragged !== '') {
      const [id, duration] = dragged.split('|');
      if (id === undefined) return;
      moveEvent.mutate({
        id,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + Number(duration ?? 0)).toISOString(),
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconButton
              label="Previous"
              icon={<ChevronLeft20Regular />}
              onClick={() => setAnchor(step(scale, anchor, -1))}
            />
            <IconButton
              label="Next"
              icon={<ChevronRight20Regular />}
              onClick={() => setAnchor(step(scale, anchor, 1))}
            />
            <Button appearance="subtle" onClick={() => setAnchor(todayIn(now, zone))}>
              Today
            </Button>
            <h2 className="ml-2 text-body-lg font-semibold text-fg">{titleOf(days, scale)}</h2>
          </div>
        </header>

        <TabStrip
          tabs={CALENDAR_SCALES.map((option) => ({ id: option.id, label: option.label }))}
          active={scale}
          onSelect={(id) => setScale(id as CalendarScale)}
        />

        {failure && (
          <InfoBar severity="danger" title="The calendar could not be read">
            {describeError(failure)}
          </InfoBar>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {scale === 'month' ? (
            <MonthGrid days={days} anchor={anchor} occurrences={occurrences} zone={zone} />
          ) : scale === 'agenda' ? (
            <AgendaList days={days} occurrences={occurrences} zone={zone} />
          ) : (
            <TimeGrid
              days={days}
              occurrences={occurrences}
              zone={zone}
              now={now}
              workHours={workHours.data ?? []}
              onDrop={onDrop}
              onDelete={(id) => deleteEvent.mutate(id)}
            />
          )}
        </div>
      </div>

      <UnscheduledPanel items={unscheduled} onOpen={onOpenItem} />
    </div>
  );
}

// ── The timed grid ─────────────────────────────────────────────────────────

function TimeGrid({
  days,
  occurrences,
  zone,
  now,
  workHours,
  onDrop,
  onDelete,
}: {
  days: string[];
  occurrences: Occurrence[];
  zone: string;
  now: string;
  workHours: Array<{ weekday: number; startsMinute: number; endsMinute: number }>;
  onDrop: (day: string, minutes: number, transfer: DataTransfer) => void;
  onDelete: (id: string) => void;
}) {
  const today = todayIn(now, zone);
  const nowMinutes = minutesInto(now, today, zone);

  const allDay = occurrences.filter((occurrence) => occurrence.event.allDay);

  return (
    <div className="min-w-max">
      <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((day) => (
          <div
            key={day}
            className={[
              'border-b border-stroke-subtle px-2 py-1 text-center text-caption',
              day === today ? 'font-semibold text-accent' : 'text-fg-secondary',
            ].join(' ')}
          >
            {labelOf(day)}
          </div>
        ))}
      </div>

      {allDay.length > 0 && (
        <div
          className="grid border-b border-stroke-subtle"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}
        >
          <div className="px-1 py-1 text-right text-caption text-fg-tertiary">All day</div>
          {days.map((day) => (
            <div key={day} className="min-h-7 space-y-0.5 border-l border-stroke-subtle p-0.5">
              {allDay
                .filter((occurrence) => occurrence.startsAt.slice(0, 10) <= day)
                .map((occurrence) => (
                  <div
                    key={occurrence.event.id}
                    className="truncate rounded-sm bg-accent-subtle px-1 text-caption text-accent"
                  >
                    {occurrence.event.title}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      <div
        className="relative grid"
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}
      >
        <div>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              style={{ height: HOUR_HEIGHT }}
              className="relative -top-2 pr-1 text-right text-caption text-fg-tertiary"
            >
              {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const boxes = layoutDay(occurrences, day, zone);
          const working = workingSpan(day, workHours);

          return (
            <div
              key={day}
              className="relative border-l border-stroke-subtle"
              style={{ height: 24 * HOUR_HEIGHT }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                const minutes = ((event.clientY - bounds.top) / HOUR_HEIGHT) * 60;
                onDrop(day, minutes, event.dataTransfer);
              }}
            >
              {/* Outside working hours is recessed rather than hidden: the time
                  is still there, it is just not the working day. */}
              {working !== null && (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 bg-card/40"
                  style={{
                    top: (working.startsMinute / 60) * HOUR_HEIGHT,
                    height: ((working.endsMinute - working.startsMinute) / 60) * HOUR_HEIGHT,
                  }}
                />
              )}

              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  aria-hidden="true"
                  className="border-b border-stroke-subtle/60"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}

              {day === today && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger"
                  style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                >
                  <span className="absolute -top-1 -left-1 size-2 rounded-full bg-danger" />
                </div>
              )}

              {boxes.map((box) => (
                <article
                  key={`${box.occurrence.event.id}-${box.occurrence.originalStart}`}
                  draggable
                  onDragStart={(event) => {
                    const duration =
                      new Date(box.occurrence.endsAt).getTime() -
                      new Date(box.occurrence.startsAt).getTime();
                    event.dataTransfer.setData(
                      DRAG_EVENT,
                      `${box.occurrence.event.id}|${duration}`,
                    );
                  }}
                  className={[
                    'group absolute overflow-hidden rounded-sm border px-1 py-0.5 text-caption',
                    box.occurrence.event.itemId !== null
                      ? 'border-accent/40 bg-accent-subtle text-accent'
                      : 'border-stroke bg-card text-fg',
                  ].join(' ')}
                  style={{
                    top: (box.topMinutes / 60) * HOUR_HEIGHT,
                    height: (box.heightMinutes / 60) * HOUR_HEIGHT - 2,
                    left: `calc(${box.left * 100}% + 2px)`,
                    width: `calc(${box.width * 100}% - 4px)`,
                  }}
                  title={box.occurrence.event.title}
                >
                  <span className="block truncate font-semibold">
                    {box.occurrence.event.title || 'Untitled'}
                  </span>
                  <span className="block truncate opacity-70">
                    {timeOf(box.occurrence.startsAt, zone)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete ${box.occurrence.event.title}`}
                    onClick={() => onDelete(box.occurrence.event.id)}
                    className="absolute top-0.5 right-0.5 hidden rounded-sm p-0.5 hover:bg-card-hover group-hover:block focus-visible:block"
                  >
                    <Delete16Regular />
                  </button>
                </article>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Month and agenda ───────────────────────────────────────────────────────

function MonthGrid({
  days,
  anchor,
  occurrences,
  zone,
}: {
  days: string[];
  anchor: string;
  occurrences: Occurrence[];
  zone: string;
}) {
  const month = anchor.slice(0, 7);

  return (
    <div className="grid grid-cols-7 gap-px bg-stroke-subtle">
      {days.map((day) => {
        const onThisDay = occurrences.filter(
          (occurrence) => dayOf(occurrence.startsAt, zone) === day,
        );
        const inMonth = day.slice(0, 7) === month;

        return (
          <div
            key={day}
            className={['min-h-24 p-1', inMonth ? 'bg-layer' : 'bg-layer-alt opacity-60'].join(' ')}
          >
            <p className="mb-1 text-caption font-semibold text-fg-secondary">
              {Number(day.slice(-2))}
            </p>
            <div className="space-y-0.5">
              {onThisDay.slice(0, 3).map((occurrence) => (
                <p
                  key={`${occurrence.event.id}-${occurrence.originalStart}`}
                  className="truncate rounded-sm bg-accent-subtle px-1 text-caption text-accent"
                  title={occurrence.event.title}
                >
                  {occurrence.event.title || 'Untitled'}
                </p>
              ))}
              {onThisDay.length > 3 && (
                <p className="px-1 text-caption text-fg-tertiary">+{onThisDay.length - 3} more</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaList({
  days,
  occurrences,
  zone,
}: {
  days: string[];
  occurrences: Occurrence[];
  zone: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const onThisDay = occurrences.filter(
          (occurrence) => dayOf(occurrence.startsAt, zone) === day,
        );
        if (onThisDay.length === 0) return null;

        return (
          <section key={day}>
            <h3 className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">
              {labelOf(day)}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {onThisDay.map((occurrence) => (
                <li
                  key={`${occurrence.event.id}-${occurrence.originalStart}`}
                  className="flex items-baseline gap-3 rounded-md px-2 py-1 hover:bg-card-hover"
                >
                  <span className="w-24 shrink-0 text-caption text-fg-tertiary">
                    {occurrence.event.allDay ? 'All day' : timeOf(occurrence.startsAt, zone)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-fg">
                    {occurrence.event.title || 'Untitled'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ── The side panel ─────────────────────────────────────────────────────────

/**
 * Tasks with no time reserved for them.
 *
 * The panel is the other half of the product's differentiator: work goes in on
 * the left, and dragging it onto the grid turns it into time without turning it
 * into a different thing.
 */
function UnscheduledPanel({ items, onOpen }: { items: Item[]; onOpen: (item: Item) => void }) {
  return (
    <aside className="hidden w-56 shrink-0 flex-col rounded-lg border border-stroke-subtle bg-layer-alt p-2 lg:flex">
      <h3 className="mb-2 px-1 text-caption font-semibold text-fg-tertiary uppercase">
        Not scheduled
      </h3>

      {items.length === 0 ? (
        <p className="px-1 text-caption text-fg-tertiary">
          Everything open has time reserved for it.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <div
                draggable
                onDragStart={(event) => event.dataTransfer.setData(DRAG_TASK, item.id)}
                className="cursor-grab rounded-md border border-stroke-subtle bg-card p-1.5 text-caption text-fg active:cursor-grabbing"
              >
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="block w-full truncate text-left"
                >
                  {item.title}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 px-1 text-caption text-fg-tertiary">
        Drag one onto the grid to reserve time for it. It stays the same task.
      </p>
    </aside>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────

function dayOf(instant: string, zone: string): string {
  const local = new Date(new Date(instant).toLocaleString('en-US', { timeZone: zone }));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

function timeOf(instant: string, zone: string): string {
  return new Date(instant).toLocaleTimeString(undefined, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function labelOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function titleOf(days: string[], scale: CalendarScale): string {
  const first = days[0]!;
  const [year, month, date] = first.split('-').map(Number);
  const start = new Date(year!, month! - 1, date!);

  if (scale === 'day') return start.toLocaleDateString(undefined, { dateStyle: 'full' });
  if (scale === 'month')
    return new Date(year!, month! - 1, 15).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });

  const last = days.at(-1)!;
  const [lastYear, lastMonth, lastDate] = last.split('-').map(Number);
  const end = new Date(lastYear!, lastMonth! - 1, lastDate!);

  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
