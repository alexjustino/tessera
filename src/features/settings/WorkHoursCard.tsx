import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useSetWorkHours, useWorkHours } from '@/data/hooks';
import type { WorkHours } from '@/domain/calendar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { announce } from '@/ui/announce';

const DAYS = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
];

const DEFAULT_START = 9 * 60;
const DEFAULT_END = 17 * 60;

/** `540` → `09:00`, the way a time field wants it. */
function toClock(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** `09:00` → `540`, or null when it is not a time. */
function toMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The working week.
 *
 * Read since 1.1 by the year view's capacity and, now, by the review's
 * arithmetic — and until this slice there was no way to say what it was, so
 * everybody had the same Monday-to-Friday nine-to-five whether they worked it
 * or not.
 *
 * A day that is off is a day with no row, which is how a four-day week is
 * said. Nothing is written until Save: a half-typed hour would otherwise
 * change every figure on three other screens as it was typed.
 */
export function WorkHoursCard() {
  const hours = useWorkHours();
  const save = useSetWorkHours();
  const [draft, setDraft] = useState<WorkHours[] | null>(null);

  const stored = useMemo(() => hours.data ?? [], [hours.data]);
  const week = draft ?? stored;
  const dayOf = (weekday: number) => week.find((day) => day.weekday === weekday);

  const change = (next: WorkHours[]) => setDraft(next);
  const dirty = draft !== null;

  const complaint = week.some((day) => day.endsMinute <= day.startsMinute)
    ? 'A working day has to end after it starts.'
    : null;

  const toggle = (weekday: number, on: boolean) => {
    if (!on) {
      change(week.filter((day) => day.weekday !== weekday));
      return;
    }
    const previous = stored.find((day) => day.weekday === weekday);
    change(
      [
        ...week,
        {
          weekday,
          startsMinute: previous?.startsMinute ?? DEFAULT_START,
          endsMinute: previous?.endsMinute ?? DEFAULT_END,
        },
      ].sort((a, b) => a.weekday - b.weekday),
    );
  };

  const setTime = (weekday: number, which: 'startsMinute' | 'endsMinute', clock: string) => {
    const minutes = toMinutes(clock);
    if (minutes === null) return;
    change(week.map((day) => (day.weekday === weekday ? { ...day, [which]: minutes } : day)));
  };

  return (
    <Card
      title="Working hours"
      description="The week the calendar shades, the year view measures against, and the review counts. A day that is off has no hours."
    >
      <div className="flex flex-col gap-2">
        {hours.error !== null && (
          <InfoBar severity="danger" title="The working week could not be read">
            {describeError(hours.error)}
          </InfoBar>
        )}
        {save.error !== null && (
          <InfoBar severity="danger" title="The working week was not saved">
            {describeError(save.error)}
          </InfoBar>
        )}

        <ul className="flex flex-col gap-1">
          {DAYS.map(({ weekday, label }) => {
            const day = dayOf(weekday);
            return (
              <li key={weekday} className="flex items-center gap-3">
                <span className="w-28 shrink-0">
                  <Checkbox
                    checked={day !== undefined}
                    onChange={(on) => toggle(weekday, on)}
                    label={label}
                  />
                </span>
                <span className="w-24 text-body text-fg-secondary">{label}</span>
                {day === undefined ? (
                  <span className="text-caption text-fg-tertiary">Off</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${label} starts`}
                      value={toClock(day.startsMinute)}
                      className="w-28"
                      onChange={(event) => setTime(weekday, 'startsMinute', event.target.value)}
                    />
                    <span className="text-caption text-fg-tertiary">to</span>
                    <Input
                      type="time"
                      aria-label={`${label} ends`}
                      value={toClock(day.endsMinute)}
                      className="w-28"
                      onChange={(event) => setTime(weekday, 'endsMinute', event.target.value)}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {complaint !== null && (
          <p role="alert" className="text-caption text-danger">
            {complaint}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            appearance="accent"
            disabled={!dirty || complaint !== null || save.isPending}
            onClick={() =>
              save.mutate(week, {
                onSuccess: () => {
                  setDraft(null);
                  announce('Working hours saved');
                },
              })
            }
          >
            Save working hours
          </Button>
          {dirty && (
            <Button appearance="subtle" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
