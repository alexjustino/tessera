import {
  ArrowRepeatAll16Regular,
  Delete20Regular,
  Diamond16Filled,
  PanelRightExpand20Regular,
  Warning16Regular,
} from '@fluentui/react-icons';
import { useState } from 'react';

import { checkTitle, type Item } from '@/domain/item';
import type { Property, PropertyValue } from '@/domain/property';
import type { Group, Row } from '@/domain/query';
import { bucketOf, formatDue, systemZone } from '@/domain/schedule';
import { PropertyValueEditor } from '@/features/properties/PropertyValueEditor';
import { Checkbox } from '@/ui/Checkbox';
import { Chip } from '@/ui/Chip';
import { IconButton } from '@/ui/IconButton';

/**
 * The same query, shown as a list.
 *
 * The list is the glance: a title, a checkbox, and only the properties that fit
 * on a line. Everything else is one click away in the detail panel. A row that
 * grows past that stops being scannable and becomes a spreadsheet nobody asked
 * for — which is what the table view is for, deliberately and separately.
 */
export function ListView({
  groups,
  grouped,
  inlineProperties,
  blockedIds,
  criticalIds,
  milestoneIds,
  onToggle,
  onRename,
  onDelete,
  onOpen,
  onSetValue,
}: {
  groups: readonly Group[];
  grouped: boolean;
  inlineProperties: Property[];
  /** Tasks waiting on something unfinished (P1). */
  blockedIds: ReadonlySet<string>;
  /** Tasks that decide when the project ends. Empty when saying so is useless. */
  criticalIds: ReadonlySet<string>;
  /** Moments in the plan rather than work. */
  milestoneIds: ReadonlySet<string>;
  onToggle: (row: Row, completed: boolean) => void;
  onRename: (row: Row, title: string) => void;
  onDelete: (row: Row) => void;
  onOpen: (row: Row) => void;
  onSetValue: (row: Row, property: Property, value: PropertyValue) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        // A declared group with nothing in it is a drop target on a board. In a
        // list it is a heading with nothing under it, so it stays hidden.
        if (grouped && group.rows.length === 0) return null;

        return (
          <section key={group.key ?? '__none__'}>
            {grouped && (
              <h2 className="mb-1 px-1 text-caption font-semibold text-fg-tertiary uppercase">
                {group.label}
                <span className="ml-2 font-normal">{group.rows.length}</span>
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.rows.map((row) => (
                <TaskRow
                  key={row.item.id}
                  task={row.item}
                  blocked={blockedIds.has(row.item.id)}
                  critical={criticalIds.has(row.item.id)}
                  milestone={milestoneIds.has(row.item.id)}
                  properties={inlineProperties}
                  values={row.values}
                  onToggle={(completed) => onToggle(row, completed)}
                  onRename={(title) => onRename(row, title)}
                  onDelete={() => onDelete(row)}
                  onOpen={() => onOpen(row)}
                  onSetValue={(property, value) => onSetValue(row, property, value)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({
  task,
  blocked,
  critical,
  milestone,
  properties,
  values,
  onToggle,
  onRename,
  onDelete,
  onOpen,
  onSetValue,
}: {
  task: Item;
  blocked: boolean;
  critical: boolean;
  milestone: boolean;
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

      <DueChip task={task} />

      {/* A moment in the plan rather than work. A diamond because that is what
          a plan draws — and never the shape alone: the wrapper carries the
          accessible name and the tooltip, the way `IconButton` does. A Fluent
          icon's own `title` becomes a `<title>` inside the SVG, which is not a
          tooltip and not a name. */}
      {milestone && (
        <span
          role="img"
          aria-label="A milestone"
          title="A milestone"
          className="shrink-0 text-accent"
        >
          <Diamond16Filled aria-hidden="true" />
        </span>
      )}

      {/* On the critical path — shown only when something is not, since a chip
          on every row costs a glance and says nothing. */}
      {critical && !done && (
        <Chip tone="accent" title="On the critical path: any delay here moves the end">
          Critical
        </Chip>
      )}

      {/* Waiting on something unfinished.
          Not "Blocked": the seeded status property already offers an option by
          that name, which a person sets by hand and means something else. Two
          different things wearing one word on the same row is how a glance
          starts lying. The whole feature says "waiting" instead — the section
          is Waiting for, the other direction is Waited on by.
          Colour is not the only cue: the word says it, and so does the title. */}
      {blocked && !done && (
        <Chip
          tone="caution"
          title="Waiting for another task to finish — see Waiting for in the detail panel"
        >
          <Warning16Regular aria-hidden="true" />
          Waiting
        </Chip>
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

/**
 * When a task is due, said the way a person would say it.
 *
 * Overdue is red, today is amber, everything else is quiet. A due date that
 * shouts at you three weeks early is a due date you learn to ignore.
 */
function DueChip({ task }: { task: Item }) {
  if (task.dueAt === null) return null;

  const now = new Date().toISOString();
  const zone = systemZone();
  const bucket = bucketOf(task.dueAt, now, zone);
  const repeats = task.recurrenceRule !== null;

  return (
    <span className="hidden shrink-0 sm:block">
      <Chip
        tone={bucket === 'overdue' ? 'danger' : bucket === 'today' ? 'caution' : 'neutral'}
        title={new Date(task.dueAt).toLocaleString()}
      >
        {repeats && <ArrowRepeatAll16Regular aria-hidden="true" />}
        {formatDue(task.dueAt, now, zone)}
      </Chip>
    </span>
  );
}
