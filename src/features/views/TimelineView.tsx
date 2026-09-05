import { ReOrderDotsVertical16Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';

import type { Edge } from '@/domain/graph';
import type { Item } from '@/domain/item';
import { localPlace, systemZone } from '@/domain/schedule';
import { columnsOf, layout, shiftByDays, type TimelineTask } from '@/domain/timeline';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { announce } from '@/ui/announce';

/** How wide a day is. Everything horizontal derives from this. */
const DAY_WIDTH = 32;

/** How tall a row is. One task per row, so this is also the row pitch. */
const ROW_HEIGHT = 28;

/** The narrowest a bar is drawn, so a short task is still something to grab. */
const MIN_BAR_PX = 14;

/** What is being moved, and how far from where it started. */
interface Carrying {
  id: string;
  days: number;
  /** Where the pointer went down, for a drag. Null when moving by keyboard. */
  fromX: number | null;
}

function asTimelineTask(item: Item): TimelineTask {
  return {
    id: item.id,
    title: item.title,
    startAt: item.startAt,
    dueAt: item.dueAt,
    completedAt: item.completedAt,
    estimateMinutes: item.estimateMinutes,
    isMilestone: item.isMilestone,
  };
}

/**
 * The timeline: the plan, drawn.
 *
 * One row per task in dependency order, a bar from each task's own dates, an
 * arrow for every dependency, and the critical path coloured. What it will not
 * do is invent a place for a task with no due date — those are counted under
 * the chart, because a Gantt that quietly omits work is worse than one that
 * admits it is incomplete.
 *
 * A bar moves by whole days: by dragging it, or — since a pointer drag is no
 * route at all for a keyboard — by pressing Move on the row and using the
 * arrows. Both shift the start and the due date together, keeping the length.
 * The dates are the plan; the timeline is a way of editing them.
 */
export function TimelineView({
  items,
  edges,
  critical,
  onOpen,
  onShift,
}: {
  items: readonly Item[];
  edges: readonly Edge[];
  critical: ReadonlySet<string>;
  onOpen: (item: Item) => void;
  onShift: (item: Item, startAt: string | null, dueAt: string) => void;
}) {
  const zone = systemZone();
  const [carrying, setCarrying] = useState<Carrying | null>(null);

  const tasks = useMemo(() => items.map(asTimelineTask), [items]);
  const timeline = useMemo(
    () => layout(tasks, edges, zone, critical),
    [tasks, edges, zone, critical],
  );
  const columns = useMemo(() => columnsOf(timeline), [timeline]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const today = localPlace(new Date().toISOString(), zone).day;

  // Carrying by keyboard. The commit lives inside the effect rather than in a
  // callback above it, so the dependency list can be honest instead of
  // silenced.
  useEffect(() => {
    if (carrying === null || carrying.fromX !== null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const item = byId.get(carrying.id);
      if (item === undefined) return;

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const days = carrying.days + (event.key === 'ArrowRight' ? 1 : -1);
        setCarrying({ ...carrying, days });
        announce(describeShift(item.title, days));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const moved = shiftByDays(asTimelineTask(item), carrying.days);
        if (moved !== null) {
          onShift(item, moved.startAt, moved.dueAt);
          announce(`Placed. ${describeShift(item.title, carrying.days)}`);
        }
        setCarrying(null);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        announce('Cancelled');
        setCarrying(null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [carrying, byId, onShift]);

  if (timeline.bars.length === 0) {
    return (
      <EmptyState
        title="Nothing to draw yet"
        description={
          timeline.undated.length === 0
            ? 'A timeline needs dates. Give a task a due date and it appears here.'
            : `${count(timeline.undated.length, 'task has', 'tasks have')} no due date, so there is nothing to place yet.`
        }
      />
    );
  }

  const width = timeline.days * DAY_WIDTH;
  const height = timeline.bars.length * ROW_HEIGHT;

  const endDrag = (id: string, clientX: number, fromX: number) => {
    const days = Math.round((clientX - fromX) / DAY_WIDTH);
    setCarrying(null);
    const item = byId.get(id);
    if (item === undefined || days === 0) return;
    const moved = shiftByDays(asTimelineTask(item), days);
    if (moved === null) return;
    onShift(item, moved.startAt, moved.dueAt);
    announce(describeShift(item.title, days));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {timeline.conflicts > 0 && (
        <InfoBar
          severity="caution"
          title={`${count(timeline.conflicts, 'dependency is', 'dependencies are')} contradicted by the dates`}
        >
          A task is scheduled to start before the thing blocking it is finished. The dashed arrows
          are the ones to look at.
        </InfoBar>
      )}

      {carrying !== null && carrying.fromX === null && (
        <p role="status" className="shrink-0 text-caption text-accent">
          Left and right move by a day · Enter places · Escape cancels
        </p>
      )}

      <div
        // `items-start` matters: without it the gutter and the chart stretch to
        // the container's height and paint a slab of background under a short
        // chart. The screenshot showed it; no test would have.
        className="flex min-h-0 flex-1 items-start overflow-auto"
        role="region"
        aria-label="Timeline"
      >
        {/* The titles, held still while the chart scrolls under them. */}
        <div className="sticky left-0 z-20 w-56 shrink-0 bg-layer">
          <div className="h-8 border-b border-stroke-subtle" />
          <ul>
            {timeline.bars.map((bar) => (
              <li
                key={bar.id}
                style={{ height: ROW_HEIGHT }}
                className="group flex items-center gap-1 border-b border-stroke-subtle/40 pr-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    const item = byId.get(bar.id);
                    if (item !== undefined) onOpen(item);
                  }}
                  className={`min-w-0 flex-1 truncate text-left text-caption ${
                    bar.completed ? 'text-fg-tertiary line-through' : 'text-fg'
                  }`}
                >
                  {bar.title}
                </button>
                <button
                  type="button"
                  aria-label={`Move ${bar.title}`}
                  aria-describedby="timeline-keyboard-help"
                  onClick={() => {
                    setCarrying({ id: bar.id, days: 0, fromX: null });
                    announce(
                      `Moving ${bar.title}. Left and right move by a day, Enter places, Escape cancels.`,
                    );
                  }}
                  className="shrink-0 rounded-sm p-0.5 text-fg-tertiary opacity-0 transition-opacity duration-100 ease-easy group-hover:opacity-100 hover:bg-card-hover hover:text-fg focus-visible:opacity-100"
                >
                  <ReOrderDotsVertical16Regular aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative shrink-0" style={{ width }}>
          <div className="sticky top-0 z-10 flex h-8 bg-layer">
            {columns.map((day) => (
              <div
                key={day}
                style={{ width: DAY_WIDTH }}
                className={[
                  'shrink-0 border-b border-l border-stroke-subtle text-center text-caption',
                  day === today ? 'font-semibold text-accent' : 'text-fg-tertiary',
                ].join(' ')}
              >
                {Number(day.slice(-2))}
              </div>
            ))}
          </div>

          <div className="relative" style={{ height }}>
            {columns.map((day, index) => (
              <div
                key={day}
                aria-hidden="true"
                className={`absolute top-0 bottom-0 border-l ${
                  day === today ? 'border-accent/50' : 'border-stroke-subtle/40'
                }`}
                style={{ left: index * DAY_WIDTH }}
              />
            ))}

            {/* Arrows, under the bars so a bar is never obscured by one. */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              width={width}
              height={height}
            >
              {timeline.arrows.map((arrow) => {
                const x1 = arrow.fromDay * DAY_WIDTH;
                const y1 = arrow.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                const x2 = arrow.toDay * DAY_WIDTH;
                const y2 = arrow.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
                // Out of the blocker, along a gutter past both ends, and in.
                const elbow = Math.max(x1, x2) + 6;
                return (
                  <polyline
                    key={`${arrow.from}-${arrow.to}`}
                    points={`${x1},${y1} ${elbow},${y1} ${elbow},${y2} ${x2},${y2}`}
                    fill="none"
                    strokeWidth={1}
                    className={arrow.breaks ? 'stroke-caution' : 'stroke-stroke-strong'}
                    strokeDasharray={arrow.breaks ? '3 2' : undefined}
                  />
                );
              })}
            </svg>

            {timeline.bars.map((bar) => {
              const nudge = carrying?.id === bar.id ? carrying.days : 0;
              const left = (bar.startDay + nudge) * DAY_WIDTH;
              const top = bar.row * ROW_HEIGHT;

              if (bar.isMilestone) {
                return (
                  <span
                    key={bar.id}
                    role="img"
                    aria-label={`${bar.title}, a milestone`}
                    title={`${bar.title} — a milestone`}
                    className="absolute z-10 size-3 rotate-45 bg-accent"
                    style={{ left: left - 6, top: top + ROW_HEIGHT / 2 - 6 }}
                  />
                );
              }

              return (
                <div
                  key={bar.id}
                  draggable
                  onDragStart={(event) =>
                    setCarrying({ id: bar.id, days: 0, fromX: event.clientX })
                  }
                  onDragEnd={(event) => {
                    if (carrying?.id === bar.id && carrying.fromX !== null) {
                      endDrag(bar.id, event.clientX, carrying.fromX);
                    }
                  }}
                  title={`${bar.title}${bar.critical ? ' — on the critical path' : ''}`}
                  className={[
                    'absolute z-10 cursor-grab truncate rounded-sm border px-1 text-caption active:cursor-grabbing',
                    carrying?.id === bar.id
                      ? 'border-dashed border-accent opacity-70'
                      : bar.critical
                        ? 'border-accent/50 bg-accent-subtle text-accent'
                        : 'border-stroke bg-card text-fg',
                    bar.completed ? 'opacity-50' : '',
                  ].join(' ')}
                  style={{
                    left,
                    // A quarter-day bar is eight pixels at this scale, which is
                    // a smudge rather than a bar.
                    width: Math.max(bar.spanDays * DAY_WIDTH, MIN_BAR_PX),
                    top: top + 4,
                    height: ROW_HEIGHT - 8,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <p id="timeline-keyboard-help" className="sr-only">
        Press Move on a task, then the left and right arrows to move it by a day. Enter places it,
        Escape cancels. A bar can also be dragged.
      </p>

      {timeline.undated.length > 0 && (
        <p className="shrink-0 text-caption text-fg-tertiary">
          {count(timeline.undated.length, 'task has', 'tasks have')} no due date and{' '}
          {timeline.undated.length === 1 ? 'is' : 'are'} not on the chart.
        </p>
      )}
    </div>
  );
}

/** `3 tasks have`, `1 task has`. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describeShift(title: string, days: number): string {
  if (days === 0) return `${title} back where it started`;
  const unit = Math.abs(days) === 1 ? 'day' : 'days';
  return `${title} ${Math.abs(days)} ${unit} ${days > 0 ? 'later' : 'earlier'}`;
}
