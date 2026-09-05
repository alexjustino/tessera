import {
  ArrowLeft20Regular,
  Checkmark20Regular,
  Next20Regular,
  Play24Regular,
  Stop24Regular,
} from '@fluentui/react-icons';
import { useEffect, useMemo, type ReactNode } from 'react';

import { describeError } from '@/data/errors';
import {
  useDependencies,
  useItems,
  useSetItemCompleted,
  useStartTimer,
  useStopTimer,
  useTimeEntries,
} from '@/data/hooks';
import { formatDuration } from '@/domain/criticalPath';
import { describeQueue, nextAfter, pickFocus } from '@/domain/focus';
import { against, elapsedClock, minutesForItem, runningEntry } from '@/domain/time';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Kbd } from '@/ui/Kbd';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

/**
 * One task, its timer, and nothing else on the screen.
 *
 * The rail and the list are gone; what is left is the title, the clock, and
 * four things a person might do next: start or stop the clock, mark the task
 * done, move to the next task that is ready, or leave. Leaving is always one
 * key away — a screen that removes everything must keep the way out obvious —
 * and nothing here starts the clock on its own. Focusing is a decision;
 * so is timing.
 *
 * Which task is shown is the domain's rule (`pickFocus`): the one asked for,
 * else the one the clock is on, else the first ready to start.
 */
export function FocusMode({
  requestedId,
  onLeave,
  onSwitch,
}: {
  /** The task the person pointed at, or null to let the queue decide. */
  requestedId: string | null;
  onLeave: () => void;
  /** The screen wants to show a different task; the shell records which. */
  onSwitch: (id: string) => void;
}) {
  const items = useItems(null, false);
  const dependencies = useDependencies();
  const entries = useTimeEntries();
  const start = useStartTimer();
  const stop = useStopTimer();
  const complete = useSetItemCompleted();

  const all = useMemo(() => items.data ?? [], [items.data]);
  const edges = useMemo(() => dependencies.data ?? [], [dependencies.data]);
  const running = runningEntry(entries.data ?? []);

  const task = useMemo(
    () => pickFocus(all, edges, running?.itemId ?? null, requestedId),
    [all, edges, running?.itemId, requestedId],
  );
  const runningHere = task !== null && running !== null && running.itemId === task.id;
  const now = useNow(runningHere ? 1_000 : null);

  // Escape leaves — unless a dialog is up, whose Escape it is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      onLeave();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onLeave]);

  const failure = start.error ?? stop.error ?? complete.error ?? items.error;
  const busy = start.isPending || stop.isPending || complete.isPending;

  if (items.isSuccess && task === null) {
    return (
      <Shell onLeave={onLeave}>
        <EmptyState
          title="Nothing is ready to start"
          description="Every open task is waiting on another, or there are none. Leave focus and add one, or finish what a task is waiting for."
        />
      </Shell>
    );
  }
  if (task === null) return <Shell onLeave={onLeave} />;

  const tracked = minutesForItem(entries.data ?? [], task.id, now);
  const comparison = against(tracked, task.isMilestone ? null : task.estimateMinutes);
  const next = nextAfter(all, edges, task.id);

  const toggle = () => {
    if (runningHere) {
      stop.mutate(undefined, { onSuccess: () => announce(`Stopped timing ${task.title}`) });
    } else {
      start.mutate(task.id, { onSuccess: () => announce(`Timing ${task.title}`) });
    }
  };

  const done = () => {
    complete.mutate(
      { id: task.id, completed: true },
      {
        onSuccess: () => {
          // The clock does not follow a finished task.
          if (runningHere) stop.mutate();
          if (next !== null) {
            announce(`Done. Next: ${next.title}`);
            onSwitch(next.id);
          } else {
            announce('Done. Nothing else is ready.');
            onLeave();
          }
        },
      },
    );
  };

  return (
    <Shell onLeave={onLeave}>
      <div
        className="flex w-full max-w-2xl flex-col items-center gap-8 text-center"
        data-testid="focus"
        data-task={task.id}
      >
        <div className="flex flex-col gap-2">
          <p className="text-caption font-semibold text-fg-tertiary uppercase">Focus</p>
          <h1 className="text-display font-semibold text-fg" data-testid="focus-title">
            {task.title}
          </h1>
          {task.estimateMinutes !== null && !task.isMilestone && (
            <p className="text-body text-fg-secondary">
              Estimated {formatDuration(task.estimateMinutes)}
              {comparison !== null &&
                (comparison.overBy > 0
                  ? ` · ${formatDuration(comparison.overBy)} over`
                  : ` · ${formatDuration(-comparison.overBy)} left`)}
            </p>
          )}
        </div>

        <p
          aria-live="off"
          className={[
            'font-mono tabular-nums',
            'text-[clamp(3rem,12vw,7rem)] leading-none',
            runningHere ? 'text-accent' : 'text-fg-tertiary',
          ].join(' ')}
          data-testid="focus-clock"
        >
          {runningHere && running !== null ? elapsedClock(running, now) : formatDuration(tracked)}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            appearance={runningHere ? 'standard' : 'accent'}
            icon={runningHere ? <Stop24Regular /> : <Play24Regular />}
            disabled={busy}
            onClick={toggle}
            className="h-12 px-6 text-body-lg"
          >
            {runningHere ? 'Stop' : tracked > 0 ? 'Resume' : 'Start'}
          </Button>
          <Button icon={<Checkmark20Regular />} disabled={busy} onClick={done}>
            Done
          </Button>
          <Button
            icon={<Next20Regular />}
            disabled={busy || next === null}
            onClick={() => {
              if (next !== null) onSwitch(next.id);
            }}
            title={next === null ? 'Nothing else is ready to start' : `Next: ${next.title}`}
          >
            Next
          </Button>
        </div>

        <p className="text-caption text-fg-tertiary">
          {describeQueue(all, edges, task.id)}
          {running !== null && !runningHere && ' The clock is on another task.'}
        </p>

        {failure !== null && failure !== undefined && (
          <InfoBar severity="danger" title="That did not work">
            {describeError(failure)}
          </InfoBar>
        )}
      </div>
    </Shell>
  );
}

/** The bare surface: a way out at the top, and the one thing in the middle. */
function Shell({ onLeave, children }: { onLeave: () => void; children?: ReactNode }) {
  return (
    <main
      className="flex min-h-0 flex-1 flex-col bg-layer"
      aria-label="Focus"
      data-testid="focus-screen"
    >
      <div className="flex items-center justify-between p-3">
        <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={onLeave}>
          Leave focus
        </Button>
        <span className="text-caption text-fg-tertiary">
          <Kbd>Esc</Kbd> leaves
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">{children}</div>
    </main>
  );
}
