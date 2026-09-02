/**
 * Documents — turning a rich-text tree into rows, and back.
 *
 * An item's body is a ProseMirror document: a tree the editor owns. The
 * database stores it as one row per top-level node, ordered by a fractional key
 * (ADR-006), because the block table exists to make a document addressable —
 * per-block search, and later per-block links and backlinks. Storing the whole
 * tree in one blob would be simpler today and would throw all of that away.
 *
 * # The part that matters
 *
 * `diff` computes the **smallest set of writes** a change implies. Saving a
 * document by deleting every row and rewriting it would be far easier, and
 * wrong in three separate ways: it churns the write-ahead log on every
 * keystroke, it destroys the identity a block needs to be linked to, and it
 * turns one edited paragraph into a hundred-row transaction.
 *
 * Identity comes from `blockId`, carried in each top-level node's attributes.
 * Positional matching would look like it works and would silently re-identify
 * every block the moment one is inserted at the top.
 *
 * Pure: no I/O, no React, no host.
 */

import { between } from './ordering';

/** A ProseMirror node, as JSON. Deliberately loose: the editor owns the schema. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: unknown[];
}

/** A ProseMirror document. */
export interface DocJSON {
  type: 'doc';
  content: DocNode[];
}

/** One stored top-level node. */
export interface Block {
  id: string;
  type: string;
  position: string;
  /** The node as JSON, without its identity — that lives in `id`. */
  content: DocNode;
}

/** The attribute every top-level node carries so a row can be recognised. */
export const BLOCK_ID_ATTR = 'blockId';

export const EMPTY_DOCUMENT: DocJSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

// ── Reading ────────────────────────────────────────────────────────────────

function withId(node: DocNode, id: string): DocNode {
  return { ...node, attrs: { ...(node.attrs ?? {}), [BLOCK_ID_ATTR]: id } };
}

/** The node as it is stored: identity stripped, because the row already has it. */
export function stripId(node: DocNode): DocNode {
  if (node.attrs === undefined || !(BLOCK_ID_ATTR in node.attrs)) return node;

  const attrs = { ...node.attrs };
  delete attrs[BLOCK_ID_ATTR];

  if (Object.keys(attrs).length > 0) return { ...node, attrs };

  // The key is removed rather than set to undefined. Two nodes that differ only
  // by `attrs: undefined` versus no `attrs` at all serialise differently, and
  // the diff compares serialised nodes — so that difference would read as an
  // edit and write a row for nothing.
  const withoutAttrs = { ...node };
  delete withoutAttrs.attrs;
  return withoutAttrs;
}

function sameContent(a: DocNode, b: DocNode): boolean {
  return JSON.stringify(stripId(a)) === JSON.stringify(stripId(b));
}

/**
 * Assemble stored rows into a document the editor can open.
 *
 * An empty document still gets one paragraph. ProseMirror requires a non-empty
 * doc, and an item with no body is the normal case rather than an error.
 */
export function toDocument(blocks: readonly Block[]): DocJSON {
  if (blocks.length === 0) return EMPTY_DOCUMENT;

  const ordered = [...blocks].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
  );

  return { type: 'doc', content: ordered.map((block) => withId(block.content, block.id)) };
}

// ── Writing ────────────────────────────────────────────────────────────────

export interface BlockCreate {
  /** Assigned by the caller, so the editor can adopt it without a round trip. */
  id: string;
  type: string;
  position: string;
  content: DocNode;
}

export interface BlockUpdate {
  id: string;
  type: string;
  position: string;
  content: DocNode;
}

export interface BlockChanges {
  creates: BlockCreate[];
  updates: BlockUpdate[];
  deletes: string[];
}

export function isEmptyChange(changes: BlockChanges): boolean {
  return (
    changes.creates.length === 0 && changes.updates.length === 0 && changes.deletes.length === 0
  );
}

function idOf(node: DocNode): string | null {
  const value = node.attrs?.[BLOCK_ID_ATTR];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The smallest set of writes that turns `existing` into `nodes`.
 *
 * `newId` supplies identities for nodes that do not have one yet. It is passed
 * in rather than generated here so the module stays pure and the tests stay
 * deterministic.
 *
 * Positions are reused wherever the relative order still holds, so typing in a
 * paragraph rewrites one row rather than renumbering the document.
 */
export function diff(
  existing: readonly Block[],
  nodes: readonly DocNode[],
  newId: () => string,
): BlockChanges {
  const byId = new Map(existing.map((block) => [block.id, block]));

  /** The stored block behind each node, where there is one. */
  const anchors = nodes.map((node) => {
    const id = idOf(node);
    return id === null ? undefined : byId.get(id);
  });

  const keep = keepable(anchors);

  const creates: BlockCreate[] = [];
  const updates: BlockUpdate[] = [];
  const seen = new Set<string>();
  let previous: string | null = null;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const content = stripId(node);
    const block = anchors[index];

    let position: string;
    if (keep.has(index) && block !== undefined) {
      position = block.position;
    } else {
      // Bounded by the next block that keeps its own key, so one insertion or
      // one drag cannot cascade into a renumber of everything after it.
      let upper: string | null = null;
      for (let ahead = index + 1; ahead < nodes.length; ahead += 1) {
        if (keep.has(ahead)) {
          upper = anchors[ahead]?.position ?? null;
          break;
        }
      }
      position = between(previous, upper);
    }
    previous = position;

    if (block === undefined) {
      creates.push({ id: idOf(node) ?? newId(), type: node.type, position, content });
      continue;
    }

    seen.add(block.id);
    if (
      block.position !== position ||
      block.type !== node.type ||
      !sameContent(block.content, content)
    ) {
      updates.push({ id: block.id, type: node.type, position, content });
    }
  }

  const deletes = existing.filter((block) => !seen.has(block.id)).map((block) => block.id);

  return { creates, updates, deletes };
}

/**
 * Which nodes can keep the key they already have.
 *
 * The longest run of stored blocks whose keys are already ascending in the new
 * order — the classic longest increasing subsequence. Everything outside it is
 * repositioned, and that set is provably as small as it can be.
 *
 * A greedy walk that simply anchors on the first block gets this wrong in a way
 * a person would notice: dragging the last block of three to the top would
 * rewrite the other two instead of the one that actually moved.
 */
function keepable(anchors: readonly (Block | undefined)[]): Set<number> {
  const candidates: number[] = [];
  for (let index = 0; index < anchors.length; index += 1) {
    if (anchors[index] !== undefined) candidates.push(index);
  }
  if (candidates.length === 0) return new Set();

  // Patience sorting: `tails[length - 1]` is the candidate ending the shortest
  // increasing run of that length seen so far.
  const tails: number[] = [];
  const cameFrom = new Map<number, number>();

  for (const index of candidates) {
    const position = anchors[index]!.position;

    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (anchors[tails[middle]!]!.position < position) low = middle + 1;
      else high = middle;
    }

    if (low > 0) cameFrom.set(index, tails[low - 1]!);
    tails[low] = index;
  }

  const keep = new Set<number>();
  let cursor: number | undefined = tails[tails.length - 1];
  while (cursor !== undefined) {
    keep.add(cursor);
    cursor = cameFrom.get(cursor);
  }
  return keep;
}

/** Apply changes locally, so a caller can predict what the host will hold. */
export function applyChanges(existing: readonly Block[], changes: BlockChanges): Block[] {
  const removed = new Set(changes.deletes);
  const updated = new Map(changes.updates.map((update) => [update.id, update]));

  const kept: Block[] = existing
    .filter((block) => !removed.has(block.id))
    .map((block) => {
      const update = updated.get(block.id);
      return update === undefined
        ? block
        : { id: block.id, type: update.type, position: update.position, content: update.content };
    });

  const created: Block[] = changes.creates.map((create) => ({
    id: create.id,
    type: create.type,
    position: create.position,
    content: create.content,
  }));

  return [...kept, ...created].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
  );
}

// ── Text ───────────────────────────────────────────────────────────────────

/**
 * The document as plain text, for the search index.
 *
 * A block separator matters: without one, "the end" and "Start" would index as
 * "the endStart" and a search for either would miss.
 */
export function plainText(blocks: readonly Block[]): string {
  return toDocument(blocks)
    .content.map((node) => nodeText(node))
    .filter((text) => text.length > 0)
    .join('\n');
}

function nodeText(node: DocNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  // A hard break inside a paragraph is still a word boundary.
  return node.content
    .map(nodeText)
    .join(node.type === 'paragraph' ? '' : ' ')
    .trim();
}

/** A short preview of a document, for a card or a list row. */
export function preview(blocks: readonly Block[], limit = 140): string {
  const text = plainText(blocks).replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
