/**
 * Markers: what a line of notes is, as OneNote's tags say it.
 *
 * A marker is meaning, not style. It is stored on the line, so it survives a
 * backup and an export, and one screen can gather every marked line in the
 * workspace. It is never a colour alone: the word is drawn with it.
 *
 * Pure: no I/O, no React, no host.
 */

import type { DocNode } from './document';

export type MarkerId = 'todo' | 'important' | 'question' | 'decision' | 'followup';

export const MARKERS: ReadonlyArray<{ id: MarkerId; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'important', label: 'Important' },
  { id: 'question', label: 'Question' },
  { id: 'decision', label: 'Decision' },
  { id: 'followup', label: 'Follow up' },
];

/** The attribute a marked line carries. */
export const MARKER_ATTR = 'noteMarker';

export function isMarker(value: unknown): value is MarkerId {
  return MARKERS.some((marker) => marker.id === value);
}

export function labelOf(marker: MarkerId): string {
  return MARKERS.find((candidate) => candidate.id === marker)?.label ?? marker;
}

/** A stored block that holds at least one marked line. */
export interface MarkedBlock {
  blockId: string;
  ownerKind: 'page' | 'item' | 'event';
  ownerId: string;
  ownerTitle: string;
  content: DocNode;
}

export interface MarkedLine {
  /** Unique within the result: a block can hold several marked lines. */
  key: string;
  marker: MarkerId;
  text: string;
  ownerKind: MarkedBlock['ownerKind'];
  ownerId: string;
  ownerTitle: string;
}

function textOf(node: DocNode): string {
  if (node.text !== undefined) return node.text;
  return (node.content ?? []).map(textOf).join('');
}

/** Every marked line in these blocks, in the order they were given. */
export function markedLines(blocks: readonly MarkedBlock[]): MarkedLine[] {
  const lines: MarkedLine[] = [];
  for (const block of blocks) {
    let index = 0;
    const walk = (node: DocNode) => {
      const marker = node.attrs?.[MARKER_ATTR];
      if (isMarker(marker)) {
        const text = textOf(node).trim();
        // A marker left on an empty line has nothing to say.
        if (text !== '') {
          lines.push({
            key: `${block.blockId}:${index}`,
            marker,
            text,
            ownerKind: block.ownerKind,
            ownerId: block.ownerId,
            ownerTitle: block.ownerTitle,
          });
          index += 1;
        }
      }
      for (const child of node.content ?? []) walk(child);
    };
    walk(block.content);
  }
  return lines;
}

/** The lines under their markers, in the markers' order, leaving out the empty ones. */
export function byMarker(
  lines: readonly MarkedLine[],
): Array<{ marker: MarkerId; label: string; lines: MarkedLine[] }> {
  return MARKERS.map((marker) => ({
    marker: marker.id,
    label: marker.label,
    lines: lines.filter((line) => line.marker === marker.id),
  })).filter((group) => group.lines.length > 0);
}
