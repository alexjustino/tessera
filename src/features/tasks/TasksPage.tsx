import { Add20Regular, Options20Regular, TaskListSquareLtr24Regular } from '@fluentui/react-icons';
import { useCallback, useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCaptureItem,
  useCompleteOccurrence,
  useDependencies,
  useDeleteItem,
  useItems,
  useProperties,
  usePropertyValues,
  useRenameItem,
  useSetItemCompleted,
  useMoveOnBoard,
  useSetPropertyValue,
  useUpdateView,
  useViews,
} from '@/data/hooks';
import { EMPTY_BOARD_CONFIG, type BoardConfig } from '@/domain/board';
import { isBlocked } from '@/domain/graph';
import type { Capture } from '@/domain/capture';
import { positionForNewItem } from '@/domain/item';
import { nextOccurrence, systemZone } from '@/domain/schedule';
import type { Property, PropertyValue } from '@/domain/property';
import { EMPTY_QUERY, run, type Query, type Row } from '@/domain/query';
import { CalendarView } from '@/features/calendar/CalendarView';
import { CaptureLine } from '@/features/capture/CaptureLine';
import { PropertyManager } from '@/features/properties/PropertyManager';
import { BoardView } from '@/features/views/BoardView';
import { ListView } from '@/features/views/ListView';
import { QueryBar } from '@/features/views/QueryBar';
import { TableView } from '@/features/views/TableView';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';
import { announce } from '@/ui/announce';

import { TaskDetail } from './TaskDetail';

/** The collection seeded by migration 002. */
const COLLECTION = 'tasks';

/**
 * How many properties are edited straight from a list row.
 *
 * Two. A row is a glance, not a form. The table view exists for the rest, which
 * is why it is a separate kind rather than a wider list.
 */
const INLINE_LIMIT = 2;

/** The types that fit in a row: one tap, one choice, no typing. */
const INLINE_TYPES = new Set(['status', 'priority', 'select']);

export function TasksPage({
  initialViewId = null,
  initialDetailId = null,
}: {
  initialViewId?: string | null;
  /** An item to open on mount — how the palette lands on a search hit. */
  initialDetailId?: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [managingProperties, setManagingProperties] = useState(false);
  const [editingQuery, setEditingQuery] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);

  const [activeViewId, setActiveViewId] = useState<string | null>(initialViewId);
  /** The query as it is being edited. Null means "whatever the view saved". */
  const [draftQuery, setDraftQuery] = useState<Query | null>(null);
  /** The board settings as they are being edited, on the same terms. */
  const [draftBoard, setDraftBoard] = useState<BoardConfig | null>(null);

  const items = useItems(COLLECTION, true);
  const properties = useProperties(COLLECTION);
  const values = usePropertyValues(COLLECTION);
  const views = useViews(COLLECTION);

  const create = useCaptureItem();
  const setCompleted = useSetItemCompleted();
  const rename = useRenameItem();
  const remove = useDeleteItem();
  const setValue = useSetPropertyValue();
  const moveOnBoard = useMoveOnBoard();
  const completeOccurrence = useCompleteOccurrence();
  const saveView = useUpdateView();

  const view = useMemo(() => {
    const all = views.data ?? [];
    return all.find((candidate) => candidate.id === activeViewId) ?? all[0] ?? null;
  }, [views.data, activeViewId]);

  const query = draftQuery ?? view?.query ?? EMPTY_QUERY;
  const board = draftBoard ?? view?.board ?? EMPTY_BOARD_CONFIG;
  const dirty = (draftQuery !== null || draftBoard !== null) && view !== null;

  const rows: Row[] = useMemo(
    () =>
      (items.data ?? []).map((item) => ({
        item,
        values: values.data?.[item.id] ?? {},
      })),
    [items.data, values.data],
  );

  const result = useMemo(
    () => run({ rows, properties: properties.data ?? [], query }),
    [rows, properties.data, query],
  );

  const inlineProperties = useMemo(
    () => (properties.data ?? []).filter((p) => INLINE_TYPES.has(p.type)).slice(0, INLINE_LIMIT),
    [properties.data],
  );

  const detailTask = useMemo(
    () => (items.data ?? []).find((item) => item.id === detailId) ?? null,
    [items.data, detailId],
  );

  // What is waiting on something unfinished. Computed once here, from the
  // whole graph, rather than asked per row.
  const dependencies = useDependencies();
  const blockedIds = useMemo(() => {
    const edges = dependencies.data ?? [];
    const all = items.data ?? [];
    const done = new Set(all.filter((item) => item.completedAt !== null).map((item) => item.id));
    return new Set(
      all.filter((item) => isBlocked(edges, item.id, (id) => done.has(id))).map((item) => item.id),
    );
  }, [dependencies.data, items.data]);

  const priorityPropertyId = useMemo(
    () => (properties.data ?? []).find((property) => property.type === 'priority')?.id ?? null,
    [properties.data],
  );

  const submit = useCallback(
    (capture: Capture) => {
      create.mutate(
        {
          collectionId: COLLECTION,
          position: positionForNewItem(items.data ?? []),
          capture,
          priorityPropertyId,
        },
        // Clearing only after the host accepted it means a rejected write does
        // not silently swallow what the person typed.
        {
          onSuccess: (item) => {
            setDraft('');
            announce(`Added ${item.title}`);
          },
        },
      );
    },
    [create, items.data, priorityPropertyId],
  );

  const failure =
    items.error ??
    properties.error ??
    values.error ??
    views.error ??
    create.error ??
    setCompleted.error ??
    remove.error ??
    rename.error ??
    setValue.error ??
    moveOnBoard.error ??
    completeOccurrence.error ??
    saveView.error;

  const readFailed = items.isError || properties.isError || values.isError || views.isError;

  const setRowValue = (row: Row, property: Property, value: PropertyValue) =>
    setValue.mutate({ itemId: row.item.id, propertyId: property.id, value });

  /**
   * Ticking a task.
   *
   * A repeating task is not finished when you do it once: the occurrence is
   * recorded and the due date moves on, and the item stays open. Closing it
   * instead would make "every Monday" disappear the first Monday it got done.
   *
   * The next date is computed here, in the domain layer, because that is where
   * the timezone and daylight-saving arithmetic lives.
   */
  const toggleRow = (row: Row, completed: boolean) => {
    const task = row.item;
    const repeats = task.recurrenceRule !== null && task.dueAt !== null;

    if (completed && repeats) {
      const at = new Date().toISOString();
      const next = nextOccurrence(
        {
          startAt: task.startAt,
          dueAt: task.dueAt,
          remindAt: task.remindAt,
          rule: task.recurrenceRule,
          mode: task.recurrenceMode,
        },
        at,
        systemZone(),
        at,
      );
      completeOccurrence.mutate({ id: task.id, nextDueAt: next });
      return;
    }

    setCompleted.mutate({ id: task.id, completed });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-3 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-fg">Tasks</h1>
          {/* Stated only once the list has actually been read. Saying "nothing
              open" when the read failed would be the interface asserting
              something it does not know. */}
          {items.isSuccess && (
            <p className="mt-1 text-body text-fg-secondary">
              {result.matched === 0
                ? 'Nothing to show.'
                : `${result.matched} item${result.matched === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
        <Button
          appearance="subtle"
          icon={<Options20Regular />}
          onClick={() => setManagingProperties(true)}
        >
          Properties
        </Button>
      </header>

      <CaptureLine value={draft} onChange={setDraft} onSubmit={submit} autoFocus>
        {({ ready }) => (
          <Button
            type="submit"
            appearance="accent"
            icon={<Add20Regular />}
            disabled={!ready || create.isPending}
          >
            Add
          </Button>
        )}
      </CaptureLine>

      {failure && (
        <InfoBar
          severity="danger"
          title={readFailed ? 'The task list could not be read' : 'That change was not saved'}
        >
          {describeError(failure)}
        </InfoBar>
      )}

      {(views.data ?? []).length > 0 && (
        <TabStrip
          tabs={(views.data ?? []).map((candidate) => ({
            id: candidate.id,
            label: candidate.name,
          }))}
          active={view?.id ?? ''}
          onSelect={(id) => {
            setActiveViewId(id);
            // Switching views abandons an unsaved query rather than carrying it
            // across. Silently applying one view's filters to another is the
            // kind of surprise that makes a person distrust the whole screen.
            setDraftQuery(null);
            setDraftBoard(null);
          }}
        />
      )}

      {view !== null && (
        <QueryBar
          query={query}
          board={board}
          columns={result.groups}
          isBoard={view.kind === 'board'}
          properties={properties.data ?? []}
          onChange={setDraftQuery}
          onBoardChange={setDraftBoard}
          matched={result.matched}
          total={result.total}
          open={editingQuery}
          onOpenChange={setEditingQuery}
          dirty={dirty}
          onSave={() =>
            saveView.mutate(
              { id: view.id, name: view.name, kind: view.kind, query, board },
              {
                onSuccess: () => {
                  setDraftQuery(null);
                  setDraftBoard(null);
                },
              },
            )
          }
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {readFailed ? null : items.isPending ? (
          <div className="flex flex-col gap-1" aria-hidden="true">
            {[0, 1, 2].map((skeleton) => (
              <div
                key={skeleton}
                className="h-(--density-row) animate-pulse rounded-md bg-card-hover"
              />
            ))}
          </div>
        ) : result.total === 0 ? (
          <EmptyState
            icon={<TaskListSquareLtr24Regular />}
            title="Nothing here yet"
            description="Everything you write is stored on this machine, in a file you own. Type above to add the first task."
          />
        ) : result.matched === 0 ? (
          <EmptyState
            title="No item matches this view"
            description="The items are still there — this view's filters just do not include any of them."
            action={<Button onClick={() => setEditingQuery(true)}>Change the filters</Button>}
          />
        ) : view?.kind === 'calendar' ? (
          <CalendarView
            // Work with no time reserved for it. The panel exists so a person
            // can drag it onto the grid, which is the whole point of the slice.
            unscheduled={(items.data ?? []).filter((item) => item.completedAt === null)}
            onOpenItem={(item) => setDetailId(item.id)}
          />
        ) : view?.kind === 'board' ? (
          <BoardView
            groups={result.groups}
            properties={properties.data ?? []}
            query={query}
            board={board}
            onQueryChange={(nextQuery, nextBoard) => {
              setDraftQuery(nextQuery);
              setDraftBoard(nextBoard);
            }}
            onMove={(move) => moveOnBoard.mutate(move)}
            onOpen={(row) => setDetailId(row.item.id)}
          />
        ) : view?.kind === 'table' ? (
          <TableView
            groups={result.groups}
            properties={properties.data ?? []}
            query={query}
            onQueryChange={setDraftQuery}
            onToggle={toggleRow}
            onSetValue={setRowValue}
            onOpen={(row) => setDetailId(row.item.id)}
          />
        ) : (
          <ListView
            groups={result.groups}
            grouped={query.groupBy !== null}
            blockedIds={blockedIds}
            inlineProperties={inlineProperties}
            onToggle={toggleRow}
            onRename={(row, title) => rename.mutate({ id: row.item.id, title })}
            onDelete={(row) => remove.mutate(row.item.id)}
            onOpen={(row) => setDetailId(row.item.id)}
            onSetValue={setRowValue}
          />
        )}
      </div>

      <PropertyManager
        open={managingProperties}
        onClose={() => setManagingProperties(false)}
        collectionId={COLLECTION}
        properties={properties.data ?? []}
      />

      <TaskDetail
        task={detailTask}
        items={items.data ?? []}
        properties={properties.data ?? []}
        values={detailTask ? (values.data?.[detailTask.id] ?? {}) : {}}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
