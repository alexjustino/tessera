/**
 * The typed client for the document commands.
 *
 * Nodes cross the boundary as opaque JSON. The host stores them and does not
 * read them; what a block type means is the editor's business (ADR-003).
 */

import { invoke } from '@tauri-apps/api/core';

import type { Block, BlockChanges, DocNode } from '@/domain/document';
import type { Link } from '@/domain/page';

interface RawBlock {
  id: string;
  owner_kind: string;
  owner_id: string;
  type: string;
  position: string;
  content: DocNode;
}

function toBlock(raw: RawBlock): Block {
  return { id: raw.id, type: raw.type, position: raw.position, content: raw.content };
}

export async function listBlocks(ownerKind: string, ownerId: string): Promise<Block[]> {
  const raw = await invoke<RawBlock[]>('blocks_list', { ownerKind, ownerId });
  return raw.map(toBlock);
}

/**
 * Apply a change set, reindex, and record what the document points at, in one
 * host transaction.
 *
 * `plainText` is the flattened document and `links` the pages it links to.
 * Both travel with the change set so neither the search index nor the
 * backlinks can end up describing a document that was never saved.
 */
export async function applyBlocks(
  ownerKind: string,
  ownerId: string,
  changes: BlockChanges,
  plainText: string,
  links: readonly Link[] = [],
): Promise<Block[]> {
  const raw = await invoke<RawBlock[]>('blocks_apply', {
    ownerKind,
    ownerId,
    changes: {
      creates: changes.creates.map((create) => ({
        id: create.id,
        type: create.type,
        position: create.position,
        content: create.content,
      })),
      updates: changes.updates.map((update) => ({
        id: update.id,
        type: update.type,
        position: update.position,
        content: update.content,
      })),
      deletes: changes.deletes,
    },
    plainText,
    links: links.map((link) => ({ pageId: link.pageId, title: link.title })),
  });
  return raw.map(toBlock);
}
