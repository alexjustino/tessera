/**
 * The typed client for time tracking.
 */

import { invoke } from '@tauri-apps/api/core';

import type { Entry } from '@/domain/time';

interface RawEntry {
  id: string;
  item_id: string;
  started_at: string;
  ended_at: string | null;
}

const toEntry = (raw: RawEntry): Entry => ({
  id: raw.id,
  itemId: raw.item_id,
  startedAt: raw.started_at,
  endedAt: raw.ended_at,
});

/**
 * Every entry in the workspace.
 *
 * Small on purpose: a person starts and stops a clock a handful of times a
 * day, so the whole table is cheaper to hold than any of the questions asked
 * of it are to ask separately — and "this task", "today" and "this week" are
 * all the same walk over the same rows.
 */
export async function listEntries(): Promise<Entry[]> {
  const raw = await invoke<RawEntry[]>('time_entries_list');
  return raw.map(toEntry);
}

/** The running entry, if a clock is going. */
export async function runningEntry(): Promise<Entry | null> {
  const raw = await invoke<RawEntry | null>('time_running');
  return raw ? toEntry(raw) : null;
}

/** Start timing a task. Whatever was running stops. */
export async function startTimer(itemId: string): Promise<Entry> {
  return toEntry(await invoke<RawEntry>('time_start', { itemId }));
}

/** Stop the running timer. Null when nothing was running. */
export async function stopTimer(): Promise<Entry | null> {
  const raw = await invoke<RawEntry | null>('time_stop');
  return raw ? toEntry(raw) : null;
}

export async function deleteEntry(id: string): Promise<void> {
  await invoke<void>('time_entry_delete', { id });
}
