import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpload16Regular,
  CheckmarkCircle20Regular,
  Delete16Regular,
  ReOrderDotsVertical16Regular,
} from '@fluentui/react-icons';
import { useMemo, useState, type ClipboardEvent } from 'react';

import { describeError } from '@/data/errors';
import {
  useAddSubtask,
  useDeleteItem,
  useMoveItem,
  usePromoteSubtask,
  useRenameItem,
  useSetItemCompleted,
  useSubtasks,
} from '@/data/hooks';
import { checkTitle, positionForMove, positionForNewItem, type Item } from '@/domain/item';
import { allDone, progressOf, stepsFromText, subtasksByParent } from '@/domain/subtasks';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Meter } from '@/ui/Meter';
import { announce } from '@/ui/announce';

/**
 * The steps inside a task: tick them, type more, drag or key them into order.
 *
 * Pasting a list makes a step of every line. A step that turns out to be work of its
 * own can become a task. When the last one is ticked the task is offered its finish,
 * but never finished for you: a person may still have something to do (ADR-051).
 */
export function Subtasks({
  task,
  siblings,
  compact = false,
}: {
  task: Item;
  /** The tasks beside this one, for where a step made into a task lands. */
  siblings: readonly Item[];
  /** Ticks only, for a screen that is about the task and nothing else. */
  compact?: boolean;
}) {
  const subtasks = useSubtasks();
  const add = useAddSubtask();
  const move = useMoveItem();
  const complete = useSetItemCompleted();
  const [draft, setDraft] = useState('');

  const steps = useMemo(
    () => subtasksByParent(subtasks.data ?? []).get(task.id) ?? [],
    [subtasks.data, task.id],
  );
  const progress = progressOf(steps);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const addAll = async (titles: readonly string[]) => {
    let last = steps;
    for (const title of titles) {
      const position = positionForNewItem(last);
      const made = await add.mutateAsync({ parentId: task.id, title, position });
      last = [...last, made];
    }
    setDraft('');
    announce(titles.length === 1 ? `Added ${titles[0]}` : `Added ${titles.length} subtasks`);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const titles = stepsFromText(event.clipboardData.getData('text'));
    if (titles.length < 2) return;
    event.preventDefault();
    void addAll(titles);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const moving = steps.find((step) => step.id === active.id);
    const without = steps.filter((step) => step.id !== active.id);
    const index = steps.findIndex((step) => step.id === over.id);
    if (moving === undefined || index < 0) return;
    move.mutate({ id: moving.id, position: positionForMove(without, index) });
    announce(`Moved ${moving.title}`);
  };

  if (compact && steps.length === 0) return null;

  const failure = subtasks.error ?? add.error ?? move.error;

  return (
    <section aria-label="Subtasks" data-testid="subtasks" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h3 className="text-caption font-semibold text-fg-tertiary uppercase">Subtasks</h3>
        {progress.total > 0 && (
          <>
            <span className="text-caption tabular-nums text-fg-secondary" data-testid="steps-done">
              {progress.done} of {progress.total}
            </span>
            <Meter
              value={progress.done}
              max={progress.total}
              label={`Subtasks of ${task.title}`}
              valueText={`${progress.done} of ${progress.total} done`}
              tone={allDone(steps) ? 'success' : 'accent'}
              className="min-w-16 flex-1"
            />
          </>
        )}
      </div>

      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="That did not work">
          {describeError(failure)}
        </InfoBar>
      )}

      {steps.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={steps.map((step) => step.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul aria-label={`Subtasks of ${task.title}`} className="flex flex-col gap-0.5">
              {steps.map((step) => (
                <Step key={step.id} step={step} siblings={siblings} compact={compact} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {!compact && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const result = checkTitle(draft);
            if (result.status === 'ok') void addAll([result.title]);
          }}
        >
          <Input
            aria-label="Add a subtask"
            placeholder="Add a subtask, or paste a list"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={onPaste}
          />
        </form>
      )}

      {!compact && allDone(steps) && task.completedAt === null && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/30 bg-success-subtle px-3 py-2"
          data-testid="steps-finished"
        >
          <span className="flex items-center gap-2 text-body text-fg">
            <CheckmarkCircle20Regular aria-hidden="true" className="shrink-0 text-success" />
            Every subtask is done.
          </span>
          <Button
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate(
                { id: task.id, completed: true },
                { onSuccess: () => announce(`Finished ${task.title}`) },
              )
            }
          >
            Finish the task
          </Button>
        </div>
      )}
    </section>
  );
}

function Step({
  step,
  siblings,
  compact,
}: {
  step: Item;
  siblings: readonly Item[];
  compact: boolean;
}) {
  const complete = useSetItemCompleted();
  const rename = useRenameItem();
  const remove = useDeleteItem();
  const promote = usePromoteSubtask();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: step.id, disabled: compact });
  const done = step.completedAt !== null;

  return (
    <li
      ref={setNodeRef}
      data-subtask={step.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group flex items-center gap-1 rounded-md py-0.5 pl-1 hover:bg-card-hover"
    >
      <Checkbox
        checked={done}
        label={`Done: ${step.title}`}
        onChange={(completed) => complete.mutate({ id: step.id, completed })}
      />
      {compact ? (
        <span
          className={`min-w-0 flex-1 px-1 text-left text-body ${done ? 'text-fg-tertiary line-through' : 'text-fg'}`}
        >
          {step.title}
        </span>
      ) : (
        <input
          key={step.title}
          aria-label={`Name of ${step.title}`}
          defaultValue={step.title}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          onBlur={(event) => {
            const result = checkTitle(event.currentTarget.value);
            if (result.status !== 'ok') {
              event.currentTarget.value = step.title;
              return;
            }
            if (result.title !== step.title) rename.mutate({ id: step.id, title: result.title });
          }}
          className={[
            'min-w-0 flex-1 rounded-sm bg-transparent px-1 py-0.5 text-body outline-none',
            'focus-visible:outline-2 focus-visible:outline-accent',
            done ? 'text-fg-tertiary line-through' : 'text-fg',
          ].join(' ')}
        />
      )}
      {!compact && (
        <>
          <IconButton
            label={`Make ${step.title} a task of its own`}
            icon={<ArrowUpload16Regular />}
            disabled={promote.isPending}
            onClick={() =>
              promote.mutate(
                { id: step.id, position: positionForNewItem(siblings) },
                { onSuccess: () => announce(`${step.title} is now a task`) },
              )
            }
          />
          <IconButton
            label={`Delete ${step.title}`}
            icon={<Delete16Regular />}
            onClick={() => remove.mutate(step.id)}
          />
          <IconButton
            ref={setActivatorNodeRef}
            label={`Move ${step.title}`}
            icon={<ReOrderDotsVertical16Regular />}
            className="cursor-grab text-fg-tertiary active:cursor-grabbing"
            {...attributes}
            {...listeners}
          />
        </>
      )}
    </li>
  );
}
