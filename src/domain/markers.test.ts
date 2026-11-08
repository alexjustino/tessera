import { describe, expect, it } from 'vitest';

import type { DocNode } from './document';
import {
  byMarker,
  DONE_ATTR,
  isLineDone,
  isMarker,
  markedLines,
  MARKER_ATTR,
  TASK_ATTR,
  type MarkedBlock,
} from './markers';

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
        blockId: 'a',
        marker: 'todo',
        done: false,
        taskId: null,
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

describe('a line that is done', () => {
  const marked = (marker: string, attrs: Record<string, unknown> = {}): DocNode => ({
    type: 'paragraph',
    attrs: { [MARKER_ATTR]: marker, ...attrs },
    content: [{ type: 'text', text: 'Line' }],
  });

  it('is a To do that was ticked', () => {
    const [found] = markedLines([block('a', marked('todo', { [DONE_ATTR]: true }))]);
    expect(found?.done).toBe(true);
    expect(isLineDone(found!, new Set())).toBe(true);
  });

  it('is a Follow up whose task was finished', () => {
    const [found] = markedLines([block('a', marked('followup', { [TASK_ATTR]: 't1' }))]);
    expect(found?.taskId).toBe('t1');
    expect(isLineDone(found!, new Set(['t1']))).toBe(true);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('is not a Follow up whose task is still open, or that never became one', () => {
    const [open] = markedLines([block('a', marked('followup', { [TASK_ATTR]: 't1' }))]);
    expect(isLineDone(open!, new Set(['t2']))).toBe(false);
    const [bare] = markedLines([block('b', marked('followup'))]);
    expect(isLineDone(bare!, new Set(['t1']))).toBe(false);
  });

  it('is never a Question, whatever its attributes say', () => {
    const [question] = markedLines([block('a', marked('question', { [DONE_ATTR]: true }))]);
    expect(isLineDone(question!, new Set())).toBe(false);
  });
});
