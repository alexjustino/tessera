import { Add16Regular, TextBulletListLtr20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useCollections, useColorList, useCreateList, useItems } from '@/data/hooks';
import { isColor, nextColor, SWATCH } from '@/domain/colors';
import {
  checkListName,
  INBOX,
  openByList,
  orderedLists,
  positionForNewList,
  WHAT_A_LIST_IS,
} from '@/domain/lists';
import { Input } from '@/ui/Input';
import { announce } from '@/ui/announce';

/**
 * The person's own lists, under Tasks in the rail (ADR-053), and the way to make one.
 *
 * Tasks itself is the entry above: it is the inbox, and the rail already names it.
 * Each list says how many open tasks it holds, in words for a screen reader.
 */
export function SidebarLists({
  activeListId,
  onOpenList,
}: {
  /** The list on screen, or null when the screen is not a list. */
  activeListId: string | null;
  onOpenList: (id: string) => void;
}) {
  const collections = useCollections();
  const items = useItems(null, false);
  const create = useCreateList();
  const colour = useColorList();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const lists = useMemo(() => orderedLists(collections.data ?? []), [collections.data]);
  const open = useMemo(() => openByList(items.data ?? []), [items.data]);
  const mine = lists.filter((list) => list.id !== INBOX);

  const save = () => {
    const result = checkListName(draft, lists);
    if (result.status === 'invalid') {
      setProblem(result.reason);
      return;
    }
    create.mutate(
      { name: result.name, position: positionForNewList(lists) },
      {
        onSuccess: (list) => {
          // A new list is told apart from the others by a colour of its own.
          colour.mutate({ id: list.id, color: nextColor(lists.map((one) => one.color)) });
          setAdding(false);
          setDraft('');
          setProblem(null);
          announce(`Made the list ${list.name}`);
          onOpenList(list.id);
        },
        onError: (error) => setProblem(describeError(error)),
      },
    );
  };

  return (
    <div role="group" aria-label="Lists" className="mb-1 flex flex-col gap-0.5 pl-4">
      {mine.map((list) => {
        const selected = list.id === activeListId;
        const count = open.get(list.id) ?? 0;
        return (
          <button
            key={list.id}
            type="button"
            data-list={list.id}
            aria-current={selected ? 'page' : undefined}
            aria-label={`${list.name}, ${count} open`}
            title={list.name}
            onClick={() => onOpenList(list.id)}
            className={[
              'flex h-(--density-row) items-center gap-3 rounded-md px-3 text-body',
              'transition-colors duration-100 ease-easy hover:bg-card-hover',
              selected ? 'bg-accent-subtle font-semibold text-fg' : 'text-fg-secondary',
            ].join(' ')}
          >
            <span aria-hidden="true" className="grid w-5 shrink-0 place-items-center">
              {isColor(list.color) ? (
                <span className={`size-2.5 rounded-full ${SWATCH[list.color]}`} />
              ) : (
                <TextBulletListLtr20Regular className={selected ? 'text-accent' : ''} />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{list.name}</span>
            {count > 0 && (
              <span aria-hidden="true" className="text-caption tabular-nums text-fg-tertiary">
                {count}
              </span>
            )}
          </button>
        );
      })}

      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          className="flex flex-col gap-1 px-1"
        >
          <Input
            // Opened by a press on purpose, so the line is where the typing goes.
            autoFocus
            aria-label="Name of the new list"
            placeholder="List name"
            value={draft}
            maxLength={80}
            disabled={create.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAdding(false);
                setDraft('');
                setProblem(null);
              }
            }}
            onBlur={() => {
              if (draft.trim() === '') {
                setAdding(false);
                setProblem(null);
              }
            }}
          />
          {problem !== null ? (
            <p role="alert" className="px-1 text-caption text-danger">
              {problem}
            </p>
          ) : (
            <p className="px-1 text-caption text-fg-secondary">{WHAT_A_LIST_IS}</p>
          )}
        </form>
      ) : (
        <button
          type="button"
          title={WHAT_A_LIST_IS}
          onClick={() => setAdding(true)}
          className={[
            'flex h-(--density-row) items-center gap-3 rounded-md px-3 text-body text-fg-secondary',
            'transition-colors duration-100 ease-easy hover:bg-card-hover',
          ].join(' ')}
        >
          <Add16Regular aria-hidden="true" />
          New list
        </button>
      )}
    </div>
  );
}
