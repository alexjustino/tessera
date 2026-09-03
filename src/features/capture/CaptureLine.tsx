import { Dismiss12Regular } from '@fluentui/react-icons';
import { useMemo, type FormEvent } from 'react';

import { parseCapture, withoutChip, type Capture, type Chip as ParsedChip } from '@/domain/capture';
import { checkTitle } from '@/domain/item';
import { systemZone } from '@/domain/schedule';
import { Chip } from '@/ui/Chip';
import type { ChipTone } from '@/ui/chipTone';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

/**
 * One line that becomes a task: the input, and the chips that show what the
 * line was understood as — before anything is written.
 *
 * The same component sits at the top of Tasks and inside the quick-capture
 * window, so the grammar behaves identically wherever a person types. A chip
 * can be removed; its words go back into the title in brackets, which the
 * parser leaves alone.
 */
export function CaptureLine({
  value,
  onChange,
  onSubmit,
  placeholder = 'Add a task — try "Call Bob tomorrow at 9am !high"',
  label = 'New task',
  autoFocus = false,
  disabled = false,
  hint = true,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (capture: Capture) => void;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Show the grammar hint under an empty line. */
  hint?: boolean;
  /** Rendered at the end of the input row — usually the submit button. */
  children?: (state: { ready: boolean }) => React.ReactNode;
}) {
  // `now` is read at render: the chips must say "Today" for today, and a line
  // left open across midnight re-labels itself on the next keystroke.
  const capture = useMemo(
    () => parseCapture(value, new Date().toISOString(), systemZone()),
    [value],
  );
  const check = checkTitle(capture.title);
  const ready = check.status === 'ok' && !disabled;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({ ...capture, title: check.title });
  };

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={2100}
          autoComplete="off"
          spellCheck={false}
        />
        {children?.({ ready })}
      </form>

      {capture.chips.length > 0 && (
        <ul aria-label="Understood as" className="flex flex-wrap gap-1.5">
          {capture.chips.map((chip) => (
            <li key={`${chip.kind}-${chip.start}`}>
              <Chip tone={toneOf(chip, capture)} title={`"${chip.text}" → ${chip.label}`}>
                <span className="text-fg-tertiary">{KIND_LABEL[chip.kind]}</span>
                {chip.label}
                <button
                  type="button"
                  aria-label={`Keep "${chip.text}" in the title`}
                  onClick={() => onChange(withoutChip(value, chip))}
                  className="-mr-0.5 ml-0.5 grid size-4 place-items-center rounded-sm hover:bg-card-active"
                >
                  <Dismiss12Regular aria-hidden="true" />
                </button>
              </Chip>
            </li>
          ))}
        </ul>
      )}

      {check.status === 'too-long' && (
        <InfoBar severity="caution" title="That title is too long">
          {check.length.toLocaleString()} characters. The limit is 2,000.
        </InfoBar>
      )}

      {check.status === 'empty' && value.trim().length > 0 && capture.chips.length > 0 && (
        <p className="text-caption text-fg-tertiary">
          Everything was read as a date or a rule — the task still needs a name.
        </p>
      )}

      {hint && value.length === 0 && (
        <p className="text-caption text-fg-tertiary">
          Dates, times, repeats, priority and reminders in plain words:{' '}
          <span className="text-fg-secondary">tomorrow at 9am</span> ·{' '}
          <span className="text-fg-secondary">every friday</span> ·{' '}
          <span className="text-fg-secondary">in 3 days</span> ·{' '}
          <span className="text-fg-secondary">!high</span> ·{' '}
          <span className="text-fg-secondary">remind me 15m before</span>
        </p>
      )}
    </div>
  );
}

const KIND_LABEL: Record<ParsedChip['kind'], string> = {
  date: 'Due',
  time: 'At',
  repeat: 'Repeat',
  priority: 'Priority',
  remind: 'Remind',
};

function toneOf(chip: ParsedChip, capture: Capture): ChipTone {
  switch (chip.kind) {
    case 'priority':
      return capture.priority === 'urgent'
        ? 'danger'
        : capture.priority === 'high'
          ? 'caution'
          : 'info';
    case 'repeat':
      return 'accent';
    case 'remind':
      return 'success';
    default:
      return 'info';
  }
}
