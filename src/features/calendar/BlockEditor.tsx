import { Open20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { describeHours } from '@/features/reports/format';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';

const LENGTHS = [15, 30, 60, 90, 120, 240];

export interface BlockFields {
  title: string;
  day: string;
  /** Minutes from local midnight. */
  minute: number;
  minutes: number;
}

function toClock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function toMinute(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * A block of time, pressed: when it is and how long it lasts, in fields.
 *
 * The same form for a block on the calendar and for a suggestion, because to a
 * person they are one thing with one question. Saving a suggestion is what makes it
 * a reservation (ADR-046). A block that is time for a task takes its name from the
 * task, so the name is only editable on an event of its own.
 */
export function BlockEditor({
  initial,
  suggested,
  titleEditable,
  pending,
  onSave,
  onDelete,
  onOpenTask,
  onClose,
}: {
  initial: BlockFields;
  /** It is only a suggestion so far. */
  suggested: boolean;
  titleEditable: boolean;
  pending: boolean;
  onSave: (fields: BlockFields) => void;
  /** Delete the block, or leave a suggestion out of the plan. */
  onDelete: () => void;
  /** Absent when the block is not time for a task that is still open. */
  onOpenTask?: (() => void) | undefined;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [day, setDay] = useState(initial.day);
  const [clock, setClock] = useState(toClock(initial.minute));
  const [minutes, setMinutes] = useState(initial.minutes);

  const minute = toMinute(clock);
  const fits = minute !== null && minute + minutes <= 24 * 60 && minutes >= 5;
  const ready = fits && day !== '' && (!titleEditable || title.trim() !== '');

  return (
    <Modal open label={suggested ? 'Suggested time' : 'Edit this block'} onClose={onClose}>
      <form
        className="flex flex-col gap-3 p-4"
        data-testid="block-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && minute !== null) {
            onSave({ title: title.trim(), day, minute, minutes });
          }
        }}
      >
        <h2 className="text-body-lg font-semibold text-fg">
          {suggested ? 'Suggested time' : 'Edit this block'}
        </h2>

        {titleEditable ? (
          <label className="flex flex-col gap-1 text-caption text-fg-secondary">
            Name
            <Input
              autoFocus
              aria-label="Name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        ) : (
          <p className="truncate text-body font-semibold text-fg" title={initial.title}>
            {initial.title}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-caption text-fg-secondary">
            Day
            <Input
              type="date"
              aria-label="Day"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-fg-secondary">
            Starts
            <Input
              type="time"
              aria-label="Starts"
              value={clock}
              onChange={(event) => setClock(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-fg-secondary">
            Minutes
            <Input
              type="number"
              aria-label="Length in minutes"
              min={5}
              step={5}
              className="w-24"
              value={String(minutes)}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="How long it lasts">
          {LENGTHS.map((length) => (
            <Button
              key={length}
              appearance={length === minutes ? 'accent' : 'standard'}
              aria-pressed={length === minutes}
              onClick={() => setMinutes(length)}
            >
              {describeHours(length)}
            </Button>
          ))}
        </div>

        {!fits && (
          <p role="alert" className="text-caption text-danger">
            A block has to start and end on the same day.
          </p>
        )}
        {suggested && (
          <p className="text-caption text-fg-tertiary">
            Nothing is reserved until you press Reserve this time.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex gap-1">
            <Button appearance="subtle" onClick={onDelete}>
              {suggested ? 'Leave out of the plan' : 'Delete'}
            </Button>
            {onOpenTask !== undefined && (
              <Button appearance="subtle" icon={<Open20Regular />} onClick={onOpenTask}>
                Open the task
              </Button>
            )}
          </div>
          <div className="flex gap-1">
            <Button appearance="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" appearance="accent" disabled={!ready || pending}>
              {suggested ? 'Reserve this time' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
