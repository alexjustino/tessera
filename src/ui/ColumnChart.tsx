/** One column: where it sits, what it reads, and how that is said. */
export interface Column {
  id: string;
  /** Under the column. */
  label: string;
  value: number;
  /** The reading in words: `2h 30m`, `3 tasks`. */
  text: string;
  /** Marks the column the reader is standing in. */
  current?: boolean;
  /** A level to read the column against, such as the day's working hours. */
  ceiling?: number;
}

/**
 * Columns from one baseline, for change over a run of days or weeks.
 *
 * Thin marks with a rounded top, one hairline for the base, and a number only on
 * the tallest and on the one the reader is standing in. Every reading is also in
 * a table a screen reader gets and in the tooltip, so a value is never only a
 * height (design system: a chart says what it left out).
 */
export function ColumnChart({
  columns,
  label,
  height = 112,
}: {
  columns: readonly Column[];
  /** What the chart shows. */
  label: string;
  /** The plot's height, in pixels. */
  height?: number;
}) {
  const top = Math.max(1, ...columns.flatMap((column) => [column.value, column.ceiling ?? 0]));
  const tallest = columns.reduce(
    (best, column) => (column.value > (best?.value ?? 0) ? column : best),
    null as Column | null,
  );

  return (
    <figure className="min-w-0">
      <div
        aria-hidden="true"
        className="flex items-end gap-1 border-b border-stroke"
        style={{ height: height + 18 }}
      >
        {columns.map((column) => {
          const labelled = column.value > 0 && (column === tallest || column.current === true);
          return (
            <div
              key={column.id}
              title={`${column.label}: ${column.text}`}
              className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
            >
              {column.ceiling !== undefined && column.ceiling > 0 && (
                <span
                  className="absolute inset-x-0.5 border-t border-stroke"
                  style={{ bottom: (column.ceiling / top) * height }}
                />
              )}
              {labelled && (
                <span className="mb-0.5 max-w-full truncate text-caption text-fg-secondary">
                  {column.text}
                </span>
              )}
              <span
                data-testid="chart-column"
                className={[
                  'w-full max-w-6 rounded-t-[4px]',
                  column.current === true ? 'bg-accent' : 'bg-stroke-strong',
                ].join(' ')}
                style={{
                  height: column.value > 0 ? Math.max(3, (column.value / top) * height) : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-1">
        {columns.map((column) => (
          <span
            key={column.id}
            className={[
              'min-w-0 flex-1 truncate text-center text-caption',
              column.current === true ? 'font-semibold text-fg' : 'text-fg-tertiary',
            ].join(' ')}
          >
            {column.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {columns.map((column) => (
            <tr key={column.id}>
              <th scope="row">{column.label}</th>
              <td>{column.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
