import { describe, expect, it } from 'vitest';

import type { DocNode } from './document';
import { byMarker, isMarker, markedLines, MARKER_ATTR, type MarkedBlock } from './markers';

const line = (text: string, marker?: string): DocNode => ({
  type: 'paragraph',
  ...(marker === undefined ? {} : { attrs: { [MARKER_ATTR]: marker } }),
  content: [{ type: 'text', text }],
});

const block = (id: string, content: DocNode): MarkedBlock => ({
  blockId: id,
  ownerKind: 'page',
  ownerId: 'p',
  ownerTitle: 'Nozomi notes',
  content,
});

describe('finding marked lines', () => {
  it('reads a marked line and where it lives', () => {
    expect(markedLines([block('a', line('Call the vendor', 'todo'))])).toEqual([
      {
        key: 'a:0',
        marker: 'todo',
        text: 'Call the vendor',
        ownerKind: 'page',
        ownerId: 'p',
        ownerTitle: 'Nozomi notes',
      },
    ]);
  });

  it('finds them inside a list, each with its own key', () => {
    const list: DocNode = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [line('First', 'question')] },
        { type: 'listItem', content: [line('Not marked')] },
        { type: 'listItem', content: [line('Second', 'decision')] },
      ],
    };
    const found = markedLines([block('a', list)]);
    expect(found.map((item) => item.text)).toEqual(['First', 'Second']);
    expect(new Set(found.map((item) => item.key)).size).toBe(2);
  });

  it('reads the words of a line with several runs of text', () => {
    const node: DocNode = {
      type: 'paragraph',
      attrs: { [MARKER_ATTR]: 'important' },
      content: [
        { type: 'text', text: 'Renew ' },
        { type: 'text', text: 'before Friday', marks: [{ type: 'bold' }] },
      ],
    };
    expect(markedLines([block('a', node)])[0]?.text).toBe('Renew before Friday');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves out a marker on an empty line', () => {
    expect(
      markedLines([block('a', { type: 'paragraph', attrs: { [MARKER_ATTR]: 'todo' } })]),
    ).toEqual([]);
  });

  it('leaves out what is not one of the markers', () => {
    expect(markedLines([block('a', line('Odd', 'someday'))])).toEqual([]);
    expect(isMarker('someday')).toBe(false);
  });
});

describe('grouping', () => {
  it('follows the order of the markers and skips the empty ones', () => {
    const lines = markedLines([
      block('a', line('Why', 'question')),
      block('b', line('Call', 'todo')),
      block('c', line('Later', 'question')),
    ]);
    const groups = byMarker(lines);
    expect(groups.map((group) => group.label)).toEqual(['To do', 'Question']);
    expect(groups[1]?.lines.map((item) => item.text)).toEqual(['Why', 'Later']);
  });
});
