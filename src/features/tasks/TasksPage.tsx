import {
  Add20Regular,
  Delete20Regular,
  Options20Regular,
  PanelRightExpand20Regular,
  TaskListSquareLtr24Regular,
} from '@fluentui/react-icons';
import { useCallback, useMemo, useState, type FormEvent } from 'react';

import { describeError } from '@/data/errors';
import {
  useCreateItem,
  useDeleteItem,
  useItems,
  useProperties,
  usePropertyValues,
  useRenameItem,
  useSetItemCompleted,
  useSetPropertyValue,
} from '@/data/hooks';
import { checkTitle, partitionByCompletion, positionForNewItem, type Item } from '@/domain/item';
import type { Property, PropertyValue } from '@/domain/property';
import { PropertyManager } from '@/features/properties/PropertyManager';
import { PropertyValueEditor } from '@/features/properties/PropertyValueEditor';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

import { TaskDetail } from './TaskDetail';

/** The collection seeded by migration 002. One list, until F3 brings views. */
const COLLECTION = 'tasks';

/**
 * How many properties are edited straight from the row.
 *
 * Two. A row is a glance, not a form: past that the line stops being scannable
 * and starts being a spreadsheet nobody asked for. Everything else lives one
 * click away, in the detail panel, using the same editors.
 */
const INLINE_LIMIT = 2;

/** The types that fit in a row: one tap, one choice, no typing. */
const INLINE_TYPES = new Set(['status', 'priority', 'select']);

export function TasksPage() {
  const [draft, setDraft] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [managingProperties, setManagingProperties] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const items = useItems(COLLECTION, true);
  const properties = useProperties(COLLECTION);
  const values = usePropertyValues(COLLECTION);

  const create = useCreateItem();
  const setCompleted = useSetItemCompleted();
  const rename = useRenameItem();
  const remove = useDeleteItem();
  const setValue = useSetPropertyValue();

  const { open, completed } = useMemo(() => partitionByCompletion(items.data ?? []), [items.data]);

  const inlineProperties = useMemo(
    () => (properties.data ?? []).filter((p) => INLINE_TYPES.has(p.type)).slice(0, INLINE_LIMIT),
    [properties.data],
  );

  const detailTask = useMemo(
    () => (items.data ?? []).find((item) => item.id === detailId) ?? null,
    [items.data, detailId],
  );

  const check = checkTitle(draft);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const result = checkTitle(draft);
      if (result.status !== 'ok') return;

      create.mutate(
        {
          collectionId: COLLECTION,
          title: result.title,
          position: positionForNewItem(items.data ?? []),
        },
        // Clearing only after the host accepted it means a rejected write does
        // not silently swallow what the person typed.
        { onSuccess: () => setDraft('') },
      );
    },
    [create, draft, items.data],
  );

  const failure =
    items.error ??
    properties.error ??
    values.error ??
    create.error ??
    setCompleted.error ??
    remove.error ??
    rename.error ??
    setValue.error;

  const readFailed = items.isError || properties.isError || values.isError;

  const renderRow = (task: Item) => (
    <TaskRow
      key={task.id}
      task={task}
      properties={inlineProperties}
      values={values.data?.[task.id] ?? {}}
      onToggle={(completedNow) => setCompleted.mutate({ id: task.id, completed: completedNow })}
      onRename={(title) => rename.mutate({ id: task.id, title })}
      onDelete={() => remove.mutate(task.id)}
      onOpen={() => setDetailId(task.id)}
      onSetValue={(property, value) =>
        setValue.mutate({ itemId: task.id, propertyId: property.id, value })
      }
    />
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-fg">Tasks</h1>
          {/* The count is only stated once the list has actually been read.
              Saying "nothing open" when the read failed would be the interface
              asserting something it does not know. */}
          {items.isSuccess && (
            <p className="mt-1 text-body text-fg-secondary">
              {open.length === 0
                ? 'Nothing open.'
                : `${open.length} open${completed.length > 0 ? `, ${completed.length} done` : ''}`}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {completed.length > 0 && (
            <Button appearance="subtle" onClick={() => setShowCompleted((value) => !value)}>
              {showCompleted ? 'Hide done' : `Show done (${completed.length})`}
            </Button>
          )}
          <Button
            appearance="subtle"
            icon={<Options20Regular />}
            onClick={() => setManagingProperties(true)}
          >
            Properties
          </Button>
        </div>
      </header>

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a task and press Enter"
          aria-label="New task"
          autoFocus
          maxLength={2100}
        />
        <Button
          type="submit"
          appearance="accent"
          icon={<Add20Regular />}
          disabled={check.status !== 'ok' || create.isPending}
        >
          Add
        </Button>
      </form>

      {check.status === 'too-long' && (
        <InfoBar severity="caution" title="That title is too long">
          {check.length.toLocaleString()} characters. The limit is 2,000.
        </InfoBar>
      )}

      {failure && (
        <InfoBar
          severity="danger"
          title={readFailed ? 'The task list could not be read' : 'That change was not saved'}
        >
          {describeError(failure)}
        </InfoBar>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {readFailed ? null : items.isPending ? (
          <div className="flex flex-col gap-1" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-(--density-row) animate-pulse rounded-md bg-card-hover" />
            ))}
          </div>
        ) : open.length === 0 && completed.length === 0 ? (
          <EmptyState
            icon={<TaskListSquareLtr24Regular />}
            title="Nothing here yet"
            description="Everything you write is stored on this machine, in a file you own. Type above to add the first task."
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {open.map(renderRow)}

            {showCompleted && completed.length > 0 && (
              <>
                <li className="mt-4 mb-1 px-1 text-caption font-semibold text-fg-tertiary uppercase">
                  Done
                </li>
                {completed.map(renderRow)}
              </>
            )}
          </ul>
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
        properties={properties.data ?? []}
        values={detailTask ? (values.data?.[detailTask.id] ?? {}) : {}}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

function TaskRow({
  task,
  properties,
  values,
  onToggle,
  onRename,
  onDelete,
  onOpen,
  onSetValue,
}: {
  task: Item;
  properties: Property[];
  values: Readonly<Record<string, unknown>>;
  onToggle: (completed: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onOpen: () => void;
  onSetValue: (property: Property, value: PropertyValue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const done = task.completedAt !== null;

  const commit = () => {
    setEditing(false);
    const result = checkTitle(draft);
    // An emptied title reverts rather than deleting: losing a row because a
    // field was cleared is never what the person meant.
    if (result.status !== 'ok') {
      setDraft(task.title);
      return;
    }
    if (result.title !== task.title) onRename(result.title);
  };

  return (
    <li className="group flex min-h-(--density-row) items-center gap-2 rounded-md px-2 hover:bg-card-hover">
      <Checkbox checked={done} onChange={onToggle} label={`Complete ${task.title}`} />

      {editing ? (
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          aria-label={`Rename ${task.title}`}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-body text-fg outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          className={[
            'min-w-0 flex-1 truncate py-1.5 text-left text-body',
            done ? 'text-fg-tertiary line-through' : 'text-fg',
          ].join(' ')}
        >
          {task.title}
        </button>
      )}

      {properties.map((property) => (
        <span key={property.id} className="hidden shrink-0 sm:block">
          <PropertyValueEditor
            property={property}
            raw={values[property.id]}
            onCommit={(value) => onSetValue(property, value)}
            compact
          />
        </span>
      ))}

      <IconButton
        label={`Open ${task.title}`}
        icon={<PanelRightExpand20Regular />}
        onClick={onOpen}
        // Hidden until the row is hovered or something inside it has focus, so
        // the list stays quiet — but never hidden from the keyboard.
        className="opacity-0 transition-opacity duration-100 ease-easy group-hover:opacity-100 focus-visible:opacity-100"
      />

      <IconButton
        label={`Delete ${task.title}`}
        icon={<Delete20Regular />}
        onClick={onDelete}
        className="opacity-0 transition-opacity duration-100 ease-easy group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
      />
    </li>
  );
}
