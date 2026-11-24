import {
  ArrowCounterclockwise20Regular,
  FolderOpen20Regular,
  Save20Regular,
} from '@fluentui/react-icons';
import { useState } from 'react';

import { chooseBackupPath, revealBackups, type BackupInfo } from '@/data/backups';
import { describeError } from '@/data/errors';
import { useBackupNow, useBackupsStatus, useRestoreBackup } from '@/data/hooks';
import { describeAge, formatBytes, type Settings } from '@/domain/settings';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';
import { Select } from '@/ui/Select';
import { SettingBody, SettingGroup, SettingRow } from '@/ui/Setting';
import { Toggle } from '@/ui/Toggle';

const KEEP_OPTIONS = [3, 7, 14, 30] as const;

/**
 * Backups: taken daily and on request, kept in rotation beside the workspace,
 * and put back from here.
 *
 * Restoring replaces the workspace, so it asks first and says what will be
 * replaced — and it takes a backup of the current state before it does, so a
 * restore can itself be undone from the same list.
 */
export function BackupsCard({
  settings,
  onChange,
  busy,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  busy: boolean;
}) {
  const status = useBackupsStatus();
  const backupNow = useBackupNow();
  const restore = useRestoreBackup();
  const [candidate, setCandidate] = useState<{ path: string; label: string } | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const failure = status.error ?? backupNow.error ?? restore.error;
  const now = new Date().toISOString();

  const askToRestore = (backup: BackupInfo) =>
    setCandidate({
      path: backup.path,
      label: `the backup from ${describeAge(backup.takenAt, now)}`,
    });

  const askToRestoreFile = async () => {
    const path = await chooseBackupPath();
    if (path) setCandidate({ path, label: path.split(/[\\/]/).pop() ?? path });
  };

  const confirmRestore = () => {
    if (!candidate) return;
    restore.mutate(candidate.path, {
      onSuccess: (counts) => {
        setCandidate(null);
        setRestored(
          `Restored: ${counts.items} tasks, ${counts.events} events, ${counts.blocks} blocks.`,
        );
      },
    });
  };

  return (
    <>
      {failure && (
        <InfoBar severity="danger" title="The backup could not be completed">
          {describeError(failure)}
        </InfoBar>
      )}
      {restored && (
        <InfoBar severity="success" title="The workspace was restored">
          {restored} The state before the restore was backed up first, and is in the list.
        </InfoBar>
      )}

      <SettingGroup
        title="Automatic backups"
        description="A copy of the workspace file, kept in rotation beside it."
        actions={
          <Button
            appearance="accent"
            icon={<Save20Regular />}
            onClick={() => backupNow.mutate()}
            disabled={backupNow.isPending}
          >
            {backupNow.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
        }
      >
        <SettingRow title="Back up every day" description="On the first start of each day.">
          <Toggle
            checked={settings.backupsEnabled}
            label="Back up daily"
            disabled={busy}
            onChange={(on) => onChange({ backupsEnabled: on })}
          />
        </SettingRow>
        <SettingRow title="How many to keep" description="The oldest goes when a new one is taken.">
          <span className="w-40">
            <Select
              aria-label="How many backups to keep"
              value={String(settings.backupsKeep)}
              disabled={busy}
              onChange={(event) => onChange({ backupsKeep: Number(event.target.value) })}
            >
              {KEEP_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} backups
                </option>
              ))}
              {!KEEP_OPTIONS.includes(settings.backupsKeep as (typeof KEEP_OPTIONS)[number]) && (
                <option value={settings.backupsKeep}>{settings.backupsKeep} backups</option>
              )}
            </Select>
          </span>
        </SettingRow>
      </SettingGroup>

      <SettingGroup
        title="In the folder"
        description={
          status.data
            ? `The workspace now holds ${status.data.counts.items} tasks, ${status.data.counts.events} events and ${status.data.counts.blocks} blocks.`
            : undefined
        }
        actions={
          <span className="flex gap-1">
            <Button
              appearance="subtle"
              icon={<FolderOpen20Regular />}
              onClick={() => void revealBackups()}
            >
              Open folder
            </Button>
            <Button onClick={() => void askToRestoreFile()} disabled={restore.isPending}>
              Restore from a file…
            </Button>
          </span>
        }
      >
        <SettingBody>
          {status.data === undefined ? (
            <div className="h-10 animate-pulse rounded-md bg-card-hover" aria-hidden="true" />
          ) : status.data.backups.length === 0 ? (
            <p className="text-body text-fg-tertiary">
              No backups yet. One is taken on the next start, or now with the button above.
            </p>
          ) : (
            <ul aria-label="Backups" className="flex flex-col gap-1">
              {status.data.backups.map((backup) => (
                <li
                  key={backup.path}
                  className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-card-hover"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-caption text-fg">
                    {backup.fileName}
                  </span>
                  <span className="shrink-0 text-caption text-fg-tertiary">
                    {describeAge(backup.takenAt, now)} · {formatBytes(backup.bytes)}
                  </span>
                  <Button
                    appearance="subtle"
                    icon={<ArrowCounterclockwise20Regular />}
                    onClick={() => askToRestore(backup)}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SettingBody>
      </SettingGroup>

      <ConfirmDialog
        open={candidate !== null}
        title="Replace the workspace with this backup?"
        confirmLabel="Restore this backup"
        danger
        pending={restore.isPending}
        onConfirm={confirmRestore}
        onCancel={() => setCandidate(null)}
      >
        Everything in the workspace now will be replaced by {candidate?.label}. A backup of the
        current state is taken first, so this can be undone from the same list.
      </ConfirmDialog>
    </>
  );
}
