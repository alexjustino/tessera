/**
 * The typed client for the quick-capture window and its shortcut.
 */

import { invoke } from '@tauri-apps/api/core';

export interface CaptureStatus {
  /** The key combination, as shown to the person, e.g. `Ctrl+Alt+Space`. */
  shortcut: string;
  registered: boolean;
  /** Why the shortcut is not live, in a sentence, when it is not. */
  problem: string | null;
}

/** The event the host sends the capture window each time it is shown. */
export const CAPTURE_SHOWN = 'capture:shown';

/**
 * The event the host sends every window after a write made from another one.
 * Each window has its own query cache; this is how the main window learns that
 * the capture window added a task.
 */
export const WORKSPACE_CHANGED = 'workspace:changed';

export async function captureStatus(): Promise<CaptureStatus> {
  return invoke<CaptureStatus>('capture_status');
}

export async function showCapture(): Promise<void> {
  await invoke<void>('capture_show');
}

export async function hideCapture(): Promise<void> {
  await invoke<void>('capture_hide');
}
