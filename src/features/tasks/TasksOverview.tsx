import {
  CalendarClock16Regular,
  CalendarDay16Regular,
  ChevronDown16Regular,
  ChevronUp16Regular,
  ClockAlarm16Regular,
  HourglassHalf16Regular,
  Stack16Regular,
  Timer16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState, type ReactNode } from 'react';

import { formatDuration, type Plan } from '@/domain/criticalPath';
import type { Item } from '@/domain/item';
import { countSlices, portionsOf, SLICES, type Slice } from '@/domain/overview';
import type { Property } from '@/domain/property';
import { systemZone } from '@/domain/schedule';
import { IconButton } from '@/ui/IconButton';
import { StackBar } from '@/ui/StackBar';
import { Stat, StatRow, type StatTone } from '@/ui/Stat';
import { toneFill, toChipTone } from '@/ui/chipTone';
import { useNow } from '@/ui/useNow';

const REMEMBER = 'tessera.tasks-overview';

const ICON: Record<Slice, ReactNode> = {
  open: <Stack16Regular />,
  overdue: <ClockAlarm16Regular />,
  week: <CalendarClock16Regular />,
  undated: <CalendarDay16Regular />,
  waiting: <HourglassHalf16Regular />,
  unestimated: <Timer16Regular />,
};

/** A few words on what each count means for the work. */
function noteFor(slice: Slice, count: number, plan: Plan): string {
  switch (slice) {
    case 'open':
      return plan.unplanned
        ? 'Press a figure to see those tasks'
        : `${formatDuration(plan.durationMinutes)} on the longest route`;
    case 'overdue':
      return count === 0 ? 'Nothing is late' : 'Past their date';
    case 'week':
      return count === 0 ? 'A clear week' : 'Coming up';
    case 'undated':
      return count === 0 ? 'Every task has a date' : 'Stay out of Today';
    case 'waiting':
      return count === 0 ? 'Nothing is held up' : 'Held up by other work';
    case 'unestimated':
      return count === 0 ? 'Every task is sized' : 'Not in the week’s hours';
  }
}

function toneFor(slice: Slice, count: number): StatTone {
  if (count === 0) return 'neutral';
  if (slice === 'overdue') return 'danger';
  if (slice === 'waiting' || slice === 'unestimated') return 'caution';
  return 'neutral';
}

/**
 * The top of the whole list: what is open, what is in trouble, how it divides.
 *
 * Pressing a figure shows those tasks and pressing it again shows them all. That
 * slice is not saved into the view: it is a look, not a change of mind.
 */
export function TasksOverview({
  items,
  blocked,
  properties,
  values,
  plan,
  slice,
  onSlice,
}: {
  items: readonly Item[];
  blocked: ReadonlySet<string>;
  properties: readonly Property[];
  values: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  plan: Plan;
  slice: Slice | null;
  onSlice: (slice: Slice | null) => void;
}) {
  const now = useNow(60_000);
  const zone = useMemo(() => systemZone(), []);
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER) !== 'hidden';
    } catch {
      return true;
    }
  });

  const counts = useMemo(() => countSlices(items, blocked, now, zone), [items, blocked, now, zone]);

  const dividing = useMemo(
    () =>
      properties
        .filter((property) => property.type === 'status' || property.type === 'priority')
        .map((property) => ({ property, portions: portionsOf(items, property, values) })),
    [items, properties, values],
  );

  const toggle = () => {
    const next = !shown;
    setShown(next);
    try {
      localStorage.setItem(REMEMBER, next ? 'shown' : 'hidden');
    } catch {
      // A profile that refuses storage just forgets the choice.
    }
  };

  return (
    <section
      aria-label="Overview"
      className="print-hide flex flex-col gap-2"
      data-testid="overview"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-caption font-semibold text-fg-tertiary uppercase">Overview</h2>
        <IconButton
          label={shown ? 'Hide the overview' : 'Show the overview'}
          aria-expanded={shown}
          icon={shown ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
          onClick={toggle}
        />
      </div>

      {shown && (
        <>
          <StatRow label="Open work">
            {SLICES.map(({ id, label }) => (
              <Stat
                key={id}
                testId={`slice-${id}`}
                label={label}
                icon={ICON[id]}
                value={counts[id]}
                note={noteFor(id, counts[id], plan)}
                tone={toneFor(id, counts[id])}
                pressed={slice === id}
                onPress={() => onSlice(slice === id ? null : id)}
              />
            ))}
          </StatRow>

          {counts.open > 0 && dividing.length > 0 && (
            <div className="grid gap-x-6 gap-y-3 rounded-xl border border-stroke-subtle bg-card p-3 shadow-card lg:grid-cols-2">
              {dividing.map(({ property, portions }) => (
                <div key={property.id} className="min-w-0">
                  <h3 className="mb-2 text-caption font-semibold text-fg-secondary">
                    {property.name}
                  </h3>
                  <StackBar
                    label={`Open work by ${property.name}`}
                    showEmpty={false}
                    parts={portions.map((portion) => ({
                      id: portion.id,
                      label: portion.label,
                      value: portion.count,
                      text: String(portion.count),
                      className: toneFill(toChipTone(portion.color)),
                    }))}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
