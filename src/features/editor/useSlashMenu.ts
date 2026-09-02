import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';

export interface SlashState {
  open: boolean;
  query: string;
  /** Where the `/` is, so the command can replace it. */
  from: number;
  coords: { top: number; left: number };
  selected: number;
  setSelected: (index: number) => void;
  close: () => void;
}

/**
 * Watch the editor for a slash command being typed.
 *
 * The menu opens only at the start of an empty paragraph. Typing "and/or" in a
 * sentence should not open a block menu, and a menu that opens when you did not
 * ask is worse than one that takes a moment to find.
 */
export function useSlashMenu(editor: Editor | null): SlashState {
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
      if (!empty || $from.parent.type.name !== 'paragraph') return close();

      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const match = /^\/(\w*)$/.exec(before);
      if (match === null) return close();

      const from = $from.start();
      const caret = editor.view.coordsAtPos(from);
      const container = editor.view.dom.getBoundingClientRect();

      setSelected(0);
      setState({
        open: true,
        query: match[1] ?? '',
        from,
        coords: { top: caret.bottom - container.top + 6, left: caret.left - container.left },
      });
    };

    editor.on('transaction', check);
    return () => {
      editor.off('transaction', check);
    };
  }, [editor, close]);

  return { ...state, selected, setSelected, close };
}
