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

import * as api from './items';
import * as propertyApi from './properties';

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
