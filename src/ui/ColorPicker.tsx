import { COLORS, SWATCH, type ColorId } from '@/domain/colors';

/**
 * Pick one of the named colours, or none. A radio group: the arrow keys move between
 * swatches, and each swatch says its name, so the choice is never colour alone.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  allowNone = true,
}: {
  value: ColorId | null;
  onChange: (color: ColorId | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const options: Array<{ id: ColorId | null; label: string }> = [
    ...(allowNone ? [{ id: null, label: 'No colour' }] : []),
    ...COLORS,
  ];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1.5"
      onKeyDown={(event) => {
        const step =
          event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -1
              : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = options[(selectedIndex + step + options.length) % options.length];
        if (next !== undefined) onChange(next.id);
      }}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={option.id ?? 'none'}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={[
              'grid size-8 place-items-center rounded-full border-2',
              checked ? 'border-fg' : 'border-transparent hover:border-stroke-strong',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'size-6 rounded-full',
                option.id === null
                  ? 'border border-dashed border-stroke-strong'
                  : SWATCH[option.id],
              ].join(' ')}
            />
          </button>
        );
      })}
    </div>
  );
}
