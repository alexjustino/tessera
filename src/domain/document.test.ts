import { describe, expect, it } from 'vitest';

import {
  applyChanges,
  BLOCK_ID_ATTR,
  diff,
  EMPTY_DOCUMENT,
  isEmptyChange,
  plainText,
  preview,
  stripId,
  toDocument,
  type Block,
  type DocNode,
} from './document';
import { isValidKey } from './ordering';

/** Deterministic identities, so a failing test names the same block twice. */
function ids() {
  let next = 0;
  return () => {
    next += 1;
    return `new-${next}`;
  };
}

function paragraph(text: string, id?: string): DocNode {
  const node: DocNode = { type: 'paragraph', content: [{ type: 'text', text }] };
  return id === undefined ? node : { ...node, attrs: { [BLOCK_ID_ATTR]: id } };
}

function block(id: string, position: string, text: string, type = 'paragraph'): Block {
  return {
    id,
    position,
    type,
    content: { type, content: [{ type: 'text', text }] },
  };
}

const EXISTING = [block('a', 'a', 'First'), block('b', 'b', 'Second'), block('c', 'c', 'Third')];

/** The document the editor would be showing for `EXISTING`. */
const nodes = () => toDocument(EXISTING).content;

describe('assembling a document', () => {
  it('gives an empty item a document ProseMirror will accept', () => {
    // A document with no content is invalid, and an item with no body is the
    // normal case rather than an error.
    expect(toDocument([])).toEqual(EMPTY_DOCUMENT);
    expect(toDocument([]).content).toHaveLength(1);
  });

  it('orders blocks by their key, not by the order they arrived', () => {
    const scrambled = [EXISTING[2]!, EXISTING[0]!, EXISTING[1]!];
    const texts = toDocument(scrambled).content.map((node) => node.content?.[0]?.text);
    expect(texts).toEqual(['First', 'Second', 'Third']);
  });

  it('hands each node its identity so the editor can give it back', () => {
    expect(toDocument(EXISTING).content.map((node) => node.attrs?.[BLOCK_ID_ATTR])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('stores a node without its identity, because the row already has it', () => {
    const stored = stripId(paragraph('x', 'a'));
    expect(stored.attrs).toBeUndefined();
  });

  it('keeps other attributes when stripping the identity', () => {
    const node: DocNode = { type: 'heading', attrs: { level: 2, [BLOCK_ID_ATTR]: 'a' } };
    expect(stripId(node).attrs).toEqual({ level: 2 });
  });
});

describe('the diff writes as little as possible', () => {
  it('writes nothing when nothing changed', () => {
    const changes = diff(EXISTING, nodes(), ids());
    expect(isEmptyChange(changes)).toBe(true);
  });

  it('writes one row when one paragraph is edited', () => {
    // The whole reason this module exists. Rewriting the document on every
    // keystroke would churn the write-ahead log and destroy block identity.
    const edited = nodes();
    edited[1] = paragraph('Second, edited', 'b');

    const changes = diff(EXISTING, edited, ids());

    expect(changes.creates).toHaveLength(0);
    expect(changes.deletes).toHaveLength(0);
    expect(changes.updates).toHaveLength(1);
    expect(changes.updates[0]?.id).toBe('b');
  });

  it('does not move the rows around an edited one', () => {
    const edited = nodes();
    edited[1] = paragraph('Second, edited', 'b');

    const changes = diff(EXISTING, edited, ids());
    expect(changes.updates[0]?.position).toBe('b');
  });

  it('creates one row for a paragraph typed at the end', () => {
    const changes = diff(EXISTING, [...nodes(), paragraph('Fourth')], ids());

    expect(changes.updates).toHaveLength(0);
    expect(changes.deletes).toHaveLength(0);
    expect(changes.creates).toHaveLength(1);
    expect(changes.creates[0]!.position > 'c').toBe(true);
  });

  it('creates one row for a paragraph typed at the top, renumbering nothing', () => {
    // The test that would fail under positional identity: inserting at the top
    // must not re-identify or rewrite every block below it.
    const changes = diff(EXISTING, [paragraph('Zeroth'), ...nodes()], ids());

    expect(changes.creates).toHaveLength(1);
    expect(changes.creates[0]!.position < 'a').toBe(true);
    expect(changes.updates).toHaveLength(0);
    expect(changes.deletes).toHaveLength(0);
  });

  it('creates one row for a paragraph typed in the middle', () => {
    const [first, second, third] = nodes();
    const changes = diff(EXISTING, [first!, second!, paragraph('Between'), third!], ids());

    expect(changes.creates).toHaveLength(1);
    expect(changes.updates).toHaveLength(0);

    const inserted = changes.creates[0]!;
    expect(inserted.position > 'b').toBe(true);
    expect(inserted.position < 'c').toBe(true);
  });

  it('deletes exactly the row that was removed', () => {
    const [first, , third] = nodes();
    const changes = diff(EXISTING, [first!, third!], ids());

    expect(changes.deletes).toEqual(['b']);
    expect(changes.updates).toHaveLength(0);
    expect(changes.creates).toHaveLength(0);
  });

  it('repositions only what moved', () => {
    const [first, second, third] = nodes();
    // Third dragged to the top.
    const changes = diff(EXISTING, [third!, first!, second!], ids());

    expect(changes.creates).toHaveLength(0);
    expect(changes.deletes).toHaveLength(0);
    expect(changes.updates).toHaveLength(1);
    expect(changes.updates[0]?.id).toBe('c');
    expect(changes.updates[0]!.position < 'a').toBe(true);
  });

  it('records a change of block type', () => {
    const edited = nodes();
    edited[0] = { type: 'heading', attrs: { level: 1, [BLOCK_ID_ATTR]: 'a' }, content: [] };

    const changes = diff(EXISTING, edited, ids());
    expect(changes.updates).toHaveLength(1);
    expect(changes.updates[0]?.type).toBe('heading');
  });

  it('adopts an identity the editor already assigned to a new node', () => {
    // A node the editor created and named locally keeps that name, so the row
    // and the node in the editor agree without a round trip.
    const changes = diff(EXISTING, [...nodes(), paragraph('Fourth', 'chosen')], ids());
    expect(changes.creates[0]?.id).toBe('chosen');
  });

  it('treats an identity that is not in the database as a new block', () => {
    // The row was deleted elsewhere while the editor still held the node.
    const changes = diff(EXISTING, [paragraph('Ghost', 'gone')], ids());

    expect(changes.creates.map((create) => create.id)).toEqual(['gone']);
    expect(changes.deletes.sort()).toEqual(['a', 'b', 'c']);
  });

  it('empties a document', () => {
    const changes = diff(EXISTING, [], ids());
    expect(changes.deletes.sort()).toEqual(['a', 'b', 'c']);
  });

  it('fills an empty document', () => {
    const changes = diff([], [paragraph('First'), paragraph('Second')], ids());

    expect(changes.creates).toHaveLength(2);
    expect(changes.creates[0]!.position < changes.creates[1]!.position).toBe(true);
    for (const create of changes.creates) expect(isValidKey(create.position)).toBe(true);
  });
});

describe('the diff and the store agree', () => {
  it('produces the document that was asked for, however it is edited', () => {
    // The property that matters: applying the diff must reproduce exactly the
    // node list the editor handed over. Anything less and the document a person
    // sees drifts from the one that was saved.
    let stored: Block[] = [...EXISTING];
    let seed = 20260905;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const newId = ids();

    for (let step = 0; step < 200; step += 1) {
      const current = toDocument(stored).content;
      const next = [...current];

      const action = Math.floor(random() * 4);
      if (action === 0 || next.length === 0) {
        next.splice(Math.floor(random() * (next.length + 1)), 0, paragraph(`typed ${step}`));
      } else if (action === 1) {
        next.splice(Math.floor(random() * next.length), 1);
      } else if (action === 2) {
        const at = Math.floor(random() * next.length);
        const id = next[at]!.attrs?.[BLOCK_ID_ATTR];
        next[at] = paragraph(`edited ${step}`, typeof id === 'string' ? id : undefined);
      } else {
        const from = Math.floor(random() * next.length);
        const to = Math.floor(random() * next.length);
        const [moved] = next.splice(from, 1);
        if (moved) next.splice(to, 0, moved);
      }

      const changes = diff(stored, next, newId);
      stored = applyChanges(stored, changes);

      const round = toDocument(stored).content;

      // One asymmetry, deliberate and documented: a store with no blocks reads
      // back as a single empty paragraph, because ProseMirror will not accept
      // an empty document. Everything else must round-trip exactly.
      const expected = next.length === 0 ? EMPTY_DOCUMENT.content : next;
      expect(round.map((node) => stripId(node))).toEqual(expected.map((node) => stripId(node)));
    }

    const positions = stored.map((each) => each.position);
    expect([...positions].sort()).toEqual(positions);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('plain text, for the search index', () => {
  it('separates blocks, so two blocks do not index as one word', () => {
    // Without a separator "the end" and "Start" index as "the endStart", and a
    // search for either misses.
    const blocks = [block('a', 'a', 'the end'), block('b', 'b', 'Start')];
    expect(plainText(blocks)).toBe('the end\nStart');
  });

  it('reads text out of a nested structure', () => {
    const list: Block = {
      id: 'l',
      position: 'a',
      type: 'bulletList',
      content: {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
          },
        ],
      },
    };
    expect(plainText([list])).toContain('one');
    expect(plainText([list])).toContain('two');
  });

  it('is empty for an empty document', () => {
    expect(plainText([])).toBe('');
  });

  it('shortens a preview and marks that it was cut', () => {
    const long = block('a', 'a', 'x'.repeat(300));
    const shown = preview([long], 50);

    expect(shown).toHaveLength(50);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('leaves a short preview alone', () => {
    expect(preview([block('a', 'a', 'short')], 50)).toBe('short');
  });
});
