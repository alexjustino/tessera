/**
 * The typed client for days off (M3).
 */

import { invoke } from '@tauri-apps/api/core';

export interface DayOff {
  /** A local day, `YYYY-MM-DD`. */
  day: string;
  label: string;
}

interface RawDayOff {
  day: string;
  label: string;
  created_at: string;
}

export async function listDaysOff(): Promise<DayOff[]> {
  return (await invoke<RawDayOff[]>('days_off_list')).map((raw) => ({
    day: raw.day,
    label: raw.label,
  }));
}

export async function setDayOff(day: string, label: string): Promise<DayOff> {
  const raw = await invoke<RawDayOff>('day_off_set', { day, label });
  return { day: raw.day, label: raw.label };
}

export async function removeDayOff(day: string): Promise<void> {
  await invoke('day_off_remove', { day });
}
