import {
  ArrowImport20Regular,
  ArrowSwap20Regular,
  CalendarClock20Regular,
  DarkTheme20Regular,
  History20Regular,
  Keyboard20Regular,
  LayoutRowTwo20Regular,
  Power20Regular,
  Settings20Regular,
} from '@fluentui/react-icons';
import { useCallback, useState, type ReactNode } from 'react';

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
import type { SettingsCard } from '@/features/guide/GettingStarted';
import { ChoiceGroup } from '@/ui/ChoiceGroup';
import { InfoBar } from '@/ui/InfoBar';
import { Kbd } from '@/ui/Kbd';
import { Page } from '@/ui/Page';
import { Select } from '@/ui/Select';
import { SettingGroup, SettingRow } from '@/ui/Setting';
import { Toggle } from '@/ui/Toggle';

import { BackupsCard } from './BackupsCard';
import { ExportImportCard } from './ExportImportCard';
import { ImportsCard } from './ImportsCard';
import { UpdatesGroup } from './UpdatesGroup';
import { DaysOffCard } from './DaysOffCard';
import { WorkHoursCard } from './WorkHoursCard';

type Section = 'general' | 'time' | 'backups' | 'files' | 'imports';

const SECTIONS: ReadonlyArray<{ id: Section; label: string; icon: ReactNode }> = [
  { id: 'general', label: 'General', icon: <Settings20Regular /> },
  { id: 'time', label: 'Working time', icon: <CalendarClock20Regular /> },
  { id: 'backups', label: 'Backups', icon: <History20Regular /> },
  { id: 'files', label: 'Export and import', icon: <ArrowSwap20Regular /> },
  { id: 'imports', label: 'Add from another product', icon: <ArrowImport20Regular /> },
];

/**
 * Settings: what a person can change, kept in the workspace file.
 *
 * Every control writes through the host and reads back what it stored — a
 * refused value never looks accepted. Appearance changes are applied at once
 * and saved behind, so the screen answers before the disk does.
 *
 * One section at a time. All of it on one page was the owner's verdict on 1.4:
 * polluted. A person comes here to change one thing.
 */
export function SettingsPage({ focusCard = null }: { focusCard?: SettingsCard | null }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const autostart = useAutostart();
  const setAutostart = useSetAutostart();
  const capture = useCaptureStatus();
  const [section, setSection] = useState<Section>(focusCard === null ? 'general' : 'time');

  const current: Settings = settings.data ?? DEFAULT_SETTINGS;

  // Arriving from the guide: bring the card it pointed at into view.
  const focused = useCallback((element: HTMLDivElement | null) => {
    element?.scrollIntoView({ block: 'start' });
  }, []);

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
    <Page>
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

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav aria-label="Settings sections" className="shrink-0 lg:sticky lg:top-6 lg:w-64">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map(({ id, label, icon }) => (
              <li key={id}>
                <button
                  type="button"
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => setSection(id)}
                  className={[
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body',
                    'transition-colors duration-100 ease-easy',
                    section === id
                      ? 'bg-card-active font-semibold text-fg'
                      : 'text-fg-secondary hover:bg-card-hover',
                  ].join(' ')}
                >
                  <span aria-hidden="true" className="flex shrink-0">
                    {icon}
                  </span>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 max-w-4xl flex-1 flex-col gap-6">
          {section === 'general' && (
            <>
              <SettingGroup title="Appearance">
                <SettingRow
                  icon={<DarkTheme20Regular />}
                  title="Theme"
                  description="System follows Windows. The accent colour is the one on your desktop."
                >
                  <ChoiceGroup
                    label="Theme"
                    hideLabel
                    options={THEMES}
                    value={current.theme}
                    onChange={(theme) => update({ theme })}
                    disabled={settings.isPending}
                  />
                </SettingRow>
                <SettingRow
                  icon={<LayoutRowTwo20Regular />}
                  title="Density"
                  description="How much fits on a screen."
                >
                  <ChoiceGroup
                    label="Density"
                    hideLabel
                    options={DENSITIES}
                    value={current.density}
                    onChange={(density) => update({ density })}
                    disabled={settings.isPending}
                  />
                </SettingRow>
              </SettingGroup>

              <SettingGroup title="Windows">
                <SettingRow
                  icon={<Keyboard20Regular />}
                  title="Quick capture"
                  description={
                    capture.data?.registered === true ? (
                      <>
                        <Kbd>{capture.data.shortcut}</Kbd> is live, from any program.
                      </>
                    ) : (
                      'Opens the capture line from any program.'
                    )
                  }
                >
                  <span className="w-48">
                    <Select
                      aria-label="Quick capture shortcut"
                      value={current.quickCaptureShortcut}
                      disabled={settings.isPending}
                      onChange={(event) =>
                        update({
                          quickCaptureShortcut: event.target
                            .value as Settings['quickCaptureShortcut'],
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
                </SettingRow>
                <SettingRow
                  icon={<Power20Regular />}
                  title="Start with Windows"
                  description="Minimised to the tray, so reminders arrive before you open anything."
                >
                  <Toggle
                    checked={autostart.data === true}
                    label="Start with Windows"
                    disabled={autostart.isPending || setAutostart.isPending}
                    onChange={(on) => setAutostart.mutate(on)}
                  />
                </SettingRow>
              </SettingGroup>

              {capture.data !== undefined && !capture.data.registered && (
                <InfoBar
                  severity="caution"
                  title={`${capture.data.shortcut} could not be registered`}
                >
                  {capture.data.problem ?? 'Another program owns this key combination.'} Try another
                  combination above.
                </InfoBar>
              )}

              <UpdatesGroup
                on={current.updateCheck}
                saving={settings.isPending || save.isPending}
                onChange={(updateCheck) => update({ updateCheck })}
              />
            </>
          )}

          {section === 'time' && (
            <>
              <div ref={focusCard === 'hours' ? focused : undefined}>
                <WorkHoursCard />
              </div>
              <div ref={focusCard === 'daysOff' ? focused : undefined}>
                <DaysOffCard />
              </div>
            </>
          )}

          {section === 'backups' && (
            <BackupsCard settings={current} onChange={update} busy={settings.isPending} />
          )}
          {section === 'files' && <ExportImportCard />}
          {section === 'imports' && <ImportsCard />}
        </div>
      </div>
    </Page>
  );
}
