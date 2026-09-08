import { Add20Regular, Delete20Regular, Dismiss12Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCreateGoal,
  useDeleteGoal,
  useGoalLinks,
  useGoals,
  useItems,
  useLinkGoalItem,
  useTimeEntries,
  useUnlinkGoalItem,
  useUpdateGoal,
} from '@/data/hooks';
import { formatDuration } from '@/domain/criticalPath';
import {
  checkName,
  checkTarget,
  daysLeft,
  describeProgress,
  itemsOf,
  progressOf,
  remainingOf,
  shareOf,
  stateOf,
  MEASURES,
  type Goal,
  type Measure,
} from '@/domain/goal';
import { between } from '@/domain/ordering';
import { traceable, type Figure } from '@/domain/report';
import { systemZone } from '@/domain/schedule';
import { FigureRow } from '@/features/reports/FigureRow';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

/**
 * Goals — what you meant to get done, and how far it has got.
 *
 * The rule this screen exists to keep is P6's, applied to intent (ADR-024):
 * **the progress is the sum of its rows, and it opens onto them**. The number
 * beside a goal is the same `Figure` a report produces, drawn by the same
 * component, and pressing it lists the finished tasks or the time entries it
 * was added up from. A figure that does not add up shows a dash and says so
 * rather than showing a number nobody could check.
 */
export function GoalsPage() {
  const zone = useMemo(() => systemZone(), []);
  const goals = useGoals();
  const links = useGoalLinks();
  const items = useItems(null, true);
  const entries = useTimeEntries();

  // Ticks while a timer runs, so a goal counted in minutes grows on screen the
  // way the task it is being tracked against does.
  const running = (entries.data ?? []).some((entry) => entry.endedAt === null);
  const now = useNow(running ? 60_000 : null);

  const create = useCreateGoal();
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const link = useLinkGoalItem();
  const unlink = useUnlinkGoalItem();

  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Goal | null>(null);
  const [chosen, setChosen] = useState('');

  const all = useMemo(() => goals.data ?? [], [goals.data]);
  const open = all.find((goal) => goal.id === openId) ?? all[0] ?? null;

  const inside = useMemo(
    () => (open === null ? [] : itemsOf(open, links.data ?? [], items.data ?? [])),
    [open, links.data, items.data],
  );
  const figure = useMemo(
    () => (open === null ? null : progressOf(open, inside, entries.data ?? [], now, zone)),
    [open, inside, entries.data, now, zone],
  );
  const broken = figure !== null && !traceable(figure) ? [figure] : [];

  const offerable = useMemo(() => {
    const already = new Set(inside.map((item) => item.id));
    return (items.data ?? []).filter((item) => !already.has(item.id));
  }, [items.data, inside]);

  const add = () => {
    const taken = new Set(all.map((goal) => goal.name.trim().toLocaleLowerCase()));
    let name = 'New goal';
    for (let n = 2; taken.has(name.toLocaleLowerCase()); n += 1) name = `New goal ${n}`;
    create.mutate(
      {
        name,
        measure: 'tasks',
        target: 5,
        dueDay: null,
        position: between(all.at(-1)?.position ?? null, null),
      },
      {
        onSuccess: (goal) => {
          setOpenId(goal.id);
          announce(`${goal.name} created`);
        },
      },
    );
  };

  const failure =
    goals.error ?? links.error ?? create.error ?? update.error ?? remove.error ?? link.error;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-title font-semibold text-fg">Goals</h1>
        <Button icon={<Add20Regular />} onClick={add}>
          New goal
        </Button>
      </header>

      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="That did not work">
          {describeError(failure)}
        </InfoBar>
      )}

      {all.length === 0 ? (
        <EmptyState
          title="No goals yet"
          description="A goal is a number to reach and the tasks that count towards it. Its progress is only ever the sum of those tasks — nothing here keeps a total of its own."
          action={
            <Button icon={<Add20Regular />} onClick={add}>
              New goal
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {all.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              open={goal.id === open?.id}
              items={itemsOf(goal, links.data ?? [], items.data ?? [])}
              entries={entries.data ?? []}
              now={now}
              zone={zone}
              onOpen={() => setOpenId(goal.id === open?.id ? '' : goal.id)}
              onDelete={() => setConfirming(goal)}
            >
              {goal.id === open?.id && figure !== null && (
                <div className="flex flex-col gap-4 border-t border-stroke-subtle pt-3">
                  <FigureRow figure={{ ...figure, label: 'Progress' }} broken={broken} big />

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-fg-tertiary">Name</span>
                      <Input
                        aria-label="Goal name"
                        defaultValue={goal.name}
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name === goal.name || checkName(name) !== null) {
                            event.target.value = goal.name;
                            return;
                          }
                          update.mutate({ id: goal.id, patch: { name } });
                        }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-fg-tertiary">Counting</span>
                      <Select
                        aria-label="What this goal counts"
                        value={goal.measure}
                        className="w-auto"
                        onChange={(event) =>
                          update.mutate({
                            id: goal.id,
                            patch: { measure: event.target.value as Measure },
                          })
                        }
                      >
                        {MEASURES.map((measure) => (
                          <option key={measure.id} value={measure.id}>
                            {measure.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-fg-tertiary">
                        Target {goal.measure === 'minutes' ? '(minutes)' : '(tasks)'}
                      </span>
                      <Input
                        aria-label="Target"
                        type="number"
                        min={1}
                        step={1}
                        defaultValue={String(goal.target)}
                        className="w-28"
                        onBlur={(event) => {
                          const target = Number(event.target.value);
                          if (target === goal.target || checkTarget(target) !== null) {
                            event.target.value = String(goal.target);
                            return;
                          }
                          update.mutate({ id: goal.id, patch: { target } });
                        }}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-fg-tertiary">By</span>
                      <Input
                        aria-label="Due day"
                        type="date"
                        defaultValue={goal.dueDay ?? ''}
                        className="w-40"
                        onChange={(event) =>
                          update.mutate({
                            id: goal.id,
                            patch: {
                              dueDay: event.target.value === '' ? null : event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>

                  <section aria-label="Tasks in this goal">
                    <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">
                      Tasks in this goal
                    </h3>
                    {inside.length === 0 ? (
                      <p className="mb-2 text-body text-fg-tertiary">
                        Nothing counts towards it yet.
                      </p>
                    ) : (
                      <ul className="mb-2 flex flex-col gap-0.5">
                        {inside.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-card-hover"
                          >
                            <span className="min-w-0 flex-1 truncate text-body text-fg">
                              {item.title}
                            </span>
                            {item.completedAt !== null && (
                              <span className="text-caption text-success">done</span>
                            )}
                            <IconButton
                              label={`Take ${item.title} out of ${goal.name}`}
                              icon={<Dismiss12Regular />}
                              onClick={() => unlink.mutate({ goalId: goal.id, itemId: item.id })}
                            />
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex items-center gap-2">
                      <Select
                        aria-label="Add a task to this goal"
                        value={chosen}
                        onChange={(event) => setChosen(event.target.value)}
                      >
                        <option value="">Add a task…</option>
                        {offerable.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </Select>
                      <Button
                        disabled={chosen === ''}
                        onClick={() => {
                          if (chosen === '') return;
                          link.mutate(
                            { goalId: goal.id, itemId: chosen },
                            { onSuccess: () => setChosen('') },
                          );
                        }}
                      >
                        Add
                      </Button>
                    </div>
                  </section>
                </div>
              )}
            </GoalCard>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={`Delete ${confirming?.name ?? 'this goal'}?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming === null) return;
          const name = confirming.name;
          remove.mutate(confirming.id, {
            onSuccess: () => {
              setConfirming(null);
              announce(`${name} deleted`);
            },
          });
        }}
      >
        The goal goes; the tasks in it stay exactly as they are. A goal keeps no work of its own —
        only the intention, and which rows counted for it.
      </ConfirmDialog>
    </div>
  );
}

/** One goal in the list: its name, where it stands, and a bar. */
function GoalCard({
  goal,
  open,
  items,
  entries,
  now,
  zone,
  onOpen,
  onDelete,
  children,
}: {
  goal: Goal;
  open: boolean;
  items: ReturnType<typeof itemsOf>;
  entries: Parameters<typeof progressOf>[2];
  now: string;
  zone: string;
  onOpen: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const figure: Figure = progressOf(goal, items, entries, now, zone);
  const share = shareOf(figure, goal);
  const state = stateOf(figure, goal, now, zone);
  const left = daysLeft(goal, now, zone);
  const hours = (minutes: number) => formatDuration(minutes);

  const says =
    state === 'achieved'
      ? 'Achieved'
      : state === 'overdue'
        ? `${Math.abs(left ?? 0)} ${Math.abs(left ?? 0) === 1 ? 'day' : 'days'} past its date`
        : state === 'due'
          ? `${left} ${left === 1 ? 'day' : 'days'} left`
          : `${remainingOf(figure, goal)} to go`;

  return (
    <li>
      <Card>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? 'Close' : 'Open'} ${goal.name}`}
              onClick={onOpen}
              className="min-w-0 flex-1 truncate text-left text-body-lg font-semibold text-fg"
            >
              {goal.name}
            </button>
            <span
              className={[
                'shrink-0 text-caption',
                state === 'achieved'
                  ? 'text-success'
                  : state === 'overdue'
                    ? 'text-danger'
                    : 'text-fg-tertiary',
              ].join(' ')}
            >
              {says}
            </span>
            <IconButton
              label={`Delete ${goal.name}`}
              icon={<Delete20Regular />}
              onClick={onDelete}
            />
          </div>

          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={`${goal.name} progress`}
              aria-valuemin={0}
              aria-valuemax={goal.target}
              aria-valuenow={figure.value}
              aria-valuetext={describeProgress(figure, goal, hours)}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-card-hover"
            >
              <div
                className={[
                  'h-full rounded-full transition-[width] duration-200 ease-easy',
                  state === 'achieved' ? 'bg-success' : 'bg-accent',
                ].join(' ')}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-caption tabular-nums text-fg-secondary">
              {describeProgress(figure, goal, hours)}
            </span>
          </div>

          {children}
        </div>
      </Card>
    </li>
  );
}
