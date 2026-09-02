/**
 * The typed client for the view commands.
 *
 * A view's query crosses the boundary as opaque JSON. The host stores it and
 * does not interpret it; `src/domain/query.ts` decides what it means. That is
 * what lets the engine grow a new operator without a migration.
 */

import { invoke } from '@tauri-apps/api/core';

import { EMPTY_BOARD_CONFIG, type BoardConfig } from '@/domain/board';
import { EMPTY_QUERY, type Query } from '@/domain/query';

export const VIEW_KINDS = ['list', 'table', 'board', 'calendar'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export interface View {
  id: string;
  /** Null for a cross-collection view: Today, Inbox, Overdue. */
  collectionId: string | null;
  name: string;
  kind: ViewKind;
  query: Query;
  /**
   * What only a board needs: work-in-progress limits, collapsed columns, which
   * properties appear on a card. Stored beside the query rather than inside it,
   * because none of it changes which items match.
   */
  board: BoardConfig;
  position: string;
}

interface RawView {
  id: string;
  collection_id: string | null;
  name: string;
  kind: string;
  config: unknown;
  position: string;
}

function isViewKind(value: string): value is ViewKind {
  return (VIEW_KINDS as readonly string[]).includes(value);
}

/**
 * Read a stored query, filling in whatever it does not carry.
 *
 * A view saved by an earlier build has fewer keys than the current shape, and a
 * corrupted one has none. Merging over the empty query means an old or damaged
 * view opens as a plain unfiltered list rather than as a blank screen.
 */
function toQuery(raw: unknown): Query {
  if (typeof raw !== 'object' || raw === null) return EMPTY_QUERY;
  const stored = raw as Partial<Query>;

  return {
    filters: Array.isArray(stored.filters) ? stored.filters : EMPTY_QUERY.filters,
    match: stored.match === 'any' ? 'any' : 'all',
    sorts: Array.isArray(stored.sorts) ? stored.sorts : EMPTY_QUERY.sorts,
    groupBy: stored.groupBy ?? null,
    includeCompleted: stored.includeCompleted !== false,
  };
}

/** Read the board settings, filling in whatever an older view does not carry. */
function toBoard(raw: unknown): BoardConfig {
  if (typeof raw !== 'object' || raw === null) return EMPTY_BOARD_CONFIG;
  const stored = (raw as { board?: Partial<BoardConfig> }).board;
  if (typeof stored !== 'object' || stored === null) return EMPTY_BOARD_CONFIG;

  return {
    wipLimits:
      typeof stored.wipLimits === 'object' && stored.wipLimits !== null
        ? stored.wipLimits
        : EMPTY_BOARD_CONFIG.wipLimits,
    collapsed: Array.isArray(stored.collapsed) ? stored.collapsed : EMPTY_BOARD_CONFIG.collapsed,
    cardProperties: Array.isArray(stored.cardProperties)
      ? stored.cardProperties
      : EMPTY_BOARD_CONFIG.cardProperties,
  };
}

function toView(raw: RawView): View | null {
  if (!isViewKind(raw.kind)) {
    console.warn(`ignoring view "${raw.name}": unknown kind "${raw.kind}"`);
    return null;
  }
  return {
    id: raw.id,
    collectionId: raw.collection_id,
    name: raw.name,
    kind: raw.kind,
    query: toQuery(raw.config),
    board: toBoard(raw.config),
    position: raw.position,
  };
}

export async function listViews(collectionId: string | null): Promise<View[]> {
  const raw = await invoke<RawView[]>('views_list', { collectionId });
  return raw.map(toView).filter((view): view is View => view !== null);
}

export async function createView(
  collectionId: string | null,
  name: string,
  kind: ViewKind,
  query: Query,
  board: BoardConfig,
  position: string,
): Promise<View | null> {
  const raw = await invoke<RawView>('view_create', {
    view: { collection_id: collectionId, name, kind, config: { ...query, board }, position },
  });
  return toView(raw);
}

export async function updateView(
  id: string,
  name: string,
  kind: ViewKind,
  query: Query,
  board: BoardConfig,
): Promise<View | null> {
  const raw = await invoke<RawView>('view_update', {
    id,
    name,
    kind,
    config: { ...query, board },
  });
  return toView(raw);
}

export async function deleteView(id: string): Promise<void> {
  await invoke<void>('view_delete', { id });
}
