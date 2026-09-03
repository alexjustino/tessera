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

import { fromLocalInput, toLocalInput } from './localTime';

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
              if (dueAt === null) {
                onChange({ ...schedule, dueAt: null, rule: null, remindAt: null });
                return;
              }
              // A reminder set "one hour before" moves with the due time. Left
              // where it was, it would fire an hour before the *old* time.
              const lead = leadOf(schedule);
              onChange({ ...schedule, dueAt, remindAt: remindAtFor(dueAt, lead) });
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

      <Field label="Remind me">
        <Select
          value={leadOf(schedule)}
          aria-label="When to be reminded"
          disabled={schedule.dueAt === null}
          onChange={(event) =>
            onChange({ ...schedule, remindAt: remindAtFor(schedule.dueAt, event.target.value) })
          }
        >
          {LEADS.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.label}
            </option>
          ))}
        </Select>
        {schedule.dueAt === null && (
          <p className="mt-1 text-caption text-fg-tertiary">
            A reminder needs a due time to count back from.
          </p>
        )}
        {schedule.remindAt !== null && (
          <p className="mt-1 text-caption text-fg-tertiary">
            A Windows notification at {new Date(schedule.remindAt).toLocaleString()} — with
            Complete, Snooze and Open on it.
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

/**
 * How far ahead of the due time the reminder fires.
 *
 * Stored as an absolute `remindAt` rather than as a lead, because the
 * scheduler sleeps until an instant and should not have to know about due
 * dates. The lead is recovered from the two instants for the control.
 */
const LEADS: ReadonlyArray<{ id: string; label: string; minutesBefore: number | null }> = [
  { id: 'none', label: 'No reminder', minutesBefore: null },
  { id: 'at', label: 'At the due time', minutesBefore: 0 },
  { id: '15m', label: '15 minutes before', minutesBefore: 15 },
  { id: '1h', label: '1 hour before', minutesBefore: 60 },
  { id: '1d', label: 'The day before', minutesBefore: 24 * 60 },
];

function remindAtFor(dueAt: string | null, leadId: string): string | null {
  const lead = LEADS.find((candidate) => candidate.id === leadId);
  if (dueAt === null || lead === undefined || lead.minutesBefore === null) return null;
  return new Date(new Date(dueAt).getTime() - lead.minutesBefore * 60_000).toISOString();
}

function leadOf(schedule: Schedule): string {
  if (schedule.remindAt === null || schedule.dueAt === null) return 'none';
  const minutes = Math.round(
    (new Date(schedule.dueAt).getTime() - new Date(schedule.remindAt).getTime()) / 60_000,
  );
  return LEADS.find((lead) => lead.minutesBefore === minutes)?.id ?? 'at';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">{label}</p>
      {children}
    </div>
  );
}
