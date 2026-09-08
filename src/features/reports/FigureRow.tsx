import { useState } from 'react';

import { formatDuration } from '@/domain/criticalPath';
import type { Figure } from '@/domain/report';

import { describeDay } from './format';

/**
 * A number that can be opened.
 *
 * The one rendering of ADR-024 in the product: the value is a button, pressing
 * it lists the rows it was added up from, and a figure whose rows do not sum to
 * it shows a dash instead of a number. Reports made it; goals use it, because
 * "the sum of its rows" has to look the same wherever it is claimed.
 */
export function FigureRow({
  figure,
  broken,
  big = false,
}: {
  figure: Figure;
  /** Figures that failed `traceable` — theirs is the dash. */
  broken: Figure[];
  big?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isBroken = broken.some((candidate) => candidate.id === figure.id);
  const shown =
    figure.unit === 'minutes'
      ? formatDuration(figure.value)
      : `${figure.value} ${figure.value === 1 ? 'task' : 'tasks'}`;

  return (
    <div data-testid="figure" data-figure={figure.id}>
      <div className="flex items-center gap-3">
        <span
          className={[
            'min-w-0 flex-1 truncate',
            big ? 'text-body text-fg' : 'text-body text-fg-secondary',
          ].join(' ')}
        >
          {figure.label}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${figure.label}: ${shown}. ${open ? 'Hide' : 'Show'} the ${figure.rows.length} ${figure.rows.length === 1 ? 'row' : 'rows'} it came from`}
          disabled={figure.rows.length === 0}
          onClick={() => setOpen((value) => !value)}
          className={[
            'rounded-md px-2 py-0.5 tabular-nums transition-colors duration-100 ease-easy',
            big ? 'text-subtitle font-semibold text-fg' : 'text-body text-fg',
            'hover:bg-card-hover disabled:cursor-default disabled:hover:bg-transparent',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          ].join(' ')}
          data-testid="figure-value"
        >
          {isBroken ? '—' : shown}
        </button>
      </div>

      {/* On screen the rows are shown when the figure is opened; on paper they
          are always shown, because the rows are what makes the number worth
          printing (ADR-024). */}
      {figure.rows.length > 0 && (
        <ul
          className={[
            'mt-1 mb-2 ml-3 flex-col gap-0.5 border-l border-stroke-subtle pl-3',
            open ? 'flex' : 'hidden print:flex',
          ].join(' ')}
        >
          {figure.rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-3 text-caption text-fg-secondary"
              data-testid="figure-row"
            >
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              {row.day !== null && <span className="tabular-nums">{describeDay(row.day)}</span>}
              {figure.unit === 'minutes' && (
                <span className="w-16 text-right tabular-nums" data-testid="row-minutes">
                  {formatDuration(row.minutes)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
