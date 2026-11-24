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
/** Up to this many columns, each is named. */
const LABEL_EVERY_FROM = 8;

/** Name every nth column so about six names fit. */
function labelStep(count: number): number {
  return Math.ceil(count / 6);
}

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
                <span className="mb-0.5 text-caption whitespace-nowrap text-fg-secondary">
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
        {columns.map((column, index) => (
          <span
            key={column.id}
            className={[
              'min-w-0 flex-1 text-center text-caption whitespace-nowrap',
              column.current === true ? 'font-semibold text-fg' : 'text-fg-tertiary',
            ].join(' ')}
          >
            {/* Many columns: every few is named, and the current one always. A row of
                names cut to "Aug ..." says nothing. */}
            {columns.length <= LABEL_EVERY_FROM ||
            column.current === true ||
            (index % labelStep(columns.length) === 0 &&
              !columns
                .slice(index + 1, index + labelStep(columns.length))
                .some((next) => next.current === true))
              ? column.label
              : ''}
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
