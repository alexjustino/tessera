import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown16Regular,
  ChevronRight16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import {
  cardProperties,
  columnKeyToStorage,
  isDroppable,
  planMove,
  toColumns,
  wipState,
  type BoardConfig,
  type Column,
  type Move,
} from '@/domain/board';
import { formatValue, optionsOf, type Property } from '@/domain/property';
import type { Group, Query, Row } from '@/domain/query';
import { Chip } from '@/ui/Chip';
import { toChipTone } from '@/ui/chipTone';
import { IconButton } from '@/ui/IconButton';

/**
 * The board.
 *
 * Columns are the query engine's groups; dropping a card into one is setting
 * that field on that item. There is no board-specific store and no second
 * source of truth, which is why "move to Done" and "set status to Done" cannot
 * drift apart.
 *
 * Dragging works from the keyboard as well as the pointer — `@dnd-kit` gives
 * that for free provided the keyboard sensor is wired, and a board you can only
 * use with a mouse is a board half the people cannot use.
 */
export function BoardView({
  groups,
  properties,
  query,
  board,
  onQueryChange,
  onMove,
  onOpen,
}: {
  groups: readonly Group[];
  properties: Property[];
  query: Query;
  board: BoardConfig;
  onQueryChange: (query: Query, board: BoardConfig) => void;
  onMove: (move: Move) => void;
  onOpen: (row: Row) => void;
}) {
  const [dragging, setDragging] = useState<Row | null>(null);

  const columns = useMemo(() => toColumns(groups, board), [groups, board]);
  const shown = cardProperties(board, properties);

  // Bound to a local so the narrowing survives the second access.
  const groupBy = query.groupBy;
  const groupProperty =
    groupBy?.kind === 'property'
      ? (properties.find((p) => p.id === groupBy.propertyId) ?? null)
      : null;

  const sensors = useSensors(
    // A small distance before a drag begins, so clicking a card to open it is
    // not read as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const rowOf = (id: string): Row | null => {
    for (const column of columns) {
      const found = column.rows.find((row) => row.item.id === id);
      if (found) return found;
    }
    return null;
  };

  const columnOf = (id: string): Column | null =>
    columns.find(
      (column) =>
        columnKeyToStorage(column.key) === id || column.rows.some((row) => row.item.id === id),
    ) ?? null;

  const onDragStart = (event: DragStartEvent) => setDragging(rowOf(String(event.active.id)));

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const { active, over } = event;
    if (over === null) return;

    const row = rowOf(String(active.id));
    const destination = columnOf(String(over.id));
    if (row === null || destination === null) return;
    if (!isDroppable(destination, groupProperty)) return;

    // dnd-kit reports the slot in the column as rendered — the array that still
    // contains the dragged card. That is exactly what `planMove` expects, and
    // getting it wrong is the classic drag-and-drop off-by-one that looks like
    // "the drag did nothing".
    const overIndex = destination.rows.findIndex((candidate) => candidate.item.id === over.id);
    const index = overIndex === -1 ? destination.rows.length : overIndex;

    const move = planMove(row, { columnKey: destination.key, index }, columns, query.groupBy);
    if (move !== null) onMove(move);
  };

  const toggleCollapsed = (column: Column) => {
    const key = columnKeyToStorage(column.key);
    const collapsed = column.collapsed
      ? board.collapsed.filter((candidate) => candidate !== key)
      : [...board.collapsed, key];
    onQueryChange(query, { ...board, collapsed });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex h-full gap-3 overflow-x-auto pb-2">
        {columns.map((column) => (
          <BoardColumn
            key={columnKeyToStorage(column.key)}
            column={column}
            properties={shown}
            droppable={isDroppable(column, groupProperty)}
            onToggleCollapsed={() => toggleCollapsed(column)}
            onOpen={onOpen}
          />
        ))}
      </div>

      {/* The card follows the cursor rather than the column reflowing under it,
          so a drag reads as picking something up. */}
      <DragOverlay>
        {dragging && <Card row={dragging} properties={shown} overlay onOpen={() => {}} />}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  properties,
  droppable,
  onToggleCollapsed,
  onOpen,
}: {
  column: Column;
  properties: Property[];
  droppable: boolean;
  onToggleCollapsed: () => void;
  onOpen: (row: Row) => void;
}) {
  const key = columnKeyToStorage(column.key);
  const { setNodeRef, isOver } = useDroppable({ id: key, disabled: !droppable });
  const wip = wipState(column);

  if (column.collapsed) {
    return (
      <section className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-lg border border-stroke-subtle bg-layer-alt py-2">
        <IconButton
          label={`Expand ${column.label}`}
          icon={<ChevronRight16Regular />}
          onClick={onToggleCollapsed}
        />
        <span
          className="text-caption font-semibold whitespace-nowrap text-fg-secondary"
          style={{ writingMode: 'vertical-rl' }}
        >
          {column.label} · {column.rows.length}
        </span>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      className={[
        'flex w-72 shrink-0 flex-col rounded-lg border bg-layer-alt',
        isOver && droppable ? 'border-accent' : 'border-stroke-subtle',
        !droppable ? 'opacity-70' : '',
      ].join(' ')}
    >
      <header className="flex items-center gap-2 px-2 py-2">
        <IconButton
          label={`Collapse ${column.label}`}
          icon={<ChevronDown16Regular />}
          onClick={onToggleCollapsed}
        />
        <h3 className="min-w-0 flex-1 truncate text-body font-semibold text-fg">{column.label}</h3>

        {column.wipLimit === null ? (
          <span className="text-caption text-fg-tertiary">{column.rows.length}</span>
        ) : (
          <Chip tone={wip === 'over' ? 'danger' : wip === 'at' ? 'caution' : 'neutral'}>
            {wip === 'over' && <Warning16Regular />}
            {column.rows.length}/{column.wipLimit}
          </Chip>
        )}
      </header>

      {!droppable && (
        <p className="px-2 pb-2 text-caption text-fg-tertiary">
          This option was removed, so cards cannot be moved here. Their value is kept.
        </p>
      )}

      <SortableContext
        items={column.rows.map((row) => row.item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex min-h-16 flex-1 flex-col gap-1.5 overflow-y-auto p-2 pt-0">
          {column.rows.map((row) => (
            <SortableCard key={row.item.id} row={row} properties={properties} onOpen={onOpen} />
          ))}
          {column.rows.length === 0 && (
            <p className="px-1 py-4 text-center text-caption text-fg-disabled">Drop a card here</p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({
  row,
  properties,
  onOpen,
}: {
  row: Row;
  properties: Property[];
  onOpen: (row: Row) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.item.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The original stays in place as a gap while the overlay follows the
      // cursor; hiding it entirely makes the column jump.
      className={isDragging ? 'opacity-40' : undefined}
      {...attributes}
      {...listeners}
    >
      <Card row={row} properties={properties} onOpen={onOpen} />
    </div>
  );
}

function Card({
  row,
  properties,
  onOpen,
  overlay = false,
}: {
  row: Row;
  properties: Property[];
  onOpen: (row: Row) => void;
  overlay?: boolean;
}) {
  const done = row.item.completedAt !== null;

  return (
    <article
      className={[
        'rounded-md border border-stroke-subtle bg-card p-2 text-left',
        overlay ? 'shadow-flyout' : 'shadow-card hover:bg-card-hover',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={[
          'block w-full text-left text-body',
          done ? 'text-fg-tertiary line-through' : 'text-fg',
        ].join(' ')}
      >
        {row.item.title}
      </button>

      {properties.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {properties.map((property) => {
            const raw = row.values[property.id];
            if (raw === undefined || raw === null) return null;
            const option = optionsOf(property).find((candidate) => candidate.id === raw);
            return (
              <Chip key={property.id} tone={toChipTone(option?.color)} title={property.name}>
                {option?.label ?? formatValue(property, raw as never)}
              </Chip>
            );
          })}
        </div>
      )}
    </article>
  );
}
