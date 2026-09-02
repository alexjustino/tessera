import { Add20Regular, Delete20Regular, Filter20Regular } from '@fluentui/react-icons';

import { columnKeyToStorage, type BoardConfig } from '@/domain/board';
import { optionsOf, type Property, type PropertyValue } from '@/domain/property';
import {
  BUILTIN_FIELDS,
  BUILTIN_LABELS,
  fieldKey,
  operatorsFor,
  OPERATOR_LABELS,
  VALUELESS,
  type FieldRef,
  type Filter,
  type Group,
  type Operator,
  type Query,
  type Sort,
} from '@/domain/query';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Drawer } from '@/ui/Drawer';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/**
 * Editing the query a view saves.
 *
 * Everything here changes the query in the caller's hand; nothing is written
 * until the caller saves. A filter you are halfway through writing already
 * affects the list you are looking at — that live feedback is the point, and it
 * is only safe because an unfinished filter accepts everything rather than
 * hiding the screen (see `accepts`).
 */
export function QueryBar({
  query,
  board,
  columns,
  isBoard,
  properties,
  onChange,
  onBoardChange,
  matched,
  total,
  open,
  onOpenChange,
  onSave,
  dirty,
}: {
  query: Query;
  board: BoardConfig;
  columns: readonly Group[];
  isBoard: boolean;
  properties: Property[];
  onChange: (query: Query) => void;
  onBoardChange: (board: BoardConfig) => void;
  matched: number;
  total: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  dirty: boolean;
}) {
  const fields = allFields(properties);

  const summary = [
    query.filters.length > 0 &&
      `${query.filters.length} filter${query.filters.length === 1 ? '' : 's'}`,
    query.sorts.length > 0 && `sorted by ${labelOf(query.sorts[0]!.field, properties)}`,
    query.groupBy !== null && `grouped by ${labelOf(query.groupBy, properties)}`,
    !query.includeCompleted && 'hiding done',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="flex items-center justify-between gap-3 py-1">
        <p className="truncate text-caption text-fg-tertiary">
          {summary === '' ? 'No filters' : summary}
          {matched !== total && ` · showing ${matched} of ${total}`}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {dirty && (
            <Button appearance="accent" onClick={onSave}>
              Save view
            </Button>
          )}
          <Button appearance="subtle" icon={<Filter20Regular />} onClick={() => onOpenChange(true)}>
            Filter &amp; sort
          </Button>
        </div>
      </div>

      <Drawer open={open} title="Filter and sort" onClose={() => onOpenChange(false)}>
        <div className="flex flex-col gap-6">
          <section>
            <Heading>Filters</Heading>
            {query.filters.length > 1 && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-caption text-fg-tertiary">Match</span>
                <Select
                  value={query.match}
                  aria-label="How filters combine"
                  className="w-auto"
                  onChange={(event) =>
                    onChange({ ...query, match: event.target.value === 'any' ? 'any' : 'all' })
                  }
                >
                  <option value="all">every filter</option>
                  <option value="any">any filter</option>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {query.filters.map((filter, index) => (
                <FilterRow
                  key={filter.id}
                  filter={filter}
                  fields={fields}
                  properties={properties}
                  onChange={(next) =>
                    onChange({
                      ...query,
                      filters: query.filters.map((f, i) => (i === index ? next : f)),
                    })
                  }
                  onRemove={() =>
                    onChange({ ...query, filters: query.filters.filter((_, i) => i !== index) })
                  }
                />
              ))}
            </div>

            <Button
              appearance="subtle"
              icon={<Add20Regular />}
              className="mt-2"
              onClick={() => {
                const field = fields[0];
                if (!field) return;
                onChange({
                  ...query,
                  filters: [
                    ...query.filters,
                    {
                      id: `f${Date.now()}`,
                      field,
                      operator: operatorsOf(field, properties)[0] ?? 'is',
                      value: null,
                    },
                  ],
                });
              }}
            >
              Add a filter
            </Button>
          </section>

          <section>
            <Heading>Sort</Heading>
            <div className="flex flex-col gap-2">
              {query.sorts.map((sort, index) => (
                <SortRow
                  key={fieldKey(sort.field) + index}
                  sort={sort}
                  fields={fields}
                  properties={properties}
                  onChange={(next) =>
                    onChange({
                      ...query,
                      sorts: query.sorts.map((s, i) => (i === index ? next : s)),
                    })
                  }
                  onRemove={() =>
                    onChange({ ...query, sorts: query.sorts.filter((_, i) => i !== index) })
                  }
                />
              ))}
            </div>

            <Button
              appearance="subtle"
              icon={<Add20Regular />}
              className="mt-2"
              onClick={() => {
                const field = fields[0];
                if (!field) return;
                onChange({ ...query, sorts: [...query.sorts, { field, direction: 'asc' }] });
              }}
            >
              Add a sort
            </Button>
            {query.sorts.length > 1 && (
              <p className="mt-2 text-caption text-fg-tertiary">
                Each sort only applies where the one above it ties.
              </p>
            )}
          </section>

          <section>
            <Heading>Group</Heading>
            <Select
              value={query.groupBy === null ? '' : fieldKey(query.groupBy)}
              aria-label="Group by"
              onChange={(event) =>
                onChange({
                  ...query,
                  groupBy: fields.find((f) => fieldKey(f) === event.target.value) ?? null,
                })
              }
            >
              <option value="">Do not group</option>
              {fields
                .filter((field) => groupable(field, properties))
                .map((field) => (
                  <option key={fieldKey(field)} value={fieldKey(field)}>
                    {labelOf(field, properties)}
                  </option>
                ))}
            </Select>
          </section>

          {isBoard && (
            <section>
              <Heading>Board</Heading>

              <p className="mb-2 text-caption text-fg-tertiary">
                A limit does not stop a card being moved. It makes a column that is too full look
                too full, which is the point &mdash; a limit that blocks the work only teaches
                people to route around it.
              </p>

              <div className="flex flex-col gap-2">
                {columns.map((column) => {
                  const key = columnKeyToStorage(column.key);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-body text-fg-secondary">
                        {column.label === '' ? 'No value' : column.label}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        className="w-24"
                        aria-label={'Work-in-progress limit for ' + column.label}
                        placeholder="No limit"
                        value={board.wipLimits[key] ?? ''}
                        onChange={(event) => {
                          const text = event.target.value;
                          const next = { ...board.wipLimits };
                          if (text === '') delete next[key];
                          else next[key] = Math.max(0, Number(text));
                          onBoardChange({ ...board, wipLimits: next });
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <h4 className="mt-4 mb-2 text-caption font-semibold text-fg-tertiary uppercase">
                On the card
              </h4>
              <div className="flex flex-wrap gap-2">
                {properties.map((property) => {
                  const on = board.cardProperties.includes(property.id);
                  return (
                    <button
                      key={property.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        onBoardChange({
                          ...board,
                          cardProperties: on
                            ? board.cardProperties.filter((id) => id !== property.id)
                            : [...board.cardProperties, property.id],
                        })
                      }
                      className={[
                        'rounded-sm border px-2 py-1 text-caption font-semibold',
                        'transition-colors duration-100 ease-easy',
                        on
                          ? 'border-accent/30 bg-accent-subtle text-accent'
                          : 'border-stroke-subtle bg-card text-fg-secondary hover:bg-card-hover',
                      ].join(' ')}
                    >
                      {property.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <Heading>Completed</Heading>
            <label className="flex items-center gap-2 text-body text-fg">
              <Checkbox
                checked={query.includeCompleted}
                label="Show completed items"
                onChange={(checked) => onChange({ ...query, includeCompleted: checked })}
              />
              Show completed items
            </label>
          </section>
        </div>
      </Drawer>
    </>
  );
}

function Heading({ children }: { children: string }) {
  return <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">{children}</h3>;
}

function FilterRow({
  filter,
  fields,
  properties,
  onChange,
  onRemove,
}: {
  filter: Filter;
  fields: FieldRef[];
  properties: Property[];
  onChange: (filter: Filter) => void;
  onRemove: () => void;
}) {
  const operators = operatorsOf(filter.field, properties);
  // Bound to a local so the narrowing survives the second access.
  const field = filter.field;
  const property =
    field.kind === 'property' ? (properties.find((p) => p.id === field.propertyId) ?? null) : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-stroke-subtle bg-card p-2">
      <div className="flex items-center gap-2">
        <Select
          value={fieldKey(filter.field)}
          aria-label="Field to filter on"
          onChange={(event) => {
            const field = fields.find((f) => fieldKey(f) === event.target.value);
            if (!field) return;
            // The operator and the value belong to the old field. Keeping them
            // would leave a filter that reads as nonsense, so both reset.
            onChange({
              ...filter,
              field,
              operator: operatorsOf(field, properties)[0] ?? 'is',
              value: null,
            });
          }}
        >
          {fields.map((field) => (
            <option key={fieldKey(field)} value={fieldKey(field)}>
              {labelOf(field, properties)}
            </option>
          ))}
        </Select>
        <IconButton
          label="Remove this filter"
          icon={<Delete20Regular />}
          onClick={onRemove}
          className="hover:text-danger"
        />
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={filter.operator}
          aria-label="How to compare"
          onChange={(event) => onChange({ ...filter, operator: event.target.value as Operator })}
        >
          {operators.map((operator) => (
            <option key={operator} value={operator}>
              {OPERATOR_LABELS[operator]}
            </option>
          ))}
        </Select>

        {!VALUELESS.has(filter.operator) && (
          <FilterValue
            property={property}
            value={filter.value}
            onChange={(value) => onChange({ ...filter, value })}
          />
        )}
      </div>
    </div>
  );
}

function FilterValue({
  property,
  value,
  onChange,
}: {
  property: Property | null;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
}) {
  const options = property === null ? [] : optionsOf(property);

  if (options.length > 0) {
    return (
      <Select
        value={value === null ? '' : String(value)}
        aria-label="Value to compare against"
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  const numeric = property?.type === 'number' || property?.type === 'duration';

  return (
    <Input
      type={numeric ? 'number' : property?.type === 'date' ? 'date' : 'text'}
      value={value === null ? '' : String(value)}
      aria-label="Value to compare against"
      placeholder="Value"
      onChange={(event) => {
        const text = event.target.value;
        if (text === '') return onChange(null);
        onChange(numeric ? Number(text) : text);
      }}
    />
  );
}

function SortRow({
  sort,
  fields,
  properties,
  onChange,
  onRemove,
}: {
  sort: Sort;
  fields: FieldRef[];
  properties: Property[];
  onChange: (sort: Sort) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={fieldKey(sort.field)}
        aria-label="Field to sort by"
        onChange={(event) => {
          const field = fields.find((f) => fieldKey(f) === event.target.value);
          if (field) onChange({ ...sort, field });
        }}
      >
        {fields.map((field) => (
          <option key={fieldKey(field)} value={fieldKey(field)}>
            {labelOf(field, properties)}
          </option>
        ))}
      </Select>
      <Select
        value={sort.direction}
        aria-label="Sort direction"
        className="w-auto"
        onChange={(event) =>
          onChange({ ...sort, direction: event.target.value === 'desc' ? 'desc' : 'asc' })
        }
      >
        <option value="asc">ascending</option>
        <option value="desc">descending</option>
      </Select>
      <IconButton
        label="Remove this sort"
        icon={<Delete20Regular />}
        onClick={onRemove}
        className="hover:text-danger"
      />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function allFields(properties: Property[]): FieldRef[] {
  return [
    ...BUILTIN_FIELDS.map((field): FieldRef => ({ kind: 'builtin', field })),
    ...properties.map((property): FieldRef => ({ kind: 'property', propertyId: property.id })),
  ];
}

function labelOf(field: FieldRef, properties: Property[]): string {
  if (field.kind === 'builtin') return BUILTIN_LABELS[field.field];
  return properties.find((p) => p.id === field.propertyId)?.name ?? 'Removed field';
}

function operatorsOf(field: FieldRef, properties: Property[]): Operator[] {
  if (field.kind === 'builtin') return operatorsFor(null, field.field);
  const property = properties.find((p) => p.id === field.propertyId) ?? null;
  return operatorsFor(property);
}

/** Only a field with a known, finite set of values makes sense as a grouping. */
function groupable(field: FieldRef, properties: Property[]): boolean {
  if (field.kind === 'builtin') return field.field === 'completed';
  const property = properties.find((p) => p.id === field.propertyId);
  return (
    property !== undefined &&
    ['select', 'status', 'priority', 'multi_select', 'checkbox'].includes(property.type)
  );
}
