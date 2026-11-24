import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCalendars,
  useCreateTimeBlock,
  useMarkPlanned,
  useReplan,
  useSetItemCompleted,
} from '@/data/hooks';
import { suggestPlan } from '@/domain/autoPlan';
import type { LedgerInput } from '@/domain/receipt';
import { addLocalDays, todayIn } from '@/domain/calendar';
import type { Item } from '@/domain/item';
import type { Pulse } from '@/domain/pulse';
import { assumedIn, movesTo, weigh, workLeft } from '@/domain/ritual';
import { systemZone } from '@/domain/schedule';
import { useLedger } from '@/features/receipt/useLedger';
import { describeHours } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';
import { Meter } from '@/ui/Meter';
import { Modal } from '@/ui/Modal';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

type Choice = 'today' | 'tomorrow' | 'done';

function clockOf(instant: string): string {
  return new Date(instant).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** The suggested plan's pieces today, for the work due today and nothing else. */
function blocksForToday(ledger: LedgerInput | null, due: readonly Item[], today: string) {
  if (ledger === null) return [];
  const dueIds = new Set(due.map((item) => item.id));
  const leaveOut = new Set(ledger.items.filter((item) => !dueIds.has(item.id)).map((i) => i.id));
  return suggestPlan(ledger, { leaveOut, horizonDays: 1 }).suggestions.filter(
    (piece) => piece.day === today,
  );
}

/**
 * Plan my day (ADR-061): what was left from before, today against the time it has, and
 * today's work on the calendar. Nothing is written until a step's button is pressed.
 */
export function PlanMyDay({ pulse, onClose }: { pulse: Pulse; onClose: () => void }) {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const tomorrow = addLocalDays(today, 1);
  const ledger = useLedger(now);
  const calendars = useCalendars();
  const replan = useReplan();
  const complete = useSetItemCompleted();
  const reserve = useCreateTimeBlock();
  const planned = useMarkPlanned();

  const left = pulse.overdue;
  const [step, setStep] = useState<1 | 2 | 3>(left.length > 0 ? 1 : 2);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const choiceOf = (item: Item): Choice => choices[item.id] ?? 'today';
  const calendarId = calendars.data?.[0]?.id ?? 'personal';
  const tracked = ledger?.tracked ?? new Map<string, number>();

  const work = workLeft(pulse.due, tracked);
  const { fits, overBy } = weigh(work, pulse.free);

  // Left to the React compiler to keep between renders, as the rest of the screen is.
  const suggestions = blocksForToday(ledger, pulse.due, today);

  const busy = replan.isPending || complete.isPending || reserve.isPending || planned.isPending;

  const settleLeft = async () => {
    setProblem(null);
    try {
      for (const item of left.filter((one) => choiceOf(one) === 'done')) {
        await complete.mutateAsync({ id: item.id, completed: true });
      }
      const toToday = movesTo(
        left.filter((one) => choiceOf(one) === 'today'),
        today,
        zone,
        now,
      );
      const toTomorrow = movesTo(
        left.filter((one) => choiceOf(one) === 'tomorrow'),
        tomorrow,
        zone,
        now,
      );
      const changes = [...toToday.moves, ...toTomorrow.moves];
      if (changes.length > 0) await replan.mutateAsync({ calendarId, tz: zone, changes });
      announce('What was left is sorted');
      setStep(2);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const toTomorrow = async (item: Item) => {
    const { moves } = movesTo([item], tomorrow, zone, now);
    if (moves.length === 0) return;
    await replan.mutateAsync({ calendarId, tz: zone, changes: moves });
    announce(`${item.title} moved to tomorrow`);
  };

  const finish = async (withBlocks: boolean) => {
    setProblem(null);
    try {
      if (withBlocks) {
        for (const piece of suggestions) {
          await reserve.mutateAsync({
            itemId: piece.itemId,
            calendarId,
            startsAt: piece.startsAt,
            endsAt: piece.endsAt,
            tz: zone,
          });
        }
      }
      await planned.mutateAsync(today);
      announce(
        withBlocks
          ? `Your day is planned, ${suggestions.length} blocks reserved`
          : 'Your day is planned',
      );
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Modal open label="Plan my day" onClose={onClose} width="lg">
      <div className="flex flex-col gap-4 p-5" data-testid="plan-my-day">
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="text-body-lg font-semibold text-fg">Plan my day</h2>
          <span className="text-caption text-fg-secondary">Step {step} of 3</span>
        </header>

        {step === 1 && (
          <section aria-label="Left from before" className="flex flex-col gap-3">
            <p className="text-body text-fg-secondary">
              {left.length === 1 ? '1 task was' : `${left.length} tasks were`} due before today.
              Keep each for today, move it to tomorrow, or say it is done.
            </p>
            <ul className="flex flex-col gap-2">
              {left.map((item) => (
                <li
                  key={item.id}
                  data-left={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stroke-subtle px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-body text-fg">{item.title}</span>
                  <ChoiceGroup<Choice>
                    label={`What to do with ${item.title}`}
                    hideLabel
                    options={['today', 'tomorrow', 'done']}
                    labels={{ today: 'Today', tomorrow: 'Tomorrow', done: 'Done' }}
                    value={choiceOf(item)}
                    onChange={(next) => setChoices((all) => ({ ...all, [item.id]: next }))}
                  />
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button appearance="accent" disabled={busy} onClick={() => void settleLeft()}>
                Next
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-label="Today" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-body text-fg" data-testid="day-weight">
                {pulse.due.length === 0
                  ? 'Nothing is due today.'
                  : `${describeHours(work)} of work, ${describeHours(pulse.free)} free today.`}
              </p>
              {assumedIn(pulse.due) > 0 && (
                <span className="text-caption text-fg-secondary">
                  {assumedIn(pulse.due)} with no estimate count as an hour each.
                </span>
              )}
            </div>
            {pulse.due.length > 0 && (
              <Meter
                value={Math.min(work, pulse.free)}
                max={Math.max(work, pulse.free, 1)}
                label="Today's work against its free time"
                valueText={`${describeHours(work)} of work, ${describeHours(pulse.free)} free`}
                tone={fits ? 'accent' : 'caution'}
              />
            )}
            {!fits && (
              <InfoBar severity="caution" title={`${describeHours(overBy)} more than today has`}>
                Move something to tomorrow, and the day becomes one you can finish.
              </InfoBar>
            )}
            <ul className="flex flex-col gap-1">
              {pulse.due.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-card-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-body text-fg">{item.title}</span>
                  <span className="text-caption tabular-nums text-fg-secondary">
                    {item.estimateMinutes === null
                      ? 'no estimate'
                      : describeHours(item.estimateMinutes)}
                  </span>
                  <Button
                    appearance="subtle"
                    disabled={busy || item.recurrenceRule !== null}
                    title={
                      item.recurrenceRule !== null ? 'A repeating task keeps its date' : undefined
                    }
                    onClick={() => void toTomorrow(item)}
                  >
                    Tomorrow
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button appearance="accent" disabled={busy} onClick={() => setStep(3)}>
                Next
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section aria-label="On the calendar" className="flex flex-col gap-3">
            {suggestions.length === 0 ? (
              <p className="text-body text-fg-secondary">
                Today&apos;s work already has its time, or there is no free time left today.
              </p>
            ) : (
              <>
                <p className="text-body text-fg-secondary">
                  Today&apos;s work fits here. Reserve it, and the calendar holds the time.
                </p>
                <ul className="flex flex-col gap-1" aria-label="Blocks to reserve">
                  {suggestions.map((piece) => (
                    <li key={piece.key} className="flex gap-3 text-body">
                      <span className="w-28 shrink-0 tabular-nums text-fg-secondary">
                        {clockOf(piece.startsAt)}–{clockOf(piece.endsAt)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-fg">{piece.title}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="flex flex-wrap justify-end gap-1">
              <Button appearance="subtle" disabled={busy} onClick={() => void finish(false)}>
                {suggestions.length === 0 ? 'Done' : 'Plan without reserving'}
              </Button>
              {suggestions.length > 0 && (
                <Button appearance="accent" disabled={busy} onClick={() => void finish(true)}>
                  Reserve {suggestions.length === 1 ? '1 block' : `${suggestions.length} blocks`}
                </Button>
              )}
            </div>
          </section>
        )}

        {problem !== null && (
          <InfoBar severity="danger" title="That did not work">
            {problem}
          </InfoBar>
        )}
      </div>
    </Modal>
  );
}
