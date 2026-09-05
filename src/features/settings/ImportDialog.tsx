import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useApplyImport, useCollections, useEvents, useItems, useCalendars } from '@/data/hooks';
import type { PlacedPlan } from '@/data/importing';
import {
  decide,
  describe,
  preview,
  normalise,
  type ImportPlan,
  type ImportedCollection,
} from '@/domain/importing';
import { sortItems, type Collection, type Item } from '@/domain/item';
import { firstKey, sequence, sortByKey } from '@/domain/ordering';
import { systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';
import { announce } from '@/ui/announce';

/**
 * What an import would do, before it does it.
 *
 * The plan is set against the workspace and the dialog says, in one sentence
 * and then in a list, what would be created and what looks like something
 * already here. Duplicates are a guess and are named as such; the one choice
 * offered is whether to skip them. Then one button, and the import is one
 * transaction — and one entry in the list of imports, from where it can be
 * undone as one thing.
 */
export function ImportDialog({
  plan,
  onClose,
  onImported,
}: {
  /** Null keeps the dialog closed. */
  plan: ImportPlan | null;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const zone = useMemo(() => systemZone(), []);
  const collections = useCollections();
  const items = useItems(null, true);
  const calendars = useCalendars();
  // Every event, for duplicates: a wide window rather than a scale's.
  const events = useEvents(
    '1970-01-01T00:00:00.000Z',
    '2100-01-01T00:00:00.000Z',
    calendars.data ?? [],
  );
  const apply = useApplyImport();
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  const shown = useMemo(
    () =>
      plan === null
        ? null
        : preview(
            plan,
            {
              collections: collections.data ?? [],
              items: items.data ?? [],
              events: events.data ?? [],
            },
            zone,
          ),
    [plan, collections.data, items.data, events.data, zone],
  );

  const run = () => {
    if (plan === null || shown === null) return;
    const decided = decide(plan, shown, skipDuplicates);
    apply.mutate(place(decided, collections.data ?? [], items.data ?? []), {
      onSuccess: (batch) => {
        const message = `Imported ${batch.summary.tasks} ${batch.summary.tasks === 1 ? 'task' : 'tasks'}, ${batch.summary.events} ${batch.summary.events === 1 ? 'event' : 'events'} and ${batch.summary.collections} new ${batch.summary.collections === 1 ? 'collection' : 'collections'} from ${batch.source}.`;
        announce(message);
        onImported(message);
        onClose();
      },
    });
  };

  const duplicateRows =
    shown === null ? [] : shown.tasks.filter((task) => task.duplicateOf !== null);
  const duplicateEvents =
    shown === null ? [] : shown.events.filter((event) => event.duplicateOf !== null);

  return (
    <Modal open={plan !== null} label="Import" onClose={onClose} width="lg">
      {shown !== null && (
        <div className="flex flex-col gap-4" data-testid="import-preview">
          <header>
            <h2 className="text-subtitle font-semibold text-fg">Import</h2>
            <p className="mt-1 text-body text-fg-secondary" data-testid="import-summary">
              {describe(shown)} Nothing here is replaced; rows are added, and the whole import can
              be undone afterwards.
            </p>
          </header>

          {apply.error !== null && (
            <InfoBar severity="danger" title="The import did not complete">
              {describeError(apply.error)}
            </InfoBar>
          )}

          {shown.warnings.length > 0 && (
            <InfoBar severity="caution" title="Left out of the file, or not carried">
              <ul className="list-disc pl-4">
                {shown.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </InfoBar>
          )}

          {shown.counts.duplicates > 0 && (
            <section aria-label="Possible duplicates" className="flex flex-col gap-2">
              <Checkbox
                checked={skipDuplicates}
                label={`Skip the ${shown.counts.duplicates} that look like something already here`}
                onChange={setSkipDuplicates}
              />
              <ul className="ml-6 flex flex-col gap-0.5 text-caption text-fg-tertiary">
                {duplicateRows.slice(0, 8).map((task) => (
                  <li key={task.key} data-testid="import-duplicate">
                    {task.title} <span className="text-fg-disabled">· {task.collection}</span>
                  </li>
                ))}
                {duplicateEvents.slice(0, 4).map((event) => (
                  <li key={event.key} data-testid="import-duplicate">
                    {event.title} <span className="text-fg-disabled">· event</span>
                  </li>
                ))}
                {shown.counts.duplicates > 12 && <li>…and {shown.counts.duplicates - 12} more.</li>}
              </ul>
            </section>
          )}

          <ul className="flex flex-col gap-0.5 text-caption text-fg-secondary">
            {shown.collections.map((collection) => (
              <li key={collection.name}>
                {collection.action === 'create' ? 'New collection' : 'Into'}{' '}
                <span className="font-semibold text-fg">{collection.name}</span>
              </li>
            ))}
          </ul>

          <div className="flex justify-end gap-2">
            <Button appearance="subtle" onClick={onClose} disabled={apply.isPending}>
              Cancel
            </Button>
            <Button
              appearance="accent"
              onClick={run}
              disabled={
                apply.isPending ||
                (shown.counts.tasks === 0 && shown.counts.events === 0) ||
                !items.isSuccess
              }
            >
              Import
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Positions for what the import creates: a new collection goes after the last
 * one; tasks into an existing collection go after its last, tasks into a new
 * one start from the first key. The host does not own the ordering scheme, so
 * the caller hands positions in (ADR-026).
 */
function place(
  plan: ImportPlan,
  collections: readonly Collection[],
  items: readonly Item[],
): PlacedPlan {
  const byName = new Map(collections.map((c) => [normalise(c.name), c]));
  const lastCollection = sortByKey(collections, (c) => c.position).at(-1);
  const collectionPositions = sequence(
    lastCollection?.position ?? null,
    null,
    plan.collections.length,
  );

  const groups = new Map<string, number[]>();
  plan.tasks.forEach((task, index) => {
    const key = normalise(task.collection);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const positions = new Array<string>(plan.tasks.length);
  for (const [key, indices] of groups) {
    const existing = byName.get(key);
    const last =
      existing === undefined
        ? null
        : (sortItems(items.filter((item) => item.collectionId === existing.id)).at(-1)?.position ??
          null);
    const run =
      last === null
        ? sequence(firstKey(), null, indices.length)
        : sequence(last, null, indices.length);
    indices.forEach((taskIndex, offset) => {
      positions[taskIndex] = run[offset]!;
    });
  }

  return {
    source: plan.source,
    collections: plan.collections.map((collection: ImportedCollection, index) => ({
      ...collection,
      position: collectionPositions[index]!,
    })),
    tasks: plan.tasks.map((task, index) => ({ ...task, position: positions[index]! })),
    events: plan.events,
  };
}
