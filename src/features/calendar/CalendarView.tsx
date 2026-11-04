import {
  CalendarAdd20Regular,
  Checkmark16Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  Delete16Regular,
  Dismiss16Regular,
  Lightbulb20Regular,
  ReOrderDotsVertical16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { describeError } from '@/data/errors';
import {
  useCalendars,
  useCreateEvent,
  useCreateTimeBlock,
  useDaysOffSet,
  useDeleteEvent,
  useEventExceptions,
  useEvents,
  useMoveEvent,
  useRenameEvent,
  useProperties,
  usePropertyValues,
  useTimeBlockedItems,
  useWorkHours,
} from '@/data/hooks';
import {
  blockLength,
  nextFree,
  suggestPlan,
  type SuggestedPlan,
  type Suggestion,
} from '@/domain/autoPlan';
import {
  addLocalDays,
  CALENDAR_SCALES,
  daysOf,
  layoutDay,
  minutesInto,
  step,
  todayIn,
  fittedHourHeight,
  workingSpan,
  workingWindow,
  type CalendarScale,
  type Occurrence,
} from '@/domain/calendar';
import { capacityOf, plannedByDay } from '@/domain/capacity';
import type { Item } from '@/domain/item';
import {
  describePlacement,
  firstSlot,
  isMoveKey,
  moveByKey,
  placeOf,
  type MoveBounds,
} from '@/domain/moveByKeys';
import { optionsOf } from '@/domain/property';
import { systemZone } from '@/domain/schedule';
import { useLedger } from '@/features/receipt/useLedger';
import { describeHours } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Meter } from '@/ui/Meter';
import { Modal } from '@/ui/Modal';
import { TabStrip } from '@/ui/TabStrip';
import { useNow } from '@/ui/useNow';
import { usePointerDrag, type DragPoint } from '@/ui/usePointerDrag';

import { BlockEditor, type BlockFields } from './BlockEditor';

import { expandEvents } from './occurrences';
import { YearView } from './YearView';
import { announce } from '@/ui/announce';

/** The grid a drag snaps to. Fifteen minutes is what a person means by "about". */
const SNAP_MINUTES = 15;

/** What is being carried by the pointer. */
type Grabbed =
  | { kind: 'event'; occurrence: Occurrence }
  | { kind: 'suggestion'; suggestion: Suggestion }
  | { kind: 'task'; item: Item };

/** Where it would land if let go now. `day` is null while it is off the grid. */
interface Landing {
  grabbed: Grabbed;
  title: string;
  day: string | null;
  minute: number;
  minutes: number;
  x: number;
  y: number;
}

/** What is open in the block editor. */
type Editing =
  { kind: 'event'; occurrence: Occurrence } | { kind: 'suggestion'; suggestion: Suggestion };

/** Whether the suggested plan shows, remembered per machine. */
const SHOW_PLAN = 'tessera.calendar-plan';

/** A place on the grid the person asked to put a new event in. */
interface NewEvent {
  day: string;
  minute: number;
}

function readShowPlan(): boolean {
  try {
    return localStorage.getItem(SHOW_PLAN) !== 'hidden';
  } catch {
    return true;
  }
}

/** What is being moved by keyboard, and where it is right now. */
interface Carrying {
  kind: 'event' | 'task';
  id: string;
  title: string;
  startsAt: string;
  durationMs: number;
}

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
  const now = useNow(60_000);

  const [scale, setScale] = useState<CalendarScale>('week');
  const [anchor, setAnchor] = useState(() => todayIn(now, zone));
  // State and not a ref: a child's layout effect runs before its parent's ref is
  // attached, so the grid fitted itself only when the working hours happened to
  // arrive later. Coming back to the calendar, it opened unfitted, at midnight.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  // Work with a date, on the day it is due: what a person looks at a week to see.
  const dueByDay = useMemo(() => {
    const byDay = new Map<string, Item[]>();
    for (const item of unscheduled) {
      if (item.dueAt === null) continue;
      const day = dayOf(item.dueAt, zone);
      byDay.set(day, [...(byDay.get(day) ?? []), item]);
    }
    return byDay;
  }, [unscheduled, zone]);

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
  const createEvent = useCreateEvent();
  const renameEvent = useRenameEvent();
  const daysOff = useDaysOffSet();
  const startDrag = usePointerDrag();
  const [landing, setLanding] = useState<Landing | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** What the last reservation did, said where a person is looking. */
  const [notice, setNotice] = useState<string | null>(null);

  // ── The suggested plan ────────────────────────────────────────────────────
  // Computed, never stored (ADR-046): nothing here is on the calendar until the
  // person takes it or moves it.
  const ledger = useLedger(now);
  const properties = useProperties('tasks');
  const values = usePropertyValues('tasks');
  const [showPlan, setShowPlan] = useState(readShowPlan);
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const [placing, setPlacing] = useState<NewEvent | null>(null);

  const plan: SuggestedPlan | null = useMemo(() => {
    if (ledger === null || !showPlan) return null;
    const priority = (properties.data ?? []).find((property) => property.type === 'priority');
    const order = priority === undefined ? [] : optionsOf(priority).map((option) => option.id);
    return suggestPlan(ledger, {
      leaveOut: leftOut,
      rankOf: (itemId) => {
        const raw = priority === undefined ? undefined : values.data?.[itemId]?.[priority.id];
        const rank = order.indexOf(raw as string);
        return rank === -1 ? order.length : rank;
      },
    });
  }, [ledger, showPlan, leftOut, properties.data, values.data]);

  const onScreen = useMemo(() => {
    const shown = new Set(days);
    return (plan?.suggestions ?? []).filter((suggestion) => shown.has(suggestion.day));
  }, [plan, days]);

  const take = (suggestion: Suggestion, startsAt = suggestion.startsAt) =>
    createBlock.mutateAsync({
      itemId: suggestion.itemId,
      calendarId: calendars.data?.[0]?.id ?? 'personal',
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + suggestion.minutes * 60_000).toISOString(),
      tz: zone,
    });

  const takeAll = async () => {
    // One at a time, in order: the host orders writes anyway, and each is its
    // own reservation a person can move or delete afterwards.
    for (const suggestion of onScreen) await take(suggestion);
    announce(`Reserved ${onScreen.length} ${onScreen.length === 1 ? 'block' : 'blocks'} of time`);
  };

  const togglePlan = () => {
    const next = !showPlan;
    setShowPlan(next);
    try {
      localStorage.setItem(SHOW_PLAN, next ? 'shown' : 'hidden');
    } catch {
      // A profile that refuses storage just forgets the choice.
    }
  };

  const pickUpSuggestion = (suggestion: Suggestion) => {
    setCarrying({
      kind: 'task',
      id: suggestion.itemId,
      title: suggestion.title,
      startsAt: suggestion.startsAt,
      durationMs: suggestion.minutes * 60_000,
    });
    announce(
      `Moving the suggestion for ${suggestion.title}. Use the arrow keys, Enter to place, Escape to cancel.`,
    );
  };

  // "Not scheduled" means no time reserved anywhere — a task blocked next
  // month is scheduled, whatever days are on screen.
  const blocked = useTimeBlockedItems();
  const waiting = useMemo(() => {
    const ids = new Set(blocked.data ?? []);
    return unscheduled.filter((item) => !ids.has(item.id));
  }, [unscheduled, blocked.data]);

  const occurrences = useMemo(
    () => expandEvents(events.data ?? [], exceptions.data ?? [], from, to),
    [events.data, exceptions.data, from, to],
  );

  const failure =
    calendars.error ?? events.error ?? exceptions.error ?? moveEvent.error ?? createBlock.error;

  // ── Moving by keyboard ────────────────────────────────────────────────────
  // The pointer drags the block itself; this is the other route. Something
  // is picked up (an event on the grid, or a task from the panel), nudged with
  // the arrows, and placed with Enter — every step spoken to the live region.
  const [carrying, setCarrying] = useState<Carrying | null>(null);

  const bounds: MoveBounds = useMemo(() => {
    const span = workingSpan(days[0] ?? anchor, workHours.data ?? []);
    return {
      days,
      zone,
      workStartsMinute: span?.startsMinute ?? 9 * 60,
      workEndsMinute: span?.endsMinute ?? 18 * 60,
    };
  }, [days, anchor, zone, workHours.data]);

  const pickUpEvent = (occurrence: Occurrence) => {
    const durationMs =
      new Date(occurrence.endsAt).getTime() - new Date(occurrence.startsAt).getTime();
    setCarrying({
      kind: 'event',
      id: occurrence.event.id,
      title: occurrence.event.title || 'Untitled',
      startsAt: occurrence.startsAt,
      durationMs,
    });
    announce(
      `Moving ${occurrence.event.title || 'Untitled'}. Use the arrow keys, Enter to place, Escape to cancel.`,
    );
  };

  /** How long a task wants, and the first free time that holds it. */
  const placeFor = (item: Item) => {
    const minutes = blockLength(item, ledger?.tracked.get(item.id) ?? 0);
    return { minutes, free: ledger === null ? null : nextFree(ledger, minutes) };
  };

  // By keyboard: picked up at the first free time, to be nudged from there.
  const pickUpTask = (item: Item) => {
    const { minutes, free } = placeFor(item);
    setCarrying({
      kind: 'task',
      id: item.id,
      title: item.title,
      startsAt: free?.startsAt ?? firstSlot(bounds, todayIn(now, zone)),
      durationMs: (free?.minutes ?? minutes) * 60_000,
    });
    announce(
      `Reserving time for ${item.title}. Use the arrow keys, Enter to place, Escape to cancel.`,
    );
  };

  // By pointer: it simply goes in the first free time. Pressing it again would put
  // the next one after it, never on top. Dragging is how it goes anywhere else.
  const reserveNext = (item: Item) => {
    const { free } = placeFor(item);
    if (free === null) {
      setNotice(`There is no free time for ${item.title} in the next three weeks.`);
      return;
    }
    createBlock.mutate(
      {
        itemId: item.id,
        calendarId: calendars.data?.[0]?.id ?? 'personal',
        startsAt: free.startsAt,
        endsAt: free.endsAt,
        tz: zone,
      },
      {
        onSuccess: () => {
          if (!days.includes(free.day)) setAnchor(free.day);
          const said = `Reserved ${item.title}: ${labelOf(free.day)}, ${timeOf(free.startsAt, zone)}, ${describeHours(free.minutes)}.`;
          setNotice(said);
          announce(said);
        },
      },
    );
  };

  // ── Moving by pointer ─────────────────────────────────────────────────────
  /** The day column under a point, and how many minutes down it. */
  const columnAt = ({ x, y }: DragPoint): { day: string; minute: number } | null => {
    const column = document
      .elementsFromPoint(x, y)
      .find((element) => element instanceof HTMLElement && element.dataset.dayColumn !== undefined);
    if (!(column instanceof HTMLElement)) return null;
    const box = column.getBoundingClientRect();
    return {
      day: column.dataset.dayColumn ?? '',
      minute: ((y - box.top) / box.height) * 24 * 60,
    };
  };

  /** Bring more of the day into view when the pointer is against the edge of the grid. */
  const scrollNearEdge = ({ y }: DragPoint) => {
    if (scroller === null) return;
    const box = scroller.getBoundingClientRect();
    if (y < box.top + 96) scroller.scrollBy({ top: -12 });
    else if (y > box.bottom - 32) scroller.scrollBy({ top: 12 });
  };

  const snapped = (minute: number, minutes: number) =>
    Math.max(0, Math.min(24 * 60 - minutes, Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES));

  const reserve = (itemId: string, day: string, minute: number, minutes: number) => {
    const startsAt = instantAt(day, minute);
    createBlock.mutate({
      itemId,
      calendarId: calendars.data?.[0]?.id ?? 'personal',
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
      tz: zone,
    });
  };

  const land = (grabbed: Grabbed, day: string, minute: number, minutes: number) => {
    if (grabbed.kind === 'event') {
      const startsAt = instantAt(day, minute);
      moveEvent.mutate({
        id: grabbed.occurrence.event.id,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
      });
    } else {
      reserve(
        grabbed.kind === 'task' ? grabbed.item.id : grabbed.suggestion.itemId,
        day,
        minute,
        minutes,
      );
    }
  };

  /** Pick something up to move it. The pointer keeps its place on the block. */
  const grab = (
    event: ReactPointerEvent<HTMLElement>,
    grabbed: Grabbed,
    title: string,
    minutes: number,
  ) => {
    const column = event.currentTarget.closest<HTMLElement>('[data-day-column]');
    const held =
      column === null
        ? 0
        : ((event.clientY - event.currentTarget.getBoundingClientRect().top) /
            column.getBoundingClientRect().height) *
          24 *
          60;
    const at = (point: DragPoint): Landing => {
      const place = columnAt(point);
      return {
        grabbed,
        title,
        minutes,
        x: point.x,
        y: point.y,
        day: place?.day ?? null,
        minute: place === null ? 0 : snapped(place.minute - held, minutes),
      };
    };
    startDrag(event, {
      onMove: (point) => {
        setLanding(at(point));
        scrollNearEdge(point);
      },
      onDrop: (point) => {
        const final = at(point);
        setLanding(null);
        if (final.day !== null) land(grabbed, final.day, final.minute, minutes);
      },
      onCancel: () => setLanding(null),
    });
  };

  /** Take a block by its bottom edge: it stays where it starts and changes length. */
  const grabEnd = (
    event: ReactPointerEvent<HTMLElement>,
    grabbed: Grabbed,
    title: string,
    day: string,
    startMinute: number,
    starting: number,
  ) => {
    event.stopPropagation();
    const at = (point: DragPoint): Landing => {
      const column = document.querySelector<HTMLElement>(`[data-day-column="${day}"]`);
      const box = column?.getBoundingClientRect();
      const reached =
        box === undefined ? startMinute + starting : ((point.y - box.top) / box.height) * 24 * 60;
      const minutes = Math.max(
        SNAP_MINUTES,
        Math.min(
          24 * 60 - startMinute,
          Math.round((reached - startMinute) / SNAP_MINUTES) * SNAP_MINUTES,
        ),
      );
      return { grabbed, title, day, minute: startMinute, minutes, x: point.x, y: point.y };
    };
    startDrag(event, {
      onMove: (point) => {
        setLanding(at(point));
        scrollNearEdge(point);
      },
      onDrop: (point) => {
        const final = at(point);
        setLanding(null);
        if (final.minutes !== starting) land(grabbed, day, startMinute, final.minutes);
      },
      onCancel: () => setLanding(null),
    });
  };

  /** Save what the block editor holds. For a suggestion, this is what reserves it. */
  const saveBlock = (target: Editing, fields: BlockFields) => {
    if (target.kind === 'suggestion') {
      reserve(target.suggestion.itemId, fields.day, fields.minute, fields.minutes);
    } else {
      land(target, fields.day, fields.minute, fields.minutes);
      if (
        target.occurrence.event.itemId === null &&
        fields.title !== target.occurrence.event.title
      ) {
        renameEvent.mutate({ id: target.occurrence.event.id, title: fields.title });
      }
    }
    setEditing(null);
  };

  useEffect(() => {
    if (carrying === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const change = (event.key === 'ArrowDown' ? 1 : -1) * SNAP_MINUTES * 60_000;
        const next = {
          ...carrying,
          durationMs: Math.max(SNAP_MINUTES * 60_000, carrying.durationMs + change),
        };
        setCarrying(next);
        announce(describeHours(next.durationMs / 60_000));
      } else if (isMoveKey(event.key)) {
        event.preventDefault();
        const startsAt = moveByKey(carrying, event.key, bounds);
        const next = { ...carrying, startsAt };
        setCarrying(next);
        announce(describePlacement(next, zone));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const endsAt = new Date(
          new Date(carrying.startsAt).getTime() + carrying.durationMs,
        ).toISOString();
        if (carrying.kind === 'event') {
          moveEvent.mutate({ id: carrying.id, startsAt: carrying.startsAt, endsAt });
        } else {
          createBlock.mutate({
            itemId: carrying.id,
            calendarId: calendars.data?.[0]?.id ?? 'personal',
            startsAt: carrying.startsAt,
            endsAt,
            tz: zone,
          });
        }
        announce(`Placed ${carrying.title}, ${describePlacement(carrying, zone)}`);
        setCarrying(null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        announce('Cancelled');
        setCarrying(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [carrying, bounds, zone, moveEvent, createBlock, calendars.data]);

  /** Where a drop landed, as an instant. */
  const instantAt = (day: string, minutes: number): string => {
    const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
    const hours = String(Math.floor(snapped / 60)).padStart(2, '0');
    const rest = String(snapped % 60).padStart(2, '0');
    // Built from the local date and time, then read as an instant — the one
    // conversion, in one place.
    return new Date(`${day}T${hours}:${rest}:00`).toISOString();
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
          <div className="flex flex-wrap items-center gap-2">
            {showPlan && onScreen.length > 0 && (
              <Button
                appearance="accent"
                icon={<Checkmark16Regular />}
                disabled={createBlock.isPending}
                onClick={() => void takeAll()}
              >
                Accept {onScreen.length} suggested {onScreen.length === 1 ? 'block' : 'blocks'}
              </Button>
            )}
            <Button
              appearance="subtle"
              aria-pressed={showPlan}
              icon={<Lightbulb20Regular />}
              onClick={togglePlan}
            >
              {showPlan ? 'Hide suggestions' : 'Suggest a plan'}
            </Button>
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

        {(scale === 'week' || scale === 'workWeek' || scale === 'day') && (
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-secondary"
            data-testid="calendar-legend"
          >
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-5 rounded-sm border border-accent/40 bg-accent-subtle"
              />
              Reserved
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-5 rounded-sm border border-dashed border-accent"
              />
              Suggested
            </span>
            <span className="text-fg-tertiary">
              Drag to move, drag the bottom edge to change the length, press to edit. Double-click
              an empty hour for a new event.
            </span>
          </div>
        )}
        {notice !== null && (
          <p role="status" data-testid="calendar-notice" className="text-caption text-fg-secondary">
            {notice}
          </p>
        )}

        <div
          ref={setScroller}
          className="min-h-0 flex-1 overflow-auto"
          // A scrollable region a keyboard cannot reach cannot be scrolled by one.
          tabIndex={0}
          role="region"
          aria-label="Calendar grid"
        >
          {scale === 'month' ? (
            <MonthGrid
              days={days}
              anchor={anchor}
              occurrences={occurrences}
              zone={zone}
              dueByDay={dueByDay}
              suggestions={onScreen}
              onOpenItem={onOpenItem}
            />
          ) : scale === 'year' ? (
            <YearView
              year={Number(anchor.slice(0, 4))}
              occurrences={occurrences}
              workHours={workHours.data ?? []}
              zone={zone}
              today={todayIn(now, zone)}
              onOpenDay={(day) => {
                setAnchor(day);
                setScale('day');
              }}
            />
          ) : scale === 'agenda' ? (
            <AgendaList days={days} occurrences={occurrences} zone={zone} suggestions={onScreen} />
          ) : (
            <TimeGrid
              landing={landing}
              onGrab={grab}
              onGrabEnd={grabEnd}
              onEdit={setEditing}
              days={days}
              occurrences={occurrences}
              zone={zone}
              now={now}
              workHours={workHours.data ?? []}
              daysOff={daysOff}
              onDelete={(id) => deleteEvent.mutate(id)}
              onNewEvent={setPlacing}
              carrying={carrying}
              onPickUp={pickUpEvent}
              scroller={scroller}
              dueByDay={dueByDay}
              onOpenItem={onOpenItem}
              suggestions={onScreen}
              onTake={(suggestion) => void take(suggestion)}
              onMoveSuggestion={pickUpSuggestion}
              onLeaveOut={(itemId) => setLeftOut((held) => new Set([...held, itemId]))}
            />
          )}
        </div>
      </div>

      <aside className="hidden w-64 shrink-0 flex-col gap-3 overflow-y-auto lg:flex">
        <MiniMonth
          anchor={anchor}
          today={todayIn(now, zone)}
          onPick={(day) => {
            setAnchor(day);
            if (scale === 'year') setScale('week');
          }}
        />
        {plan !== null && <PlanSummary plan={plan} />}
        <UnscheduledPanel
          items={waiting}
          leftOut={leftOut}
          onBringBack={(itemId) =>
            setLeftOut((held) => new Set([...held].filter((id) => id !== itemId)))
          }
          suggestions={plan?.suggestions ?? []}
          onShowDay={setAnchor}
          onOpen={onOpenItem}
          onPickUp={pickUpTask}
          onReserve={reserveNext}
          onGrab={(event, item) =>
            grab(event, { kind: 'task', item }, item.title, placeFor(item).minutes)
          }
        />
      </aside>

      {/* Off the grid, the thing being carried stays with the pointer. */}
      {landing !== null && landing.day === null && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 max-w-56 truncate rounded-md border border-accent bg-card px-2 py-1 text-caption font-semibold text-fg shadow-flyout"
          style={{ left: landing.x + 8, top: landing.y + 8 }}
        >
          {landing.title}
        </div>
      )}

      {editing !== null && (
        <BlockEditor
          key={
            editing.kind === 'event'
              ? `${editing.occurrence.event.id}-${editing.occurrence.originalStart}`
              : editing.suggestion.key
          }
          initial={fieldsOf(editing, zone)}
          suggested={editing.kind === 'suggestion'}
          titleEditable={editing.kind === 'event' && editing.occurrence.event.itemId === null}
          pending={createBlock.isPending || moveEvent.isPending}
          onClose={() => setEditing(null)}
          onSave={(fields) => saveBlock(editing, fields)}
          onDelete={() => {
            if (editing.kind === 'event') deleteEvent.mutate(editing.occurrence.event.id);
            else {
              const { itemId } = editing.suggestion;
              setLeftOut((held) => new Set([...held, itemId]));
            }
            setEditing(null);
          }}
          onOpenTask={(() => {
            const itemId =
              editing.kind === 'event'
                ? editing.occurrence.event.itemId
                : editing.suggestion.itemId;
            const item = unscheduled.find((candidate) => candidate.id === itemId);
            return item === undefined
              ? undefined
              : () => {
                  setEditing(null);
                  onOpenItem(item);
                };
          })()}
        />
      )}

      <NewEventDialog
        place={placing}
        pending={createEvent.isPending}
        onClose={() => setPlacing(null)}
        onCreate={(title, minutes) => {
          if (placing === null) return;
          const startsAt = instantAt(placing.day, placing.minute);
          createEvent.mutate(
            {
              calendarId: calendars.data?.[0]?.id ?? 'personal',
              title,
              startsAt,
              endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
              tz: zone,
              allDay: false,
            },
            {
              onSuccess: () => {
                setPlacing(null);
                announce(`Added ${title}`);
              },
            },
          );
        }}
      />

      {/* What the keys do, for anyone who reaches a block or a task. */}
      <p id="calendar-keyboard-help" className="sr-only">
        Enter picks up. The arrow keys move by fifteen minutes or a day, Page Up and Page Down by an
        hour, Home and End to the start and end of the working day. Shift with the up and down keys
        makes it shorter or longer. Enter places, Escape cancels.
      </p>
    </div>
  );
}

// ── The timed grid ─────────────────────────────────────────────────────────

function TimeGrid({
  landing,
  onGrab,
  onGrabEnd,
  onEdit,
  days,
  occurrences,
  zone,
  now,
  workHours,
  daysOff,
  onDelete,
  onNewEvent,
  carrying,
  onPickUp,
  scroller,
  dueByDay,
  onOpenItem,
  suggestions,
  onTake,
  onMoveSuggestion,
  onLeaveOut,
}: {
  /** Where the thing being carried would land. */
  landing: Landing | null;
  onGrab: (
    event: ReactPointerEvent<HTMLElement>,
    grabbed: Grabbed,
    title: string,
    minutes: number,
  ) => void;
  onGrabEnd: (
    event: ReactPointerEvent<HTMLElement>,
    grabbed: Grabbed,
    title: string,
    day: string,
    startMinute: number,
    minutes: number,
  ) => void;
  onEdit: (target: Editing) => void;
  daysOff: ReadonlySet<string>;
  /** Double-click an empty place: a new event there. */
  onNewEvent: (place: NewEvent) => void;
  suggestions: readonly Suggestion[];
  onTake: (suggestion: Suggestion) => void;
  onMoveSuggestion: (suggestion: Suggestion) => void;
  onLeaveOut: (itemId: string) => void;
  /** The region that scrolls this grid, and whose height the hours are fitted to. */
  scroller: HTMLDivElement | null;
  dueByDay: ReadonlyMap<string, readonly Item[]>;
  onOpenItem: (item: Item) => void;
  days: string[];
  occurrences: Occurrence[];
  zone: string;
  now: string;
  workHours: Array<{ weekday: number; startsMinute: number; endsMinute: number }>;
  onDelete: (id: string) => void;
  carrying: Carrying | null;
  onPickUp: (occurrence: Occurrence) => void;
}) {
  const carriedPlace = carrying ? placeOf(carrying.startsAt, zone) : null;
  const today = todayIn(now, zone);
  const nowMinutes = minutesInto(now, today, zone);

  // Every day the same share of the room: a long title is cut, it does not push
  // Sunday off the screen. A narrow window scrolls rather than crushing them.
  const columns = `3.5rem repeat(${days.length}, minmax(6rem, 1fr))`;

  const allDay = occurrences.filter((occurrence) => occurrence.event.allDay);
  const planned = useMemo(() => plannedByDay(occurrences, zone), [occurrences, zone]);
  const hasBand = allDay.length > 0 || days.some((day) => dueByDay.has(day));

  // The working day fills the room there is, so a week is seen at a glance. The
  // rest of the day is still there, a scroll away.
  const header = useRef<HTMLDivElement>(null);
  const workWindow = useMemo(() => workingWindow(days, workHours), [days, workHours]);
  const [hourHeight, setHourHeight] = useState(48);

  useLayoutEffect(() => {
    const region = scroller;
    if (region === null) return;
    const fit = () =>
      setHourHeight(
        fittedHourHeight(region.clientHeight - (header.current?.offsetHeight ?? 0), workWindow),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(region);
    return () => observer.disconnect();
  }, [scroller, workWindow, hasBand]);

  useLayoutEffect(() => {
    // A little above the first hour, so its label is not cut by the day names.
    scroller?.scrollTo({ top: (workWindow.startsMinute / 60) * hourHeight - 12 });
  }, [scroller, workWindow, hourHeight]);

  return (
    <div className="min-w-full">
      <div ref={header} className="sticky top-0 z-10 bg-card">
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div />
          {days.map((day) => (
            <DayHead
              key={day}
              day={day}
              today={today}
              capacity={capacityOf(day, workHours, daysOff)}
              planned={planned.get(day) ?? 0}
              suggested={suggestions
                .filter((suggestion) => suggestion.day === day)
                .reduce((sum, suggestion) => sum + suggestion.minutes, 0)}
            />
          ))}
        </div>

        {hasBand && (
          <div
            className="grid border-b border-stroke-subtle"
            style={{ gridTemplateColumns: columns }}
          >
            <div className="px-1 py-1 text-right text-caption text-fg-tertiary">All day</div>
            {days.map((day) => (
              <div key={day} className="min-h-7 space-y-0.5 border-l border-stroke-subtle p-0.5">
                {allDay
                  // On the day it is on, not on every day from then on.
                  .filter((occurrence) => dayOf(occurrence.startsAt, zone) === day)
                  .map((occurrence) => (
                    <div
                      key={occurrence.event.id}
                      className="truncate rounded-sm bg-accent-subtle px-1 text-caption text-accent"
                    >
                      {occurrence.event.title}
                    </div>
                  ))}
                {(dueByDay.get(day) ?? []).map((item) => (
                  <DueLine key={item.id} item={item} onOpen={onOpenItem} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative grid" style={{ gridTemplateColumns: columns }}>
        <div>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              style={{ height: hourHeight }}
              className="relative -top-2 pr-1 text-right text-caption text-fg-tertiary"
            >
              {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const boxes = layoutDay(occurrences, day, zone);
          // A day off has no working hours to shade, whatever its weekday says.
          const working =
            capacityOf(day, workHours, daysOff) > 0 ? workingSpan(day, workHours) : null;
          const carried =
            landing?.grabbed.kind === 'event' ? landing.grabbed.occurrence.event.id : null;
          const carriedSuggestion =
            landing?.grabbed.kind === 'suggestion' ? landing.grabbed.suggestion.key : null;
          // What the block would land on. Said, not refused: the person decides.
          const landsOn =
            landing?.day === day
              ? boxes.find(
                  (box) =>
                    box.occurrence.event.id !== carried &&
                    box.topMinutes < landing.minute + landing.minutes &&
                    box.topMinutes + box.heightMinutes > landing.minute,
                )
              : undefined;

          return (
            <div
              key={day}
              className={[
                'relative border-l border-stroke-subtle',
                day === today ? 'bg-accent-subtle' : '',
              ].join(' ')}
              style={{ height: 24 * hourHeight }}
              data-day-column={day}
              onDoubleClick={(event) => {
                // Only the grid itself: a double click on a block is that block's.
                const target = event.target as HTMLElement;
                if (target.closest('article, [data-suggestion], button') !== null) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const minute = ((event.clientY - bounds.top) / hourHeight) * 60;
                onNewEvent({ day, minute: Math.floor(minute / SNAP_MINUTES) * SNAP_MINUTES });
              }}
            >
              {/* Outside working hours is recessed rather than hidden: the time
                  is still there, it is just not the working day. */}
              {working !== null && (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 bg-card/40"
                  style={{
                    top: (working.startsMinute / 60) * hourHeight,
                    height: ((working.endsMinute - working.startsMinute) / 60) * hourHeight,
                  }}
                />
              )}

              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  aria-hidden="true"
                  className="border-b border-stroke-subtle/60"
                  style={{ height: hourHeight }}
                />
              ))}

              {day === today && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger"
                  style={{ top: (nowMinutes / 60) * hourHeight }}
                >
                  <span className="absolute -top-1 -left-1 size-2 rounded-full bg-danger" />
                </div>
              )}

              {/* Where the carried block would land, drawn as an outline
                  until Enter makes it real. */}
              {carrying && carriedPlace && carriedPlace.day === day && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0.5 z-30 rounded-sm border-2 border-dashed border-accent bg-accent-subtle px-1 text-caption font-semibold text-accent"
                  style={{
                    top: (carriedPlace.minute / 60) * hourHeight,
                    height: (carrying.durationMs / 3_600_000) * hourHeight - 2,
                  }}
                >
                  {carrying.title}
                </div>
              )}

              {/* Where the block will land if let go now. */}
              {landing !== null && landing.day === day && (
                <div
                  aria-hidden="true"
                  data-testid="landing"
                  className={[
                    'pointer-events-none absolute inset-x-0.5 z-30 overflow-hidden rounded-sm border-2 border-dashed px-1 text-caption font-semibold',
                    landsOn === undefined
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-caution bg-caution-subtle text-caution',
                  ].join(' ')}
                  style={{
                    top: (landing.minute / 60) * hourHeight,
                    height: Math.max(20, (landing.minutes / 60) * hourHeight - 2),
                  }}
                >
                  <span className="block truncate">{landing.title}</span>
                  <span className="block truncate font-normal">
                    {clockOf(landing.minute)} to {clockOf(landing.minute + landing.minutes)}
                    {landsOn === undefined
                      ? ''
                      : `, on top of ${landsOn.occurrence.event.title || 'Untitled'}`}
                  </span>
                </div>
              )}

              {suggestions
                .filter((suggestion) => suggestion.day === day)
                .map((suggestion) => (
                  <SuggestionBlock
                    key={suggestion.key}
                    suggestion={suggestion}
                    hourHeight={hourHeight}
                    zone={zone}
                    dimmed={carriedSuggestion === suggestion.key}
                    onGrab={(event) =>
                      onGrab(
                        event,
                        { kind: 'suggestion', suggestion },
                        suggestion.title,
                        suggestion.minutes,
                      )
                    }
                    onGrabEnd={(event) =>
                      onGrabEnd(
                        event,
                        { kind: 'suggestion', suggestion },
                        suggestion.title,
                        day,
                        suggestion.startMinute,
                        suggestion.minutes,
                      )
                    }
                    onOpen={() => onEdit({ kind: 'suggestion', suggestion })}
                    onTake={() => onTake(suggestion)}
                    onMove={() => onMoveSuggestion(suggestion)}
                    onLeaveOut={() => onLeaveOut(suggestion.itemId)}
                  />
                ))}

              {boxes.map((box) => {
                const boxKey = `${box.occurrence.event.id}-${box.occurrence.originalStart}`;
                const title = box.occurrence.event.title || 'Untitled';
                const grabbed: Grabbed = { kind: 'event', occurrence: box.occurrence };
                return (
                  <article
                    key={boxKey}
                    aria-label={`${title}, ${timeOf(box.occurrence.startsAt, zone)} to ${timeOf(box.occurrence.endsAt, zone)}`}
                    onPointerDown={(event) => onGrab(event, grabbed, title, box.heightMinutes)}
                    className={[
                      'group absolute cursor-grab touch-none overflow-hidden rounded-sm border px-1 py-0.5 text-caption select-none active:cursor-grabbing',
                      carrying?.id === box.occurrence.event.id ||
                      carried === box.occurrence.event.id
                        ? 'opacity-40'
                        : '',
                      box.occurrence.event.itemId !== null
                        ? 'border-accent/40 bg-accent-subtle text-accent'
                        : 'border-stroke bg-card text-fg',
                    ].join(' ')}
                    style={{
                      top: (box.topMinutes / 60) * hourHeight,
                      height: (box.heightMinutes / 60) * hourHeight - 2,
                      left: `calc(${box.left * 100}% + 2px)`,
                      width: `calc(${box.width * 100}% - 4px)`,
                    }}
                    title={box.occurrence.event.title}
                  >
                    <button
                      type="button"
                      aria-label={`Edit ${title}`}
                      onClick={() => onEdit({ kind: 'event', occurrence: box.occurrence })}
                      className="block w-full cursor-inherit truncate text-left font-semibold"
                    >
                      {title}
                    </button>
                    <span className="block truncate opacity-70">
                      {timeOf(box.occurrence.startsAt, zone)}
                    </span>
                    {/* The keyboard route, in view only once the keys reach it. Sitting
                      on the block they took the press meant for it, invisibly, and in
                      a narrow column the middle of a block was its Delete. */}
                    <span data-no-drag className="absolute top-0.5 right-0.5 flex gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${box.occurrence.event.title || 'Untitled'}`}
                        aria-describedby="calendar-keyboard-help"
                        onClick={() => onPickUp(box.occurrence)}
                        className="sr-only rounded-sm bg-card p-0.5 focus-visible:not-sr-only"
                      >
                        <ReOrderDotsVertical16Regular />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${box.occurrence.event.title}`}
                        onClick={() => onDelete(box.occurrence.event.id)}
                        className="sr-only rounded-sm bg-card p-0.5 focus-visible:not-sr-only"
                      >
                        <Delete16Regular />
                      </button>
                    </span>
                    {/* The bottom edge is the length. A real gesture for the
                      pointer; the keyboard has Shift with the arrows. */}
                    <span
                      aria-hidden="true"
                      data-resize-handle
                      className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-end justify-center"
                      onPointerDown={(event) =>
                        onGrabEnd(event, grabbed, title, day, box.topMinutes, box.heightMinutes)
                      }
                    >
                      <span className="mb-px h-0.5 w-6 rounded-full bg-current opacity-0 transition-opacity duration-100 ease-easy group-hover:opacity-60" />
                    </span>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A day's name, and how full it is. */
function DayHead({
  day,
  today,
  capacity,
  planned,
  suggested,
}: {
  day: string;
  today: string;
  capacity: number;
  planned: number;
  suggested: number;
}) {
  const free = Math.max(0, capacity - planned - suggested);
  const words =
    capacity === 0
      ? 'Not a working day'
      : `${describeHours(planned)} reserved${
          suggested > 0 ? `, ${describeHours(suggested)} suggested` : ''
        }, ${describeHours(free)} free`;
  return (
    <div
      data-day-head={day}
      className="border-b border-stroke-subtle px-2 py-1 text-center text-caption"
      title={words}
    >
      <span className={day === today ? 'font-semibold text-accent' : 'text-fg-secondary'}>
        {labelOf(day)}
      </span>
      {capacity > 0 ? (
        <Meter
          value={planned + suggested}
          max={capacity}
          label={`${labelOf(day)}: how full`}
          valueText={words}
          tone={planned + suggested > capacity ? 'danger' : 'accent'}
          className="mt-1"
        />
      ) : (
        <span className="mt-1 block h-1.5" />
      )}
    </div>
  );
}

/**
 * Time the plan proposes for a task. Dashed, because it is not there yet: nothing
 * is reserved until the person takes it or drags it somewhere.
 */
function SuggestionBlock({
  suggestion,
  hourHeight,
  zone,
  dimmed,
  onGrab,
  onGrabEnd,
  onOpen,
  onTake,
  onMove,
  onLeaveOut,
}: {
  suggestion: Suggestion;
  hourHeight: number;
  zone: string;
  dimmed: boolean;
  onGrab: (event: ReactPointerEvent<HTMLElement>) => void;
  onGrabEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen: () => void;
  onTake: () => void;
  onMove: () => void;
  onLeaveOut: () => void;
}) {
  const from = timeOf(suggestion.startsAt, zone);
  return (
    <div
      data-suggestion={suggestion.itemId}
      onPointerDown={onGrab}
      style={{
        top: (suggestion.startMinute / 60) * hourHeight,
        height: (suggestion.minutes / 60) * hourHeight - 2,
      }}
      className={[
        'group absolute inset-x-0.5 cursor-grab touch-none overflow-hidden rounded-sm border border-dashed bg-layer px-1 py-0.5 text-caption select-none active:cursor-grabbing',
        suggestion.late ? 'border-danger' : 'border-accent',
        dimmed ? 'opacity-40' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Suggested: ${suggestion.title}, ${from}, ${describeHours(suggestion.minutes)}${
          suggestion.assumed ? ', length assumed' : ''
        }${suggestion.late ? ', after its date' : ''}`}
        className="block w-full cursor-inherit truncate pr-5 text-left font-semibold text-fg"
      >
        {suggestion.title}
      </button>
      <span className="flex items-center gap-1 truncate text-fg-tertiary">
        {suggestion.late && (
          <Warning16Regular aria-hidden="true" className="shrink-0 text-danger" />
        )}
        {describeHours(suggestion.minutes)}
        {suggestion.assumed ? ' assumed' : ''}
        {suggestion.late ? ', after its date' : ''}
      </span>
      <span
        aria-hidden="true"
        data-resize-handle
        className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-end justify-center"
        onPointerDown={onGrabEnd}
      >
        <span className="mb-px h-0.5 w-6 rounded-full bg-current opacity-0 transition-opacity duration-100 ease-easy group-hover:opacity-60" />
      </span>
      <span data-no-drag className="absolute top-0.5 right-0.5 flex gap-0.5">
        <button
          type="button"
          aria-label={`Accept the time for ${suggestion.title}`}
          title="Accept"
          onClick={onTake}
          className="rounded-sm p-0.5 text-accent hover:bg-card-hover"
        >
          <Checkmark16Regular />
        </button>
        <button
          type="button"
          aria-label={`Move the suggestion for ${suggestion.title}`}
          aria-describedby="calendar-keyboard-help"
          title="Move with the keyboard"
          onClick={onMove}
          className="sr-only rounded-sm bg-card p-0.5 focus-visible:not-sr-only"
        >
          <ReOrderDotsVertical16Regular />
        </button>
        <button
          type="button"
          aria-label={`Leave ${suggestion.title} out of the plan`}
          title="Leave out of the plan"
          onClick={onLeaveOut}
          className="sr-only rounded-sm bg-card p-0.5 focus-visible:not-sr-only"
        >
          <Dismiss16Regular />
        </button>
      </span>
    </div>
  );
}

/** A task on the day it is due. Pressing it opens the task. */
function DueLine({ item, onOpen }: { item: Item; onOpen: (item: Item) => void }) {
  return (
    <button
      type="button"
      title={`Due: ${item.title}`}
      aria-label={`Due: ${item.title}`}
      onClick={() => onOpen(item)}
      className="block w-full truncate rounded-sm border border-stroke bg-layer px-1 text-left text-caption text-fg hover:bg-card-hover"
    >
      {item.title}
    </button>
  );
}

// ── Month and agenda ───────────────────────────────────────────────────────

function MonthGrid({
  days,
  anchor,
  occurrences,
  zone,
  dueByDay,
  suggestions,
  onOpenItem,
}: {
  days: string[];
  anchor: string;
  occurrences: Occurrence[];
  zone: string;
  dueByDay: ReadonlyMap<string, readonly Item[]>;
  suggestions: readonly Suggestion[];
  onOpenItem: (item: Item) => void;
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
              {(dueByDay.get(day) ?? []).slice(0, 3).map((item) => (
                <DueLine key={item.id} item={item} onOpen={onOpenItem} />
              ))}
              {(dueByDay.get(day) ?? []).length > 3 && (
                <p className="px-1 text-caption text-fg-tertiary">
                  +{(dueByDay.get(day) ?? []).length - 3} more due
                </p>
              )}
              <SuggestedOnDay suggestions={suggestions.filter((one) => one.day === day)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A month has no room for blocks, so it counts what the plan proposes for the day. */
function SuggestedOnDay({ suggestions }: { suggestions: readonly Suggestion[] }) {
  if (suggestions.length === 0) return null;
  const minutes = suggestions.reduce((sum, suggestion) => sum + suggestion.minutes, 0);
  return (
    <p
      data-suggestion-count={suggestions.length}
      title={suggestions.map((suggestion) => suggestion.title).join(', ')}
      className="truncate rounded-sm border border-dashed border-accent px-1 text-caption text-fg-secondary"
    >
      {describeHours(minutes)} suggested
    </p>
  );
}

function AgendaList({
  days,
  occurrences,
  zone,
  suggestions,
}: {
  days: string[];
  occurrences: Occurrence[];
  zone: string;
  suggestions: readonly Suggestion[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const onThisDay = occurrences.filter(
          (occurrence) => dayOf(occurrence.startsAt, zone) === day,
        );
        const proposed = suggestions.filter((suggestion) => suggestion.day === day);
        if (onThisDay.length === 0 && proposed.length === 0) return null;

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
              {proposed.map((suggestion) => (
                <li
                  key={suggestion.key}
                  data-suggestion={suggestion.itemId}
                  className="flex items-baseline gap-3 rounded-md border border-dashed border-accent px-2 py-1"
                >
                  <span className="w-24 shrink-0 text-caption text-fg-tertiary">
                    {timeOf(suggestion.startsAt, zone)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-fg">
                    {suggestion.title}
                  </span>
                  <span className="shrink-0 text-caption text-fg-tertiary">Suggested</span>
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

/** The month around the day on screen: the fast way to get anywhere. */
function MiniMonth({
  anchor,
  today,
  onPick,
}: {
  anchor: string;
  today: string;
  onPick: (day: string) => void;
}) {
  const [shown, setShown] = useState(anchor);
  // Follows the main grid when it moves to another month.
  const [lastAnchor, setLastAnchor] = useState(anchor);
  if (anchor !== lastAnchor) {
    setLastAnchor(anchor);
    setShown(anchor);
  }
  const days = daysOf('month', shown);
  const month = shown.slice(0, 7);
  const [year, monthNumber] = shown.split('-').map(Number);
  const name = new Date(year!, monthNumber! - 1, 15).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <section
      aria-label="Go to a day"
      className="rounded-lg border border-stroke-subtle bg-layer-alt p-2"
    >
      <header className="mb-1 flex items-center justify-between">
        <span className="px-1 text-body font-semibold text-fg">{name}</span>
        <span className="flex">
          <IconButton
            label="The month before"
            icon={<ChevronLeft20Regular />}
            onClick={() => setShown(step('month', shown, -1))}
          />
          <IconButton
            label="The month after"
            icon={<ChevronRight20Regular />}
            onClick={() => setShown(step('month', shown, 1))}
          />
        </span>
      </header>
      <div className="grid grid-cols-7 text-center">
        {days.map((day) => {
          const inMonth = day.slice(0, 7) === month;
          const selected = day === anchor;
          return (
            <button
              key={day}
              type="button"
              aria-label={labelOf(day)}
              aria-current={day === today ? 'date' : undefined}
              onClick={() => onPick(day)}
              className={[
                'rounded-sm py-0.5 text-caption tabular-nums hover:bg-card-hover',
                day === today
                  ? 'bg-accent font-semibold text-fg-on-accent hover:bg-accent-hover'
                  : selected
                    ? 'bg-card-active font-semibold text-fg'
                    : inMonth
                      ? 'text-fg-secondary'
                      : 'text-fg-tertiary',
              ].join(' ')}
            >
              {Number(day.slice(-2))}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** What the suggested plan comes to, and what it had to assume. */
function PlanSummary({ plan }: { plan: SuggestedPlan }) {
  return (
    <section
      aria-label="The suggested plan"
      data-testid="plan-summary"
      className="rounded-lg border border-stroke-subtle bg-layer-alt p-2"
    >
      <h3 className="mb-1 flex items-center gap-1 px-1 text-caption font-semibold text-fg-tertiary uppercase">
        Suggested plan
      </h3>
      {plan.suggestions.length === 0 && plan.unplaced.length === 0 ? (
        <p className="px-1 text-caption text-fg-tertiary">
          Everything open already has its time set aside.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-1 text-caption text-fg-secondary">
          <li>
            <span className="font-semibold text-fg">{describeHours(plan.minutes)}</span> laid out
            over the next three weeks.
          </li>
          {plan.assumed > 0 && (
            <li>
              {plan.assumed} {plan.assumed === 1 ? 'task has' : 'tasks have'} no estimate, so an
              hour is assumed.
            </li>
          )}
          {plan.late > 0 && (
            <li className="text-danger">
              {plan.late} {plan.late === 1 ? 'task lands' : 'tasks land'} after the date.
            </li>
          )}
          {plan.unplaced.length > 0 && (
            <li className="text-danger">
              {plan.unplaced.length} {plan.unplaced.length === 1 ? 'task does' : 'tasks do'} not fit
              in those weeks.
            </li>
          )}
          <li className="pt-1 text-fg-tertiary">
            Drag a block to move it, or accept it. Nothing is reserved until you do.
          </li>
        </ul>
      )}
    </section>
  );
}

/**
 * Tasks with no time reserved for them.
 *
 * The panel is the other half of the product's differentiator: work goes in on
 * the left, and dragging it onto the grid turns it into time without turning it
 * into a different thing.
 */
function UnscheduledPanel({
  items,
  leftOut,
  suggestions,
  onShowDay,
  onBringBack,
  onOpen,
  onPickUp,
  onReserve,
  onGrab,
}: {
  /** Where the plan has put each task, to say so beside it. */
  suggestions: readonly Suggestion[];
  /** Go to a day, from where the plan put a task. */
  onShowDay: (day: string) => void;
  /** Reserve it in the first free time: the pointer's way. */
  onReserve: (item: Item) => void;
  onGrab: (event: ReactPointerEvent<HTMLElement>, item: Item) => void;
  items: Item[];
  /** Tasks the person left out of the plan for now. */
  leftOut: ReadonlySet<string>;
  onBringBack: (itemId: string) => void;
  onOpen: (item: Item) => void;
  onPickUp: (item: Item) => void;
}) {
  return (
    <section
      aria-label="Not scheduled"
      className="flex min-h-48 flex-1 flex-col rounded-lg border border-stroke-subtle bg-layer-alt p-2"
    >
      <h3 className="mb-2 px-1 text-caption font-semibold text-fg-tertiary uppercase">
        Not scheduled
      </h3>

      {items.length === 0 ? (
        <p className="px-1 text-caption text-fg-tertiary">
          Everything open has time reserved for it.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            const first = suggestions.find((suggestion) => suggestion.itemId === item.id);
            return (
              <li key={item.id}>
                <div
                  data-panel-task={item.id}
                  onPointerDown={(event) => onGrab(event, item)}
                  className="flex cursor-grab touch-none items-center gap-1 rounded-md border border-stroke-subtle bg-card p-1.5 text-caption text-fg select-none active:cursor-grabbing"
                >
                  <span className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      className="block w-full cursor-inherit truncate text-left"
                    >
                      {item.title}
                    </button>
                    {first !== undefined && (
                      <button
                        type="button"
                        data-no-drag
                        onClick={() => onShowDay(first.day)}
                        className="block w-full truncate text-left text-fg-tertiary hover:underline"
                      >
                        Suggested {labelOf(first.day)}, {clockOf(first.startMinute)}
                      </button>
                    )}
                  </span>
                  {leftOut.has(item.id) && (
                    <button
                      type="button"
                      data-no-drag
                      onClick={() => onBringBack(item.id)}
                      aria-label={`Bring ${item.title} back into the plan`}
                      className="shrink-0 rounded-sm px-1 text-fg-tertiary underline hover:text-fg"
                    >
                      Left out
                    </button>
                  )}
                  <IconButton
                    label={`Reserve time for ${item.title}`}
                    icon={<CalendarAdd20Regular />}
                    aria-describedby="calendar-keyboard-help"
                    data-no-drag
                    // From the keys, a click has no detail: they pick it up to nudge it.
                    onClick={(event) => (event.detail === 0 ? onPickUp(item) : onReserve(item))}
                    className="-my-1 shrink-0"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Asked when a place on the grid is double-clicked. */
function NewEventDialog({
  place,
  pending,
  onClose,
  onCreate,
}: {
  place: NewEvent | null;
  pending: boolean;
  onClose: () => void;
  onCreate: (title: string, minutes: number) => void;
}) {
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(60);
  const clock =
    place === null
      ? ''
      : `${String(Math.floor(place.minute / 60)).padStart(2, '0')}:${String(place.minute % 60).padStart(2, '0')}`;

  return (
    <Modal
      open={place !== null}
      label="New event"
      onClose={() => {
        setTitle('');
        onClose();
      }}
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() === '') return;
          onCreate(title.trim(), minutes);
          setTitle('');
        }}
      >
        <h2 className="text-body-lg font-semibold text-fg">
          {place === null ? 'New event' : `New event, ${labelOf(place.day)} at ${clock}`}
        </h2>
        <Input
          autoFocus
          aria-label="What the event is"
          placeholder="What is it?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="flex gap-1" role="group" aria-label="How long it lasts">
          {[30, 60, 90, 120].map((length) => (
            <Button
              key={length}
              appearance={length === minutes ? 'accent' : 'standard'}
              aria-pressed={length === minutes}
              onClick={() => setMinutes(length)}
            >
              {describeHours(length)}
            </Button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="submit" appearance="accent" disabled={title.trim() === '' || pending}>
            Add event
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Small helpers ──────────────────────────────────────────────────────────

function dayOf(instant: string, zone: string): string {
  const local = new Date(new Date(instant).toLocaleString('en-US', { timeZone: zone }));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

/** `570` as `09:30`. */
function clockOf(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** What the block editor opens with. */
function fieldsOf(target: Editing, zone: string): BlockFields {
  if (target.kind === 'suggestion') {
    const { title, day, startMinute: minute, minutes } = target.suggestion;
    return { title, day, minute, minutes };
  }
  const { occurrence } = target;
  const day = dayOf(occurrence.startsAt, zone);
  return {
    title: occurrence.event.title,
    day,
    minute: minutesInto(occurrence.startsAt, day, zone),
    minutes: Math.round(
      (new Date(occurrence.endsAt).getTime() - new Date(occurrence.startsAt).getTime()) / 60_000,
    ),
  };
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
  if (scale === 'year') return String(year);
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
