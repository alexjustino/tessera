import { Delete20Regular, PanelRightExpand20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { checkTitle, type Item } from '@/domain/item';
import type { Property, PropertyValue } from '@/domain/property';
import type { Group, Row } from '@/domain/query';
import { PropertyValueEditor } from '@/features/properties/PropertyValueEditor';
import { Checkbox } from '@/ui/Checkbox';
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
  onToggle,
  onRename,
  onDelete,
  onOpen,
  onSetValue,
}: {
  groups: readonly Group[];
  grouped: boolean;
  inlineProperties: Property[];
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
