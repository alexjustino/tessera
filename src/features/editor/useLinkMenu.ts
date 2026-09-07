import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';

export interface LinkState {
  open: boolean;
  /** What has been typed after the two brackets. */
  query: string;
  /** Where the `[[` starts, so choosing a page can replace it. */
  from: number;
  coords: { top: number; left: number };
  selected: number;
  setSelected: (index: number) => void;
  close: () => void;
}

/**
 * Watch the editor for a page link being typed.
 *
 * Opens on `[[`, anywhere in a sentence — unlike the slash menu, which only
 * opens on an empty paragraph, because a link is written *inside* a thought
 * and a block is written instead of one.
 *
 * The query stops at the first `]`, so a person who types the closing brackets
 * themselves gets what they meant rather than a menu that never closes.
 */
export function useLinkMenu(editor: Editor | null): LinkState {
  const [state, setState] = useState({
    open: false,
    query: '',
    from: 0,
    coords: { top: 0, left: 0 },
  });
  const [selected, setSelected] = useState(0);

  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);

  useEffect(() => {
    if (editor === null) return;

    const check = () => {
      const { state: editorState } = editor;
      const { $from, empty } = editorState.selection;
      if (!empty || !$from.parent.isTextblock) return close();

      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const opened = before.lastIndexOf('[[');
      if (opened < 0) return close();

      const typed = before.slice(opened + 2);
      // A closed pair is a finished link or a piece of prose; either way the
      // menu has no business being open over it.
      if (typed.includes(']') || typed.includes('[') || typed.length > 200) return close();

      const from = $from.start() + opened;
      const caret = editor.view.coordsAtPos(from);
      const container = editor.view.dom.getBoundingClientRect();

      setState((current) => {
        if (current.open && current.query === typed && current.from === from) return current;
        setSelected(0);
        return {
          open: true,
          query: typed,
          from,
          coords: { top: caret.bottom - container.top + 6, left: caret.left - container.left },
        };
      });
    };

    editor.on('transaction', check);
    return () => {
      editor.off('transaction', check);
    };
  }, [editor, close]);

  return { ...state, selected, setSelected, close };
}
