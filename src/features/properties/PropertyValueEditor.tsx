import { useState } from 'react';

import {
  checkValue,
  formatDuration,
  optionsOf,
  parseValueOrEmpty,
  type Property,
  type PropertyValue,
} from '@/domain/property';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * One editor, every property type.
 *
 * The dispatch lives here rather than being spread across the screens that use
 * it, so a new type is added in one place and every surface — the list, the
 * detail panel, and the board when it arrives — gains it at once.
 *
 * Nothing is written until it is valid. `checkValue` is stricter than the reader
 * on purpose: reading tolerates whatever history left behind, writing does not
 * create more of it.
 */
export function PropertyValueEditor({
  property,
  raw,
  onCommit,
  compact = false,
}: {
  property: Property;
  /** The stored JSON, as it came from the host. */
  raw: unknown;
  onCommit: (value: PropertyValue) => void;
  /** Inline in a row rather than in a panel: tighter, no label. */
  compact?: boolean;
}) {
  const value = parseValueOrEmpty(property, raw);

  switch (property.type) {
    case 'checkbox':
      return (
        <Checkbox
          checked={value === true}
          label={property.name}
          onChange={(checked) => onCommit(checked)}
        />
      );

    case 'select':
    case 'status':
    case 'priority':
      return (
        <OptionSelect property={property} value={value} onCommit={onCommit} compact={compact} />
      );

    case 'multi_select':
      return <MultiSelect property={property} value={value} onCommit={onCommit} />;

    case 'date':
      return (
        <NativeInput
          type="date"
          property={property}
          value={value}
          onCommit={onCommit}
          aria-label={property.name}
        />
      );

    case 'datetime':
      return <DateTimeInput property={property} value={value} onCommit={onCommit} />;

    case 'duration':
      return <DurationInput property={property} value={value} onCommit={onCommit} />;

    case 'number':
      return (
        <NativeInput
          type="number"
          property={property}
          value={value}
          onCommit={onCommit}
          aria-label={property.name}
        />
      );

    case 'url':
      return (
        <NativeInput
          type="url"
          property={property}
          value={value}
          onCommit={onCommit}
          placeholder="https://"
          aria-label={property.name}
        />
      );

    default:
      return (
        <NativeInput
          type="text"
          property={property}
          value={value}
          onCommit={onCommit}
          aria-label={property.name}
        />
      );
  }
}

// ── The editors ────────────────────────────────────────────────────────────

function OptionSelect({
  property,
  value,
  onCommit,
  compact,
}: {
  property: Property;
  value: PropertyValue;
  onCommit: (value: PropertyValue) => void;
  compact: boolean;
}) {
  const options = optionsOf(property);
  const current = value === null ? '' : String(value);
  // An option the property no longer offers is still shown, so a value written
  // before somebody edited the options does not vanish from the control.
  const orphaned = current !== '' && !options.some((option) => option.id === current);

  return (
    <Select
      value={current}
      aria-label={property.name}
      className={compact ? 'h-7 w-auto min-w-28 text-caption' : ''}
      onChange={(event) => onCommit(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">{compact ? `— ${property.name}` : '—'}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
      {orphaned && <option value={current}>{current} (removed)</option>}
    </Select>
  );
}

function MultiSelect({
  property,
  value,
  onCommit,
}: {
  property: Property;
  value: PropertyValue;
  onCommit: (value: PropertyValue) => void;
}) {
  const chosen = new Set((value as readonly string[]) ?? []);

  return (
    <div className="flex flex-wrap gap-2">
      {optionsOf(property).map((option) => {
        const on = chosen.has(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next = new Set(chosen);
              if (on) next.delete(option.id);
              else next.add(option.id);
              onCommit([...next]);
            }}
            className={[
              'rounded-sm border px-2 py-1 text-caption font-semibold transition-colors duration-100 ease-easy',
              on
                ? 'border-accent/30 bg-accent-subtle text-accent'
                : 'border-stroke-subtle bg-card text-fg-secondary hover:bg-card-hover',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
      {optionsOf(property).length === 0 && (
        <p className="text-caption text-fg-tertiary">
          This property has no options yet. Add some in Properties.
        </p>
      )}
    </div>
  );
}

/**
 * A text-shaped field that commits on blur or Enter, never on every keystroke.
 *
 * Committing per keystroke would write a partly-typed URL to the database and
 * show it as invalid while the person is still typing it.
 */
function NativeInput({
  property,
  value,
  onCommit,
  type,
  ...rest
}: {
  property: Property;
  value: PropertyValue;
  onCommit: (value: PropertyValue) => void;
  type: string;
  placeholder?: string;
  'aria-label'?: string;
}) {
  const asText = value === null ? '' : String(value);
  const [draft, setDraft] = useState(asText);
  const [lastStored, setLastStored] = useState(asText);
  const [problem, setProblem] = useState<string | null>(null);

  // Follow the stored value when it changes elsewhere — another screen, an undo
  // — but never while the field is being typed in.
  //
  // Adjusted during render rather than in an effect. Syncing a prop into state
  // from `useEffect` renders once with the stale value and then again with the
  // fresh one, which is both a visible flicker and the cascade React warns
  // about. Comparing here re-renders before anything is painted.
  if (lastStored !== asText) {
    setLastStored(asText);
    setDraft(asText);
  }

  const commit = () => {
    const typed: PropertyValue =
      draft.trim() === '' ? null : type === 'number' ? Number(draft) : draft;

    const result = checkValue(property, typed);
    if (result.status === 'invalid') {
      setProblem(result.reason);
      return;
    }
    setProblem(null);
    onCommit(result.value);
  };

  return (
    <div className="w-full">
      <Input
        type={type}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setProblem(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(asText);
            setProblem(null);
            event.currentTarget.blur();
          }
        }}
        aria-invalid={problem !== null}
        {...rest}
      />
      {problem && <p className="mt-1 text-caption text-danger">{problem}</p>}
    </div>
  );
}

/** An instant, edited in local time and stored in UTC (ADR-013). */
function DateTimeInput({
  property,
  value,
  onCommit,
}: {
  property: Property;
  value: PropertyValue;
  onCommit: (value: PropertyValue) => void;
}) {
  const local = value === null ? '' : toLocalInput(String(value));

  return (
    <Input
      type="datetime-local"
      value={local}
      aria-label={property.name}
      onChange={(event) => {
        const text = event.target.value;
        if (text === '') {
          onCommit(null);
          return;
        }
        // The control speaks local wall-clock time; the database speaks UTC.
        // Converting here, once, is what keeps that boundary honest.
        const instant = new Date(text);
        if (!Number.isNaN(instant.getTime())) onCommit(instant.toISOString());
      }}
    />
  );
}

/** `2026-09-02T17:30:00.000Z` as the `datetime-local` control wants it. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Minutes, entered in minutes, shown the way a person says them. */
function DurationInput({
  property,
  value,
  onCommit,
}: {
  property: Property;
  value: PropertyValue;
  onCommit: (value: PropertyValue) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <NativeInput
        type="number"
        property={property}
        value={value}
        onCommit={onCommit}
        aria-label={`${property.name} in minutes`}
      />
      <span className="shrink-0 text-caption text-fg-tertiary">
        {value === null ? 'minutes' : formatDuration(Number(value))}
      </span>
    </div>
  );
}
