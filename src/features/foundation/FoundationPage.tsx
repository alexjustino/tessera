import { Alert20Regular, Database20Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useState } from 'react';

import { applyAccent, applyDensity, applyTheme, type Density, type ThemeChoice } from '@/app/theme';
import { describeError } from '@/data/errors';
import {
  fetchAccentRamp,
  fetchSystemInfo,
  probeNotification,
  type AccentRamp,
  type SystemInfo,
  type ToastOutcome,
} from '@/data/system';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';

import { RemindersCard } from './RemindersCard';

/**
 * The foundation screen.
 *
 * It exists to make the foundation slice's claims checkable rather than
 * asserted: the host is reachable, the database migrated, the accent colour
 * really came from Windows, and the notification pipeline really reaches the
 * Action Center. When the product has real screens this page becomes
 * Diagnostics.
 */
export function FoundationPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [ramp, setRamp] = useState<AccentRamp | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [density, setDensity] = useState<Density>('comfortable');

  const [toast, setToast] = useState<ToastOutcome | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [systemInfo, accentRamp] = await Promise.all([fetchSystemInfo(), fetchAccentRamp()]);
        if (!active) return;
        setInfo(systemInfo);
        setRamp(accentRamp);
        applyAccent(accentRamp);
      } catch (error) {
        if (!active) return;
        setFailure(describeError(error));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const chooseTheme = useCallback(
    (choice: ThemeChoice) => {
      setTheme(choice);
      applyTheme(choice);
      // The accent ramp is theme-dependent: light surfaces take the darker
      // steps, dark surfaces the lighter ones. Re-apply, or the accent stops
      // meeting contrast on the new surface.
      if (ramp) applyAccent(ramp);
    },
    [ramp],
  );

  const chooseDensity = useCallback((choice: Density) => {
    setDensity(choice);
    applyDensity(choice);
  }, []);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      setToast(await probeNotification());
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setProbing(false);
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Foundation</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Everything the first slice claims, shown rather than asserted.
        </p>
      </header>

      {failure && (
        <InfoBar severity="danger" title="The host did not answer">
          {failure}
        </InfoBar>
      )}

      <Card title="Workspace" description="Read from the running binary, never a typed constant.">
        {info ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
            <Row label="Version" value={info.version} />
            <Row
              label="Schema"
              value={
                info.schemaVersion === info.expectedSchemaVersion
                  ? `${info.schemaVersion} (up to date)`
                  : `${info.schemaVersion}, expected ${info.expectedSchemaVersion}`
              }
            />
            <Row label="Platform" value={info.platform} />
            <Row label="Database" value={info.databasePath} mono />
            <Row label="Size" value={`${info.databaseBytes.toLocaleString()} bytes`} />
          </dl>
        ) : (
          <div className="h-24 animate-pulse rounded-md bg-card-hover" />
        )}
      </Card>

      <Card
        title="Appearance"
        description="Mica is painted by Windows behind this window. The accent colour is the one you chose for your desktop."
      >
        <div className="flex flex-col gap-4">
          <Choice
            label="Theme"
            options={['system', 'light', 'dark'] as const}
            value={theme}
            onChange={chooseTheme}
          />
          <Choice
            label="Density"
            options={['comfortable', 'compact'] as const}
            value={density}
            onChange={chooseDensity}
          />

          <div>
            <p className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">
              Accent ramp
            </p>
            <div className="flex overflow-hidden rounded-md border border-stroke-subtle">
              {ramp
                ? [
                    ramp.dark3,
                    ramp.dark2,
                    ramp.dark1,
                    ramp.accent,
                    ramp.light1,
                    ramp.light2,
                    ramp.light3,
                  ].map((hex) => (
                    <div
                      key={hex}
                      className="h-10 flex-1"
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))
                : null}
            </div>
            {ramp && !ramp.fromSystem && (
              <p className="mt-2 text-caption text-fg-tertiary">
                This is the built-in default, not your Windows setting — the system could not be
                asked.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Notification probe"
        description="The highest-severity unknown in the plan. A toast is addressed to a registered AppUserModelID, and a development build has none of its own."
        actions={
          <Button
            appearance="accent"
            icon={<Alert20Regular />}
            onClick={runProbe}
            disabled={probing}
          >
            {probing ? 'Sending…' : 'Send a test toast'}
          </Button>
        }
      >
        {toast ? (
          <InfoBar
            severity={!toast.delivered ? 'danger' : toast.ownIdentity ? 'success' : 'caution'}
            title={
              !toast.delivered
                ? 'Windows refused the notification'
                : toast.ownIdentity
                  ? 'Delivered under this application’s own identity'
                  : 'Delivered under a borrowed identity'
            }
          >
            <p>{toast.note}</p>
            {toast.appIdUsed && (
              <p className="mt-1 font-mono text-caption text-fg-tertiary">{toast.appIdUsed}</p>
            )}
          </InfoBar>
        ) : (
          <p className="flex items-center gap-2 text-body text-fg-secondary">
            <Database20Regular aria-hidden="true" className="text-fg-tertiary" />
            Not run yet. The result that counts comes from an installed build, not from{' '}
            <code className="font-mono text-caption">tauri dev</code>.
          </p>
        )}
      </Card>

      <RemindersCard />
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-fg-tertiary">{label}</dt>
      <dd
        data-selectable
        className={`min-w-0 break-all text-fg ${mono ? 'font-mono text-caption' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-caption font-semibold text-fg-tertiary uppercase">
        {label}
      </span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {options.map((option) => (
          <Button
            key={option}
            role="radio"
            aria-checked={option === value}
            appearance={option === value ? 'accent' : 'standard'}
            onClick={() => onChange(option)}
            className="capitalize"
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}
