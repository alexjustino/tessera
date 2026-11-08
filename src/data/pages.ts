/**
 * The typed client for pages — the notes space.
 */

import { invoke } from '@tauri-apps/api/core';

import { isColor, type ColorId } from '@/domain/colors';
import type { Backlink, Page } from '@/domain/page';
import type { Section } from '@/domain/sections';

interface RawPage {
  id: string;
  title: string;
  position: string;
  created_at: string;
  updated_at: string;
  section_id: string | null;
}

interface RawSection {
  id: string;
  name: string;
  color: string | null;
  position: string;
}

function toSection(raw: RawSection): Section {
  return {
    id: raw.id,
    name: raw.name,
    color: isColor(raw.color) ? raw.color : null,
    position: raw.position,
  };
}

export async function listSections(): Promise<Section[]> {
  return (await invoke<RawSection[]>('sections_list')).map(toSection);
}

export async function createSection(input: {
  name: string;
  color: ColorId | null;
  position: string;
}): Promise<Section> {
  return toSection(await invoke<RawSection>('section_create', input));
}

export async function updateSection(input: {
  id: string;
  name: string;
  color: ColorId | null;
}): Promise<Section> {
  return toSection(await invoke<RawSection>('section_update', input));
}

export async function deleteSection(id: string): Promise<void> {
  await invoke('section_delete', { id });
}

/** File a page in a section, or in Quick notes with null. */
export async function filePage(id: string, sectionId: string | null): Promise<StoredPage> {
  return toPage(await invoke<RawPage>('page_file', { id, sectionId }));
}

interface RawBacklink {
  owner_kind: string;
  owner_id: string;
  title: string;
}

/** A page, and the order key the list keeps it in. */
export interface StoredPage extends Page {
  position: string;
  /** The section it is filed in; null is Quick notes. */
  sectionId: string | null;
}

function toPage(raw: RawPage): StoredPage {
  return {
    id: raw.id,
    title: raw.title,
    position: raw.position,
    updatedAt: raw.updated_at,
    sectionId: raw.section_id,
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
