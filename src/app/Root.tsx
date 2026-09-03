import { getCurrentWindow } from '@tauri-apps/api/window';

import { App } from '@/app/App';
import { CaptureWindow } from '@/features/capture/CaptureWindow';

/**
 * One bundle, two windows. The host labels the quick-capture window
 * `capture`; everything else — the main window, or a browser preview with no
 * host at all — renders the workspace.
 */
function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return 'main';
  }
}

export function Root() {
  return windowLabel() === 'capture' ? <CaptureWindow /> : <App />;
}
