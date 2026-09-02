import { CalendarClock20Regular, Dismiss16Regular } from '@fluentui/react-icons';

import {
  COMMON_RULES,
  formatDue,
  isValidRule,
  systemZone,
  type RecurrenceMode,
  type Schedule,
} from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * When a task is due, and whether it comes back.
 *
 * The one conversion in the product between wall-clock and instant happens
 * here: the controls speak the local time a person reads off a wall, and the
 * database speaks UTC (ADR-013). Doing it in one place is what keeps the
 * boundary honest.
 */
export function ScheduleEditor({
  schedule,
  now,
  onChange,
}: {
  schedule: Schedule;
  now: string;
  onChange: (schedule: Schedule) => void;
}) {
  const zone = systemZone();

  return (
    <div className="flex flex-col gap-3">
      <Field label="Due">
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={toLocalInput(schedule.dueAt)}
            aria-label="Due date and time"
            onChange={(event) => {
              const dueAt = fromLocalInput(event.target.value);
              // Clearing the date clears the repetition with it: a rule with
              // nothing to repeat from is a rule that repeats from nowhere, and
              // the host refuses it anyway.
              onChange(
                dueAt === null ? { ...schedule, dueAt: null, rule: null } : { ...schedule, dueAt },
              );
            }}
          />
          {schedule.dueAt !== null && (
            <IconButton
              label="Clear the due date"
              icon={<Dismiss16Regular />}
              onClick={() => onChange({ ...schedule, dueAt: null, rule: null })}
            />
          )}
        </div>
        {schedule.dueAt !== null && (
          <p className="mt-1 flex items-center gap-1 text-caption text-fg-tertiary">
            <CalendarClock20Regular aria-hidden="true" />
            {formatDue(schedule.dueAt, now, zone)}
          </p>
        )}
      </Field>

      <Field label="Start">
        <Input
          type="datetime-local"
          value={toLocalInput(schedule.startAt)}
          aria-label="Start date and time"
          onChange={(event) =>
            onChange({ ...schedule, startAt: fromLocalInput(event.target.value) })
          }
        />
      </Field>

      <Field label="Repeat">
        <Select
          value={schedule.rule ?? ''}
          aria-label="How often this repeats"
          disabled={schedule.dueAt === null}
          onChange={(event) =>
            onChange({ ...schedule, rule: event.target.value === '' ? null : event.target.value })
          }
        >
          <option value="">Does not repeat</option>
          {COMMON_RULES.map((option) => (
            <option key={option.rule} value={option.rule}>
              {option.label}
            </option>
          ))}
          {/* A rule stored by another build, or written by hand, stays
              selectable rather than being silently replaced. */}
          {schedule.rule !== null &&
            !COMMON_RULES.some((option) => option.rule === schedule.rule) && (
              <option value={schedule.rule}>
                {isValidRule(schedule.rule) ? schedule.rule : `${schedule.rule} (unreadable)`}
              </option>
            )}
        </Select>
        {schedule.dueAt === null && (
          <p className="mt-1 text-caption text-fg-tertiary">
            Give it a date first — a repetition needs something to repeat from.
          </p>
        )}
      </Field>

      {schedule.rule !== null && (
        <Field label="Counting from">
          <div className="flex flex-col gap-1.5">
            {(
              [
                ['schedule', 'The calendar', 'Every Monday, whether or not last Monday got done.'],
                [
                  'after_completion',
                  'When I finish it',
                  'Three days after I actually do it. What maintenance work means.',
                ],
              ] as Array<[RecurrenceMode, string, string]>
            ).map(([mode, label, explanation]) => (
              <label key={mode} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="recurrence-mode"
                  checked={schedule.mode === mode}
                  onChange={() => onChange({ ...schedule, mode })}
                  className="mt-1 accent-[var(--accent-base)]"
                />
                <span>
                  <span className="block text-body text-fg">{label}</span>
                  <span className="block text-caption text-fg-tertiary">{explanation}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}

      {(schedule.dueAt !== null || schedule.startAt !== null || schedule.rule !== null) && (
        <Button
          appearance="subtle"
          onClick={() =>
            onChange({ startAt: null, dueAt: null, remindAt: null, rule: null, mode: 'schedule' })
          }
        >
          Clear the schedule
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">{label}</p>
      {children}
    </div>
  );
}

/**
 * An instant, as the `datetime-local` control wants it.
 *
 * The control has no concept of a zone: it shows and returns wall-clock digits.
 * Converting on both sides, here, is what stops a due date drifting by the
 * offset every time somebody opens the panel.
 */
export function toLocalInput(instant: string | null): string {
  if (instant === null) return '';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** What the control returned, back to an instant. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
