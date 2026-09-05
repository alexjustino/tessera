/**
 * The typed client for the import door.
 */

import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

import type { ImportPlan } from '@/domain/importing';

export interface ImportSummary {
  collections: number;
  tasks: number;
  events: number;
  notes: number;
  valuesDropped: number;
}

export interface ImportBatch {
  id: string;
  source: string;
  importedAt: string;
  summary: ImportSummary;
}

interface RawBatch {
  id: string;
  source: string;
  imported_at: string;
  summary: {
    collections: number;
    tasks: number;
    events: number;
    notes: number;
    values_dropped: number;
  };
}

const toBatch = (raw: RawBatch): ImportBatch => ({
  id: raw.id,
  source: raw.source,
  importedAt: raw.imported_at,
  summary: {
    collections: raw.summary.collections,
    tasks: raw.summary.tasks,
    events: raw.summary.events,
    notes: raw.summary.notes,
    valuesDropped: raw.summary.values_dropped,
  },
});

/** A Tessera export file, as the JSON it is. The domain turns it into a plan. */
export async function readExportFile(path: string): Promise<unknown> {
  return invoke<unknown>('import_read_export', { path });
}

/**
 * A decided plan, with the positions the new rows take. Positions are the
 * caller's: it knows the current order of each collection.
 */
export interface PlacedPlan {
  source: string;
  collections: { name: string; icon: string | null; color: string | null; position: string }[];
  tasks: (ImportPlan['tasks'][number] & { position: string })[];
  events: ImportPlan['events'];
}

export async function applyImport(plan: PlacedPlan): Promise<ImportBatch> {
  const raw = await invoke<RawBatch>('import_apply', {
    plan: {
      source: plan.source,
      collections: plan.collections,
      tasks: plan.tasks.map((task) => ({
        collection: task.collection,
        title: task.title,
        notes: task.notes,
        position: task.position,
        start_at: task.startAt,
        due_at: task.dueAt,
        completed_at: task.completedAt,
        estimate_minutes: task.estimateMinutes,
        is_milestone: task.isMilestone,
        values: task.values,
      })),
      events: plan.events.map((event) => ({
        title: event.title,
        starts_at: event.startsAt,
        ends_at: event.endsAt,
        tz: event.tz,
        all_day: event.allDay,
        rrule: event.rrule,
      })),
    },
  });
  return toBatch(raw);
}

export async function listImports(): Promise<ImportBatch[]> {
  return (await invoke<RawBatch[]>('imports_list')).map(toBatch);
}

export async function undoImport(id: string): Promise<ImportBatch> {
  return toBatch(await invoke<RawBatch>('import_undo', { id }));
}

/** A file another product exported, as text. Size and encoding are the host's. */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('import_read_text', { path });
}

/** Ask for a CSV another product exported. Null when the person cancelled. */
export async function chooseCsvPath(title: string): Promise<string | null> {
  const chosen = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: 'Comma-separated values', extensions: ['csv', 'txt'] }],
  });
  return typeof chosen === 'string' ? chosen : null;
}

/** `C:\exports\Errands.csv` → `Errands`: the list the file was, as the file says it. */
export function nameFromPath(path: string): string {
  const base = path.split(/[\u005C/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '').trim();
}
