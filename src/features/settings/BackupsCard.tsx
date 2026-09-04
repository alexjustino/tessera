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
import { Card } from '@/ui/Card';
import { Checkbox } from '@/ui/Checkbox';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';
import { Select } from '@/ui/Select';

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
    <Card
      title="Backups"
      description="A copy of the workspace file, taken on the first start of each day and kept in rotation."
      actions={
        <span className="flex gap-1">
          <Button
            appearance="subtle"
            icon={<FolderOpen20Regular />}
            onClick={() => void revealBackups()}
          >
            Open folder
          </Button>
          <Button
            appearance="accent"
            icon={<Save20Regular />}
            onClick={() => backupNow.mutate()}
            disabled={backupNow.isPending}
          >
            {backupNow.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
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

        <label className="flex items-center gap-2 text-body text-fg">
          <Checkbox
            checked={settings.backupsEnabled}
            label="Back up daily"
            disabled={busy}
            onChange={(on) => onChange({ backupsEnabled: on })}
          />
          <span>Back up on the first start of each day</span>
        </label>

        <label className="flex items-center gap-3 text-body text-fg">
          <span className="w-28 shrink-0 text-caption font-semibold text-fg-tertiary uppercase">
            Keep
          </span>
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
        </label>

        <div>
          <p className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">
            In the folder
          </p>
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
          <p className="mt-2 text-caption text-fg-tertiary">
            {status.data
              ? `Now: ${status.data.counts.items} tasks, ${status.data.counts.events} events, ${status.data.counts.blocks} blocks.`
              : ''}
          </p>
        </div>

        <div>
          <Button onClick={() => void askToRestoreFile()} disabled={restore.isPending}>
            Restore from a file…
          </Button>
        </div>
      </div>

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
    </Card>
  );
}
