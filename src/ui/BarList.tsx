import type { ReactNode } from 'react';

import { Meter, type MeterTone } from './Meter';

export interface BarRow {
  id: string;
  label: ReactNode;
  /** What the row is called when spoken. */
  name: string;
  value: number;
  text: string;
  tone?: MeterTone;
  onPress?: () => void;
}

/**
 * Things ranked by how much of something they hold: a name, a bar, a reading.
 *
 * All the bars share one scale, the largest reading, unless a scale is given.
 */
export function BarList({
  rows,
  label,
  scale,
}: {
  rows: readonly BarRow[];
  /** What is being ranked. */
  label: string;
  scale?: number;
}) {
  const top = scale ?? Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul aria-label={label} className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id}>
          <div className="flex items-baseline justify-between gap-3">
            {row.onPress === undefined ? (
              <span className="min-w-0 flex-1 truncate text-body text-fg">{row.label}</span>
            ) : (
              <button
                type="button"
                onClick={row.onPress}
                className="min-w-0 flex-1 truncate rounded-sm text-left text-body text-fg hover:underline"
              >
                {row.label}
              </button>
            )}
            <span className="shrink-0 text-caption tabular-nums text-fg-secondary">{row.text}</span>
          </div>
          <Meter
            value={row.value}
            max={top}
            label={row.name}
            valueText={row.text}
            tone={row.tone ?? 'accent'}
            className="mt-1"
          />
        </li>
      ))}
    </ul>
  );
}
