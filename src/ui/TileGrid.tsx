import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/**
 * A grid of tiles a keyboard can walk (M4).
 *
 * The mosaic needed it and nothing else had it: a two-dimensional surface
 * where every cell is a thing with a name, not a button in a list. It is an
 * ARIA grid — rows of cells, one tab stop for the whole grid, the arrow keys
 * to move, Home and End for the row's ends, Ctrl+Home and Ctrl+End for the
 * grid's — so a screen reader announces each tile by its name and a keyboard
 * reaches all of them without forty tab stops.
 *
 * It draws no colour of its own. The caller says how each cell looks
 * (`className`) and what it contains; the grid owns only the geometry, the
 * focus and the keys. A cell that is `null` is a hole — a day with no working
 * hours at that time — and the keys step over it.
 */

export interface TileCell {
  id: string;
  /** What a screen reader says: the whole tile in words. */
  label: string;
  className: string;
  content?: ReactNode;
  /** The present moment is in this tile. */
  current?: boolean;
  /** What pressing the tile does, by pointer or with Enter or Space. */
  onActivate?: (() => void) | undefined;
  /** A colour the token layer holds as a value, such as a goal's. */
  style?: CSSProperties | undefined;
  /** The pointer or the focus came to this tile. */
  onInspect?: (() => void) | undefined;
  /** Something was dropped on the tile. Without it the tile takes no drop. */
  onDropOn?: ((event: DragEvent<HTMLDivElement>) => void) | undefined;
}

export function TileGrid({
  label,
  columns,
  rows,
  rowHeight = 'h-9',
}: {
  /** The tiles' height, as the utility that sets it. */
  rowHeight?: string;
  /** The grid's accessible name. */
  label: string;
  /** Column headings, left to right. */
  columns: ReadonlyArray<{ id: string; header: ReactNode }>;
  /** Row by row: a heading, and one cell (or a hole) per column. */
  rows: ReadonlyArray<{ id: string; header: ReactNode; cells: ReadonlyArray<TileCell | null> }>;
}) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const first = firstCell(rows);
  const [focused, setFocused] = useState<[number, number] | null>(null);
  const active = focused ?? first;

  const move = (row: number, column: number) => {
    const cell = rows[row]?.cells[column];
    if (cell === null || cell === undefined) return false;
    setFocused([row, column]);
    cellRefs.current.get(cell.id)?.focus();
    return true;
  };

  /** Step from (row, column) by (dr, dc) until a cell, or stay put. */
  const step = (row: number, column: number, dr: number, dc: number) => {
    let r = row + dr;
    let c = column + dc;
    while (r >= 0 && r < rows.length && c >= 0 && c < columns.length) {
      if (move(r, c)) return;
      r += dr;
      c += dc;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: number, column: number) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => step(row, column, 0, 1),
      ArrowLeft: () => step(row, column, 0, -1),
      ArrowDown: () => step(row, column, 1, 0),
      ArrowUp: () => step(row, column, -1, 0),
      Home: () =>
        event.ctrlKey ? first !== null && move(first[0], first[1]) : step(row, -1, 0, 1),
      End: () => {
        if (event.ctrlKey) {
          const last = lastCell(rows);
          if (last !== null) move(last[0], last[1]);
        } else {
          step(row, columns.length, 0, -1);
        }
      },
    };
    const action = keys[event.key];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };

  return (
    <div role="grid" aria-label={label} className="flex flex-col gap-1">
      <div role="row" className="flex gap-1">
        <span role="columnheader" className="w-14 shrink-0" aria-label="Hour" />
        {columns.map((column) => (
          <span
            key={column.id}
            role="columnheader"
            className="min-w-0 flex-1 truncate text-center text-caption font-semibold text-fg-secondary"
          >
            {column.header}
          </span>
        ))}
      </div>
      {rows.map((row, r) => (
        <div key={row.id} role="row" className="flex gap-1">
          <span
            role="rowheader"
            className="w-14 shrink-0 pt-1 text-right text-caption tabular-nums text-fg-tertiary"
          >
            {row.header}
          </span>
          {row.cells.map((cell, c) =>
            cell === null ? (
              <span key={`${row.id}:${c}`} role="gridcell" className="min-w-0 flex-1" />
            ) : (
              <div
                key={cell.id}
                ref={(node) => {
                  if (node === null) cellRefs.current.delete(cell.id);
                  else cellRefs.current.set(cell.id, node);
                }}
                role="gridcell"
                aria-label={cell.label}
                aria-current={cell.current === true ? 'time' : undefined}
                data-tile={cell.id}
                tabIndex={active !== null && active[0] === r && active[1] === c ? 0 : -1}
                style={cell.style}
                onFocus={() => {
                  setFocused([r, c]);
                  cell.onInspect?.();
                }}
                onMouseEnter={cell.onInspect}
                onDragOver={
                  cell.onDropOn === undefined ? undefined : (event) => event.preventDefault()
                }
                onDrop={cell.onDropOn}
                onClick={cell.onActivate}
                onKeyDown={(event) => {
                  if (
                    cell.onActivate !== undefined &&
                    (event.key === 'Enter' || event.key === ' ')
                  ) {
                    event.preventDefault();
                    cell.onActivate();
                    return;
                  }
                  onKeyDown(event, r, c);
                }}
                className={[
                  rowHeight,
                  'min-w-0 flex-1 overflow-hidden rounded-sm px-1.5 py-1 text-caption outline-none',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg',
                  cell.onActivate === undefined ? '' : 'cursor-pointer hover:brightness-110',
                  cell.className,
                ].join(' ')}
              >
                {cell.content}
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function firstCell(
  rows: ReadonlyArray<{ cells: ReadonlyArray<TileCell | null> }>,
): [number, number] | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r]?.cells.findIndex((cell) => cell !== null) ?? -1;
    if (c >= 0) return [r, c];
  }
  return null;
}

function lastCell(
  rows: ReadonlyArray<{ cells: ReadonlyArray<TileCell | null> }>,
): [number, number] | null {
  for (let r = rows.length - 1; r >= 0; r--) {
    const cells = rows[r]?.cells ?? [];
    for (let c = cells.length - 1; c >= 0; c--) if (cells[c] !== null) return [r, c];
  }
  return null;
}
