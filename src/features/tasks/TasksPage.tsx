import {
  Add20Regular,
  CopyAdd20Regular,
  Options20Regular,
  Print20Regular,
  TaskListSquareLtr24Regular,
} from '@fluentui/react-icons';
import { Suspense, useCallback, useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCaptureItem,
  useCollections,
  useCompleteOccurrence,
  useDependencies,
  useDeleteItem,
  useItemPages,
  useItems,
  usePages,
  useProperties,
  usePropertyValues,
  useRenameItem,
  useSetItemCompleted,
  useSetSchedule,
  useSubtasks,
  useMoveOnBoard,
  useSetPropertyValue,
  useTimeEntries,
  useUpdateView,
  useViews,
} from '@/data/hooks';
import { EMPTY_BOARD_CONFIG, type BoardConfig } from '@/domain/board';
import { formatDuration, plan as computePlan } from '@/domain/criticalPath';
import { isBlocked } from '@/domain/graph';
import { runningEntry } from '@/domain/time';
import type { Capture } from '@/domain/capture';
import { positionForNewItem } from '@/domain/item';
import { INBOX } from '@/domain/lists';
import { nextOccurrence, systemZone } from '@/domain/schedule';
import type { Page as NotesPage } from '@/domain/page';
import type { Property, PropertyValue } from '@/domain/property';
import { EMPTY_QUERY, flatten, run, type Query, type Row } from '@/domain/query';
import { inSlice, type Slice } from '@/domain/overview';
import { todayMarkOf, type TodayMark } from '@/domain/pulse';
import { progressOf, subtasksByParent, type Progress } from '@/domain/subtasks';
import { dueForToday } from '@/domain/today';
import { BoardView, CalendarView, TableView, TimelineView } from '@/app/lazyPages';
import { CaptureLine } from '@/features/capture/CaptureLine';
import { GettingStarted, type SettingsCard } from '@/features/guide/GettingStarted';
import { PropertyManager } from '@/features/properties/PropertyManager';
import { Skeleton } from '@/ui/Skeleton';
import { ListView } from '@/features/views/ListView';
import { QueryBar } from '@/features/views/QueryBar';
import { ComingUp } from './ComingUp';
import { ListActions } from './ListActions';
import { NowCard } from './NowCard';
import { ReplanCard } from './ReplanCard';
import { TasksOverview } from './TasksOverview';
import { FinishedToday, TodayAgenda, TodayOverview } from './TodayOverview';
import { usePulse } from './usePulse';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Page } from '@/ui/Page';
import { TabStrip } from '@/ui/TabStrip';
import { announce } from '@/ui/announce';
import { useNow } from '@/ui/useNow';

import { TaskDetail } from './TaskDetail';
import { TemplatesDialog } from './TemplatesDialog';

/** The collection seeded by migration 002. */

/**
 * How many properties are edited straight from a list row.
 *
 * Two. A row is a glance, not a form. The table view exists for the rest, which
 * is why it is a separate kind rather than a wider list.
 */
const INLINE_LIMIT = 2;

/** The types that fit in a row: one tap, one choice, no typing. */
const INLINE_TYPES = new Set(['status', 'priority', 'select']);

/** The places in the rail this page serves, and what each one calls itself. */
export type TasksPlace = 'tasks' | 'today' | 'board' | 'calendar';

const PLACES: Record<TasksPlace, { title: string; viewId: string | null; say: string | null }> = {
  tasks: { title: 'Tasks', viewId: null, say: null },
  today: {
    title: 'Today',
    viewId: 'view.today',
    say: 'What is due today or already late, from every list. Everything else stays in its list.',
  },
  board: { title: 'Board', viewId: 'tasks.board', say: null },
  calendar: { title: 'Calendar', viewId: 'view.calendar', say: null },
};

/** Views with a place of their own in the rail: a second way in only confused the two. */
const RAIL_VIEWS = new Set(['view.today', 'tasks.board', 'view.calendar']);

/** A list's board is the Board in the rail, whichever list it belongs to. */
const railView = (view: { id: string; kind: string }) =>
  RAIL_VIEWS.has(view.id) || view.kind === 'board';

export function TasksPage({
  place = 'tasks',
  collectionId = INBOX,
  onListDeleted,
  initialDetailId = null,
  onFocus,
  onShowAll,
  onOpenSettings,
  onOpenPage,
}: {
  /** Which place in the rail this is. */
  place?: TasksPlace;
  /** The list shown on Tasks and on the Board (ADR-053). Today reads every list. */
  collectionId?: string;
  /** Go somewhere else once the list on screen has been deleted. */
  onListDeleted?: () => void;
  /** Go to the whole list, from a place that shows part of it. */
  onShowAll?: () => void;
  /** Go to a page, from a task it is about. */
  onOpenPage?: (pageId: string) => void;
  /** Open a card in Settings, from the getting-started guide. */
  onOpenSettings?: (card: SettingsCard) => void;
  /** An item to open on mount — how the palette lands on a search hit. */
  initialDetailId?: string | null;
  /** Enter focus mode on a task (P8). Absent where the page has no shell to hand it to. */
  onFocus?: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [managingProperties, setManagingProperties] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editingQuery, setEditingQuery] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId);

  const [activeViewId, setActiveViewId] = useState<string | null>(PLACES[place].viewId);
  /** The query as it is being edited. Null means "whatever the view saved". */
  const [draftQuery, setDraftQuery] = useState<Query | null>(null);
  /** The board settings as they are being edited, on the same terms. */
  const [draftBoard, setDraftBoard] = useState<BoardConfig | null>(null);
  /** The part of the list a figure in the overview was pressed for. */
  const [slice, setSlice] = useState<Slice | null>(null);

  // Today is across every list; Tasks and the Board show one. Properties and views are
  // a list's own, so Today reads the inbox's and a row from another list shows none.
  const items = useItems(place === 'today' ? null : collectionId, true);
  const shapeOf = place === 'today' ? INBOX : collectionId;
  const properties = useProperties(shapeOf);
  const values = usePropertyValues(shapeOf);
  const views = useViews(shapeOf);
  const collections = useCollections();
  const list = (collections.data ?? []).find((candidate) => candidate.id === collectionId);
  const listNames = useMemo(
    () => new Map((collections.data ?? []).map((candidate) => [candidate.id, candidate.name])),
    [collections.data],
  );

  const create = useCaptureItem();
  const setCompleted = useSetItemCompleted();
  const rename = useRenameItem();
  const remove = useDeleteItem();
  const setValue = useSetPropertyValue();
  const moveOnBoard = useMoveOnBoard();
  const completeOccurrence = useCompleteOccurrence();
  const saveView = useUpdateView();
  const setSchedule = useSetSchedule();

  const view = useMemo(() => {
    const all = views.data ?? [];
    // Every list has a board of its own, made with it; the Board shows the list's.
    if (place === 'board') {
      return (
        all.find(
          (candidate) => candidate.kind === 'board' && candidate.collectionId === collectionId,
        ) ?? null
      );
    }
    return (
      all.find((candidate) => candidate.id === activeViewId) ??
      all.find((candidate) => !railView(candidate)) ??
      null
    );
  }, [views.data, activeViewId, place, collectionId]);

  const query = draftQuery ?? view?.query ?? EMPTY_QUERY;
  const board = draftBoard ?? view?.board ?? EMPTY_BOARD_CONFIG;
  const dirty = (draftQuery !== null || draftBoard !== null) && view !== null;

  const dependencies = useDependencies();
  const timeEntries = useTimeEntries();
  const now = useNow(60_000);

  // What is waiting on something unfinished. Computed once here, from the
  // whole graph, rather than asked per row.
  const blockedIds = useMemo(() => {
    const edges = dependencies.data ?? [];
    const all = items.data ?? [];
    const done = new Set(all.filter((item) => item.completedAt !== null).map((item) => item.id));
    return new Set(
      all.filter((item) => isBlocked(edges, item.id, (id) => done.has(id))).map((item) => item.id),
    );
  }, [dependencies.data, items.data]);

  const rows: Row[] = useMemo(() => {
    const zone = systemZone();
    return (items.data ?? [])
      .filter((item) => slice === null || inSlice(item, slice, blockedIds, now, zone))
      .map((item) => ({
        item,
        values: values.data?.[item.id] ?? {},
      }));
  }, [items.data, values.data, slice, blockedIds, now]);

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
  // The detail edits the task's own list's properties, which on Today may be another's.
  const detailShape = detailTask?.collectionId ?? shapeOf;
  const detailProperties = useProperties(detailShape);
  const detailValues = usePropertyValues(detailShape);

  /**
   * The plan over this collection: how long it takes, what decides the end.
   *
   * Computed over every task, completed ones included — the critical path is a
   * statement about the plan as designed, not about what is left to do.
   */
  const planned = useMemo(
    () =>
      computePlan(
        (items.data ?? []).map((item) => ({
          id: item.id,
          estimateMinutes: item.estimateMinutes,
          isMilestone: item.isMilestone,
        })),
        dependencies.data ?? [],
      ),
    [items.data, dependencies.data],
  );

  /**
   * Marking the critical path is only worth doing when something is *not* on
   * it. A straight chain is entirely critical, and a chip on every row says
   * nothing while costing a glance.
   */
  const criticalIds = useMemo(
    () =>
      planned.unplanned || planned.critical.size === (items.data ?? []).length
        ? new Set<string>()
        : planned.critical,
    [planned, items.data],
  );

  const milestoneIds = useMemo(
    () => new Set((items.data ?? []).filter((item) => item.isMilestone).map((item) => item.id)),
    [items.data],
  );

  // The one running clock, if any. The row only needs to know which task it is
  // on; how long it has been going is the detail panel's business, and only it
  // ticks.
  const timingId = runningEntry(timeEntries.data ?? [])?.itemId ?? null;

  const priorityPropertyId = useMemo(
    () => (properties.data ?? []).find((property) => property.type === 'priority')?.id ?? null,
    [properties.data],
  );

  const submit = useCallback(
    (capture: Capture) => {
      create.mutate(
        {
          collectionId: place === 'today' ? INBOX : collectionId,
          position: positionForNewItem(
            (items.data ?? []).filter(
              (item) => item.collectionId === (place === 'today' ? INBOX : collectionId),
            ),
          ),
          // Typed on Today, with no date of its own: today is what was meant, and
          // anything else would vanish from the screen it was just typed on.
          capture:
            place === 'today'
              ? {
                  ...capture,
                  dueAt: dueForToday(capture.dueAt, new Date().toISOString(), systemZone()),
                }
              : capture,
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
    [create, items.data, priorityPropertyId, place, collectionId],
  );

  const pulse = usePulse(items.data ?? []);

  // How far along each task's subtasks are, for its row and its card.
  const subtasks = useSubtasks();
  const stepsOf = useMemo(() => {
    const found = new Map<string, Progress>();
    for (const [parent, steps] of subtasksByParent(subtasks.data ?? [])) {
      found.set(parent, progressOf(steps));
    }
    return found;
  }, [subtasks.data]);

  // Which pages are applied to each task, for its row and its card to say so.
  const pages = usePages();
  const itemPages = useItemPages();
  const notesOf = useMemo(() => {
    const byId = new Map((pages.data ?? []).map((page) => [page.id, page]));
    const found = new Map<string, NotesPage[]>();
    for (const pair of itemPages.data ?? []) {
      const page = byId.get(pair.pageId);
      if (page !== undefined) found.set(pair.itemId, [...(found.get(pair.itemId) ?? []), page]);
    }
    return found;
  }, [pages.data, itemPages.data]);

  // Why each card on the board matters today, for the ones where it does.
  const marks = useMemo(() => {
    const zone = systemZone();
    const reservedToday = new Set(
      pulse.agenda.flatMap((occurrence) =>
        occurrence.event.itemId === null ? [] : [occurrence.event.itemId],
      ),
    );
    const found = new Map<string, TodayMark>();
    for (const item of items.data ?? []) {
      const mark = todayMarkOf(item, reservedToday, timingId, now, zone);
      if (mark !== null) found.set(item.id, mark);
    }
    return found;
  }, [items.data, pulse.agenda, timingId, now]);

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
    <Page className="h-full">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-fg">
            {place === 'tasks' && list !== undefined
              ? list.name
              : place === 'board' && list !== undefined && collectionId !== INBOX
                ? `Board · ${list.name}`
                : PLACES[place].title}
          </h1>
          {PLACES[place].say !== null && (
            <p className="mt-1 text-body text-fg-secondary">{PLACES[place].say}</p>
          )}
          {/* Stated only once the list has actually been read. Saying "nothing
              open" when the read failed would be the interface asserting
              something it does not know. */}
          {items.isSuccess && place !== 'calendar' && (place !== 'today' || result.matched > 0) && (
            <p className="mt-1 text-body text-fg-secondary">
              {result.matched === 0
                ? 'Nothing to show.'
                : `${result.matched} item${result.matched === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Prints whatever view is on screen — the list, the table, or the
              timeline, which has a rendering of its own for paper. */}
          <Button
            appearance="subtle"
            icon={<Print20Regular />}
            className="print-hide"
            onClick={() => window.print()}
          >
            Print
          </Button>
          {place === 'tasks' && list !== undefined && collectionId !== INBOX && (
            <ListActions
              list={list}
              held={(items.data ?? []).length}
              onDeleted={() => onListDeleted?.()}
            />
          )}
          {/* Ways to shape the whole list, so they live where the whole list is. */}
          {place !== 'today' && place !== 'calendar' && (
            <>
              <Button
                appearance="subtle"
                icon={<CopyAdd20Regular />}
                onClick={() => setTemplatesOpen(true)}
              >
                Templates
              </Button>
              <Button
                appearance="subtle"
                icon={<Options20Regular />}
                onClick={() => setManagingProperties(true)}
              >
                Properties
              </Button>
            </>
          )}
        </div>
      </header>

      {!planned.unplanned && place !== 'today' && place !== 'calendar' && (
        <p className="-mt-1 text-caption text-fg-tertiary">
          {formatDuration(planned.durationMinutes)} of work on the longest route
          {planned.longestChain.length > 1 && `, through ${planned.longestChain.length} tasks`}
          {planned.unestimatedOnPath.length > 0 &&
            ` · ${planned.unestimatedOnPath.length} of them without an estimate`}
          .
        </p>
      )}

      {/* A line for typing into, the view tabs and the filter summary are all
          things to press. Paper gets the list they produced. */}
      <div className="print-hide contents">
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
      </div>

      {failure && (
        <InfoBar
          severity="danger"
          title={readFailed ? 'The task list could not be read' : 'That change was not saved'}
        >
          {describeError(failure)}
        </InfoBar>
      )}

      {place === 'tasks' && items.isSuccess && (
        <TasksOverview
          items={items.data}
          blocked={blockedIds}
          properties={properties.data ?? []}
          values={values.data ?? {}}
          slice={slice}
          onSlice={setSlice}
        />
      )}

      {place === 'tasks' && (views.data ?? []).length > 0 && (
        <div className="print-hide">
          <TabStrip
            tabs={(views.data ?? [])
              .filter((candidate) => !railView(candidate))
              .map((candidate) => ({
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
        </div>
      )}

      {view !== null && place !== 'today' && place !== 'calendar' && (
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
        {/* Inside what scrolls: above it, the guide would squeeze the list to nothing. */}
        {(place === 'tasks' || place === 'today') && items.isSuccess && (
          <div className="mb-3">
            <GettingStarted items={items.data} onOpenSettings={onOpenSettings} />
          </div>
        )}
        {place === 'today' && items.isSuccess && (
          <div className="mb-4 flex flex-col gap-3">
            <NowCard items={items.data} onFocus={onFocus} onOpen={setDetailId} />
            <ReplanCard />
            <TodayOverview pulse={pulse} />
          </div>
        )}
        <div
          className={
            place === 'today'
              ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]'
              : 'contents'
          }
        >
          <div className={place === 'today' ? 'min-w-0' : 'contents'}>
            <Suspense fallback={<Skeleton />}>
              {readFailed ? null : items.isPending ? (
                <div className="flex flex-col gap-1" aria-hidden="true">
                  {[0, 1, 2].map((skeleton) => (
                    <div
                      key={skeleton}
                      className="h-(--density-row) animate-pulse rounded-md bg-card-hover"
                    />
                  ))}
                </div>
              ) : view?.kind === 'calendar' ? (
                // Before the empty states: the calendar is events, working hours,
                // days off and the year, none of which needs a task to exist. An
                // empty workspace — or one with only an imported calendar — showed
                // "Nothing here yet" instead of its calendar until 1.3.
                <CalendarView
                  // Work with no time reserved for it. The panel exists so a person
                  // can drag it onto the grid, which is the whole point of the slice.
                  unscheduled={(items.data ?? []).filter((item) => item.completedAt === null)}
                  onOpenItem={(item) => setDetailId(item.id)}
                  onOpenPage={onOpenPage}
                />
              ) : (items.data ?? []).length === 0 ? (
                <EmptyState
                  icon={<TaskListSquareLtr24Regular />}
                  title="Nothing here yet"
                  description="Everything you write is stored on this machine, in a file you own. Type above to add the first task."
                />
              ) : result.matched === 0 && place === 'today' ? (
                <EmptyState
                  title="Nothing is due today"
                  description="Type above and it lands here. A task whose date comes round shows up on its own."
                />
              ) : result.matched === 0 && slice !== null ? (
                <EmptyState
                  title="No task here"
                  description="Nothing in this view is in the figure you pressed."
                  action={<Button onClick={() => setSlice(null)}>Show every task</Button>}
                />
              ) : result.matched === 0 ? (
                <EmptyState
                  title="No item matches this view"
                  description="The items are still there — this view's filters just do not include any of them."
                  action={<Button onClick={() => setEditingQuery(true)}>Change the filters</Button>}
                />
              ) : view?.kind === 'timeline' ? (
                <TimelineView
                  items={items.data ?? []}
                  edges={dependencies.data ?? []}
                  critical={criticalIds}
                  onOpen={(item) => setDetailId(item.id)}
                  onShift={(item, startAt, dueAt) =>
                    setSchedule.mutate({
                      id: item.id,
                      schedule: {
                        startAt,
                        dueAt,
                        remindAt: item.remindAt,
                        rule: item.recurrenceRule,
                        mode: item.recurrenceMode,
                      },
                    })
                  }
                />
              ) : view?.kind === 'board' ? (
                <BoardView
                  groups={result.groups}
                  items={items.data ?? []}
                  properties={properties.data ?? []}
                  query={query}
                  board={board}
                  marks={marks}
                  notesOf={notesOf}
                  stepsOf={stepsOf}
                  onOpenPage={onOpenPage}
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
                  listNameOf={place === 'today' ? listNames : undefined}
                  groups={result.groups}
                  grouped={query.groupBy !== null}
                  notesOf={notesOf}
                  stepsOf={stepsOf}
                  onOpenPage={onOpenPage}
                  blockedIds={blockedIds}
                  criticalIds={criticalIds}
                  milestoneIds={milestoneIds}
                  timingId={timingId}
                  inlineProperties={inlineProperties}
                  onToggle={toggleRow}
                  onRename={(row, title) => rename.mutate({ id: row.item.id, title })}
                  onDelete={(row) => remove.mutate(row.item.id)}
                  onOpen={(row) => setDetailId(row.item.id)}
                  onSetValue={setRowValue}
                />
              )}
            </Suspense>
          </div>
          {place === 'today' && items.isSuccess && (
            <aside aria-label="Around today" className="flex min-w-0 flex-col gap-3">
              <TodayAgenda pulse={pulse} now={now} />
              <FinishedToday pulse={pulse} />
              <ComingUp
                items={items.data}
                onOpen={(item) => setDetailId(item.id)}
                onShowAll={onShowAll}
              />
            </aside>
          )}
        </div>
      </div>

      <TemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        collectionId={collectionId}
        shown={flatten(result).map((row) => row.item)}
        all={items.data ?? []}
        edges={dependencies.data ?? []}
      />

      <PropertyManager
        open={managingProperties}
        onClose={() => setManagingProperties(false)}
        collectionId={collectionId}
        properties={properties.data ?? []}
      />

      <TaskDetail
        task={detailTask}
        items={items.data ?? []}
        timing={detailTask ? planned.timing.get(detailTask.id) : undefined}
        properties={detailProperties.data ?? []}
        values={detailTask ? (detailValues.data?.[detailTask.id] ?? {}) : {}}
        onClose={() => setDetailId(null)}
        onFocus={onFocus}
        onOpenPage={onOpenPage}
        onOpenItem={setDetailId}
      />
    </Page>
  );
}
