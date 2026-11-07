import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useCalendars, useCloseDay, useDayReviews, useReplan } from '@/data/hooks';
import { addLocalDays, todayIn } from '@/domain/calendar';
import type { Pulse } from '@/domain/pulse';
import { journalEntry, movesTo } from '@/domain/ritual';
import { systemZone } from '@/domain/schedule';
import { describeHours } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * Close the day (ADR-061): what got done, what goes to tomorrow, and a line about the
 * day for the journal. The day's record keeps its score, so the days can be read back.
 */
export function CloseTheDay({ pulse, onClose }: { pulse: Pulse; onClose: () => void }) {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const tomorrow = addLocalDays(today, 1);
  const week = useDayReviews(addLocalDays(today, -6));
  const calendars = useCalendars();
  const replan = useReplan();
  const close = useCloseDay();

  const open = useMemo(() => [...pulse.overdue, ...pulse.due], [pulse.overdue, pulse.due]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [carry, setCarry] = useState<ReadonlySet<string>>(
    () => new Set(open.filter((item) => item.recurrenceRule === null).map((item) => item.id)),
  );
  const [carried, setCarried] = useState(0);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const busy = replan.isPending || close.isPending;

  const carryOver = async () => {
    setProblem(null);
    try {
      const { moves } = movesTo(
        open.filter((item) => carry.has(item.id)),
        tomorrow,
        zone,
        now,
      );
      if (moves.length > 0) {
        await replan.mutateAsync({
          calendarId: calendars.data?.[0]?.id ?? 'personal',
          tz: zone,
          changes: moves,
        });
        announce(`${moves.length === 1 ? '1 task' : `${moves.length} tasks`} moved to tomorrow`);
      }
      setCarried(moves.length);
      setStep(3);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const finish = () => {
    setProblem(null);
    const figures = {
      score: pulse.score,
      done: pulse.done.length,
      carried,
      trackedMinutes: pulse.tracked,
    };
    close.mutate(
      {
        day: today,
        close: { ...figures, note },
        journal: journalEntry(
          today,
          { done: figures.done, tracked: figures.trackedMinutes, score: figures.score, carried },
          note,
        ),
      },
      {
        onSuccess: () => {
          announce('The day is closed');
          onClose();
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  const history = (week.data ?? []).filter(
    (review) => review.day !== today && review.score !== null,
  );

  return (
    <Modal open label="Close the day" onClose={onClose} width="lg">
      <div className="flex flex-col gap-4 p-5" data-testid="close-the-day">
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="text-body-lg font-semibold text-fg">Close the day</h2>
          <span className="text-caption text-fg-secondary">Step {step} of 3</span>
        </header>

        {step === 1 && (
          <section aria-label="What got done" className="flex flex-col gap-3">
            <p className="text-body text-fg" data-testid="day-done">
              {pulse.done.length === 0
                ? 'Nothing was finished today.'
                : `${pulse.done.length === 1 ? '1 task' : `${pulse.done.length} tasks`} finished`}
              {pulse.tracked > 0 ? `, ${describeHours(pulse.tracked)} on the clock` : ''}
              {pulse.score === null
                ? '.'
                : `. Today stands at ${pulse.score}: ${pulse.word ?? ''}.`}
            </p>
            {pulse.done.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-body text-fg-secondary">
                {pulse.done.map((item) => (
                  <li key={item.id} className="truncate">
                    ✓ {item.title}
                  </li>
                ))}
              </ul>
            )}
            {history.length > 0 && (
              <p className="text-caption text-fg-secondary" data-testid="day-history">
                The days before:{' '}
                {history.map((review) => `${shortDay(review.day)} ${review.score}`).join(' · ')}
              </p>
            )}
            <div className="flex justify-end">
              <Button appearance="accent" onClick={() => setStep(open.length > 0 ? 2 : 3)}>
                Next
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-label="Not finished" className="flex flex-col gap-3">
            <p className="text-body text-fg-secondary">
              Not finished. The ticked ones move to tomorrow, at the same time of day.
            </p>
            <ul className="flex flex-col gap-1">
              {open.map((item) => (
                <li key={item.id} className="flex items-center gap-2" data-carry={item.id}>
                  <Checkbox
                    checked={carry.has(item.id)}
                    disabled={item.recurrenceRule !== null}
                    label={`Move ${item.title} to tomorrow`}
                    onChange={(checked) =>
                      setCarry((all) => {
                        const next = new Set(all);
                        if (checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-fg">{item.title}</span>
                  {item.recurrenceRule !== null && (
                    <span className="text-caption text-fg-secondary">repeats, keeps its date</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-1">
              <Button appearance="subtle" disabled={busy} onClick={() => setStep(3)}>
                Leave them
              </Button>
              <Button
                appearance="accent"
                disabled={busy || carry.size === 0}
                onClick={() => void carryOver()}
              >
                Move {carry.size === 1 ? '1' : carry.size} to tomorrow
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section aria-label="A line about today" className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-caption text-fg-secondary">
              A line about today, for your journal in Notes
              <textarea
                aria-label="A line about today"
                value={note}
                maxLength={2000}
                rows={3}
                onChange={(event) => setNote(event.target.value)}
                className={[
                  'w-full rounded-md border border-stroke bg-card px-3 py-2 text-body text-fg',
                  'border-b-2 border-b-stroke-strong focus:border-b-accent focus:outline-none',
                ].join(' ')}
              />
            </label>
            <div className="flex justify-end">
              <Button appearance="accent" disabled={busy} onClick={finish}>
                Close the day
              </Button>
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
