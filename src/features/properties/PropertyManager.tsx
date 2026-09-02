import { Add20Regular, Delete20Regular, LockClosed16Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useCreateProperty, useDeleteProperty, useUpdateProperty } from '@/data/hooks';
import { between } from '@/domain/ordering';
import {
  optionsOf,
  PROPERTY_TYPES,
  type Property,
  type PropertyType,
  type SelectOption,
} from '@/domain/property';
import { Button } from '@/ui/Button';
import { Drawer } from '@/ui/Drawer';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

/** Types whose options a person edits here. The priority scale is fixed. */
const CONFIGURABLE = new Set<PropertyType>(['select', 'multi_select', 'status']);

const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  url: 'Link',
  select: 'Select',
  multi_select: 'Multi-select',
  status: 'Status',
  priority: 'Priority',
  date: 'Date',
  datetime: 'Date and time',
  duration: 'Duration',
};

/**
 * Declaring what a collection's items have.
 *
 * A type is chosen once, at creation, and is not editable afterwards. Changing
 * a property's type would reinterpret every value already stored under it —
 * that is a data migration wearing an edit's clothing, and it needs its own
 * design rather than a dropdown.
 */
export function PropertyManager({
  open,
  onClose,
  collectionId,
  properties,
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  properties: Property[];
}) {
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const remove = useDeleteProperty();

  const [name, setName] = useState('');
  const [type, setType] = useState<PropertyType>('text');

  const failure = create.error ?? update.error ?? remove.error;

  const add = () => {
    if (name.trim() === '') return;
    const last = properties.at(-1);
    create.mutate(
      {
        collectionId,
        name,
        type,
        config: CONFIGURABLE.has(type) ? { options: [] } : {},
        position: between(last ? last.position : null, null),
      },
      { onSuccess: () => setName('') },
    );
  };

  return (
    <Drawer open={open} title="Properties" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {failure && (
          <InfoBar severity="danger" title="That change was not saved">
            {describeError(failure)}
          </InfoBar>
        )}

        <ul className="flex flex-col gap-3">
          {properties.map((property) => (
            <PropertyRow
              key={property.id}
              property={property}
              onRename={(next) =>
                update.mutate({ id: property.id, name: next, config: property.config })
              }
              onOptions={(options) =>
                update.mutate({
                  id: property.id,
                  name: property.name,
                  config: { ...property.config, options },
                })
              }
              onDelete={() => remove.mutate(property.id)}
            />
          ))}
        </ul>

        <section className="rounded-lg border border-stroke-subtle bg-card p-3">
          <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">
            Add a property
          </h3>
          <div className="flex flex-col gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && add()}
              placeholder="Name"
              aria-label="New property name"
            />
            <Select
              value={type}
              aria-label="New property type"
              onChange={(event) => setType(event.target.value as PropertyType)}
            >
              {PROPERTY_TYPES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {TYPE_LABELS[candidate]}
                </option>
              ))}
            </Select>
            <Button
              appearance="accent"
              icon={<Add20Regular />}
              onClick={add}
              disabled={name.trim() === '' || create.isPending}
            >
              Add
            </Button>
            <p className="text-caption text-fg-tertiary">
              The type is chosen once. Changing it later would reinterpret every value already
              stored, so it is not an edit.
            </p>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function PropertyRow({
  property,
  onRename,
  onOptions,
  onDelete,
}: {
  property: Property;
  onRename: (name: string) => void;
  onOptions: (options: SelectOption[]) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(property.name);
  const [newOption, setNewOption] = useState('');
  const options = optionsOf(property);
  const configurable = CONFIGURABLE.has(property.type);

  return (
    <li className="rounded-lg border border-stroke-subtle bg-card p-3">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          aria-label={'Rename ' + property.name}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft.trim() !== '' && draft !== property.name && onRename(draft)}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
        {property.isSystem ? (
          <span
            title="Part of the list — it can be renamed, but not removed"
            className="grid size-(--density-control) shrink-0 place-items-center text-fg-tertiary"
          >
            <LockClosed16Regular />
          </span>
        ) : (
          <IconButton
            label={'Delete ' + property.name}
            icon={<Delete20Regular />}
            onClick={onDelete}
            className="hover:text-danger"
          />
        )}
      </div>

      <p className="mt-1 text-caption text-fg-tertiary">
        {TYPE_LABELS[property.type]} · <code className="font-mono">{property.key}</code>
      </p>

      {configurable && (
        <div className="mt-3 flex flex-col gap-2">
          {options.map((option) => (
            <div key={option.id} className="flex items-center gap-2">
              <Input
                defaultValue={option.label}
                aria-label={'Rename option ' + option.label}
                onBlur={(event) => {
                  const label = event.target.value.trim();
                  if (label === '' || label === option.label) return;
                  onOptions(options.map((o) => (o.id === option.id ? { ...o, label } : o)));
                }}
              />
              <IconButton
                label={'Remove option ' + option.label}
                icon={<Delete20Regular />}
                onClick={() => onOptions(options.filter((o) => o.id !== option.id))}
                className="hover:text-danger"
              />
            </div>
          ))}

          <Input
            value={newOption}
            placeholder="Add an option"
            aria-label={'Add an option to ' + property.name}
            onChange={(event) => setNewOption(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const label = newOption.trim();
              if (label === '') return;
              onOptions([...options, { id: slug(label, options), label, color: null }]);
              setNewOption('');
            }}
          />

          {options.length > 0 && (
            <p className="text-caption text-fg-tertiary">
              Removing an option does not clear it from items that already use it — the value stays,
              and is shown as removed.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** A stable option identifier, unique within the property. */
function slug(label: string, existing: readonly SelectOption[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'option';

  const taken = new Set(existing.map((option) => option.id));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(base + '_' + suffix)) suffix += 1;
  return base + '_' + suffix;
}
