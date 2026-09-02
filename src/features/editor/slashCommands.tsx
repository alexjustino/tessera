import {
  Code24Regular,
  Image24Regular,
  Info24Regular,
  Line24Regular,
  TextBulletListLtr24Regular,
  TextHeader124Regular,
  TextHeader224Regular,
  TextHeader324Regular,
  TextNumberListLtr24Regular,
  TextQuote24Regular,
  Table24Regular,
  TaskListSquareLtr24Regular,
  TextParagraph24Regular,
} from '@fluentui/react-icons';
import type { ChainedCommands } from '@tiptap/react';
import type { ReactNode } from 'react';

/**
 * The block menu, opened by typing `/`.
 *
 * Driven from editor state rather than through a suggestion plugin and a
 * floating-element library. The behaviour is the same and the moving parts are
 * three instead of a dozen: read what is before the cursor, decide whether it
 * looks like a command, and position a list at the caret.
 */

export interface Command {
  id: string;
  label: string;
  /** Extra words a person might type to find it. */
  keywords: string;
  icon: ReactNode;
  /**
   * Applied to a chain that has already removed the "/query" text.
   *
   * A chain rather than the editor, deliberately. Deleting the text in one
   * chain and applying the block in another made the second chain's `focus()`
   * restore the selection captured before the deletion, and the block landed
   * beside the paragraph instead of on it — which is where the stray empty
   * paragraph under every inserted block came from.
   */
  apply: (chain: ChainedCommands, answer?: string) => ChainedCommands;
  /** Anything that must be asked before the chain runs. Null cancels. */
  ask?: () => string | null;
}

export const COMMANDS: Command[] = [
  {
    id: 'paragraph',
    label: 'Text',
    keywords: 'paragraph plain body',
    icon: <TextParagraph24Regular />,
    apply: (chain) => chain.setParagraph(),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    keywords: 'title big',
    icon: <TextHeader124Regular />,
    apply: (chain) => chain.toggleHeading({ level: 1 }),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    keywords: 'subtitle section',
    icon: <TextHeader224Regular />,
    apply: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    keywords: 'subsection small',
    icon: <TextHeader324Regular />,
    apply: (chain) => chain.toggleHeading({ level: 3 }),
  },
  {
    id: 'todo',
    label: 'To-do list',
    keywords: 'task checkbox check',
    icon: <TaskListSquareLtr24Regular />,
    apply: (chain) => chain.toggleTaskList(),
  },
  {
    id: 'bullets',
    label: 'Bulleted list',
    keywords: 'unordered dash points',
    icon: <TextBulletListLtr24Regular />,
    apply: (chain) => chain.toggleBulletList(),
  },
  {
    id: 'numbers',
    label: 'Numbered list',
    keywords: 'ordered steps',
    icon: <TextNumberListLtr24Regular />,
    apply: (chain) => chain.toggleOrderedList(),
  },
  {
    id: 'quote',
    label: 'Quote',
    keywords: 'blockquote citation',
    icon: <TextQuote24Regular />,
    apply: (chain) => chain.toggleBlockquote(),
  },
  {
    id: 'callout',
    label: 'Callout',
    keywords: 'note warning aside info',
    icon: <Info24Regular />,
    apply: (chain) => chain.setCallout('info'),
  },
  {
    id: 'code',
    label: 'Code',
    keywords: 'snippet monospace syntax',
    icon: <Code24Regular />,
    apply: (chain) => chain.toggleCodeBlock(),
  },
  {
    id: 'table',
    label: 'Table',
    keywords: 'grid rows columns',
    icon: <Table24Regular />,
    apply: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  {
    id: 'divider',
    label: 'Divider',
    keywords: 'rule separator line horizontal',
    icon: <Line24Regular />,
    apply: (chain) => chain.setHorizontalRule(),
  },
  {
    id: 'image',
    label: 'Image',
    keywords: 'picture photo figure',
    icon: <Image24Regular />,
    // No network: the editor takes a path or a data URL the person already has.
    // A file picker arrives with attachments.
    ask: () => {
      const source = window.prompt('Image address');
      return source === null || source.trim() === '' ? null : source.trim();
    },
    apply: (chain, source = '') => chain.setImage({ src: source }),
  },
];

export function matching(query: string): Command[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return COMMANDS;
  return COMMANDS.filter(
    (command) => command.label.toLowerCase().includes(needle) || command.keywords.includes(needle),
  );
}
