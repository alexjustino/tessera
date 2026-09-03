import { useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

import { applyAccent, applyTheme } from '@/app/theme';
import { WORKSPACE_CHANGED, showCapture } from '@/data/capture';
import { pauseReminders, resumeReminders } from '@/data/reminders';
import { fetchAccentRamp } from '@/data/system';
import { AboutPage } from '@/features/about/AboutPage';
import { FoundationPage } from '@/features/foundation/FoundationPage';
import { CommandPalette } from '@/features/palette/CommandPalette';
import type { CommandId } from '@/features/palette/commands';
import { Sidebar, type Destination } from '@/features/shell/Sidebar';
import { TitleBar } from '@/features/shell/TitleBar';
import { TasksPage } from '@/features/tasks/TasksPage';

/**
 * A request to show one item: which, and a nonce so that asking for the same
 * item twice still re-opens it.
 */
interface Focus {
  itemId: string | null;
  nonce: number;
}

/**
 * The window shell: title bar, navigation rail, content layer, palette.
 *
 * The outer element is transparent so the Mica material Windows paints behind
 * the window shows through the chrome; the content region is the "layer" that
 * floats on it. That separation is the whole reason the application reads as
 * native rather than as a web page in a frame.
 */
export function App() {
  const [destination, setDestination] = useState<Destination>('tasks');
  const [focus, setFocus] = useState<Focus>({ itemId: null, nonce: 0 });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const client = useQueryClient();

  // A write from another window — the quick-capture line — lands in the same
  // file but not in this window's cache. The host says so; everything refetches.
  useEffect(() => {
    const unlisten = listen(WORKSPACE_CHANGED, () => {
      void client.invalidateQueries();
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [client]);

  // The accent ramp follows the desktop. Applied once at start, and again on a
  // theme change, because the shade that reads on white does not read on black.
  useEffect(() => {
    void fetchAccentRamp()
      .then(applyAccent)
      .catch(() => undefined);
  }, []);

  // The tray menu only asks; the window decides where to go. Keeping the
  // routing here means there is one map from names to screens.
  useEffect(() => {
    const unlisten = listen<string>('tray:navigate', (event) => {
      if (event.payload === 'today') setDestination('today');
      else setDestination('tasks');
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Ctrl+K opens the palette from anywhere in the window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = useCallback((next: Destination) => {
    setDestination(next);
    setFocus((current) => ({ itemId: null, nonce: current.nonce + 1 }));
  }, []);

  const openItem = useCallback((itemId: string) => {
    setDestination('tasks');
    setFocus((current) => ({ itemId, nonce: current.nonce + 1 }));
  }, []);

  const runCommand = useCallback(
    (id: CommandId) => {
      switch (id) {
        case 'go.today':
        case 'go.tasks':
        case 'go.board':
        case 'go.calendar':
        case 'go.diagnostics':
        case 'go.about':
          go(id.slice('go.'.length) as Destination);
          break;
        case 'new.task':
          // Tasks mounts with its capture line focused.
          go('tasks');
          break;
        case 'capture.open':
          void showCapture();
          break;
        case 'reminders.pause':
          void pauseReminders(60);
          break;
        case 'reminders.resume':
          void resumeReminders();
          break;
        case 'theme.system':
        case 'theme.light':
        case 'theme.dark':
          applyTheme(id.slice('theme.'.length) as 'system' | 'light' | 'dark');
          void fetchAccentRamp()
            .then(applyAccent)
            .catch(() => undefined);
          break;
      }
    },
    [go],
  );

  const pageKey = `${destination}:${focus.nonce}`;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={destination} onNavigate={go} onSearch={() => setPaletteOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-layer">
          {/* Today is the same page opened on a different saved view — it is
              a query over the same items, not a second screen. */}
          {destination === 'tasks' && <TasksPage key={pageKey} initialDetailId={focus.itemId} />}
          {destination === 'today' && <TasksPage key={pageKey} initialViewId="view.today" />}
          {destination === 'board' && <TasksPage key={pageKey} initialViewId="tasks.board" />}
          {destination === 'calendar' && <TasksPage key={pageKey} initialViewId="view.calendar" />}
          {destination === 'diagnostics' && <FoundationPage />}
          {destination === 'about' && <AboutPage />}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCommand={runCommand}
        onOpenItem={openItem}
        // An event has no drawer of its own yet; the calendar is where it lives.
        onOpenEvent={() => go('calendar')}
      />
    </div>
  );
}
