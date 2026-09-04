import { Alert20Regular, Pause20Regular, Play20Regular } from '@fluentui/react-icons';

import { describeError } from '@/data/errors';
import {
  useDismissReminder,
  usePauseReminders,
  useReminderStatus,
  useResumeReminders,
  useSnoozeReminder,
} from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

/**
 * The alert pipeline, shown rather than asserted.
 *
 * What is queued and whether the queue is paused. The queue is the scheduler's own list, read back — if it says a
 * reminder will fire at nine, that is because the loop will sleep until nine.
 */
export function RemindersCard() {
  const status = useReminderStatus();
  const pause = usePauseReminders();
  const resume = useResumeReminders();
  const snooze = useSnoozeReminder();
  const dismiss = useDismissReminder();

  const failure = status.error ?? pause.error;
  const paused = status.data?.pausedUntil ?? null;

  return (
    <Card
      title="Reminders"
      description="Native Windows notifications, with Complete, Snooze and Open on them. The window can be closed; the tray keeps them coming."
      actions={
        paused === null ? (
          <Button
            appearance="subtle"
            icon={<Pause20Regular />}
            onClick={() => pause.mutate(60)}
            disabled={pause.isPending}
          >
            Pause for 1 hour
          </Button>
        ) : (
          <Button
            appearance="accent"
            icon={<Play20Regular />}
            onClick={() => resume.mutate()}
            disabled={resume.isPending}
          >
            Resume
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {failure && (
          <InfoBar severity="danger" title="The reminder pipeline did not answer">
            {describeError(failure)}
          </InfoBar>
        )}

        {paused !== null && (
          <InfoBar severity="caution" title="Reminders are paused">
            Until {new Date(paused).toLocaleTimeString()}. Anything that comes due meanwhile fires
            when the pause lifts.
          </InfoBar>
        )}

        <div>
          <p className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">Queued</p>
          {status.data === undefined ? (
            <div className="h-10 animate-pulse rounded-md bg-card-hover" aria-hidden="true" />
          ) : status.data.pending.length === 0 ? (
            <p className="text-body text-fg-tertiary">
              Nothing queued. Set a due time and a reminder on a task and it appears here.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {status.data.pending.slice(0, 8).map((reminder) => (
                <li
                  key={reminder.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-card-hover"
                >
                  <Alert20Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
                  <span className="min-w-0 flex-1 truncate text-body text-fg">
                    {reminder.title || 'Reminder'}
                  </span>
                  <span className="shrink-0 text-caption text-fg-tertiary">
                    {new Date(reminder.fireAt).toLocaleString()}
                  </span>
                  <Button
                    appearance="subtle"
                    onClick={() => snooze.mutate({ id: reminder.id, minutes: 60 })}
                  >
                    +1h
                  </Button>
                  <Button appearance="subtle" onClick={() => dismiss.mutate(reminder.id)}>
                    Dismiss
                  </Button>
                </li>
              ))}
              {status.data.pending.length > 8 && (
                <li className="px-2 text-caption text-fg-tertiary">
                  and {status.data.pending.length - 8} more
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
