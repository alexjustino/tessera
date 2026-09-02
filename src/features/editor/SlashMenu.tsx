import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo } from 'react';

import { matching, type Command } from './slashCommands';
import type { SlashState } from './useSlashMenu';

export function SlashMenu({ editor, state }: { editor: Editor; state: SlashState }) {
  const commands = useMemo(() => matching(state.query), [state.query]);
  const { selected, setSelected, close, query } = state;

  const run = useCallback(
    (command: Command) => {
      const answer = command.ask?.();
      if (command.ask !== undefined && answer === null) {
        close();
        return;
      }

      // One chain: remove the "/query" text and apply the block together, so
      // the block lands on the paragraph the person was typing in rather than
      // beside it. Counted back from the cursor, because a range that starts at
      // the block boundary lets ProseMirror replace the node itself.
      const cursor = editor.state.selection.from;
      command
        .apply(
          editor
            .chain()
            .focus()
            .deleteRange({ from: cursor - query.length - 1, to: cursor }),
          answer ?? undefined,
        )
        .run();

      close();
    },
    [editor, query, close],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (commands.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((selected + 1) % commands.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((selected - 1 + commands.length) % commands.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const command = commands[selected];
        if (command) run(command);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    // Captured on the way down, ahead of the editor's own handling: Enter must
    // choose a command rather than split the paragraph underneath it.
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [commands, selected, setSelected, run, close]);

  if (commands.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Insert a block"
      style={{ top: state.coords.top, left: state.coords.left }}
      className="absolute z-40 max-h-72 w-60 overflow-y-auto rounded-lg border border-stroke bg-flyout p-1 shadow-flyout backdrop-blur-xl"
    >
      {commands.map((command, index) => (
        <button
          key={command.id}
          type="button"
          role="option"
          aria-selected={index === selected}
          onMouseEnter={() => setSelected(index)}
          onMouseDown={(event) => {
            // Keep the editor's selection: losing it would put the block in the
            // wrong place, or nowhere.
            event.preventDefault();
            run(command);
          }}
          className={[
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body',
            index === selected ? 'bg-accent-subtle text-fg' : 'text-fg-secondary',
          ].join(' ')}
        >
          <span aria-hidden="true" className="text-fg-tertiary">
            {command.icon}
          </span>
          {command.label}
        </button>
      ))}
    </div>
  );
}
