import { Add20Regular, Delete20Regular, TaskListSquareLtr24Regular } from '@fluentui/react-icons';
import { useCallback, useMemo, useState, type FormEvent } from 'react';

import { describeError } from '@/data/errors';
import {
  useCreateItem,
  useDeleteItem,
  useItems,
  useRenameItem,
  useSetItemCompleted,
} from '@/data/hooks';
import { checkTitle, partitionByCompletion, positionForNewItem, type Item } from '@/domain/item';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';

/** The collection seeded by migration 002. One list, until F3 brings views. */
const COLLECTION = 'tasks';

/**
 * The first vertical slice, end to end.
 *
 * Type a task, it is written to SQLite; it appears in the list; tick it and the
 * completion time is recorded; close the application and it is all still there.
 * Nothing here is a placeholder — every layer between this component and the
 * file on disk is the real one.
 */
export function TasksPage() {
  const [draft, setDraft] = useState('');
  const [showCompleted, setShowCompleted] = useState(true);

  const items = useItems(COLLECTION, true);
  const create = useCreateItem();
  const setCompleted = useSetItemCompleted();
  const rename = useRenameItem();
  const remove = useDeleteItem();

  const { open, completed } = useMemo(() => partitionByCompletion(items.data ?? []), [items.data]);

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

  const failure = items.error ?? create.error ?? setCompleted.error ?? remove.error ?? rename.error;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 p-6">
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
        {completed.length > 0 && (
          <Button appearance="subtle" onClick={() => setShowCompleted((value) => !value)}>
            {showCompleted ? 'Hide done' : `Show done (${completed.length})`}
          </Button>
        )}
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
          title={items.isError ? 'The task list could not be read' : 'That change was not saved'}
        >
          {describeError(failure)}
        </InfoBar>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.isError ? null : items.isPending ? (
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
            {open.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={(completedNow) =>
                  setCompleted.mutate({ id: task.id, completed: completedNow })
                }
                onRename={(title) => rename.mutate({ id: task.id, title })}
                onDelete={() => remove.mutate(task.id)}
              />
            ))}

            {showCompleted && completed.length > 0 && (
              <>
                <li className="mt-4 mb-1 px-1 text-caption font-semibold text-fg-tertiary uppercase">
                  Done
                </li>
                {completed.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={(completedNow) =>
                      setCompleted.mutate({ id: task.id, completed: completedNow })
                    }
                    onRename={(title) => rename.mutate({ id: task.id, title })}
                    onDelete={() => remove.mutate(task.id)}
                  />
                ))}
              </>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onRename,
  onDelete,
}: {
  task: Item;
  onToggle: (completed: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
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
    <li className="group flex min-h-(--density-row) items-center gap-3 rounded-md px-2 hover:bg-card-hover">
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

      <IconButton
        label={`Delete ${task.title}`}
        icon={<Delete20Regular />}
        onClick={onDelete}
        // Hidden until the row is hovered or something inside it has focus, so
        // the list stays quiet — but never hidden from the keyboard.
        className="opacity-0 transition-opacity duration-100 ease-easy group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
      />
    </li>
  );
}
