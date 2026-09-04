/**
 * The typed client for reminders, the tray and autostart.
 */

import { invoke } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

export interface PendingReminder {
  id: string;
  ownerKind: string;
  ownerId: string;
  fireAt: string;
  title: string;
}

export interface ReminderStatus {
  pending: PendingReminder[];
  pausedUntil: string | null;
}

interface RawStatus {
  pending: Array<{
    id: string;
    owner_kind: string;
    owner_id: string;
    fire_at: string;
    title: string;
  }>;
  paused_until: string | null;
}

export async function reminderStatus(): Promise<ReminderStatus> {
  const raw = await invoke<RawStatus>('reminders_status');
  return {
    pending: raw.pending.map((row) => ({
      id: row.id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      fireAt: row.fire_at,
      title: row.title,
    })),
    pausedUntil: raw.paused_until,
  };
}

export async function pauseReminders(minutes: number): Promise<void> {
  await invoke<void>('reminders_pause', { minutes });
}

export async function resumeReminders(): Promise<void> {
  await invoke<void>('reminders_resume');
}

export async function snoozeReminder(id: string, minutes: number): Promise<void> {
  await invoke<void>('reminder_snooze', { id, minutes });
}

export async function dismissReminder(id: string): Promise<void> {
  await invoke<void>('reminder_dismiss', { id });
}

export async function refreshTray(): Promise<void> {
  await invoke<void>('tray_refresh');
}

/**
 * Whether Tessera starts with Windows.
 *
 * Off by default and only ever turned on from Diagnostics: the product never
 * registers itself to run at login behind somebody's back.
 */
export async function autostartEnabled(): Promise<boolean> {
  return isEnabled();
}

export async function setAutostart(on: boolean): Promise<void> {
  if (on) await enable();
  else await disable();
}
