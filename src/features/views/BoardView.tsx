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
  CalendarToday16Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  ClockAlarm16Regular,
  ReOrderDotsVertical20Regular,
  Stack16Filled,
  Target16Regular,
  Timer16Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState, type KeyboardEventHandler, type ReactNode } from 'react';

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
import type { Item } from '@/domain/item';
import type { Page } from '@/domain/page';
import type { TodayMark } from '@/domain/pulse';
import { NotesChip } from '@/features/notes/NotesChip';
import { formatValue, optionsOf, type Property } from '@/domain/property';
import type { Group, Query, Row } from '@/domain/query';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { toChipTone } from '@/ui/chipTone';
import { IconButton } from '@/ui/IconButton';
import { announce } from '@/ui/announce';

/** What a card says about today. Colour, icon and word, never the colour alone. */
const MARK: Record<
  TodayMark,
  { word: string; tone: 'danger' | 'accent' | 'caution'; bar: string; icon: ReactNode }
> = {
  late: {
    word: 'Late',
    tone: 'danger',
    bar: 'border-l-danger',
    icon: <ClockAlarm16Regular aria-hidden="true" />,
  },
  running: {
    word: 'On the clock',
    tone: 'accent',
    bar: 'border-l-accent',
    icon: <Timer16Regular aria-hidden="true" />,
  },
  today: {
    word: 'Today',
    tone: 'caution',
    bar: 'border-l-caution',
    icon: <Target16Regular aria-hidden="true" />,
  },
  reserved: {
    word: 'On the calendar today',
    tone: 'accent',
    bar: 'border-l-accent',
    icon: <CalendarToday16Regular aria-hidden="true" />,
  },
};

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
  items,
  properties,
  query,
  board,
  marks,
  notesOf,
  onOpenPage,
  onQueryChange,
  onMove,
  onOpen,
}: {
  /** Why a card matters today, for the ones where it does. */
  marks: ReadonlyMap<string, TodayMark>;
  /** The pages applied to each task, by the task's id. */
  notesOf?: ReadonlyMap<string, readonly Page[]>;
  onOpenPage?: ((pageId: string) => void) | undefined;
  groups: readonly Group[];
  /** The whole collection, not the filtered columns: a drop's key is new to all of it. */
  items: readonly Item[];
  properties: Property[];
  query: Query;
  board: BoardConfig;
  onQueryChange: (query: Query, board: BoardConfig) => void;
  onMove: (move: Move) => void;
  onOpen: (row: Row) => void;
}) {
  const [dragging, setDragging] = useState<Row | null>(null);
  /** Only dims the rest: hiding cards would leave a drop with the wrong neighbours. */
  const [spotlight, setSpotlight] = useState(false);

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
    announce(`Moved ${row.item.title} to ${destination.label}`);

    // dnd-kit reports the slot in the column as rendered — the array that still
    // contains the dragged card. That is exactly what `planMove` expects, and
    // getting it wrong is the classic drag-and-drop off-by-one that looks like
    // "the drag did nothing".
    const overIndex = destination.rows.findIndex((candidate) => candidate.item.id === over.id);
    const index = overIndex === -1 ? destination.rows.length : overIndex;

    const move = planMove(
      row,
      { columnKey: destination.key, index },
      columns,
      query.groupBy,
      items,
    );
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
      <div className="flex h-full min-h-0 flex-col gap-2">
        <TodayStrip
          marks={marks}
          rows={columns.flatMap((column) => column.rows)}
          spotlight={spotlight}
          onSpotlight={setSpotlight}
        />
        {/* Named, like the timeline's region: a scrolling area with no
            accessible name is one a screen reader cannot announce and a test
            cannot address without reading the whole window. */}
        <div
          role="region"
          aria-label="Board"
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2"
        >
          {columns.map((column) => (
            <BoardColumn
              key={columnKeyToStorage(column.key)}
              column={column}
              properties={shown}
              droppable={isDroppable(column, groupProperty)}
              marks={marks}
              notesOf={notesOf}
              onOpenPage={onOpenPage}
              spotlight={spotlight}
              onToggleCollapsed={() => toggleCollapsed(column)}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>

      {/* The card follows the cursor rather than the column reflowing under it,
          so a drag reads as picking something up. */}
      <DragOverlay>
        {dragging && (
          <Card
            row={dragging}
            properties={shown}
            mark={marks.get(dragging.item.id) ?? null}
            overlay
            onOpen={() => {}}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** How many cards today asks about, and a way to see only them. */
function TodayStrip({
  marks,
  rows,
  spotlight,
  onSpotlight,
}: {
  marks: ReadonlyMap<string, TodayMark>;
  rows: readonly Row[];
  spotlight: boolean;
  onSpotlight: (on: boolean) => void;
}) {
  const counts = new Map<TodayMark, number>();
  for (const row of rows) {
    const mark = marks.get(row.item.id);
    if (mark !== undefined) counts.set(mark, (counts.get(mark) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="board-today">
      <span className="text-body font-semibold text-fg">
        {total === 0
          ? 'Nothing on this board is for today'
          : `${total} ${total === 1 ? 'card is' : 'cards are'} for today`}
      </span>
      {(['late', 'running', 'today', 'reserved'] as const).map((mark) =>
        (counts.get(mark) ?? 0) === 0 ? null : (
          <Chip key={mark} tone={MARK[mark].tone}>
            {MARK[mark].icon}
            {counts.get(mark)} {MARK[mark].word.toLocaleLowerCase()}
          </Chip>
        ),
      )}
      {total > 0 && (
        <Button
          appearance="subtle"
          aria-pressed={spotlight}
          icon={<Target16Regular />}
          onClick={() => onSpotlight(!spotlight)}
        >
          {spotlight ? 'Show all cards' : 'Spotlight today'}
        </Button>
      )}
    </div>
  );
}

/**
 * How full a column is, at a glance.
 *
 * The count alone is a number among other numbers: on a board of five columns,
 * "0" and "3" look alike until you read them. The icon appears only when there
 * is something in the column, so a glance down the row shows which columns hold
 * work without reading a single digit — and it stays visible when the column is
 * collapsed to a rail, which is exactly when the digit is hardest to read.
 *
 * The icon never carries the meaning alone: the count is always beside it, and
 * the accessible name spells the whole thing out.
 */
function ColumnCount({ column }: { column: Column }) {
  const wip = wipState(column);
  const occupied = column.rows.length > 0;
  const label =
    column.wipLimit === null
      ? `${column.rows.length} in ${column.label}`
      : `${column.rows.length} of ${column.wipLimit} in ${column.label}`;

  const body = (
    <>
      {occupied && (
        <Stack16Filled
          aria-hidden="true"
          className={wip === 'over' ? 'text-danger' : wip === 'at' ? 'text-caution' : 'text-accent'}
        />
      )}
      {column.wipLimit === null ? column.rows.length : `${column.rows.length}/${column.wipLimit}`}
    </>
  );

  if (column.wipLimit !== null) {
    return (
      <span title={label} aria-label={label}>
        <Chip tone={wip === 'over' ? 'danger' : wip === 'at' ? 'caution' : 'neutral'}>{body}</Chip>
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 text-caption text-fg-tertiary"
    >
      {body}
    </span>
  );
}

function BoardColumn({
  column,
  properties,
  droppable,
  marks,
  notesOf,
  onOpenPage,
  spotlight,
  onToggleCollapsed,
  onOpen,
}: {
  column: Column;
  properties: Property[];
  droppable: boolean;
  marks: ReadonlyMap<string, TodayMark>;
  notesOf?: ReadonlyMap<string, readonly Page[]> | undefined;
  onOpenPage?: ((pageId: string) => void) | undefined;
  spotlight: boolean;
  onToggleCollapsed: () => void;
  onOpen: (row: Row) => void;
}) {
  const key = columnKeyToStorage(column.key);
  const { setNodeRef, isOver } = useDroppable({ id: key, disabled: !droppable });
  const wip = wipState(column);
  const forToday = column.rows.filter((row) => marks.has(row.item.id)).length;

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
          {column.label}
        </span>

        {/* At the foot of the rail, not the head.
            A collapsed column reads downwards: the control to reopen it at the
            top, then the name running down, and the count where the eye ends up
            — which is also where it sits in a column that is open. Putting it
            second meant the label started halfway down and the two states no
            longer looked like the same column. */}
        <span className="mt-auto">
          <ColumnCount column={column} />
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

        {wip === 'over' && <Warning16Regular aria-hidden="true" className="text-danger" />}
        {forToday > 0 && <Chip tone="accent">{forToday} today</Chip>}
        <ColumnCount column={column} />
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
            <SortableCard
              key={row.item.id}
              row={row}
              properties={properties}
              mark={marks.get(row.item.id) ?? null}
              notes={notesOf?.get(row.item.id)}
              onOpenPage={onOpenPage}
              dimmed={spotlight && !marks.has(row.item.id)}
              onOpen={onOpen}
            />
          ))}
          {column.rows.length === 0 && (
            <p className="px-1 py-4 text-center text-caption text-fg-tertiary">Drop a card here</p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({
  row,
  properties,
  mark,
  notes,
  onOpenPage,
  dimmed,
  onOpen,
}: {
  row: Row;
  properties: Property[];
  mark: TodayMark | null;
  notes?: readonly Page[] | undefined;
  onOpenPage?: ((pageId: string) => void) | undefined;
  dimmed: boolean;
  onOpen: (row: Row) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.item.id });

  // The pointer drags the whole card; the keyboard drags by the handle. Putting
  // the button role on the card would nest the title button inside another
  // control, which no screen reader can present — so the role, the tab stop
  // and the key handling live on one small handle instead.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The original stays in place as a gap while the overlay follows the
      // cursor; hiding it entirely makes the column jump.
      className={[
        isDragging || dimmed ? 'opacity-40' : '',
        'transition-opacity duration-150 ease-easy',
      ].join(' ')}
      {...pointerListeners}
    >
      <Card
        row={row}
        properties={properties}
        mark={mark}
        notes={notes}
        onOpenPage={onOpenPage}
        onOpen={onOpen}
        handle={
          <IconButton
            ref={setActivatorNodeRef}
            label={`Move ${row.item.title}`}
            icon={<ReOrderDotsVertical20Regular />}
            className="-my-1 shrink-0 cursor-grab text-fg-tertiary active:cursor-grabbing"
            {...attributes}
            // dnd-kit types its listeners loosely; this one is the keyboard sensor's.
            onKeyDown={onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
          />
        }
      />
    </div>
  );
}

function Card({
  row,
  properties,
  mark,
  notes,
  onOpenPage,
  onOpen,
  overlay = false,
  handle,
}: {
  notes?: readonly Page[] | undefined;
  onOpenPage?: ((pageId: string) => void) | undefined;
  row: Row;
  properties: Property[];
  /** Why this card matters today. */
  mark: TodayMark | null;
  onOpen: (row: Row) => void;
  overlay?: boolean;
  /** The keyboard drag handle; absent on the overlay copy. */
  handle?: ReactNode;
}) {
  const done = row.item.completedAt !== null;

  return (
    <article
      data-today={mark ?? undefined}
      className={[
        'rounded-md border border-stroke-subtle bg-card p-2 text-left',
        mark === null ? '' : `border-l-4 ${MARK[mark].bar}`,
        overlay ? 'shadow-flyout' : 'shadow-card hover:bg-card-hover',
      ].join(' ')}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => onOpen(row)}
          className={[
            'block min-w-0 flex-1 text-left text-body',
            done ? 'text-fg-tertiary line-through' : 'text-fg',
          ].join(' ')}
        >
          {row.item.title}
        </button>
        {handle}
      </div>

      {(mark !== null || properties.length > 0 || (notes?.length ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {notes !== undefined && notes.length > 0 && (
            <NotesChip notes={notes} onOpenPage={onOpenPage} />
          )}
          {mark !== null && (
            <Chip tone={MARK[mark].tone}>
              {MARK[mark].icon}
              {MARK[mark].word}
            </Chip>
          )}
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
