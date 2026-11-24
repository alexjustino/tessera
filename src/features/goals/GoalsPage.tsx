import {
  Add20Regular,
  CheckmarkCircle16Regular,
  ChevronDown20Regular,
  ChevronUp20Regular,
  Clock16Regular,
  Delete20Regular,
  Dismiss12Regular,
  Target16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
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
import { calibrationOf, forecastGoals, type Forecast } from '@/domain/confidence';
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
import { seriesOf } from '@/domain/mosaicHistory';
import { between } from '@/domain/ordering';
import { traceable, type Figure } from '@/domain/report';
import { systemZone } from '@/domain/schedule';
import { ForecastLine } from '@/features/receipt/ForecastLine';
import { useLedger } from '@/features/receipt/useLedger';
import { FigureRow } from '@/features/reports/FigureRow';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Page } from '@/ui/Page';
import { ProgressRing } from '@/ui/ProgressRing';
import { Select } from '@/ui/Select';
import { Stat, StatRow } from '@/ui/Stat';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

/** The easy question first: is there a finish line at all? */
const GOAL_KINDS = ['target', 'ongoing'] as const;
const GOAL_KIND_LABELS = { target: 'Until I reach a target', ongoing: 'Ongoing focus' };

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

  // When each goal would be done, on the estimates as typed and — with
  // history enough — as a range (M2). One projection for the whole page.
  const ledger = useLedger(now);
  const { forecasts, sample } = useMemo(() => {
    if (ledger === null) return { forecasts: new Map<string, Forecast>(), sample: 0 };
    const calibration = calibrationOf(ledger.items, ledger.tracked);
    return {
      forecasts: new Map(
        forecastGoals(ledger, calibration).map((forecast) => [forecast.goalId, forecast]),
      ),
      sample: calibration.sample,
    };
  }, [ledger]);

  const create = useCreateGoal();
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const link = useLinkGoalItem();
  const unlink = useUnlinkGoalItem();

  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Goal | null>(null);
  const [chosen, setChosen] = useState('');

  const all = useMemo(() => goals.data ?? [], [goals.data]);
  // Cards first, so the page reads as scores: one opens when it is pressed. A lone
  // goal has nothing to be compact beside, so it opens by itself.
  const open =
    all.find((goal) => goal.id === openId) ??
    (all.length === 1 && openId !== '' ? (all[0] ?? null) : null);
  const series = useMemo(() => seriesOf(all), [all]);

  // How the goals stand together: the figures at the top of the page.
  const standing = useMemo(() => {
    let achieved = 0;
    let late = 0;
    let onTrack = 0;
    let week = 0;
    for (const goal of all) {
      const held = itemsOf(goal, links.data ?? [], items.data ?? []);
      const reading = progressOf(goal, held, entries.data ?? [], now, zone);
      const state = stateOf(reading, goal, now, zone);
      const forecast = forecasts.get(goal.id);
      if (state === 'achieved') achieved += 1;
      else if (
        state === 'overdue' ||
        (goal.dueDay !== null &&
          forecast !== undefined &&
          (forecast.plain === null || forecast.plain > goal.dueDay))
      ) {
        late += 1;
      } else onTrack += 1;
      week += goal.weeklyMinutes ?? 0;
    }
    return { achieved, late, onTrack, week };
  }, [all, links.data, items.data, entries.data, now, zone, forecasts]);

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
    <Page>
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

      {all.length > 0 && (
        <StatRow label="How the goals stand">
          <Stat
            testId="goals-track"
            label="On track"
            icon={<Target16Regular />}
            value={standing.onTrack}
            note={`Of ${all.length} ${all.length === 1 ? 'goal' : 'goals'}`}
          />
          <Stat
            testId="goals-late"
            label="At risk"
            icon={<Warning16Regular />}
            value={standing.late}
            tone={standing.late > 0 ? 'danger' : 'neutral'}
            note={standing.late > 0 ? 'Past or heading past the date' : 'Nothing heading late'}
          />
          <Stat
            testId="goals-achieved"
            label="Achieved"
            icon={<CheckmarkCircle16Regular />}
            value={standing.achieved}
            tone={standing.achieved > 0 ? 'success' : 'neutral'}
            note={standing.achieved > 0 ? 'Reached' : 'None yet'}
          />
          <Stat
            testId="goals-week"
            label="Promised each week"
            icon={<Clock16Regular />}
            value={standing.week === 0 ? '—' : hoursSaid(standing.week)}
            note={standing.week === 0 ? 'No goal holds a weekly budget' : 'Across the goals'}
          />
        </StatRow>
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
        <ul className="grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
          {all.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              open={goal.id === open?.id}
              items={itemsOf(goal, links.data ?? [], items.data ?? [])}
              entries={entries.data ?? []}
              now={now}
              zone={zone}
              forecast={forecasts.get(goal.id) ?? null}
              sample={sample}
              slot={series.get(goal.id)}
              onOpen={() => setOpenId(goal.id === open?.id ? '' : goal.id)}
              onDelete={() => setConfirming(goal)}
            >
              {goal.id === open?.id && figure !== null && (
                <div className="flex flex-col gap-4 border-t border-stroke-subtle pt-3">
                  <FigureRow figure={{ ...figure, label: 'Progress' }} broken={broken} big />

                  <div className="flex flex-wrap items-start gap-3">
                    <label className="flex min-w-64 flex-1 flex-col gap-1">
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
                    <div className="flex flex-col gap-1">
                      <ChoiceGroup
                        label="How long it runs"
                        options={GOAL_KINDS}
                        labels={GOAL_KIND_LABELS}
                        value={goal.ongoing === true ? 'ongoing' : 'target'}
                        onChange={(kind) =>
                          update.mutate({
                            id: goal.id,
                            patch:
                              kind === 'ongoing'
                                ? { ongoing: true, dueDay: null }
                                : { ongoing: false },
                          })
                        }
                      />
                    </div>
                    {goal.ongoing !== true && (
                      <>
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
                          <span className="text-caption text-fg-tertiary">By (optional)</span>
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
                      </>
                    )}
                  </div>

                  <details className="group/details">
                    <summary className="cursor-pointer text-body text-fg-secondary hover:text-fg">
                      More details
                    </summary>
                    <div className="mt-3 flex flex-wrap items-start gap-3">
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
                          Hours each week (optional) — the goal&apos;s envelope in the Mosaic
                        </span>
                        <Input
                          aria-label="Hours each week"
                          type="number"
                          min={0}
                          max={168}
                          step={0.5}
                          placeholder="No envelope"
                          defaultValue={
                            goal.weeklyMinutes === null || goal.weeklyMinutes === undefined
                              ? ''
                              : String(goal.weeklyMinutes / 60)
                          }
                          className="w-40"
                          onBlur={(event) => {
                            const text = event.target.value.trim();
                            const hours = Number(text);
                            const minutes =
                              text === '' || hours === 0 ? null : Math.round(hours * 60);
                            if (
                              minutes !== null &&
                              (!Number.isFinite(hours) || hours < 0 || hours > 168)
                            ) {
                              event.target.value =
                                goal.weeklyMinutes === null || goal.weeklyMinutes === undefined
                                  ? ''
                                  : String(goal.weeklyMinutes / 60);
                              return;
                            }
                            if (minutes === (goal.weeklyMinutes ?? null)) return;
                            update.mutate({ id: goal.id, patch: { weeklyMinutes: minutes } });
                          }}
                        />
                      </label>
                    </div>
                  </details>

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
    </Page>
  );
}

function hoursSaid(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * One goal: closed it is a card with its score and how it stands, pressed it opens
 * across the row with everything that can be changed.
 */
function GoalCard({
  goal,
  open,
  items,
  entries,
  now,
  zone,
  forecast,
  sample,
  slot,
  onOpen,
  onDelete,
  children,
}: {
  /** Which colour the goal wears, the one its tiles have in the Mosaic. */
  slot: number | undefined;
  goal: Goal;
  open: boolean;
  items: ReturnType<typeof itemsOf>;
  entries: Parameters<typeof progressOf>[2];
  now: string;
  zone: string;
  /** When it would be done, if it has open estimated work (M2). */
  forecast: Forecast | null;
  sample: number;
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
    state === 'ongoing'
      ? 'Ongoing focus, no end date'
      : state === 'achieved'
        ? 'Achieved'
        : state === 'overdue'
          ? `${Math.abs(left ?? 0)} ${Math.abs(left ?? 0) === 1 ? 'day' : 'days'} past its date`
          : state === 'due'
            ? `${left} ${left === 1 ? 'day' : 'days'} left`
            : `${goal.measure === 'minutes' ? hours(remainingOf(figure, goal)) : remainingOf(figure, goal)} to go`;

  return (
    <li className={open ? 'col-span-full' : ''} data-goal={goal.id}>
      <div
        className="rounded-xl border-l-4 border-l-transparent"
        style={slot === undefined ? undefined : { borderLeftColor: `var(--series-${slot})` }}
      >
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <ProgressRing
                share={goal.ongoing === true ? null : share}
                tone={state === 'achieved' ? 'success' : 'accent'}
                label={`${goal.name} progress`}
                valueText={describeProgress(figure, goal, hours)}
                max={goal.target}
                value={figure.value}
              >
                {goal.ongoing === true
                  ? goal.measure === 'minutes'
                    ? hours(figure.value)
                    : figure.value
                  : `${Math.round(share * 100)}%`}
              </ProgressRing>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? 'Close' : 'Open'} ${goal.name}`}
                  onClick={onOpen}
                  className="flex w-full items-center gap-1 text-left text-body-lg font-semibold text-fg"
                >
                  <span className="min-w-0 truncate">{goal.name}</span>
                  <span aria-hidden="true" className="shrink-0 text-fg-tertiary">
                    {open ? <ChevronUp20Regular /> : <ChevronDown20Regular />}
                  </span>
                </button>
                <p className="truncate text-caption tabular-nums text-fg-secondary">
                  {describeProgress(figure, goal, hours)}
                </p>
                <p
                  className={[
                    'text-caption',
                    state === 'achieved'
                      ? 'text-success'
                      : state === 'overdue'
                        ? 'text-danger'
                        : 'text-fg-tertiary',
                  ].join(' ')}
                >
                  {says}
                </p>
              </div>
              {open && (
                <IconButton
                  label={`Delete ${goal.name}`}
                  icon={<Delete20Regular />}
                  onClick={onDelete}
                />
              )}
            </div>

            {open && forecast !== null && state !== 'achieved' && state !== 'ongoing' && (
              <ForecastLine forecast={forecast} sample={sample} dueDay={goal.dueDay} />
            )}

            {children}
          </div>
        </Card>
      </div>
    </li>
  );
}
