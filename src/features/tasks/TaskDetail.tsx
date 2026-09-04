import { useSetPropertyValue, useSetSchedule } from '@/data/hooks';
import { type Timing } from '@/domain/criticalPath';
import { type Item } from '@/domain/item';
import { type Schedule } from '@/domain/schedule';
import { type Property, type PropertyValue } from '@/domain/property';
import { Editor } from '@/features/editor/Editor';

import { Dependencies } from './Dependencies';
import { PlanEditor } from './PlanEditor';

import { ScheduleEditor } from './ScheduleEditor';
import { PropertyValueEditor } from '@/features/properties/PropertyValueEditor';
import { Drawer } from '@/ui/Drawer';
import { EmptyState } from '@/ui/EmptyState';

/**
 * Everything about one task, editable in place.
 *
 * The inline row carries the two or three fields worth seeing at a glance; this
 * is where the rest live. Both use the same editor, so a type behaves the same
 * wherever it is edited.
 */
export function TaskDetail({
  task,
  items,
  timing,
  properties,
  values,
  onClose,
}: {
  task: Item | null;
  /** Every task in the collection — what the dependency picker offers. */
  items: readonly Item[];
  /** This task's place in the plan, from the whole collection (P2). */
  timing: Timing | undefined;
  properties: Property[];
  values: Readonly<Record<string, unknown>>;
  onClose: () => void;
}) {
  const setValue = useSetPropertyValue();
  const setSchedule = useSetSchedule();
  const now = new Date().toISOString();

  const commit = (property: Property, value: PropertyValue) => {
    if (task === null) return;
    setValue.mutate({ itemId: task.id, propertyId: property.id, value });
  };

  const schedule: Schedule =
    task === null
      ? { startAt: null, dueAt: null, remindAt: null, rule: null, mode: 'schedule' }
      : {
          startAt: task.startAt,
          dueAt: task.dueAt,
          remindAt: task.remindAt,
          rule: task.recurrenceRule,
          mode: task.recurrenceMode,
        };

  return (
    <Drawer open={task !== null} title={task?.title ?? ''} onClose={onClose}>
      {task !== null && (
        <section className="mb-5 border-b border-stroke-subtle pb-5">
          <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">Schedule</h3>
          <ScheduleEditor
            schedule={schedule}
            now={now}
            onChange={(next) => setSchedule.mutate({ id: task.id, schedule: next })}
          />
        </section>
      )}

      {properties.length === 0 ? (
        <EmptyState
          title="No properties yet"
          description="Add one from the Properties panel and it will appear here for every task in this list."
        />
      ) : (
        <dl className="flex flex-col gap-4">
          {properties.map((property) => (
            <div key={property.id}>
              <dt className="mb-1.5 text-caption font-semibold text-fg-tertiary uppercase">
                {property.name}
              </dt>
              <dd>
                <PropertyValueEditor
                  property={property}
                  raw={values[property.id]}
                  onCommit={(value) => commit(property, value)}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {task !== null && <PlanEditor task={task} timing={timing} />}

      {task !== null && <Dependencies task={task} items={items} />}

      {task !== null && (
        <section className="mt-6 border-t border-stroke-subtle pt-4">
          <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">Notes</h3>
          {/* Keyed on the item, so opening a different task builds a fresh
              editor rather than pouring one document into another's state. */}
          <Editor key={task.id} ownerKind="item" ownerId={task.id} />
        </section>
      )}

      {task !== null && (
        <p className="mt-6 text-caption text-fg-tertiary">
          Created {new Date(task.createdAt).toLocaleString()}
          {task.completedAt !== null &&
            ` · completed ${new Date(task.completedAt).toLocaleString()}`}
        </p>
      )}
    </Drawer>
  );
}
