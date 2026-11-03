import type { ReactNode } from 'react';

import { Sparkline } from './Sparkline';

/** How a figure stands. Carried by the word in `note` too, never by the colour alone. */
export type StatTone = 'neutral' | 'success' | 'caution' | 'danger';

const NOTE_TONE: Record<StatTone, string> = {
  neutral: 'text-fg-tertiary',
  success: 'text-success',
  caution: 'text-caution',
  danger: 'text-danger',
};

/**
 * One number and what it is: the tile every dashboard in the product is made of.
 *
 * Given `onPress` it is a toggle, because a figure a person can act on should
 * not make them go looking for the control that does the same thing.
 */
export function Stat({
  label,
  value,
  note,
  tone = 'neutral',
  icon,
  trend,
  trendLabel,
  onPress,
  pressed,
  testId,
}: {
  label: string;
  value: ReactNode;
  /** A short phrase under the number: what it is measured against. */
  note?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
  /** The last few readings, oldest first. */
  trend?: readonly number[];
  /** What the trend shows, in words. Required with `trend`. */
  trendLabel?: string;
  onPress?: () => void;
  pressed?: boolean;
  testId?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-caption text-fg-secondary">
        {icon !== undefined && (
          <span aria-hidden="true" className="flex shrink-0 text-fg-tertiary">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1 flex items-end justify-between gap-2 overflow-hidden">
        <span
          className="shrink-0 text-title font-semibold whitespace-nowrap text-fg"
          data-testid="stat-value"
        >
          {value}
        </span>
        {trend !== undefined && trend.length > 1 && (
          <Sparkline values={trend} label={trendLabel ?? label} className="mb-1.5 min-w-0" />
        )}
      </span>
      {note !== undefined && (
        <span className={`mt-0.5 block truncate text-caption ${NOTE_TONE[tone]}`}>{note}</span>
      )}
    </>
  );

  const frame = 'block min-w-0 rounded-xl border bg-card p-3 text-left shadow-card';

  if (onPress === undefined) {
    return (
      <div className={`${frame} border-stroke-subtle`} data-testid={testId}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={pressed === true}
      onClick={onPress}
      data-testid={testId}
      className={[
        frame,
        'w-full transition-colors duration-100 ease-easy hover:bg-card-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        pressed === true ? 'border-accent ring-1 ring-accent' : 'border-stroke-subtle',
      ].join(' ')}
    >
      {body}
    </button>
  );
}

/** Stat tiles in a row that wraps, each as wide as the row allows. */
export function StatRow({
  children,
  label,
  columns,
}: {
  children: ReactNode;
  label: string;
  /** Hold to this many across when there is room, so a short last row leaves no hole. */
  columns?: 3;
}) {
  return (
    <section
      aria-label={label}
      className={[
        'grid gap-2',
        columns === 3
          ? 'grid-cols-2 lg:grid-cols-3'
          : '[grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]',
      ].join(' ')}
    >
      {children}
    </section>
  );
}
