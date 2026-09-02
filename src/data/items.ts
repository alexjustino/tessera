/**
 * The typed client for the item commands.
 *
 * The host speaks snake_case, because that is what the schema speaks. The
 * interface speaks camelCase. The translation happens exactly once, here,
 * rather than leaking a database naming convention into every component.
 */

import { invoke } from '@tauri-apps/api/core';

import type { Collection, Item } from '@/domain/item';
import type { Schedule } from '@/domain/schedule';

interface RawItem {
  id: string;
  collection_id: string;
  parent_item_id: string | null;
  title: string;
  position: string;
  start_at: string | null;
  due_at: string | null;
  remind_at: string | null;
  recurrence_rrule: string | null;
  recurrence_mode: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawCollection {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  position: string;
}

function toItem(raw: RawItem): Item {
  return {
    id: raw.id,
    collectionId: raw.collection_id,
    parentItemId: raw.parent_item_id,
    title: raw.title,
    position: raw.position,
    startAt: raw.start_at,
    dueAt: raw.due_at,
    remindAt: raw.remind_at,
    recurrenceRule: raw.recurrence_rrule,
    // An unrecognised mode reads as the ordinary one rather than failing the
    // row: a schedule is a better guess than no item at all.
    recurrenceMode: raw.recurrence_mode === 'after_completion' ? 'after_completion' : 'schedule',
    completedAt: raw.completed_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toCollection(raw: RawCollection): Collection {
  return {
    id: raw.id,
    name: raw.name,
    icon: raw.icon,
    color: raw.color,
    position: raw.position,
  };
}

export async function listCollections(): Promise<Collection[]> {
  const raw = await invoke<RawCollection[]>('collections_list');
  return raw.map(toCollection);
}

export async function listItems(
  collectionId: string | null,
  includeCompleted: boolean,
): Promise<Item[]> {
  const raw = await invoke<RawItem[]>('items_list', { collectionId, includeCompleted });
  return raw.map(toItem);
}

/**
 * Create an item.
 *
 * `position` is computed by the domain layer and passed in: the ordering
 * algorithm lives in one tested place and the host stores what it is given
 * (ADR-006).
 */
export async function createItem(
  collectionId: string,
  title: string,
  position: string,
): Promise<Item> {
  const raw = await invoke<RawItem>('item_create', {
    item: { collection_id: collectionId, title, position },
  });
  return toItem(raw);
}

export async function setItemCompleted(id: string, completed: boolean): Promise<Item> {
  return toItem(await invoke<RawItem>('item_set_completed', { id, completed }));
}

export async function renameItem(id: string, title: string): Promise<Item> {
  return toItem(await invoke<RawItem>('item_rename', { id, title }));
}

export async function moveItem(
  id: string,
  position: string,
  collectionId: string | null = null,
): Promise<Item> {
  return toItem(await invoke<RawItem>('item_move', { id, position, collectionId }));
}

/**
 * Move a card on a board: its position and the field the columns group by, in
 * one host transaction.
 */
export async function moveOnBoard(
  id: string,
  position: string,
  propertyId: string | null,
  value: unknown,
): Promise<Item> {
  const raw = await invoke<RawItem>('item_move_on_board', { id, position, propertyId, value });
  return toItem(raw);
}

export async function deleteItem(id: string): Promise<void> {
  await invoke<void>('item_delete', { id });
}

/** Set an item's dates and repetition. */
export async function setSchedule(id: string, schedule: Schedule): Promise<Item> {
  const raw = await invoke<RawItem>('item_set_schedule', {
    id,
    schedule: {
      start_at: schedule.startAt,
      due_at: schedule.dueAt,
      remind_at: schedule.remindAt,
      recurrence_rrule: schedule.rule,
      recurrence_mode: schedule.rule === null ? null : schedule.mode,
    },
  });
  return toItem(raw);
}

/**
 * Complete one occurrence of a repeating item.
 *
 * `nextDueAt` is computed here, in the domain layer, and passed down. The host
 * owns storage; the calendar arithmetic — and every daylight-saving edge in it
 * — stays in one tested place (ADR-003).
 */
export async function completeOccurrence(id: string, nextDueAt: string | null): Promise<Item> {
  const raw = await invoke<RawItem>('item_complete_occurrence', { id, nextDueAt });
  return toItem(raw);
}
