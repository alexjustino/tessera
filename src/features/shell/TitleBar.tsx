import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from 'react';

/**
 * The application's own title bar.
 *
 * The window is drawn without system decorations so the Mica material runs
 * behind the chrome and the command surface can live in the same strip, the way
 * modern Windows applications are built. The cost is that the three window
 * controls are ours to draw, including their Fluent hover behaviour — close
 * turns red, the others take the neutral hover.
 *
 * Known gap, tracked rather than hidden: Snap Layouts (hovering the maximise
 * button to choose a layout) needs native `WM_NCHITTEST` handling that a custom
 * title bar does not get for free. Maximise itself works; the hover flyout does
 * not appear yet.
 */

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      const value = await appWindow.isMaximized();
      if (active) setMaximized(value);
    };
    void sync();
    const unlisten = appWindow.onResized(() => void sync());
    return () => {
      active = false;
      void unlisten.then((off) => off());
    };
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between border-b border-stroke-subtle bg-layer-alt pl-3 select-none"
    >
      <span data-tauri-drag-region className="text-caption font-semibold text-fg-secondary">
        Tessera
      </span>

      <div className="flex">
        <WindowButton
          label="Minimise"
          onClick={() => void appWindow.minimize()}
          path="M 0,5 H 10"
        />
        <WindowButton
          label={maximized ? 'Restore' : 'Maximise'}
          onClick={() => void appWindow.toggleMaximize()}
          path={
            maximized
              ? 'M 2,0.5 H 9.5 V 8 M 0.5,2.5 H 7.5 V 9.5 H 0.5 Z'
              : 'M 0.5,0.5 H 9.5 V 9.5 H 0.5 Z'
          }
        />
        <WindowButton
          label="Close"
          onClick={() => void appWindow.close()}
          path="M 0,0 L 10,10 M 10,0 L 0,10"
          danger
        />
      </div>
    </header>
  );
}

function WindowButton({
  label,
  onClick,
  path,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  path: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        'grid h-8 w-12 place-items-center text-fg transition-colors duration-100 ease-easy',
        danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-card-hover',
      ].join(' ')}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </button>
  );
}
