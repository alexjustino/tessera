import { Delete20Regular, Rename20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useCollections, useDeleteList, useRenameList } from '@/data/hooks';
import type { Collection } from '@/domain/item';
import { checkListName } from '@/domain/lists';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { announce } from '@/ui/announce';

/**
 * Rename a list, or delete it once it is empty (ADR-053).
 *
 * Deleting a list that still holds tasks is not offered as a choice at all: the
 * press says what is in the way. A list takes its tasks with it, and a press that
 * looked like tidying a heading must not destroy work.
 */
export function ListActions({
  list,
  held,
  onDeleted,
}: {
  list: Collection;
  /** Tasks in the list, finished ones included. */
  held: number;
  onDeleted: () => void;
}) {
  const collections = useCollections();
  const rename = useRenameList();
  const remove = useDeleteList();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    const result = checkListName(draft, collections.data ?? [], list.id);
    if (result.status === 'invalid') {
      setProblem(result.reason);
      return;
    }
    rename.mutate(
      { id: list.id, name: result.name },
      {
        onSuccess: () => {
          setRenaming(false);
          setProblem(null);
          announce(`Renamed to ${result.name}`);
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  return (
    <>
      {renaming ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            // Opened by a press on purpose, so the field is where the typing goes.
            autoFocus
            aria-label="New name of the list"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setRenaming(false);
                setDraft(list.name);
                setProblem(null);
              }
            }}
            className="w-48"
          />
          <Button type="submit" disabled={rename.isPending}>
            Save
          </Button>
        </form>
      ) : (
        <Button
          appearance="subtle"
          icon={<Rename20Regular />}
          onClick={() => {
            setDraft(list.name);
            setRenaming(true);
          }}
        >
          Rename list
        </Button>
      )}
      <Button
        appearance="subtle"
        icon={<Delete20Regular />}
        onClick={() => {
          if (held > 0) {
            setProblem(
              `${list.name} still holds ${held === 1 ? '1 task' : `${held} tasks`}. Move or delete ${held === 1 ? 'it' : 'them'} first.`,
            );
            return;
          }
          setConfirming(true);
        }}
      >
        Delete list
      </Button>
      {problem !== null && (
        <div className="w-full basis-full" role="alert">
          <InfoBar severity="caution" title="Not yet">
            {problem}
          </InfoBar>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Delete ${list.name}?`}
        confirmLabel="Delete the list"
        danger
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(list.id, {
            onSuccess: () => {
              setConfirming(false);
              announce(`Deleted the list ${list.name}`);
              onDeleted();
            },
            onError: (error) => {
              setConfirming(false);
              setProblem(describeError(error));
            },
          })
        }
      >
        It is empty. Its saved views and properties go with it.
      </ConfirmDialog>
    </>
  );
}
