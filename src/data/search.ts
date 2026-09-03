/**
 * The typed client for search: one box over items and events.
 */

import { invoke } from '@tauri-apps/api/core';

import type { SearchHit } from '@/domain/search';

interface RawHit {
  owner_kind: string;
  owner_id: string;
  title: string;
  body: string;
  completed: boolean;
}

/**
 * `query` must already be shaped by `toFtsQuery`; passing raw text here would
 * hand FTS5 syntax to the index. The host caps `limit` at fifty.
 */
export async function search(query: string, limit = 20): Promise<SearchHit[]> {
  const raw = await invoke<RawHit[]>('search', { query, limit });
  return raw.map((hit) => ({
    ownerKind: hit.owner_kind === 'event' ? 'event' : 'item',
    ownerId: hit.owner_id,
    title: hit.title,
    body: hit.body,
    completed: hit.completed,
  }));
}
