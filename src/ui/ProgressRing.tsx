import type { ReactNode } from 'react';

/**
 * How far along something is, as a ring with the words in the middle.
 *
 * The share is drawn and the middle says it: never the colour or the arc alone.
 * `share` of null draws an even ring, for something with no finish line.
 */
export function ProgressRing({
  share,
  tone = 'accent',
  size = 'md',
  label,
  valueText,
  max,
  value,
  children,
}: {
  share: number | null;
  tone?: 'accent' | 'success' | 'danger';
  /** `lg` for the one figure a screen leads with. */
  size?: 'md' | 'lg';
  /** The accessible name. */
  label: string;
  /** The progress in words. */
  valueText: string;
  max?: number;
  value?: number;
  children: ReactNode;
}) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const measured = share !== null;

  return (
    <div
      role={measured ? 'progressbar' : 'img'}
      aria-label={label}
      aria-valuemin={measured ? 0 : undefined}
      aria-valuemax={measured ? max : undefined}
      aria-valuenow={measured ? value : undefined}
      aria-valuetext={measured ? valueText : undefined}
      className={`relative shrink-0 ${size === 'lg' ? 'size-24' : 'size-16'}`}
    >
      <svg viewBox="0 0 56 56" className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="4"
          className="stroke-card-hover"
        />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (share ?? 1))}
          className={[
            'transition-[stroke-dashoffset] duration-300 ease-easy',
            tone === 'success'
              ? 'stroke-success'
              : tone === 'danger'
                ? 'stroke-danger'
                : 'stroke-accent',
            measured ? '' : 'opacity-40',
          ].join(' ')}
        />
      </svg>
      <span
        className={[
          'absolute inset-0 flex items-center justify-center font-semibold text-fg',
          size === 'lg' ? 'text-title' : 'text-caption tabular-nums',
        ].join(' ')}
      >
        {children}
      </span>
    </div>
  );
}
