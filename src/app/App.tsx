import { useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { startTransition, Suspense, useCallback, useEffect, useState } from 'react';

import {
  AboutPage,
  FocusMode,
  FoundationPage,
  GoalsPage,
  MosaicPage,
  NotesPage,
  preloadPages,
  ReportsPage,
  ReviewPage,
  SettingsPage,
} from '@/app/lazyPages';
import { closeOpening } from '@/app/opening';
import { applyAccent, applyDensity, applyTheme } from '@/app/theme';
import { WORKSPACE_CHANGED, showCapture } from '@/data/capture';
import { pauseReminders, resumeReminders } from '@/data/reminders';
import { useItems, useSaveSettings, useSettings } from '@/data/hooks';
import { fetchAccentRamp } from '@/data/system';
import { settingsAsk } from '@/domain/gettingStarted';
import { INBOX } from '@/domain/lists';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import type { SettingsCard } from '@/features/guide/GettingStarted';
import { CommandPalette } from '@/features/palette/CommandPalette';
import type { CommandId } from '@/features/palette/commands';
import { Sidebar, type Destination } from '@/features/shell/Sidebar';
import { TitleBar } from '@/features/shell/TitleBar';
import { TasksPage } from '@/features/tasks/TasksPage';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Skeleton } from '@/ui/Skeleton';

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
  /** The list Tasks and the Board show (ADR-053). */
  const [listId, setListId] = useState<string>(INBOX);
  const everything = useItems(null, true);
  const [settingsCard, setSettingsCard] = useState<SettingsCard | null>(null);
  const [focus, setFocus] = useState<Focus>({ itemId: null, nonce: 0 });
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The page the palette asked for, until Notes has opened it. */
  const [openPageId, setOpenPageId] = useState<string | null>(null);
  /** Focus mode: `undefined` off; null lets the queue choose; an id points at a task. */
  const [focused, setFocused] = useState<string | null | undefined>(undefined);
  const client = useQueryClient();
  const settings = useSettings();
  const settingsQuestion = settings.data === undefined ? null : settingsAsk(settings.data);
  const saveSettings = useSaveSettings();

  // The stored theme and density are applied as soon as they are read, and
  // the accent ramp after them, because the ramp depends on the theme.
  useEffect(() => {
    if (!settings.data) return;
    applyTheme(settings.data.theme);
    applyDensity(settings.data.density);
    void fetchAccentRamp()
      .then(applyAccent)
      .catch(() => undefined);
  }, [settings.data]);

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

  // The workspace has been read, or could not be: either way there is a window to show.
  useEffect(() => {
    if (settings.isSuccess || settings.isError) {
      closeOpening();
      preloadPages();
    }
  }, [settings.isSuccess, settings.isError]);

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
    // A transition, so a screen not yet read keeps the last one up for that moment
    // rather than flashing an empty shape.
    startTransition(() => {
      setSettingsCard(null);
      // Tasks in the rail is the inbox; a list of one's own is opened from under it.
      if (next === 'tasks') setListId(INBOX);
      setDestination(next);
      setFocus((current) => ({ itemId: null, nonce: current.nonce + 1 }));
    });
  }, []);

  const openSettings = useCallback((card: SettingsCard) => {
    setSettingsCard(card);
    setDestination('settings');
    setFocus((current) => ({ itemId: null, nonce: current.nonce + 1 }));
  }, []);

  const openList = useCallback((id: string) => {
    startTransition(() => {
      setSettingsCard(null);
      setListId(id);
      setDestination('tasks');
      setFocus((current) => ({ itemId: null, nonce: current.nonce + 1 }));
    });
  }, []);

  // A task opens in its own list, wherever it was found.
  const openItem = useCallback(
    (itemId: string) => {
      const found = everything.data?.find((item) => item.id === itemId);
      setListId(found?.collectionId ?? INBOX);
      setDestination('tasks');
      setFocus((current) => ({ itemId, nonce: current.nonce + 1 }));
    },
    [everything.data],
  );

  const openPage = useCallback((pageId: string) => {
    setOpenPageId(pageId);
    setDestination('notes');
    setFocus((current) => ({ itemId: null, nonce: current.nonce + 1 }));
  }, []);

  const runCommand = useCallback(
    (id: CommandId) => {
      switch (id) {
        case 'go.today':
        case 'go.tasks':
        case 'go.board':
        case 'go.calendar':
        case 'go.settings':
        case 'go.diagnostics':
        case 'go.about':
          go(id.slice('go.'.length) as Destination);
          break;
        case 'focus.start':
          setFocused(null);
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
        case 'theme.dark': {
          // Applied now, saved behind: the palette is a shortcut to Settings.
          const theme = id.slice('theme.'.length) as 'system' | 'light' | 'dark';
          applyTheme(theme);
          void fetchAccentRamp()
            .then(applyAccent)
            .catch(() => undefined);
          saveSettings.mutate({ ...(settings.data ?? DEFAULT_SETTINGS), theme });
          break;
        }
      }
    },
    [go, saveSettings, settings.data],
  );

  const pageKey = `${destination}:${listId}:${focus.nonce}`;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg">
      <TitleBar />
      {focused !== undefined ? (
        <Suspense fallback={<Skeleton />}>
          <FocusMode
            requestedId={focused}
            onLeave={() => setFocused(undefined)}
            onSwitch={(id) => setFocused(id)}
          />
        </Suspense>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar
            active={destination}
            onNavigate={go}
            onSearch={() => setPaletteOpen(true)}
            asks={settingsQuestion === null ? {} : { settings: settingsQuestion }}
            activeListId={listId}
            onOpenList={openList}
          />
          <main className="min-w-0 flex-1 overflow-y-auto bg-layer">
            <ErrorBoundary key={pageKey}>
              <Suspense fallback={<Skeleton />}>
                {/* Today is the same page opened on a different saved view — it is
              a query over the same items, not a second screen. */}
                {destination === 'tasks' && (
                  <TasksPage
                    key={pageKey}
                    collectionId={listId}
                    onListDeleted={() => go('tasks')}
                    initialDetailId={focus.itemId}
                    onFocus={setFocused}
                    onOpenSettings={openSettings}
                    onOpenPage={openPage}
                  />
                )}
                {destination === 'today' && (
                  <TasksPage
                    key={pageKey}
                    place="today"
                    onFocus={setFocused}
                    onShowAll={() => go('tasks')}
                    onOpenSettings={openSettings}
                    onOpenPage={openPage}
                  />
                )}
                {destination === 'board' && (
                  <TasksPage
                    key={pageKey}
                    place="board"
                    collectionId={listId}
                    onFocus={setFocused}
                    onOpenPage={openPage}
                  />
                )}
                {destination === 'calendar' && (
                  <TasksPage
                    key={pageKey}
                    place="calendar"
                    onFocus={setFocused}
                    onOpenPage={openPage}
                  />
                )}
                {destination === 'mosaic' && <MosaicPage key={pageKey} onOpenPage={openPage} />}
                {destination === 'notes' && (
                  <NotesPage key={pageKey} initialPageId={openPageId} onOpenItem={openItem} />
                )}
                {destination === 'goals' && <GoalsPage key={pageKey} />}
                {destination === 'review' && <ReviewPage key={pageKey} onOpenItem={openItem} />}
                {destination === 'reports' && <ReportsPage />}
                {destination === 'settings' && (
                  <SettingsPage key={pageKey} focusCard={settingsCard} />
                )}
                {destination === 'diagnostics' && <FoundationPage onBack={() => go('about')} />}
                {destination === 'about' && (
                  <AboutPage onOpenDiagnostics={() => go('diagnostics')} />
                )}
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCommand={runCommand}
        onOpenItem={openItem}
        // An event has no drawer of its own yet; the calendar is where it lives.
        onOpenEvent={() => go('calendar')}
        onOpenPage={openPage}
      />
    </div>
  );
}
