import { Extension } from '@tiptap/core';

import { isMarker, labelOf, MARKER_ATTR, MARKERS, type MarkerId } from '@/domain/markers';

/** The nodes a marker can sit on: a line of text, in a list or not. */
const MARKABLE = ['paragraph', 'heading'] as const;

/**
 * A marker on a line. It keeps to data on the node, so it is read back from the
 * document and not from how the line looks, and it is drawn with its word.
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
        },
      },
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
    editor.commands.updateAttributes(type, { [MARKER_ATTR]: marker }),
  ).some(Boolean);
}
