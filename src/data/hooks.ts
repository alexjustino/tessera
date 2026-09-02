/**
 * React Query bindings for the item commands.
 *
 * Commands are asynchronous I/O against a local process, which is what this
 * library is for: caching, invalidation and load state, without a hand-rolled
 * store per screen.
 *
 * Every mutation invalidates rather than patching the cache by hand. The write
 * already returned the row the host actually stored — trimmed title, generated
 * identifier, real timestamps — and refetching is how the interface stays honest
 * about what is on disk instead of about what it hoped would be.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PropertyConfig } from '@/domain/property';
import type { BoardConfig, Move } from '@/domain/board';
import type { BlockChanges } from '@/domain/document';
import type { Query } from '@/domain/query';

import * as api from './items';
import * as propertyApi from './properties';
import * as blockApi from './blocks';
import * as viewApi from './views';

export const keys = {
  collections: ['collections'] as const,
  items: (collectionId: string | null, includeCompleted: boolean) =>
    ['items', collectionId, includeCompleted] as const,
};

export function useCollections() {
  return useQuery({ queryKey: keys.collections, queryFn: api.listCollections });
}

export function useItems(collectionId: string | null, includeCompleted: boolean) {
  return useQuery({
    queryKey: keys.items(collectionId, includeCompleted),
    queryFn: () => api.listItems(collectionId, includeCompleted),
  });
}

/** Invalidate every item list, whichever collection or filter it was for. */
function useInvalidateItems() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['items'] });
}

export function useCreateItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: ({
      collectionId,
      title,
      position,
    }: {
      collectionId: string;
      title: string;
      position: string;
    }) => api.createItem(collectionId, title, position),
    onSuccess: invalidate,
  });
}

export function useSetItemCompleted() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.setItemCompleted(id, completed),
    onSuccess: invalidate,
  });
}

export function useRenameItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameItem(id, title),
    onSuccess: invalidate,
  });
}

/**
 * Move a card on a board.
 *
 * Position and grouping field travel together in one command, because a failure
 * between two separate writes would leave a card in one column while the data
 * says another — on a board, a task that looks done and is not.
 */
export function useMoveOnBoard() {
  const invalidate = useInvalidateItems();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (move: Move) =>
      api.moveOnBoard(
        move.itemId,
        move.position,
        move.field?.kind === 'property' ? move.field.propertyId : null,
        move.value,
      ),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: ['property-values'] });
    },
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    onSuccess: invalidate,
  });
}

// ── Properties ──────────────────────────────────────────────────────────────

export const propertyKeys = {
  properties: (collectionId: string) => ['properties', collectionId] as const,
  values: (collectionId: string) => ['property-values', collectionId] as const,
};

export function useProperties(collectionId: string) {
  return useQuery({
    queryKey: propertyKeys.properties(collectionId),
    queryFn: () => propertyApi.listProperties(collectionId),
  });
}

export function usePropertyValues(collectionId: string) {
  return useQuery({
    queryKey: propertyKeys.values(collectionId),
    queryFn: () => propertyApi.listValues(collectionId),
  });
}

function useInvalidateProperties() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['properties'] });
    void client.invalidateQueries({ queryKey: ['property-values'] });
  };
}

export function useSetPropertyValue() {
  const invalidate = useInvalidateProperties();
  return useMutation({
    mutationFn: ({
      itemId,
      propertyId,
      value,
    }: {
      itemId: string;
      propertyId: string;
      value: unknown;
    }) => propertyApi.setValue(itemId, propertyId, value),
    onSuccess: invalidate,
  });
}

export function useCreateProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({
    mutationFn: ({
      collectionId,
      name,
      type,
      config,
      position,
    }: {
      collectionId: string;
      name: string;
      type: string;
      config: PropertyConfig;
      position: string;
    }) => propertyApi.createProperty(collectionId, name, type, config, position),
    onSuccess: invalidate,
  });
}

export function useUpdateProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({
    mutationFn: ({ id, name, config }: { id: string; name: string; config: PropertyConfig }) =>
      propertyApi.updateProperty(id, name, config),
    onSuccess: invalidate,
  });
}

export function useDeleteProperty() {
  const invalidate = useInvalidateProperties();
  return useMutation({
    mutationFn: (id: string) => propertyApi.deleteProperty(id),
    onSuccess: invalidate,
  });
}

// ── Views ───────────────────────────────────────────────────────────────────

export const viewKeys = {
  views: (collectionId: string | null) => ['views', collectionId] as const,
};

export function useViews(collectionId: string | null) {
  return useQuery({
    queryKey: viewKeys.views(collectionId),
    queryFn: () => viewApi.listViews(collectionId),
  });
}

function useInvalidateViews() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['views'] });
}

export function useCreateView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: ({
      collectionId,
      name,
      kind,
      query,
      board,
      position,
    }: {
      collectionId: string | null;
      name: string;
      kind: viewApi.ViewKind;
      query: Query;
      board: BoardConfig;
      position: string;
    }) => viewApi.createView(collectionId, name, kind, query, board, position),
    onSuccess: invalidate,
  });
}

export function useUpdateView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: ({
      id,
      name,
      kind,
      query,
      board,
    }: {
      id: string;
      name: string;
      kind: viewApi.ViewKind;
      query: Query;
      board: BoardConfig;
    }) => viewApi.updateView(id, name, kind, query, board),
    onSuccess: invalidate,
  });
}

export function useDeleteView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (id: string) => viewApi.deleteView(id),
    onSuccess: invalidate,
  });
}

// ── Documents ───────────────────────────────────────────────────────────────

export const blockKeys = {
  blocks: (ownerKind: string, ownerId: string) => ['blocks', ownerKind, ownerId] as const,
};

export function useBlocks(ownerKind: string, ownerId: string | null) {
  return useQuery({
    queryKey: blockKeys.blocks(ownerKind, ownerId ?? ''),
    queryFn: () => blockApi.listBlocks(ownerKind, ownerId ?? ''),
    enabled: ownerId !== null,
  });
}

/**
 * Save a document change set.
 *
 * The editor holds the authoritative document while it is open, so a successful
 * save writes the result straight into the cache rather than refetching. A
 * refetch would replace the document under the cursor mid-sentence, which is
 * the one thing an editor must never do.
 */
export function useApplyBlocks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      ownerKind,
      ownerId,
      changes,
      plainText,
    }: {
      ownerKind: string;
      ownerId: string;
      changes: BlockChanges;
      plainText: string;
    }) => blockApi.applyBlocks(ownerKind, ownerId, changes, plainText),
    onSuccess: (blocks, variables) => {
      client.setQueryData(blockKeys.blocks(variables.ownerKind, variables.ownerId), blocks);
    },
  });
}
