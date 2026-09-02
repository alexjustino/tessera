import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { BLOCK_ID_ATTR } from '@/domain/document';

/**
 * Gives every top-level node a stable identity.
 *
 * Without this, the diff would have nothing to match a node against and would
 * have to fall back on position — which looks like it works until somebody
 * inserts a paragraph at the top, at which point every block below it is
 * silently re-identified and rewritten.
 *
 * # Why the identity is assigned here and not at save time
 *
 * Assigning ids only when saving creates a subtler bug. A new paragraph has no
 * id, so the save creates a row for it — and then the node in the editor
 * *still* has no id, so the next save creates a second row for the same
 * paragraph, and a third. The document quietly doubles as you type.
 *
 * So ids are assigned the moment a node appears, in `appendTransaction`, before
 * anything is saved. The transaction is kept out of the undo history: pressing
 * undo should take back what the person typed, not an identity they never knew
 * existed.
 *
 * The same pass repairs duplicates. Pasting a block copies its attributes, id
 * included, and two rows claiming one identity is the kind of corruption that
 * shows up much later as "one of my paragraphs keeps changing".
 */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        // Only top-level nodes become rows, so only they carry an identity.
        types: [
          'paragraph',
          'heading',
          'bulletList',
          'orderedList',
          'taskList',
          'blockquote',
          'codeBlock',
          'horizontalRule',
          'image',
          'table',
          'callout',
        ],
        attributes: {
          [BLOCK_ID_ATTR]: {
            default: null,
            // Kept out of the HTML: it is a database identity, not markup, and
            // it must not travel when a person copies a block into an email.
            rendered: false,
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockId'),

        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;

          const seen = new Set<string>();
          const fixes: Array<{ pos: number; id: string }> = [];

          newState.doc.forEach((node, offset) => {
            if (!node.type.isBlock) return;

            const current = node.attrs[BLOCK_ID_ATTR];
            const valid = typeof current === 'string' && current.length > 0;

            if (!valid || seen.has(current as string)) {
              fixes.push({ pos: offset, id: newId() });
              return;
            }
            seen.add(current as string);
          });

          if (fixes.length === 0) return null;

          const transaction = newState.tr;
          for (const fix of fixes) {
            const node = newState.doc.nodeAt(fix.pos);
            if (node === null) continue;
            transaction.setNodeMarkup(fix.pos, undefined, {
              ...node.attrs,
              [BLOCK_ID_ATTR]: fix.id,
            });
          }

          // Undo should take back what the person typed, not an identity they
          // never knew existed.
          return transaction.setMeta('addToHistory', false);
        },
      }),
    ];
  },
});

/** A fresh identity, matching the host's format closely enough to be opaque. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
