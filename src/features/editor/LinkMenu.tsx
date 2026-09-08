import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo } from 'react';

import { useCreatePage, usePages } from '@/data/hooks';
import { between } from '@/domain/ordering';
import { checkTitle, exactly, suggest, PAGE_LINK, type Page } from '@/domain/page';

/** One row of the menu: a page that exists, or the offer to make one. */
type Choice = { kind: 'page'; page: Page } | { kind: 'create'; title: string };

/**
 * The list of pages offered while `[[` is being typed.
 *
 * The last row offers to create what has been typed, when no page has that
 * name — which is how a wiki is written: you link to the page you mean, and it
 * comes into being because you meant it.
 */
export function LinkMenu({
  editor,
  state,
}: {
  editor: Editor;
  state: ReturnType<typeof import('./useLinkMenu').useLinkMenu>;
}) {
  const pages = usePages();
  const create = useCreatePage();
  const { selected, setSelected, close, query, from } = state;

  const choices = useMemo<Choice[]>(() => {
    const all = pages.data ?? [];
    const matches: Choice[] = suggest(query, all).map((page) => ({ kind: 'page', page }));
    const trimmed = query.trim();
    if (
      trimmed !== '' &&
      exactly(trimmed, all) === undefined &&
      checkTitle(trimmed, all) === null
    ) {
      matches.push({ kind: 'create', title: trimmed });
    }
    return matches;
  }, [pages.data, query]);

  const insert = useCallback(
    (pageId: string | null, title: string) => {
      // One chain: the typed "[[query" is replaced by the link itself, plus a
      // space, so the sentence carries on where the person was writing.
      const cursor = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .deleteRange({ from, to: cursor })
        .insertContent([
          { type: PAGE_LINK, attrs: { pageId, title } },
          { type: 'text', text: ' ' },
        ])
        .run();
      close();
    },
    [editor, from, close],
  );

  const choose = useCallback(
    (choice: Choice) => {
      if (choice.kind === 'page') {
        insert(choice.page.id, choice.page.title);
        return;
      }
      // A page made from a link is made now, not on the next save: the link has
      // to point at something, and a person who typed a name meant that page.
      const last = (pages.data ?? []).at(-1);
      create.mutate(
        { title: choice.title, position: between(last?.position ?? null, null) },
        {
          onSuccess: (page) => insert(page.id, page.title),
          // The name was taken between the check and the write: the link is
          // still written, by name, and resolves to whatever now holds it.
          onError: () => insert(null, choice.title),
        },
      );
    },
    [create, insert, pages.data],
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

  return (
    <div
      role="listbox"
      aria-label="Link to a page"
      style={{ top: state.coords.top, left: state.coords.left }}
      className="absolute z-40 max-h-72 w-72 overflow-y-auto rounded-lg border border-stroke bg-flyout p-1 shadow-flyout backdrop-blur-xl"
    >
      {choices.map((choice, index) => (
        <button
          key={choice.kind === 'page' ? choice.page.id : 'create'}
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
            'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left',
            index === selected ? 'bg-card-hover' : '',
          ].join(' ')}
        >
          {choice.kind === 'page' ? (
            <span className="truncate text-body text-fg">{choice.page.title}</span>
          ) : (
            <>
              <span className="text-caption text-fg-tertiary">New page</span>
              <span className="truncate text-body text-fg">{choice.title}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
