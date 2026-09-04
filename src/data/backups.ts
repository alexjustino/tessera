/**
 * The typed client for backups, restore, export and import — and the native
 * dialogs that ask where a file goes or comes from.
 *
 * The host reads and writes the files itself; the interface only asks the
 * person for a path. That keeps filesystem access out of the page entirely.
 */

import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export interface BackupInfo {
  path: string;
  fileName: string;
  takenAt: string;
  bytes: number;
}

export interface Counts {
  items: number;
  events: number;
  blocks: number;
}

export interface BackupsStatus {
  folder: string;
  backups: BackupInfo[];
  counts: Counts;
}

interface RawBackup {
  path: string;
  file_name: string;
  taken_at: string;
  bytes: number;
}

function toBackup(raw: RawBackup): BackupInfo {
  return { path: raw.path, fileName: raw.file_name, takenAt: raw.taken_at, bytes: raw.bytes };
}

export async function backupsStatus(): Promise<BackupsStatus> {
  const raw = await invoke<{ folder: string; backups: RawBackup[]; counts: Counts }>(
    'backups_status',
  );
  return { folder: raw.folder, backups: raw.backups.map(toBackup), counts: raw.counts };
}

export async function backupNow(): Promise<BackupInfo> {
  return toBackup(await invoke<RawBackup>('backup_now'));
}

export async function restoreBackup(path: string): Promise<Counts> {
  return invoke<Counts>('backup_restore', { path });
}

export async function revealBackups(): Promise<void> {
  await invoke<void>('backups_reveal');
}

export type ExportKind = 'json' | 'markdown' | 'ics';

export async function exportTo(kind: ExportKind, path: string): Promise<Counts | null> {
  if (kind === 'json') return invoke<Counts>('export_json', { path });
  if (kind === 'markdown') await invoke<void>('export_markdown', { path });
  else await invoke<void>('export_ics', { path });
  return null;
}

/** What an export file holds, before deciding to import it. */
export async function inspectImport(path: string): Promise<Counts> {
  return invoke<Counts>('import_inspect', { path });
}

export async function importJson(path: string): Promise<Counts> {
  return invoke<Counts>('import_json', { path });
}

// ── Dialogs ────────────────────────────────────────────────────────────────

const FILTERS: Record<ExportKind, { name: string; extensions: string[] }> = {
  json: { name: 'Tessera export', extensions: ['json'] },
  markdown: { name: 'Markdown', extensions: ['md'] },
  ics: { name: 'iCalendar', extensions: ['ics'] },
};

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Ask where to save an export. Null when the person cancelled. */
export async function chooseExportPath(kind: ExportKind): Promise<string | null> {
  const extension = FILTERS[kind].extensions[0] ?? kind;
  return save({
    title: 'Export Tessera',
    defaultPath: `tessera-${stamp()}.${extension}`,
    filters: [FILTERS[kind]],
  });
}

/** Ask for an export file to import. Null when the person cancelled. */
export async function chooseImportPath(): Promise<string | null> {
  const chosen = await open({
    title: 'Import a Tessera export',
    multiple: false,
    directory: false,
    filters: [FILTERS.json],
  });
  return typeof chosen === 'string' ? chosen : null;
}

/** Ask for a workspace file to restore. Null when the person cancelled. */
export async function chooseBackupPath(): Promise<string | null> {
  const chosen = await open({
    title: 'Restore a Tessera backup',
    multiple: false,
    directory: false,
    filters: [{ name: 'Tessera workspace', extensions: ['sqlite3'] }],
  });
  return typeof chosen === 'string' ? chosen : null;
}
