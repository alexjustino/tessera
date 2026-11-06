import { useMemo } from 'react';

import { describeError } from '@/data/errors';
import { useCollections, useItems, useMoveToList } from '@/data/hooks';
import { positionForNewItem, type Item } from '@/domain/item';
import { orderedLists } from '@/domain/lists';
import { InfoBar } from '@/ui/InfoBar';
import { Select } from '@/ui/Select';
import { announce } from '@/ui/announce';

/**
 * Which list a task lives in, and the way to move it (ADR-053). Shown only once there
 * is more than one list. Its subtasks go with it; its values go where they fit.
 */
export function ListPicker({ task }: { task: Item }) {
  const collections = useCollections();
  const all = useItems(null, true);
  const move = useMoveToList();
  const lists = useMemo(() => orderedLists(collections.data ?? []), [collections.data]);

  if (lists.length < 2) return null;

  return (
    <div className="mb-4 flex flex-col gap-1">
      <label htmlFor={`list-of-${task.id}`} className="text-caption text-fg-secondary">
        List
      </label>
      <Select
        id={`list-of-${task.id}`}
        value={task.collectionId}
        disabled={move.isPending}
        onChange={(event) => {
          const target = lists.find((list) => list.id === event.target.value);
          if (target === undefined) return;
          const there = (all.data ?? []).filter((item) => item.collectionId === target.id);
          move.mutate(
            { id: task.id, collectionId: target.id, position: positionForNewItem(there) },
            { onSuccess: () => announce(`Moved ${task.title} to ${target.name}`) },
          );
        }}
      >
        {lists.map((list) => (
          <option key={list.id} value={list.id}>
            {list.name}
          </option>
        ))}
      </Select>
      {move.error !== null && (
        <InfoBar severity="danger" title="It was not moved">
          {describeError(move.error)}
        </InfoBar>
      )}
    </div>
  );
}
