import { Circle16Regular, Document16Regular, DocumentAdd16Regular } from '@fluentui/react-icons';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo } from 'react';

import { useCreatePage, useItems, useLinkItemPage, usePages } from '@/data/hooks';
import { isCompleted, type Item } from '@/domain/item';
import { between } from '@/domain/ordering';
import {
  checkTitle,
  exactly,
  suggest,
  titleKey,
  PAGE_LINK,
  TASK_LINK,
  type Page,
} from '@/domain/page';

import { LinkPreviewBody, type LinkTarget } from './LinkPreview';

/** One row of the menu: a page, a task, or the offer to make a page. */
type Choice =
  { kind: 'page'; page: Page } | { kind: 'task'; item: Item } | { kind: 'create'; title: string };

/** How many tasks are offered: the menu is for finding one, not for reading them all. */
const TASKS_SHOWN = 5;

function tasksMatching(query: string, items: readonly Item[]): Item[] {
  const key = titleKey(query);
  return items
    .filter((item) => !isCompleted(item) && (key === '' || titleKey(item.title).includes(key)))
    .slice(0, TASKS_SHOWN);
}

function targetOf(choice: Choice): LinkTarget {
  if (choice.kind === 'page') {
    return { kind: 'page', id: choice.page.id, title: choice.page.title };
  }
  if (choice.kind === 'task') return { kind: 'task', id: choice.item.id, title: choice.item.title };
  return { kind: 'missing', title: choice.title };
}

/**
 * The list offered while `[[` is being typed: pages, tasks, and what each choice
 * would do, shown before it is chosen.
 *
 * The last page row offers to create what has been typed, when no page has that
 * name — which is how a wiki is written: you link to the page you mean, and it
 * comes into being because you meant it.
 */
export function LinkMenu({
  editor,
  state,
  ownerKind,
  ownerId,
}: {
  editor: Editor;
  state: ReturnType<typeof import('./useLinkMenu').useLinkMenu>;
  ownerKind: string;
  ownerId: string;
}) {
  const pages = usePages();
  const items = useItems(null, true);
  const create = useCreatePage();
  const pair = useLinkItemPage();
  const { selected, setSelected, close, query, from } = state;

  const choices = useMemo<Choice[]>(() => {
    const all = pages.data ?? [];
    const matches: Choice[] = suggest(query, all, 6).map((page) => ({ kind: 'page', page }));
    const trimmed = query.trim();
    if (
      trimmed !== '' &&
      exactly(trimmed, all) === undefined &&
      checkTitle(trimmed, all) === null
    ) {
      matches.push({ kind: 'create', title: trimmed });
    }
    for (const item of tasksMatching(query, items.data ?? [])) {
      matches.push({ kind: 'task', item });
    }
    return matches;
  }, [pages.data, items.data, query]);

  const insert = useCallback(
    (node: { type: string; attrs: Record<string, unknown> }) => {
      // One chain: the typed "[[query" is replaced by the link itself, plus a
      // space, so the sentence carries on where the person was writing.
      const cursor = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .deleteRange({ from, to: cursor })
        .insertContent([node, { type: 'text', text: ' ' }])
        .run();
      close();
    },
    [editor, from, close],
  );

  const choose = useCallback(
    (choice: Choice) => {
      if (choice.kind === 'page') {
        insert({ type: PAGE_LINK, attrs: { pageId: choice.page.id, title: choice.page.title } });
        return;
      }
      if (choice.kind === 'task') {
        insert({ type: TASK_LINK, attrs: { itemId: choice.item.id, title: choice.item.title } });
        // A page that names a task is about that task: the pair is what both show.
        if (ownerKind === 'page') pair.mutate({ itemId: choice.item.id, pageId: ownerId });
        return;
      }
      // A page made from a link is made now, not on the next save: the link has
      // to point at something, and a person who typed a name meant that page.
      const last = (pages.data ?? []).at(-1);
      create.mutate(
        { title: choice.title, position: between(last?.position ?? null, null) },
        {
          onSuccess: (page) =>
            insert({ type: PAGE_LINK, attrs: { pageId: page.id, title: page.title } }),
          // The name was taken between the check and the write: the link is
          // still written, by name, and resolves to whatever now holds it.
          onError: () => insert({ type: PAGE_LINK, attrs: { pageId: null, title: choice.title } }),
        },
      );
    },
    [create, insert, pages.data, pair, ownerKind, ownerId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (choices.length === 0) {
        if (event.key === 'Escape') close();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((selected + 1) % choices.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((selected - 1 + choices.length) % choices.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const choice = choices[selected];
        if (choice) choose(choice);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    // Captured on the way down: Enter must choose a page rather than split the
    // paragraph the link is being written into.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [choices, selected, setSelected, choose, close]);

  if (choices.length === 0) return null;

  const current = choices[selected] ?? choices[0];

  return (
    <div
      style={{ top: state.coords.top, left: state.coords.left }}
      className="absolute z-40 flex w-[34rem] max-w-[90vw] overflow-hidden rounded-lg border border-stroke bg-flyout shadow-flyout backdrop-blur-xl"
    >
      <div
        role="listbox"
        aria-label="Link to a page or a task"
        className="max-h-72 w-72 shrink-0 overflow-y-auto border-r border-stroke-subtle p-1"
      >
        {choices.map((choice, index) => (
          <button
            key={
              choice.kind === 'page'
                ? choice.page.id
                : choice.kind === 'task'
                  ? choice.item.id
                  : 'create'
            }
            type="button"
            role="option"
            aria-selected={index === selected}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(event) => {
              // The editor must not lose the selection before the click lands.
              event.preventDefault();
              choose(choice);
            }}
            className={[
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
              index === selected ? 'bg-card-hover' : '',
            ].join(' ')}
          >
            {choice.kind === 'page' ? (
              <>
                <Document16Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
                <span className="truncate text-body text-fg">{choice.page.title}</span>
              </>
            ) : choice.kind === 'task' ? (
              <>
                <Circle16Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
                <span className="min-w-0 flex-1 truncate text-body text-fg">
                  {choice.item.title}
                </span>
                <span className="shrink-0 text-caption text-fg-tertiary">Task</span>
              </>
            ) : (
              <>
                <DocumentAdd16Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
                <span className="text-caption text-fg-tertiary">New page</span>
                <span className="truncate text-body text-fg">{choice.title}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 p-3" data-testid="link-menu-preview">
        {current !== undefined && <LinkPreviewBody target={targetOf(current)} />}
      </div>
    </div>
  );
}
