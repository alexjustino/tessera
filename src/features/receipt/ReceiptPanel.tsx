import type { Forecast } from '@/domain/confidence';
import { isFree, type GoalShift, type Receipt, type Shift } from '@/domain/receipt';
import { describeDay } from '@/features/reports/format';
import { InfoBar } from '@/ui/InfoBar';

import { ForecastLine } from './ForecastLine';

/**
 * The receipt for a change that has not been saved yet (M1).
 *
 * It says what saying yes would cost — free time claimed, and every task and
 * goal that would land on a different day — and nothing else. It has no
 * buttons: the decision stays with the field the person is typing in, and
 * leaving the field the way it was costs nothing (SPEC 1.3, "show the cost;
 * never decide").
 *
 * Every line names its task or goal, so the receipt carries the rows it was
 * made from (ADR-024). Lateness is said in words beside the dates, never by
 * colour alone.
 */
export function ReceiptPanel({
  receipt,
  forecast = null,
  sample = 0,
}: {
  receipt: Receipt | null;
  /** The changed task's own finish as a range (M2), when there is one. */
  forecast?: Forecast | null;
  /** How many finished tasks the range stands on. */
  sample?: number;
}) {
  if (receipt === null) {
    return (
      <p className="text-caption text-fg-tertiary" data-testid="receipt-loading">
        Working out what this costs…
      </p>
    );
  }

  const late =
    receipt.own.late ||
    receipt.shifts.some((shift) => shift.becameLate) ||
    receipt.goals.some((goal) => goal.becameLate);

  return (
    <section aria-label="What this would cost" data-testid="receipt">
      <InfoBar
        severity={isFree(receipt) ? 'success' : late ? 'caution' : 'info'}
        title={headlineOf(receipt)}
      >
        <div className="flex flex-col gap-2">
          <p data-testid="receipt-cost">{costOf(receipt.costMinutes)}</p>
          {ownLineOf(receipt) !== null && <p data-testid="receipt-own">{ownLineOf(receipt)}</p>}
          {forecast !== null && <ForecastLine forecast={forecast} sample={sample} rangeOnly />}

          {receipt.shifts.length > 0 && (
            <div>
              <p className="font-semibold">Tasks that would move</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {receipt.shifts.map((shift) => (
                  <li key={shift.itemId} data-testid="receipt-shift" data-item={shift.itemId}>
                    {lineOf(shift.title, shift)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {receipt.goals.length > 0 && (
            <div>
              <p className="font-semibold">Goals that would move</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {receipt.goals.map((goal) => (
                  <li key={goal.goalId} data-testid="receipt-goal" data-goal={goal.goalId}>
                    {lineOf(goal.name, goal)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {receipt.unestimated > 0 && (
            <p className="text-fg-tertiary">
              {receipt.unestimated} open {receipt.unestimated === 1 ? 'task has' : 'tasks have'} no
              estimate and {receipt.unestimated === 1 ? 'is' : 'are'} not counted.
            </p>
          )}

          <p className="text-fg-tertiary">
            Nothing has changed yet. This is what saving would cost, counted over your working hours
            and calendar until {describeYearDay(receipt.horizonEnd)}.
          </p>
        </div>
      </InfoBar>
    </section>
  );
}

/**
 * A day with its year. The horizon is a year away, and without the year
 * "Sun, Oct 31" reads as this week — the capture of the first build showed
 * exactly that.
 */
function describeYearDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function headlineOf(receipt: Receipt): string {
  if (isFree(receipt)) return 'It fits. Nothing else moves.';
  const parts: string[] = [];
  if (receipt.shifts.length > 0) parts.push(plural(receipt.shifts.length, 'task', 'tasks'));
  if (receipt.goals.length > 0) parts.push(plural(receipt.goals.length, 'goal', 'goals'));
  const nowLate =
    receipt.shifts.filter((shift) => shift.becameLate).length +
    receipt.goals.filter((goal) => goal.becameLate).length;
  if (parts.length === 0) return 'This task would finish late.';
  return `Moves ${parts.join(' and ')}${nowLate > 0 ? ` — ${nowLate} would be late` : ''}.`;
}

/**
 * Hours and minutes, never days: the receipt talks about the free time in the
 * person's own working days, and a "day" of eight hours would not be theirs.
 */
function hoursOf(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function costOf(minutes: number): string {
  if (minutes > 0) return `Claims ${hoursOf(minutes)} of free time.`;
  if (minutes < 0) return `Gives back ${hoursOf(-minutes)} of free time.`;
  return 'Claims no free time.';
}

function ownLineOf(receipt: Receipt): string | null {
  const { finish, dueDay, late } = receipt.own;
  if (finish === null && !late) return null;
  if (finish === null) return 'This task would not fit in the next year of working hours.';
  if (late && dueDay !== null) {
    return `This task would finish ${describeDay(finish)}, after it is due on ${describeDay(dueDay)} — late.`;
  }
  return `This task would finish ${describeDay(finish)}.`;
}

function lineOf(name: string, shift: Shift | GoalShift): string {
  const before = shift.before === null ? 'no finish' : describeDay(shift.before);
  if (shift.after === null) {
    return `${name}: ${before} → no longer fits in the next year${shift.becameLate ? ' — late' : ''}`;
  }
  const days =
    shift.days === null
      ? ''
      : ` (${shift.days > 0 ? '+' : '−'}${plural(Math.abs(shift.days), 'day', 'days')})`;
  return `${name}: ${before} → ${describeDay(shift.after)}${days}${shift.becameLate ? ' — late' : ''}`;
}
