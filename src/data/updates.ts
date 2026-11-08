/**
 * The typed client for the update check (ADR-062). The host makes the request,
 * enforces the setting, and verifies what it installs.
 */

import { invoke } from '@tauri-apps/api/core';

import type { UpdateFound } from '@/domain/updates';

/** A newer release, or `null` when this is the newest. */
export async function checkForUpdate(): Promise<UpdateFound | null> {
  return invoke<UpdateFound | null>('update_check');
}

/** Download, verify and install the update the last check found; Tessera restarts. */
export async function installUpdate(): Promise<void> {
  await invoke('update_install');
}
