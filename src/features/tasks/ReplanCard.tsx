import {
  ArrowRepeatAll20Regular,
  ArrowUndo20Regular,
  CalendarArrowRight20Regular,
  CheckmarkCircle20Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import type { ReplanUndo } from '@/data/items';
import { useCalendars, useReplan, useUndoReplan } from '@/data/hooks';
import { todayIn } from '@/domain/calendar';
import { planReplan, type Left, type ReplanChange } from '@/domain/replan';
import { systemZone } from '@/domain/schedule';
import { useLedger } from '@/features/receipt/useLedger';
import { describeDay } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

/** How many moves are listed before the rest are counted. */
const SHOWN = 5;

function clockOf(instant: string): string {
  return new Date(instant).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function whenOf(instant: string, zone: string, today: string): string {
  const day = todayIn(instant, zone);
  return `${day === today ? 'Today' : describeDay(day)} ${clockOf(instant)}`;
}

const names = (left: readonly Left[]) => left.map((task) => task.title).join(', ');

/**
 * Replan in one press (ADR-052): what would move, said before anything does, then
 * one press that moves it all, and one that puts it all back.
 *
 * Shown only while something is late, or while the last replan can still be undone.
 */
export function ReplanCard({ compact = false }: { compact?: boolean }) {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const ledger = useLedger(now);
  const calendars = useCalendars();
  const replan = useReplan();
  const undo = useUndoReplan();
  const [done, setDone] = useState<{ undo: ReplanUndo; moved: ReplanChange[] } | null>(null);

  const plan = useMemo(() => (ledger === null ? null : planReplan(ledger, now)), [ledger, now]);
  const calendarId = calendars.data?.[0]?.id;

  if (done !== null) {
    return (
      <section
        aria-label="Replanned"
        data-testid="replan-done"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-success/30 bg-success-subtle px-4 py-3"
      >
        <CheckmarkCircle20Regular aria-hidden="true" className="shrink-0 text-success" />
        <p className="min-w-48 flex-1 text-body text-fg">
          {done.moved.length === 1 ? 'Moved 1 late task' : `Moved ${done.moved.length} late tasks`}{' '}
          to free time, with their dates.
        </p>
        <Button
          icon={<ArrowUndo20Regular />}
          disabled={undo.isPending}
          onClick={() =>
            undo.mutate(done.undo, {
              onSuccess: () => {
                setDone(null);
                announce('Put back as it was');
              },
            })
          }
        >
          Undo
        </Button>
        <Button appearance="subtle" onClick={() => setDone(null)}>
          Dismiss
        </Button>
        {undo.error !== null && (
          <div className="w-full">
            <InfoBar severity="danger" title="That could not be undone">
              {describeError(undo.error)}
            </InfoBar>
          </div>
        )}
      </section>
    );
  }

  if (plan === null) return null;
  const late =
    plan.changes.length + plan.noRoom.length + plan.repeating.length + plan.waiting.length;
  if (late === 0) return null;

  const assumed = plan.changes.filter((change) => change.assumed).length;
  const short = plan.changes.filter((change) => change.short).length;
  const label =
    plan.changes.length === 1 ? 'Replan 1 late task' : `Replan ${plan.changes.length} late tasks`;

  return (
    <section
      aria-label="Late work"
      data-testid="replan"
      className={[
        'flex flex-col gap-2 rounded-xl border border-caution/40 bg-caution-subtle',
        compact ? 'p-3' : 'px-4 py-3',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <CalendarArrowRight20Regular aria-hidden="true" className="shrink-0 text-caution" />
        <div className="min-w-40 flex-1">
          <p className="text-caption font-semibold text-fg uppercase">
            {late === 1 ? '1 task is late' : `${late} tasks are late`}
          </p>
          {plan.changes.length > 0 && (
            <p className="text-caption text-fg-secondary">
              One press gives each the next free time and moves its date there. Nothing changes
              until you press.
            </p>
          )}
        </div>
        {plan.changes.length > 0 && calendarId !== undefined && (
          <Button
            appearance="accent"
            icon={<ArrowRepeatAll20Regular />}
            disabled={replan.isPending}
            onClick={() =>
              replan.mutate(
                { calendarId, tz: zone, changes: plan.changes },
                {
                  onSuccess: (undoData) => {
                    setDone({ undo: undoData, moved: plan.changes });
                    announce(label.replace('Replan', 'Replanned'));
                  },
                },
              )
            }
          >
            {label}
          </Button>
        )}
      </div>

      {plan.changes.length > 0 && (
        <ul aria-label="What would move" className="flex flex-col gap-0.5 text-caption">
          {plan.changes.slice(0, SHOWN).map((change) => (
            <li key={change.itemId} data-replan={change.itemId} className="text-fg-secondary">
              <span className="font-semibold text-fg">{change.title}</span>
              {' → '}
              {change.blocks[0] !== undefined
                ? `${whenOf(change.blocks[0].startsAt, zone, today)}${
                    change.blocks.length > 1 ? ` and ${change.blocks.length - 1} more` : ''
                  }, due ${whenOf(change.dueAt, zone, today)}`
                : `already has time set aside; due ${whenOf(change.dueAt, zone, today)}`}
            </li>
          ))}
          {plan.changes.length > SHOWN && (
            <li className="text-fg-tertiary">and {plan.changes.length - SHOWN} more</li>
          )}
        </ul>
      )}

      <ul className="flex flex-col gap-0.5 text-caption text-fg-secondary">
        {assumed > 0 && (
          <li>{assumed === 1 ? '1 has' : `${assumed} have`} no estimate, so an hour is assumed.</li>
        )}
        {short > 0 && (
          <li>{short === 1 ? '1 does' : `${short} do`} not fit whole in the next three weeks.</li>
        )}
        {plan.repeating.length > 0 && (
          <li>Left as they are, because they repeat: {names(plan.repeating)}.</li>
        )}
        {plan.waiting.length > 0 && (
          <li>Left as they are, waiting on work that is not late: {names(plan.waiting)}.</li>
        )}
        {plan.noRoom.length > 0 && (
          <li className="text-danger">
            No free time in the next three weeks for: {names(plan.noRoom)}.
          </li>
        )}
      </ul>

      {replan.error !== null && (
        <InfoBar severity="danger" title="Nothing was moved">
          {describeError(replan.error)}
        </InfoBar>
      )}
    </section>
  );
}
