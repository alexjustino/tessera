/**
 * On or off, taking effect at once: the Windows switch.
 *
 * A checkbox says "this will be included"; a switch says "this is happening now",
 * which is what a setting saved as it is pressed means. The word beside it carries
 * the state too, so it is never the position alone.
 */
export function Toggle({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  /** The accessible name. */
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2 rounded-md text-body text-fg disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="w-6 text-right text-fg-secondary">{checked ? 'On' : 'Off'}</span>
      <span
        aria-hidden="true"
        className={[
          'relative h-5 w-10 rounded-full border transition-colors duration-150 ease-easy',
          checked ? 'border-accent bg-accent' : 'border-stroke-strong bg-transparent',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 size-3.5 rounded-full transition-all duration-150 ease-easy',
            checked ? 'left-[1.3rem] bg-fg-on-accent' : 'left-0.5 bg-fg-secondary',
          ].join(' ')}
        />
      </span>
    </button>
  );
}
