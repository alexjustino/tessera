import {
  Add16Regular,
  Delete12Regular,
  Edit12Regular,
  Play16Regular,
  Stop16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useAddTimeEntry,
  useDeleteTimeEntry,
  useStartTimer,
  useStopTimer,
  useTimeEntries,
  useUpdateTimeEntry,
} from '@/data/hooks';
import { formatDuration } from '@/domain/criticalPath';
import type { Item } from '@/domain/item';
import { localPlace, systemZone } from '@/domain/schedule';
import {
  against,
  elapsedClock,
  minutesForItem,
  minutesOnDay,
  runningEntry,
  type Entry,
} from '@/domain/time';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { InfoBar } from '@/ui/InfoBar';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

import { fromLocalInput, toLocalInput } from './localTime';

/**
 * How long this task has taken, and the clock for taking longer.
 *
 * One button, because there is one timer: starting this task stops whatever
 * else was running, which is what a person means by moving on. The product
 * says so before it happens rather than after — the button names the task it
 * would interrupt.
 *
 * Everything shown is computed by `domain/time` from `now`, which ticks once a
 * second only while something is running. A drawer with no clock going
 * re-renders no more than the rest of the product does.
 */
export function TimeTracker({ task, items }: { task: Item; items: readonly Item[] }) {
  const entries = useTimeEntries();
  const start = useStartTimer();
  const stop = useStopTimer();
  const remove = useDeleteTimeEntry();
  const add = useAddTimeEntry();
  const update = useUpdateTimeEntry();

  /** The entry being corrected, or 'new' for time written by hand. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const all = useMemo(() => entries.data ?? [], [entries.data]);
  const running = runningEntry(all);
  const runningHere = running !== null && running.itemId === task.id;

  // A second while a clock runs; not at all otherwise.
  const now = useNow(running === null ? null : 1_000);
  const zone = useMemo(() => systemZone(), []);
  const today = useMemo(() => localPlace(now, zone).day, [now, zone]);

  const tracked = minutesForItem(all, task.id, now);
  const comparison = against(tracked, task.isMilestone ? null : task.estimateMinutes);
  const todayTotal = minutesOnDay(all, today, zone, now);

  const titleOf = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item.title]));
    return (id: string) => byId.get(id) ?? 'a task that is gone';
  }, [items]);

  const mine = useMemo(
    () =>
      all
        .filter((entry) => entry.itemId === task.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [all, task.id],
  );

  const toggle = () => {
    if (runningHere) {
      stop.mutate(undefined, {
        onSuccess: () => announce(`Stopped timing ${task.title}`),
      });
      return;
    }
    start.mutate(task.id, {
      onSuccess: () => announce(`Timing ${task.title}`),
    });
  };

  const busy = start.isPending || stop.isPending;
  const failure = start.error ?? stop.error ?? remove.error ?? add.error ?? update.error;

  return (
    <section className="mt-6 border-t border-stroke-subtle pt-4">
      <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">Time</h3>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            appearance={runningHere ? 'standard' : 'accent'}
            icon={runningHere ? <Stop16Regular /> : <Play16Regular />}
            disabled={busy}
            onClick={toggle}
          >
            {runningHere ? 'Stop' : 'Start timer'}
          </Button>

          {runningHere && running !== null && (
            <span
              // Announced as it changes would read a number every second, which
              // is noise; the start and the stop are announced instead.
              aria-live="off"
              className="font-mono text-subtitle tabular-nums text-accent"
            >
              {elapsedClock(running, now)}
            </span>
          )}

          {/* Minutes, so a clock two seconds old has tracked nothing yet —
              and saying "nothing" beside a running clock is a contradiction
              on screen. While this task's clock runs, the clock speaks. */}
          {(tracked > 0 || !runningHere) && (
            <span className="ml-auto text-caption text-fg-tertiary">
              {tracked === 0 ? 'Nothing tracked yet' : `${formatDuration(tracked)} tracked`}
            </span>
          )}
        </div>

        {/* Naming the task that would be interrupted, before the button is
            pressed — the one-timer rule is easier to live with than to read
            about afterwards. */}
        {running !== null && !runningHere && (
          <p className="text-caption text-fg-tertiary">
            Timing <strong className="font-semibold text-fg">{titleOf(running.itemId)}</strong>{' '}
            right now. Starting here stops it.
          </p>
        )}

        {comparison !== null && (
          <p className="text-caption text-fg-tertiary">
            {comparison.overBy > 0
              ? `${formatDuration(comparison.overBy)} over the ${formatDuration(task.estimateMinutes ?? 0)} estimate.`
              : `${formatDuration(-comparison.overBy)} left of the ${formatDuration(task.estimateMinutes ?? 0)} estimate.`}
          </p>
        )}

        {todayTotal > 0 && (
          <p className="text-caption text-fg-tertiary">
            {formatDuration(todayTotal)} tracked today, across everything.
          </p>
        )}

        {failure !== null && failure !== undefined && (
          <InfoBar severity="danger" title="That did not work">
            {describeError(failure)}
          </InfoBar>
        )}

        {mine.length > 0 && (
          <ul className="flex flex-col gap-1">
            {mine.slice(0, 8).map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-caption text-fg-secondary">
                <span className="tabular-nums">{describeEntry(entry, now)}</span>
                <span className="ml-auto tabular-nums">
                  {entry.endedAt === null ? 'running' : formatDuration(minutesBetween(entry))}
                </span>
                <IconButton
                  label={`Correct the entry from ${describeEntry(entry, now)}`}
                  icon={<Edit12Regular />}
                  disabled={update.isPending}
                  onClick={() => setEditing(entry.id)}
                />
                <IconButton
                  label={`Remove the entry from ${describeEntry(entry, now)}`}
                  icon={<Delete12Regular />}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(entry.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {editing === null ? (
          <div>
            <Button
              appearance="subtle"
              icon={<Add16Regular />}
              onClick={() => setEditing('new')}
              disabled={add.isPending}
            >
              Add time
            </Button>
          </div>
        ) : (
          <EntryForm
            key={editing}
            entry={editing === 'new' ? null : (mine.find((entry) => entry.id === editing) ?? null)}
            now={now}
            busy={add.isPending || update.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(startedAt, endedAt) => {
              const done = {
                onSuccess: () => {
                  setEditing(null);
                  announce(editing === 'new' ? 'Time added' : 'Entry corrected');
                },
              };
              if (editing === 'new') add.mutate({ itemId: task.id, startedAt, endedAt }, done);
              else update.mutate({ id: editing, startedAt, endedAt }, done);
            }}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Two times and a button: time the clock never saw, or a correction to what
 * it did see. A running entry being corrected gets an end — a person editing
 * the times of a clock is not asking it to keep running.
 *
 * An end before its start is refused here in words; the host refuses it too,
 * and the schema after that. Three answers, one rule.
 */
function EntryForm({
  entry,
  now,
  busy,
  onCancel,
  onSubmit,
}: {
  entry: Entry | null;
  now: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (startedAt: string, endedAt: string) => void;
}) {
  const [started, setStarted] = useState(toLocalInput(entry?.startedAt ?? null));
  const [ended, setEnded] = useState(toLocalInput(entry?.endedAt ?? (entry ? now : null)));
  const [complaint, setComplaint] = useState<string | null>(null);

  const submit = () => {
    const startedAt = fromLocalInput(started);
    const endedAt = fromLocalInput(ended);
    if (startedAt === null || endedAt === null) {
      setComplaint('An entry needs a start and an end.');
      return;
    }
    if (endedAt < startedAt) {
      setComplaint('An entry cannot end before it starts.');
      return;
    }
    setComplaint(null);
    onSubmit(startedAt, endedAt);
  };

  return (
    <form
      className="flex flex-col gap-2"
      aria-label={entry === null ? 'Add time' : 'Correct the entry'}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-caption text-fg-tertiary">
          Started
          <Input
            type="datetime-local"
            aria-label="Started"
            value={started}
            onChange={(event) => setStarted(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-fg-tertiary">
          Ended
          <Input
            type="datetime-local"
            aria-label="Ended"
            value={ended}
            onChange={(event) => setEnded(event.target.value)}
          />
        </label>
        <Button type="submit" appearance="accent" disabled={busy}>
          {entry === null ? 'Add' : 'Save'}
        </Button>
        <Button appearance="subtle" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {complaint !== null && <p className="text-caption text-caution">{complaint}</p>}
    </form>
  );
}

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** `8 Sep · 09:00 – 11:15`, in the machine's own zone and format. */
function describeEntry(entry: Entry, now: string): string {
  const started = new Date(entry.startedAt);
  const ended = new Date(entry.endedAt ?? now);
  return `${DAY.format(started)} · ${CLOCK.format(started)} – ${CLOCK.format(ended)}`;
}

function minutesBetween(entry: Entry): number {
  if (entry.endedAt === null) return 0;
  return Math.round((Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 60_000);
}
