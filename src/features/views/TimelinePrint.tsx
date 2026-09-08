import { axisTicks, printRows, type Timeline } from '@/domain/timeline';

/**
 * The timeline, on paper.
 *
 * A second rendering of the same chart, not the screen's one scaled down
 * (ADR-031). The screen draws one tall canvas of absolutely positioned bars,
 * which is right for scrolling and wrong for a page: a break would fall
 * wherever the paper ran out, through the middle of whatever was there.
 *
 * Here each task is a block of its own with its own track, so a page break can
 * only ever land *between* rows — and the bars are placed in percentages, so
 * the chart is as wide as the paper rather than as wide as the days. What it
 * gives up is the arrows: a dependency is a line between two rows, and two
 * rows can be on different sheets.
 */
export function TimelinePrint({ timeline }: { timeline: Timeline }) {
  const rows = printRows(timeline);
  const ticks = axisTicks(timeline);
  if (rows.length === 0) return null;

  return (
    <section aria-hidden="true" data-print-view="timeline" className="hidden print:block">
      {/* The axis sits over the same track the bars do — the title column is
          spaced out of it, or every date would point at the wrong day. */}
      <header className="mb-1 flex items-end gap-3 border-b border-stroke-subtle pb-1">
        <span className="w-48 shrink-0" />
        <span className="relative block h-4 min-w-0 flex-1">
          {ticks.map((tick, index) => (
            <span
              key={tick.day}
              className="absolute top-0 text-caption whitespace-nowrap text-fg-tertiary"
              style={{
                left: `${tick.at * 100}%`,
                // The last label would run off the edge if it started there.
                transform: index === ticks.length - 1 ? 'translateX(-100%)' : undefined,
              }}
            >
              {tick.day.slice(5)}
            </span>
          ))}
        </span>
      </header>

      <ul>
        {rows.map((row) => (
          <li key={row.id} data-print-row={row.id} className="flex items-center gap-3 py-0.5">
            <span className="w-48 shrink-0 truncate text-caption text-fg">{row.title}</span>
            <span className="relative h-3 min-w-0 flex-1 border-b border-stroke-subtle/60">
              <span
                data-print-bar={row.id}
                className={[
                  'absolute top-0 block h-3 rounded-sm border',
                  row.completed
                    ? 'border-stroke-default bg-transparent'
                    : row.critical
                      ? 'border-danger bg-danger-subtle'
                      : 'border-accent bg-accent-subtle',
                ].join(' ')}
                style={{ left: `${row.left * 100}%`, width: `${row.width * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>

      {timeline.undated.length > 0 && (
        <p className="mt-2 text-caption text-fg-tertiary">
          {timeline.undated.length} {timeline.undated.length === 1 ? 'task has' : 'tasks have'} no
          date and {timeline.undated.length === 1 ? 'is' : 'are'} not on the chart.
        </p>
      )}
      <p className="mt-1 text-caption text-fg-tertiary">
        Dependencies are not drawn on paper; the order is the chart's own.
      </p>
    </section>
  );
}
