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

import * as api from './items';

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
