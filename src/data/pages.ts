/**
 * The typed client for pages — the notes space.
 */

import { invoke } from '@tauri-apps/api/core';

import type { Backlink, Page } from '@/domain/page';

interface RawPage {
  id: string;
  title: string;
  position: string;
  created_at: string;
  updated_at: string;
}

interface RawBacklink {
  owner_kind: string;
  owner_id: string;
  title: string;
}

/** A page, and the order key the list keeps it in. */
export interface StoredPage extends Page {
  position: string;
}

function toPage(raw: RawPage): StoredPage {
  return {
    id: raw.id,
    title: raw.title,
    position: raw.position,
    updatedAt: raw.updated_at,
  };
}

export async function listPages(): Promise<StoredPage[]> {
  return (await invoke<RawPage[]>('pages_list')).map(toPage);
}

export async function createPage(title: string, position: string): Promise<StoredPage> {
  return toPage(await invoke<RawPage>('page_create', { title, position }));
}

export async function renamePage(id: string, title: string): Promise<StoredPage> {
  return toPage(await invoke<RawPage>('page_rename', { id, title }));
}

export async function deletePage(id: string): Promise<void> {
  await invoke<void>('page_delete', { id });
}

/** What points at this page — pages, tasks and events alike. */
export async function pageBacklinks(id: string): Promise<Backlink[]> {
  const raw = await invoke<RawBacklink[]>('page_backlinks', { id });
  return raw.map((entry) => ({
    ownerKind: entry.owner_kind as Backlink['ownerKind'],
    ownerId: entry.owner_id,
    title: entry.title,
    excerpt: '',
  }));
}

/** A task and a page a person paired. */
export interface ItemPage {
  itemId: string;
  pageId: string;
}

export async function listItemPages(): Promise<ItemPage[]> {
  const raw = await invoke<Array<{ item_id: string; page_id: string }>>('item_pages_list');
  return raw.map((pair) => ({ itemId: pair.item_id, pageId: pair.page_id }));
}

export async function linkItemPage(pair: ItemPage): Promise<void> {
  await invoke<void>('item_page_link', { ...pair });
}

export async function unlinkItemPage(pair: ItemPage): Promise<void> {
  await invoke<void>('item_page_unlink', { ...pair });
}
