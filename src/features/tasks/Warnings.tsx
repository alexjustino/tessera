import { Alert20Regular, Dismiss16Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useAddWarning, useRemoveWarning, useWarnings } from '@/data/hooks';
import { checkWarning, describeLead, fireAtFor, presetsLeft } from '@/domain/warnings';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

/**
 * The alarms before a task is due: as many as the deadline deserves, at the times
 * a person picks. Each one is a Windows notification of its own.
 */
export function Warnings({ itemId, dueAt }: { itemId: string; dueAt: string | null }) {
  const warnings = useWarnings(itemId, dueAt);
  const add = useAddWarning();
  const remove = useRemoveWarning();
  const [custom, setCustom] = useState('');
  const [complaint, setComplaint] = useState<string | null>(null);

  if (dueAt === null) {
    return (
      <p className="flex items-center gap-2 text-caption text-fg-tertiary">
        <Alert20Regular aria-hidden="true" />
        Give it a due time and you can set warnings to count down to it.
      </p>
    );
  }

  const now = new Date().toISOString();
  const all = warnings.data ?? [];
  const presets = presetsLeft(dueAt, now, all);
  const failure = warnings.error ?? add.error ?? remove.error;

  const addCustom = () => {
    const fireAt = custom === '' ? '' : new Date(custom).toISOString();
    const problem =
      custom === '' ? 'Pick a date and time first.' : checkWarning(fireAt, dueAt, now);
    setComplaint(problem);
    if (problem !== null) return;
    add.mutate({ itemId, fireAt }, { onSuccess: () => setCustom('') });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="warnings">
      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="That warning was not saved">
          {describeError(failure)}
        </InfoBar>
      )}

      {all.length === 0 ? (
        <p className="text-caption text-fg-tertiary">
          None set. Add as many as this deadline deserves, like alarms on a clock.
        </p>
      ) : (
        <ul aria-label="Warnings" className="flex flex-col gap-1">
          {all.map((warning) => (
            <li
              key={warning.id}
              className="flex items-center gap-2 rounded-md border border-stroke-subtle px-2 py-1"
            >
              <Alert20Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
              <span className="min-w-0 flex-1 text-body text-fg">
                {new Date(warning.fireAt).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                <span className="ml-2 text-caption text-fg-tertiary">
                  {warning.fired ? 'went off' : describeLead(warning.fireAt, dueAt)}
                </span>
              </span>
              {!warning.fired && (
                <IconButton
                  label={`Remove the warning at ${new Date(warning.fireAt).toLocaleString()}`}
                  icon={<Dismiss16Regular />}
                  onClick={() => remove.mutate(warning.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Add a warning">
          {presets.map((preset) => (
            <Button
              key={preset.id}
              disabled={add.isPending}
              onClick={() => add.mutate({ itemId, fireAt: fireAtFor(dueAt, preset.minutes) })}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          type="datetime-local"
          aria-label="A warning at this date and time"
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            setComplaint(null);
          }}
        />
        <Button disabled={add.isPending} onClick={addCustom}>
          Add warning
        </Button>
      </div>
      {complaint !== null && <p className="text-caption text-danger">{complaint}</p>}

      {all.some((warning) => !warning.fired) && (
        <p className="text-caption text-fg-tertiary">
          They move with the due time, and stop once the task is done.
        </p>
      )}
    </div>
  );
}
