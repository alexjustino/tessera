/**
 * The typed client for settings.
 */

import { invoke } from '@tauri-apps/api/core';

import { readSettings, type Settings } from '@/domain/settings';

interface RawSettings {
  theme: string;
  density: string;
  quick_capture_shortcut: string;
  backups_enabled: boolean;
  backups_keep: number;
  guide_hours_set: boolean;
  guide_days_off_set: boolean;
  guide_dismissed: boolean;
  update_check: boolean;
}

function fromRaw(raw: RawSettings): Settings {
  return readSettings({
    theme: raw.theme,
    density: raw.density,
    quickCaptureShortcut: raw.quick_capture_shortcut,
    backupsEnabled: raw.backups_enabled,
    backupsKeep: raw.backups_keep,
    guideHoursSet: raw.guide_hours_set,
    guideDaysOffSet: raw.guide_days_off_set,
    guideDismissed: raw.guide_dismissed,
    updateCheck: raw.update_check,
  });
}

function toRaw(settings: Settings): RawSettings {
  return {
    theme: settings.theme,
    density: settings.density,
    quick_capture_shortcut: settings.quickCaptureShortcut,
    backups_enabled: settings.backupsEnabled,
    backups_keep: settings.backupsKeep,
    guide_hours_set: settings.guideHoursSet,
    guide_days_off_set: settings.guideDaysOffSet,
    guide_dismissed: settings.guideDismissed,
    update_check: settings.updateCheck,
  };
}

export async function getSettings(): Promise<Settings> {
  return fromRaw(await invoke<RawSettings>('settings_get'));
}

/** Replace the settings. The host validates and re-binds the capture shortcut. */
export async function setSettings(settings: Settings): Promise<Settings> {
  return fromRaw(await invoke<RawSettings>('settings_set', { settings: toRaw(settings) }));
}
