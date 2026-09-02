/**
 * The typed client for the property commands.
 *
 * Values cross the boundary as raw JSON. The host stores them and does not
 * interpret them; the domain layer decides what each type may contain
 * (ADR-003), which is why nothing here validates anything.
 */

import { invoke } from '@tauri-apps/api/core';

import { isPropertyType, type Property, type PropertyConfig } from '@/domain/property';

interface RawProperty {
  id: string;
  collection_id: string;
  key: string;
  name: string;
  type: string;
  config: unknown;
  position: string;
  is_system: boolean;
}

interface RawValueRow {
  item_id: string;
  property_id: string;
  value: unknown;
}

/** One item's values, keyed by property id. */
export type ValuesByItem = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

function toProperty(raw: RawProperty): Property | null {
  // A property whose type this build does not know is dropped rather than
  // guessed at. It stays in the database untouched, so an older build — or a
  // later one — still sees it.
  if (!isPropertyType(raw.type)) {
    console.warn(`ignoring property "${raw.name}": unknown type "${raw.type}"`);
    return null;
  }

  const config: PropertyConfig =
    typeof raw.config === 'object' && raw.config !== null ? (raw.config as PropertyConfig) : {};

  return {
    id: raw.id,
    collectionId: raw.collection_id,
    key: raw.key,
    name: raw.name,
    type: raw.type,
    config,
    position: raw.position,
    isSystem: raw.is_system,
  };
}

export async function listProperties(collectionId: string): Promise<Property[]> {
  const raw = await invoke<RawProperty[]>('properties_list', { collectionId });
  return raw.map(toProperty).filter((property): property is Property => property !== null);
}

export async function createProperty(
  collectionId: string,
  name: string,
  type: string,
  config: PropertyConfig,
  position: string,
): Promise<Property | null> {
  const raw = await invoke<RawProperty>('property_create', {
    property: { collection_id: collectionId, name, type, config, position },
  });
  return toProperty(raw);
}

export async function updateProperty(
  id: string,
  name: string,
  config: PropertyConfig,
): Promise<Property | null> {
  const raw = await invoke<RawProperty>('property_update', { id, name, config });
  return toProperty(raw);
}

export async function deleteProperty(id: string): Promise<void> {
  await invoke<void>('property_delete', { id });
}

/** Every stored value for a collection, folded into a lookup by item. */
export async function listValues(collectionId: string): Promise<ValuesByItem> {
  const rows = await invoke<RawValueRow[]>('property_values_list', { collectionId });

  const byItem: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    (byItem[row.item_id] ??= {})[row.property_id] = row.value;
  }
  return byItem;
}

export async function setValue(itemId: string, propertyId: string, value: unknown): Promise<void> {
  await invoke<void>('property_value_set', { itemId, propertyId, value });
}
