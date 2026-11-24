/** What a meter's fill means. The words beside it say the same thing. */
export type MeterTone = 'accent' | 'success' | 'caution' | 'danger' | 'neutral';

const FILL: Record<MeterTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  caution: 'bg-caution',
  danger: 'bg-danger',
  neutral: 'bg-stroke-strong',
};

/**
 * How much of something is used: a thin bar with a track behind it.
 *
 * It says nothing on its own. The caller writes the figure beside it, and the
 * spoken value is the same sentence.
 */
export function Meter({
  value,
  max,
  label,
  valueText,
  tone = 'accent',
  className = '',
}: {
  value: number;
  max: number;
  /** The accessible name. */
  label: string;
  /** The reading, in words. */
  valueText: string;
  tone?: MeterTone;
  className?: string;
}) {
  const share = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(max, 0)}
      aria-valuenow={Math.max(0, Math.min(value, Math.max(max, 0)))}
      aria-valuetext={valueText}
      className={`h-1.5 overflow-hidden rounded-full bg-card-active ${className}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-easy ${FILL[tone]}`}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  );
}
