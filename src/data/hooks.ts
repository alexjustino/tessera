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

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Capture } from '@/domain/capture';
import type { Settings } from '@/domain/settings';
import type { PropertyConfig } from '@/domain/property';
import { toFtsQuery } from '@/domain/search';
import type { BoardConfig, Move } from '@/domain/board';
import type { BlockChanges } from '@/domain/document';
import type { Schedule } from '@/domain/schedule';
import type { Query } from '@/domain/query';

import * as api from './items';
import * as propertyApi from './properties';
import * as blockApi from './blocks';
import * as reminderApi from './reminders';
import * as calendarApi from './calendar';
import * as viewApi from './views';
import * as searchApi from './search';
import * as captureApi from './capture';
import * as settingsApi from './settings';
import * as backupsApi from './backups';

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

export function useSetSchedule() {
  const invalidate = useInvalidateItems();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, schedule }: { id: string; schedule: Schedule }) =>
      api.setSchedule(id, schedule),
    onSuccess: () => {
      invalidate();
      void client.invalidateQueries({ queryKey: ['reminders'] });
      void reminderApi.refreshTray();
    },
  });
}

/**
 * Tick one occurrence of a repeating item.
 *
 * Separate from completing a plain task on purpose: a repeating task is not
 * finished when you do it once, so this records the occurrence and moves the
 * date on rather than closing the item.
 */
export function useCompleteOccurrence() {
  const invalidate = useInvalidateItems();
  return useMutation({
    mutationFn: ({ id, nextDueAt }: { id: string; nextDueAt: string | null }) =>
      api.completeOccurrence(id, nextDueAt),
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

// ── Time ────────────────────────────────────────────────────────────────────

export const calendarKeys = {
  calendars: ['calendars'] as const,
  workHours: ['work-hours'] as const,
  events: (from: string, to: string) => ['events', from, to] as const,
  exceptions: ['event-exceptions'] as const,
};

export function useCalendars() {
  return useQuery({ queryKey: calendarKeys.calendars, queryFn: calendarApi.listCalendars });
}

export function useWorkHours() {
  return useQuery({ queryKey: calendarKeys.workHours, queryFn: calendarApi.listWorkHours });
}

export function useEvents(from: string, to: string, calendars: calendarApi.Calendar[]) {
  return useQuery({
    queryKey: calendarKeys.events(from, to),
    queryFn: () => calendarApi.listEvents(from, to, calendars),
    enabled: calendars.length > 0,
  });
}

export function useEventExceptions() {
  return useQuery({ queryKey: calendarKeys.exceptions, queryFn: calendarApi.listExceptions });
}

function useInvalidateCalendar() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['events'] });
    void client.invalidateQueries({ queryKey: ['event-exceptions'] });
    // Reserving time for a task touches the task's own row too.
    void client.invalidateQueries({ queryKey: ['items'] });
  };
}

export function useMoveEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, startsAt, endsAt }: { id: string; startsAt: string; endsAt: string }) =>
      calendarApi.moveEvent(id, startsAt, endsAt),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: calendarApi.deleteEvent, onSuccess: invalidate });
}

export function useSetException() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: calendarApi.setException, onSuccess: invalidate });
}

export function useCreateTimeBlock() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: calendarApi.createTimeBlock, onSuccess: invalidate });
}

// ── Reminders ───────────────────────────────────────────────────────────────

export const reminderKeys = {
  status: ['reminders', 'status'] as const,
  autostart: ['autostart'] as const,
};

export function useReminderStatus() {
  return useQuery({
    queryKey: reminderKeys.status,
    queryFn: reminderApi.reminderStatus,
    // The one query in the product that is allowed to go stale on a timer: the
    // queue changes as the clock moves, not only when this application writes.
    refetchInterval: 30_000,
  });
}

function useInvalidateReminders() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['reminders'] });
    void reminderApi.refreshTray();
  };
}

export function usePauseReminders() {
  const invalidate = useInvalidateReminders();
  return useMutation({ mutationFn: reminderApi.pauseReminders, onSuccess: invalidate });
}

export function useResumeReminders() {
  const invalidate = useInvalidateReminders();
  return useMutation({ mutationFn: reminderApi.resumeReminders, onSuccess: invalidate });
}

export function useSnoozeReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) =>
      reminderApi.snoozeReminder(id, minutes),
    onSuccess: invalidate,
  });
}

export function useDismissReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({ mutationFn: reminderApi.dismissReminder, onSuccess: invalidate });
}

export function useAutostart() {
  return useQuery({ queryKey: reminderKeys.autostart, queryFn: reminderApi.autostartEnabled });
}

export function useSetAutostart() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: reminderApi.setAutostart,
    onSuccess: () => void client.invalidateQueries({ queryKey: reminderKeys.autostart }),
  });
}

// ── Search and quick capture (F9) ──────────────────────────────────────────

/**
 * One box over items and events. The text is shaped for the index here, so no
 * component ever hands FTS5 syntax to the host. Nothing is asked for an empty
 * or punctuation-only query; the previous answer stays while a new one loads,
 * so the list does not blink between keystrokes.
 */
export function useSearch(text: string) {
  const query = toFtsQuery(text);
  return useQuery({
    queryKey: ['search', query] as const,
    queryFn: () => (query === null ? Promise.resolve([]) : searchApi.search(query, 20)),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    // Unlike the item lists, a search answer is stale as soon as anything is
    // written; reopening the palette asks again.
    staleTime: 0,
  });
}

/**
 * Write one parsed line. A capture can touch items, values, reminders and the
 * search index at once, so everything is invalidated rather than guessing.
 */
export function useCaptureItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      collectionId,
      position,
      capture,
      priorityPropertyId,
    }: {
      collectionId: string;
      position: string;
      capture: Capture;
      /** The collection's priority property, when it has one. */
      priorityPropertyId: string | null;
    }) =>
      api.captureItem(
        collectionId,
        position,
        capture,
        priorityPropertyId !== null && capture.priority !== null
          ? [{ propertyId: priorityPropertyId, value: capture.priority }]
          : [],
      ),
    onSuccess: () => {
      void client.invalidateQueries();
      void reminderApi.refreshTray();
    },
  });
}

export function useCaptureStatus() {
  return useQuery({ queryKey: ['capture-status'] as const, queryFn: captureApi.captureStatus });
}

// ── Settings and data (F10) ────────────────────────────────────────────────

export const settingsKey = ['settings'] as const;

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: settingsApi.getSettings });
}

/**
 * Replace the settings. The cache takes what the host actually stored, not
 * what was sent — a refused value never looks accepted — and the capture
 * status is re-read because the shortcut may have been re-bound.
 */
export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) => settingsApi.setSettings(settings),
    onSuccess: (saved) => {
      client.setQueryData(settingsKey, saved);
      void client.invalidateQueries({ queryKey: ['capture-status'] });
    },
  });
}

export function useBackupsStatus() {
  return useQuery({
    queryKey: ['backups'] as const,
    queryFn: backupsApi.backupsStatus,
    staleTime: 0,
  });
}

export function useBackupNow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: backupsApi.backupNow,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['backups'] }),
  });
}

/** After the workspace is replaced, nothing in any cache can be trusted. */
function useWorkspaceReplaced() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries();
    void reminderApi.refreshTray();
  };
}

export function useRestoreBackup() {
  const replaced = useWorkspaceReplaced();
  return useMutation({
    mutationFn: (path: string) => backupsApi.restoreBackup(path),
    onSuccess: replaced,
  });
}

export function useExport() {
  return useMutation({
    mutationFn: ({ kind, path }: { kind: backupsApi.ExportKind; path: string }) =>
      backupsApi.exportTo(kind, path),
  });
}

export function useImportJson() {
  const replaced = useWorkspaceReplaced();
  return useMutation({
    mutationFn: (path: string) => backupsApi.importJson(path),
    onSuccess: replaced,
  });
}
