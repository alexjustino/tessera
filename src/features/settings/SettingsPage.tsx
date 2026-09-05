import { Keyboard20Regular } from '@fluentui/react-icons';
import { useCallback } from 'react';

import { applyDensity, applyTheme } from '@/app/theme';
import { describeError } from '@/data/errors';
import {
  useAutostart,
  useCaptureStatus,
  useSaveSettings,
  useSetAutostart,
  useSettings,
} from '@/data/hooks';
import { DENSITIES, DEFAULT_SETTINGS, SHORTCUTS, THEMES, type Settings } from '@/domain/settings';
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';
import { Kbd } from '@/ui/Kbd';
import { Select } from '@/ui/Select';

import { BackupsCard } from './BackupsCard';
import { ExportImportCard } from './ExportImportCard';
import { ImportsCard } from './ImportsCard';

/**
 * Settings: what a person can change, kept in the workspace file.
 *
 * Every control writes through the host and reads back what it stored — a
 * refused value never looks accepted. Appearance changes are applied at once
 * and saved behind, so the screen answers before the disk does.
 */
export function SettingsPage() {
  const settings = useSettings();
  const save = useSaveSettings();
  const autostart = useAutostart();
  const setAutostart = useSetAutostart();
  const capture = useCaptureStatus();

  const current: Settings = settings.data ?? DEFAULT_SETTINGS;

  const update = useCallback(
    (patch: Partial<Settings>) => {
      const next = { ...current, ...patch };
      if (patch.theme) applyTheme(patch.theme);
      if (patch.density) applyDensity(patch.density);
      save.mutate(next);
    },
    [current, save],
  );

  const failure = settings.error ?? save.error ?? autostart.error ?? setAutostart.error;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header>
        <h1 className="text-title font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Kept in your workspace file, so a backup carries them too.
        </p>
      </header>

      {failure && (
        <InfoBar severity="danger" title="That setting was not saved">
          {describeError(failure)}
        </InfoBar>
      )}

      <Card
        title="Appearance"
        description="Mica is painted by Windows behind the window; the accent colour is the one you chose for your desktop."
      >
        <div className="flex flex-col gap-4">
          <ChoiceGroup
            label="Theme"
            options={THEMES}
            value={current.theme}
            onChange={(theme) => update({ theme })}
            disabled={settings.isPending}
          />
          <ChoiceGroup
            label="Density"
            options={DENSITIES}
            value={current.density}
            onChange={(density) => update({ density })}
            disabled={settings.isPending}
          />
        </div>
      </Card>

      <Card
        title="Quick capture"
        description="The key combination that opens the capture line from any program."
      >
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-caption font-semibold text-fg-tertiary uppercase">
              Shortcut
            </span>
            <span className="w-56">
              <Select
                aria-label="Quick capture shortcut"
                value={current.quickCaptureShortcut}
                disabled={settings.isPending}
                onChange={(event) =>
                  update({
                    quickCaptureShortcut: event.target.value as Settings['quickCaptureShortcut'],
                  })
                }
              >
                {SHORTCUTS.map((shortcut) => (
                  <option key={shortcut} value={shortcut}>
                    {shortcut}
                  </option>
                ))}
              </Select>
            </span>
          </label>
          {capture.data &&
            (capture.data.registered ? (
              <p className="flex items-center gap-2 text-body text-fg-secondary">
                <Keyboard20Regular aria-hidden="true" className="text-fg-tertiary" />
                <Kbd>{capture.data.shortcut}</Kbd> is live.
              </p>
            ) : (
              <InfoBar
                severity="caution"
                title={`${capture.data.shortcut} could not be registered`}
              >
                {capture.data.problem ?? 'Another program owns this key combination.'} Try another
                combination above.
              </InfoBar>
            ))}
        </div>
      </Card>

      <Card title="Start-up" description="How Tessera behaves when Windows starts.">
        <label className="flex items-center gap-2 text-body text-fg">
          <Checkbox
            checked={autostart.data === true}
            label="Start with Windows"
            disabled={autostart.isPending || setAutostart.isPending}
            onChange={(on) => setAutostart.mutate(on)}
          />
          <span>
            Start with Windows, minimised to the tray
            <span className="block text-caption text-fg-tertiary">
              Off unless you turn it on. This is how reminders arrive before you have opened
              anything.
            </span>
          </span>
        </label>
      </Card>

      <BackupsCard settings={current} onChange={update} busy={settings.isPending} />
      <ExportImportCard />

      <ImportsCard />
    </div>
  );
}
