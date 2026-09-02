import { ArrowSortDown16Regular, ArrowSortUp16Regular } from '@fluentui/react-icons';

import type { Property, PropertyValue } from '@/domain/property';
import {
  fieldKey,
  sameField,
  type FieldRef,
  type Group,
  type Query,
  type Row,
} from '@/domain/query';
import { PropertyValueEditor } from '@/features/properties/PropertyValueEditor';
import { Checkbox } from '@/ui/Checkbox';

/**
 * The same query, shown as a grid.
 *
 * A table earns its place by making a column comparable down the page, which is
 * why the headers sort: clicking one replaces the sort rather than adding to it,
 * because a person clicking a header means "order by this", not "and then by
 * this". Multiple sorts are built deliberately, in the filter panel.
 */
export function TableView({
  groups,
  properties,
  query,
  onQueryChange,
  onToggle,
  onSetValue,
  onOpen,
}: {
  groups: readonly Group[];
  properties: Property[];
  query: Query;
  onQueryChange: (query: Query) => void;
  onToggle: (row: Row, completed: boolean) => void;
  onSetValue: (row: Row, property: Property, value: PropertyValue) => void;
  onOpen: (row: Row) => void;
}) {
  const sortBy = (field: FieldRef) => {
    const current = query.sorts[0];
    const already = current !== undefined && sameField(current.field, field);
    // Third click clears it: a header that can only cycle between two states
    // gives no way back to the manual order.
    if (already && current.direction === 'desc') {
      onQueryChange({ ...query, sorts: [] });
      return;
    }
    onQueryChange({
      ...query,
      sorts: [{ field, direction: already && current.direction === 'asc' ? 'desc' : 'asc' }],
    });
  };

  const indicator = (field: FieldRef) => {
    const current = query.sorts[0];
    if (current === undefined || !sameField(current.field, field)) return null;
    return current.direction === 'asc' ? (
      <ArrowSortUp16Regular className="text-accent" />
    ) : (
      <ArrowSortDown16Regular className="text-accent" />
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-body">
        <thead>
          <tr className="border-b border-stroke-subtle">
            <th scope="col" className="w-8" />
            <SortableHeader
              label="Title"
              onSort={() => sortBy({ kind: 'builtin', field: 'title' })}
              indicator={indicator({ kind: 'builtin', field: 'title' })}
            />
            {properties.map((property) => (
              <SortableHeader
                key={property.id}
                label={property.name}
                onSort={() => sortBy({ kind: 'property', propertyId: property.id })}
                indicator={indicator({ kind: 'property', propertyId: property.id })}
              />
            ))}
          </tr>
        </thead>

        <tbody>
          {groups.map((group) => (
            <GroupRows
              key={group.key ?? '__none__'}
              group={group}
              grouped={query.groupBy !== null}
              properties={properties}
              onToggle={onToggle}
              onSetValue={onSetValue}
              onOpen={onOpen}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  onSort,
  indicator,
}: {
  label: string;
  onSort: () => void;
  indicator: React.ReactNode;
}) {
  return (
    <th scope="col" className="p-0 text-left font-semibold">
      <button
        type="button"
        onClick={onSort}
        className="flex w-full items-center gap-1 px-2 py-2 text-left text-caption text-fg-tertiary uppercase hover:text-fg"
      >
        {label}
        {indicator}
      </button>
    </th>
  );
}

function GroupRows({
  group,
  grouped,
  properties,
  onToggle,
  onSetValue,
  onOpen,
}: {
  group: Group;
  grouped: boolean;
  properties: Property[];
  onToggle: (row: Row, completed: boolean) => void;
  onSetValue: (row: Row, property: Property, value: PropertyValue) => void;
  onOpen: (row: Row) => void;
}) {
  // A declared group with nothing in it is worth showing on a board, where it
  // is a drop target. In a table it is a blank heading, so it stays hidden.
  if (grouped && group.rows.length === 0) return null;

  return (
    <>
      {grouped && (
        <tr>
          <th
            colSpan={properties.length + 2}
            scope="colgroup"
            className="pt-5 pb-1 text-left text-caption font-semibold text-fg-tertiary uppercase"
          >
            {group.label}
            <span className="ml-2 font-normal">{group.rows.length}</span>
          </th>
        </tr>
      )}

      {group.rows.map((row) => (
        <tr key={row.item.id} className="group border-b border-stroke-subtle hover:bg-card-hover">
          <td className="px-1">
            <Checkbox
              checked={row.item.completedAt !== null}
              label={`Complete ${row.item.title}`}
              onChange={(completed) => onToggle(row, completed)}
            />
          </td>
          <td className="max-w-md px-2 py-1">
            <button
              type="button"
              onClick={() => onOpen(row)}
              className={[
                'block w-full truncate text-left',
                row.item.completedAt !== null ? 'text-fg-tertiary line-through' : 'text-fg',
              ].join(' ')}
            >
              {row.item.title}
            </button>
          </td>
          {properties.map((property) => (
            <td key={fieldKey({ kind: 'property', propertyId: property.id })} className="px-2 py-1">
              <PropertyValueEditor
                property={property}
                raw={row.values[property.id]}
                onCommit={(value) => onSetValue(row, property, value)}
                compact
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
