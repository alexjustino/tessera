import { Delete20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useDaysOff, useRemoveDayOff, useSetDayOff } from '@/data/hooks';
import { describeDay } from '@/features/reports/format';
import { useGuideAnswer } from '@/features/guide/useGuideAnswer';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { announce } from '@/ui/announce';

/** A day with its year, for a list that spans years. */
function describeYearDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return `${describeDay(day)}, ${new Date(year!, month! - 1, date!).getFullYear()}`;
}

/**
 * Days off (M3): holidays, leave, a closed office — weekdays in the working
 * week that have no working hours this time.
 *
 * Every screen that counts capacity reads this list, so a day added here
 * stops having hours in the year view, the review, the report and the
 * receipt at once. A day off is not an event: it has no time and does not
 * repeat; next year's holiday is next year's line.
 */
export function DaysOffCard() {
  const daysOff = useDaysOff();
  const set = useSetDayOff();
  const remove = useRemoveDayOff();
  const answer = useGuideAnswer();
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');

  const add = () => {
    if (day === '') return;
    set.mutate(
      { day, label },
      {
        onSuccess: (row) => {
          answer({ guideDaysOffSet: true });
          announce(`${describeYearDay(row.day)} is a day off`);
          setDay('');
          setLabel('');
        },
      },
    );
  };

  const failure = daysOff.error ?? set.error ?? remove.error;
  const rows = daysOff.data ?? [];

  return (
    <Card
      title="Days off"
      description="Holidays and leave. A day off has no working hours anywhere Tessera counts them — the year, the review, the reports and the price of a change."
    >
      <div className="flex flex-col gap-3">
        {failure !== null && failure !== undefined && (
          <InfoBar severity="danger" title="That did not work">
            {describeError(failure)}
          </InfoBar>
        )}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-fg-secondary">
            Day
            <span className="w-44">
              <Input
                type="date"
                aria-label="Day off"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </span>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-fg-secondary">
            Name (optional)
            <Input
              aria-label="What the day off is"
              value={label}
              placeholder="Christmas, leave, office closed…"
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={day === '' || set.isPending}>
            Add day off
          </Button>
        </form>

        {rows.length === 0 ? (
          <p className="text-caption text-fg-tertiary">
            No days off yet. Every day of the working week has its hours.
          </p>
        ) : (
          <ul aria-label="Days off" className="flex flex-col gap-1">
            {rows.map((row) => (
              <li
                key={row.day}
                data-day-off={row.day}
                className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-card-hover"
              >
                <span className="w-40 shrink-0 text-body tabular-nums text-fg">
                  {describeYearDay(row.day)}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-fg-secondary">
                  {row.label === '' ? 'Day off' : row.label}
                </span>
                <IconButton
                  label={`Make ${describeYearDay(row.day)} a working day again`}
                  icon={<Delete20Regular />}
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(row.day, {
                      onSuccess: () =>
                        announce(`${describeYearDay(row.day)} is a working day again`),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
