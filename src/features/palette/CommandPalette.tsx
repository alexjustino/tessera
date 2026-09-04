import {
  Calendar16Regular,
  CheckmarkCircle16Regular,
  ChevronRight16Regular,
  Search20Regular,
  TaskListSquareLtr16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { describeError } from '@/data/errors';
import { useSearch } from '@/data/hooks';
import { GROUP_LABELS, rankCommands, type RankedCommand } from '@/domain/palette';
import { splitSnippet, type SearchHit } from '@/domain/search';
import { Chip } from '@/ui/Chip';
import { InfoBar } from '@/ui/InfoBar';
import { Kbd } from '@/ui/Kbd';
import { Modal } from '@/ui/Modal';

import { COMMANDS, type CommandId } from './commands';

/** How long typing pauses before the index is asked. */
const SEARCH_DEBOUNCE_MS = 120;

/** How many commands share the list with search hits once there is a query. */
const COMMANDS_BESIDE_HITS = 4;

type Entry = (
  | { kind: 'command'; key: string; ranked: RankedCommand }
  | { kind: 'hit'; key: string; hit: SearchHit }
) & {
  /** Shown above this entry when it starts a new group; null otherwise. */
  heading: string | null;
};

/**
 * The command palette: one box that runs a command or finds a task or event.
 *
 * Empty, it is a menu of everything the product can do, grouped. With text, it
 * ranks commands by the letters typed and asks the index for items and events
 * whose title or body match — one list, arrow keys across the whole of it,
 * Enter to act. A leading `>` restricts it to commands, for the person who
 * knows exactly what they want.
 */
export function CommandPalette({
  open,
  onClose,
  onCommand,
  onOpenItem,
  onOpenEvent,
}: {
  open: boolean;
  onClose: () => void;
  onCommand: (id: CommandId) => void;
  onOpenItem: (id: string) => void;
  onOpenEvent: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const [debounced, setDebounced] = useState('');

  const commandsOnly = text.startsWith('>');
  const query = commandsOnly ? text.slice(1) : text;

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => setDebounced(commandsOnly ? '' : query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [open, query, commandsOnly]);

  const hits = useSearch(open ? debounced : '');

  const entries = useMemo<Entry[]>(() => {
    const ranked = rankCommands(query, COMMANDS);
    const commands = query.trim().length === 0 ? ranked : ranked.slice(0, COMMANDS_BESIDE_HITS);
    const list: Entry[] = commands.map((item) => ({
      kind: 'command',
      key: `c:${item.command.id}`,
      ranked: item,
      heading: GROUP_LABELS[item.command.group],
    }));
    if (!commandsOnly) {
      for (const hit of hits.data ?? []) {
        list.push({
          kind: 'hit',
          key: `h:${hit.ownerKind}:${hit.ownerId}`,
          hit,
          heading: hit.ownerKind === 'event' ? 'Events' : 'Tasks',
        });
      }
    }
    // A heading is shown once per run of the same group.
    return list.map((entry, index) => {
      const previous = list[index - 1];
      return previous && previous.heading === entry.heading ? { ...entry, heading: null } : entry;
    });
  }, [query, commandsOnly, hits.data]);

  // The selection is clamped rather than reset on every keystroke, so a person
  // who arrowed down and kept typing does not jump back to the top.
  const current = Math.min(selected, Math.max(0, entries.length - 1));

  const close = useCallback(() => {
    setText('');
    setDebounced('');
    setSelected(0);
    onClose();
  }, [onClose]);

  const run = useCallback(
    (entry: Entry) => {
      close();
      if (entry.kind === 'command') onCommand(entry.ranked.command.id as CommandId);
      else if (entry.hit.ownerKind === 'event') onOpenEvent(entry.hit.ownerId);
      else onOpenItem(entry.hit.ownerId);
    },
    [close, onCommand, onOpenEvent, onOpenItem],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(Math.min(current + 1, entries.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[current];
      if (entry) run(entry);
    }
  };

  const showingHits = !commandsOnly && debounced.trim().length > 0;

  return (
    <Modal open={open} label="Command palette" onClose={close}>
      <div className="flex items-center gap-2 border-b border-stroke-subtle px-4">
        <Search20Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={entries[current]?.key}
          aria-label="Search or run a command"
          aria-autocomplete="list"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search tasks and events, or type > for commands"
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full bg-transparent text-body-lg text-fg placeholder:text-fg-tertiary focus:outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>

      {/* Screen readers hear how many results the letters found. */}
      <p className="sr-only" role="status" aria-live="polite">
        {entries.length === 0 ? 'No results' : `${entries.length} results`}
      </p>

      <ul
        id="palette-list"
        role="listbox"
        aria-label="Results"
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {entries.map((entry, index) => {
          const heading = entry.heading;
          return (
            <li key={entry.key} role="presentation">
              {heading && (
                <p className="px-2 pt-2 pb-1 text-caption font-semibold text-fg-tertiary uppercase">
                  {heading}
                </p>
              )}
              <button
                type="button"
                id={entry.key}
                role="option"
                aria-selected={index === current}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(entry)}
                className={[
                  'flex h-(--density-row) w-full items-center gap-3 rounded-md px-2 text-left text-body',
                  'transition-colors duration-100 ease-easy',
                  index === current ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-card-hover',
                ].join(' ')}
              >
                {entry.kind === 'command' ? (
                  <>
                    <ChevronRight16Regular
                      aria-hidden="true"
                      className="shrink-0 text-fg-tertiary"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <Highlighted
                        text={entry.ranked.command.title}
                        indices={entry.ranked.matched}
                      />
                    </span>
                    {entry.ranked.command.shortcut && <Kbd>{entry.ranked.command.shortcut}</Kbd>}
                  </>
                ) : (
                  <>
                    {entry.hit.ownerKind === 'event' ? (
                      <Calendar16Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
                    ) : entry.hit.completed ? (
                      <CheckmarkCircle16Regular
                        aria-hidden="true"
                        className="shrink-0 text-success"
                      />
                    ) : (
                      <TaskListSquareLtr16Regular
                        aria-hidden="true"
                        className="shrink-0 text-fg-tertiary"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={`truncate ${entry.hit.completed ? 'text-fg-secondary line-through' : ''}`}
                      >
                        <Snippet marked={entry.hit.title} />
                      </span>
                      {entry.hit.body.length > 0 && (
                        <span className="truncate text-caption text-fg-tertiary">
                          <Snippet marked={entry.hit.body} />
                        </span>
                      )}
                    </span>
                    {entry.hit.completed && <Chip tone="success">Done</Chip>}
                  </>
                )}
              </button>
            </li>
          );
        })}

        {entries.length === 0 && (
          <li className="px-2 py-6 text-center text-body text-fg-tertiary">
            {showingHits && hits.isFetched
              ? 'Nothing matches — not a command, not a task, not an event.'
              : 'No command matches.'}
          </li>
        )}
      </ul>

      {hits.error && (
        <div className="px-2 pb-2">
          <InfoBar severity="danger" title="The search did not answer">
            {describeError(hits.error)}
          </InfoBar>
        </div>
      )}

      <footer className="flex items-center gap-3 border-t border-stroke-subtle px-4 py-2 text-caption text-fg-tertiary">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
        </span>
        <span>
          <Kbd>Enter</Kbd> open
        </span>
        <span>
          <Kbd>{'>'}</Kbd> commands only
        </span>
      </footer>
    </Modal>
  );
}

/** A command title with the letters that matched set in bold. */
function Highlighted({ text, indices }: { text: string; indices: readonly number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {Array.from(text).map((char, index) =>
        set.has(index) ? (
          <span key={index} className="font-semibold text-accent">
            {char}
          </span>
        ) : (
          <span key={index}>{char}</span>
        ),
      )}
    </>
  );
}

/** A snippet from the index, with hits marked. Text in, elements out. */
function Snippet({ marked }: { marked: string }) {
  return (
    <>
      {splitSnippet(marked).map((segment, index) =>
        segment.hit ? (
          <mark key={index} className="rounded-sm bg-accent-subtle text-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
