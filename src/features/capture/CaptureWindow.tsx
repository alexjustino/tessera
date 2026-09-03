import { Add20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import mark from '@/assets/mark.svg';
import { applyAccent } from '@/app/theme';
import { CAPTURE_SHOWN, hideCapture } from '@/data/capture';
import { describeError } from '@/data/errors';
import { useCaptureItem, useCaptureStatus, useItems, useProperties } from '@/data/hooks';
import { fetchAccentRamp } from '@/data/system';
import type { Capture } from '@/domain/capture';
import { positionForNewItem } from '@/domain/item';
import { formatDue, systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Kbd } from '@/ui/Kbd';

import { CaptureLine } from './CaptureLine';

/** The collection quick capture writes into. */
const COLLECTION = 'tasks';

/** How long the confirmation stays before the window gets out of the way. */
const LINGER_MS = 1_400;

/**
 * The quick-capture window: one line, over whatever else is on screen.
 *
 * It is the same bundle as the main window, rendered differently because the
 * host gave this window a different label. It is shown by a global shortcut or
 * the tray, takes a line, confirms what it wrote, and hides — Escape or losing
 * focus hides it too. It never becomes a second copy of the workspace.
 */
export function CaptureWindow() {
  const [value, setValue] = useState('');
  const [added, setAdded] = useState<{ title: string; dueAt: string | null } | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);

  const items = useItems(COLLECTION, true);
  const properties = useProperties(COLLECTION);
  const status = useCaptureStatus();
  const capture = useCaptureItem();

  const priorityPropertyId = useMemo(
    () => (properties.data ?? []).find((p) => p.type === 'priority')?.id ?? null,
    [properties.data],
  );

  // The accent ramp is applied by Diagnostics in the main window; this window
  // has no Diagnostics, so it asks once itself.
  useEffect(() => {
    void fetchAccentRamp()
      .then(applyAccent)
      .catch(() => undefined);
  }, []);

  const reset = useCallback(() => {
    setValue('');
    setAdded(null);
    capture.reset();
    if (linger.current) clearTimeout(linger.current);
  }, [capture]);

  // Each time the host shows the window, start clean and focused.
  useEffect(() => {
    const unlisten = listen(CAPTURE_SHOWN, () => {
      reset();
      const input = document.querySelector<HTMLInputElement>('input');
      input?.focus();
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [reset]);

  // Escape hides; so does losing focus to another window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void hideCapture();
    };
    document.addEventListener('keydown', onKeyDown);

    let unlisten: (() => void) | null = null;
    try {
      void getCurrentWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (!focused) void hideCapture();
        })
        .then((off) => {
          unlisten = off;
        });
    } catch {
      // Not inside the host (a browser preview): nothing to listen to.
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlisten?.();
    };
  }, []);

  const submit = (parsed: Capture) => {
    capture.mutate(
      {
        collectionId: COLLECTION,
        position: positionForNewItem(items.data ?? []),
        capture: parsed,
        priorityPropertyId,
      },
      {
        onSuccess: (item) => {
          setValue('');
          setAdded({ title: item.title, dueAt: item.dueAt });
          linger.current = setTimeout(() => void hideCapture(), LINGER_MS);
        },
      },
    );
  };

  return (
    <div className="h-full p-2">
      <div className="flex h-full flex-col gap-3 rounded-xl border border-stroke bg-flyout p-4 shadow-dialog backdrop-blur-xl">
        <header className="flex items-center gap-2">
          <img src={mark} alt="" width={16} height={16} draggable={false} />
          <h1 className="text-caption font-semibold text-fg-secondary">Quick capture</h1>
          <span className="ml-1 text-caption text-fg-tertiary">
            {status.data?.registered ? <Kbd>{status.data.shortcut}</Kbd> : 'from the tray'}
          </span>
          <span className="ml-auto">
            <IconButton
              label="Close"
              icon={<Dismiss20Regular />}
              onClick={() => void hideCapture()}
            />
          </span>
        </header>

        <CaptureLine
          value={value}
          onChange={(next) => {
            setValue(next);
            if (added) setAdded(null);
          }}
          onSubmit={submit}
          label="Quick capture"
          autoFocus
          disabled={capture.isPending}
          hint={false}
          placeholder='What needs doing? "Pay rent on friday remind me"'
        >
          {({ ready }) => (
            <Button
              type="submit"
              appearance="accent"
              icon={<Add20Regular />}
              disabled={!ready || capture.isPending}
            >
              Add
            </Button>
          )}
        </CaptureLine>

        {capture.error && (
          <InfoBar severity="danger" title="That task was not saved">
            {describeError(capture.error)}
          </InfoBar>
        )}

        {added && (
          <p role="status" className="text-caption text-fg-secondary">
            Added <span className="font-semibold text-fg">{added.title}</span> to Tasks
            {added.dueAt
              ? ` — due ${formatDue(added.dueAt, new Date().toISOString(), systemZone())}`
              : ''}
            .
          </p>
        )}
      </div>
    </div>
  );
}
