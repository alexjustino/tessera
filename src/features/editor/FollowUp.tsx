import { useState } from 'react';

import { useCaptureItem, useItems, useLinkItemPage } from '@/data/hooks';
import { nextWorkingMorning } from '@/domain/followUp';
import { positionForNewItem } from '@/domain/item';
import { systemZone } from '@/domain/schedule';
import { toLocalInput } from '@/features/tasks/localTime';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/**
 * Turn the line the cursor is on into a task, without leaving the note. It lives
 * where tasks live, and when it starts from a page, the two are paired.
 */
export function FollowUp({
  title,
  ownerKind,
  ownerId,
  onDone,
}: {
  /** The line's words, for the person to keep or change. */
  title: string;
  ownerKind: string;
  ownerId: string;
  /** Finished, and whether a task was made. */
  onDone: (made: boolean) => void;
}) {
  const items = useItems(null, true);
  const create = useCaptureItem();
  const link = useLinkItemPage();
  const [name, setName] = useState(title);
  const [due, setDue] = useState(() =>
    toLocalInput(nextWorkingMorning(new Date().toISOString(), systemZone())),
  );

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === '' || due === '') return;
    create.mutate(
      {
        collectionId: 'tasks',
        position: positionForNewItem(items.data ?? []),
        capture: {
          title: trimmed,
          dueAt: new Date(due).toISOString(),
          remindAt: null,
          rule: null,
          priority: null,
          chips: [],
        },
        priorityPropertyId: null,
      },
      {
        onSuccess: (item) => {
          if (ownerKind === 'page') link.mutate({ itemId: item.id, pageId: ownerId });
          announce(`Follow-up added: ${item.title}`);
          onDone(true);
        },
      },
    );
  };

  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-2 border-t border-stroke-subtle pt-1"
      data-testid="follow-up"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        aria-label="Follow-up task"
        placeholder="What needs doing"
        value={name}
        className="min-w-48 flex-1"
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        type="datetime-local"
        aria-label="Follow-up due"
        value={due}
        onChange={(event) => setDue(event.target.value)}
      />
      <Button type="submit" disabled={create.isPending || name.trim() === '' || due === ''}>
        Add follow-up
      </Button>
      <Button appearance="subtle" onClick={() => onDone(false)}>
        Cancel
      </Button>
    </form>
  );
}
