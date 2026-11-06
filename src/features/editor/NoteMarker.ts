import { Extension } from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import {
  DONE_ATTR,
  isLineDone,
  isMarker,
  labelOf,
  MARKER_ATTR,
  MARKERS,
  TASK_ATTR,
  type MarkerId,
} from '@/domain/markers';

/** The nodes a marker can sit on: a line of text, in a list or not. */
const MARKABLE = ['paragraph', 'heading'] as const;

/** Told when the finished tasks change, so Follow up lines can say they are done. */
export const REFRESH_MARKERS = 'noteMarkerRefresh';

const key = new PluginKey<ReadonlySet<string>>('noteMarkerDone');

const textOf = (node: ProseNode) => node.textContent.trim();

/** The tick at the start of a To do line. Ticking it is an edit, saved like any other. */
function tickFor(node: ProseNode, done: boolean) {
  return (view: import('@tiptap/pm/view').EditorView, getPos: () => number | undefined) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = done;
    box.className = 'note-tick';
    box.setAttribute('aria-label', `Done: ${textOf(node)}`);
    box.disabled = !view.editable;
    box.contentEditable = 'false';
    // The press is the tick's, not the editor's: no caret moves and nothing is selected.
    box.addEventListener('mousedown', (event) => event.preventDefault());
    box.addEventListener('click', (event) => {
      event.preventDefault();
      const inside = getPos();
      if (inside === undefined) return;
      const at = inside - 1;
      const line = view.state.doc.nodeAt(at);
      if (line === null) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(at, undefined, {
          ...line.attrs,
          [DONE_ATTR]: line.attrs[DONE_ATTR] !== true,
        }),
      );
    });
    return box;
  };
}

/**
 * A marker on a line. It keeps to data on the node, so it is read back from the
 * document and not from how the line looks, and it is drawn with its word.
 *
 * A To do line carries a tick, and a Follow up line knows the task it became; either
 * is drawn done when its work is, the first by the tick and the second by the task.
 */
export const NoteMarker = Extension.create({
  name: 'noteMarker',

  addGlobalAttributes() {
    return [
      {
        types: [...MARKABLE],
        attributes: {
          [MARKER_ATTR]: {
            default: null,
            // A new line starts unmarked: pressing Enter is not saying it again.
            keepOnSplit: false,
            parseHTML: (element) => {
              const value = element.getAttribute('data-note-marker');
              return isMarker(value) ? value : null;
            },
            renderHTML: (attributes) =>
              isMarker(attributes[MARKER_ATTR])
                ? {
                    'data-note-marker': attributes[MARKER_ATTR] as MarkerId,
                    'data-note-label': labelOf(attributes[MARKER_ATTR] as MarkerId),
                  }
                : {},
          },
          [DONE_ATTR]: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-note-done') === 'true',
            renderHTML: (attributes) =>
              attributes[DONE_ATTR] === true ? { 'data-note-done': 'true' } : {},
          },
          [TASK_ATTR]: {
            default: null,
            keepOnSplit: false,
            // An identity, not markup: it does not travel in a copied email.
            rendered: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ReadonlySet<string>>({
        key,
        // The finished tasks, as the editor was last told them.
        state: {
          init: () => new Set<string>(),
          apply: (tr, finished) =>
            (tr.getMeta(REFRESH_MARKERS) as ReadonlySet<string> | undefined) ?? finished,
        },
        props: {
          decorations(state) {
            const finished = key.getState(state) as ReadonlySet<string>;
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!(MARKABLE as readonly string[]).includes(node.type.name)) return true;
              const marker = node.attrs[MARKER_ATTR];
              if (!isMarker(marker)) return true;
              const line = {
                marker,
                done: node.attrs[DONE_ATTR] === true,
                taskId: typeof node.attrs[TASK_ATTR] === 'string' ? node.attrs[TASK_ATTR] : null,
              };
              if (marker === 'todo') {
                found.push(
                  Decoration.widget(pos + 1, tickFor(node, line.done), {
                    side: -1,
                    key: `tick-${line.done ? 'on' : 'off'}-${textOf(node)}`,
                    ignoreSelection: true,
                    stopEvent: () => true,
                  }),
                );
              }
              // A Follow up is done by its task, which the document does not hold.
              if (marker === 'followup' && isLineDone(line, finished)) {
                found.push(Decoration.node(pos, pos + node.nodeSize, { 'data-note-done': 'true' }));
              }
              return true;
            });
            return DecorationSet.create(state.doc, found);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    // Ctrl+1 to Ctrl+5, as in OneNote. The same key again takes it off.
    return Object.fromEntries(
      MARKERS.map((marker, index) => [
        `Mod-${index + 1}`,
        () => {
          const current =
            this.editor.getAttributes('paragraph')[MARKER_ATTR] ??
            this.editor.getAttributes('heading')[MARKER_ATTR];
          return setMarker(this.editor, current === marker.id ? null : marker.id);
        },
      ]),
    );
  },
});

/** Put a marker on the line the cursor is in, or take it off. */
export function setMarker(
  editor: { commands: { updateAttributes: (type: string, attrs: object) => boolean } },
  marker: MarkerId | null,
): boolean {
  return MARKABLE.map((type) =>
    editor.commands.updateAttributes(type, {
      [MARKER_ATTR]: marker,
      // A line that stops being a To do is not left ticked underneath.
      ...(marker === 'todo' ? {} : { [DONE_ATTR]: false }),
      ...(marker === 'followup' ? {} : { [TASK_ATTR]: null }),
    }),
  ).some(Boolean);
}

/** Mark the line a Follow up, and remember the task it became. */
export function markFollowUp(
  editor: { commands: { updateAttributes: (type: string, attrs: object) => boolean } },
  taskId: string,
): boolean {
  return MARKABLE.map((type) =>
    editor.commands.updateAttributes(type, { [MARKER_ATTR]: 'followup', [TASK_ATTR]: taskId }),
  ).some(Boolean);
}
