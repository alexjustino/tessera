import { ArrowDownload20Regular, ArrowUpload20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import {
  chooseExportPath,
  chooseImportPath,
  inspectImport,
  type Counts,
  type ExportKind,
} from '@/data/backups';
import { describeError } from '@/data/errors';
import { useExport, useImportJson } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';
import { SettingGroup, SettingRow } from '@/ui/Setting';

const KINDS: ReadonlyArray<{ kind: ExportKind; label: string; note: string }> = [
  { kind: 'json', label: 'JSON', note: 'Everything, and the only form that imports.' },
  { kind: 'markdown', label: 'Markdown', note: 'Tasks and notes, readable anywhere.' },
  { kind: 'ics', label: 'iCalendar', note: 'Events and dated tasks, for Outlook and others.' },
];

/**
 * Export and import: the workspace as files a person owns outright.
 *
 * Import replaces the workspace and never merges, so it inspects the file
 * first, says exactly what is in it, and asks. A backup of the current state is
 * taken by the host before it replaces anything.
 */
export function ExportImportCard() {
  const doExport = useExport();
  const doImport = useImportJson();
  const [exported, setExported] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ path: string; counts: Counts } | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  const startExport = async (kind: ExportKind) => {
    const path = await chooseExportPath(kind);
    if (!path) return;
    doExport.mutate({ kind, path }, { onSuccess: () => setExported(`Written to ${path}`) });
  };

  const startImport = async () => {
    setInspectError(null);
    const path = await chooseImportPath();
    if (!path) return;
    try {
      setCandidate({ path, counts: await inspectImport(path) });
    } catch (error) {
      setInspectError(describeError(error));
    }
  };

  const confirmImport = () => {
    if (!candidate) return;
    doImport.mutate(candidate.path, {
      onSuccess: (counts) => {
        setCandidate(null);
        setImported(
          `Imported: ${counts.items} tasks, ${counts.events} events, ${counts.blocks} blocks.`,
        );
      },
    });
  };

  const failure = doExport.error ?? doImport.error;

  return (
    <>
      {failure && (
        <InfoBar severity="danger" title="That did not complete">
          {describeError(failure)}
        </InfoBar>
      )}
      {inspectError && (
        <InfoBar severity="caution" title="That file cannot be imported">
          {inspectError}
        </InfoBar>
      )}
      {exported && (
        <InfoBar severity="success" title="Exported">
          <span data-selectable className="font-mono text-caption">
            {exported}
          </span>
        </InfoBar>
      )}
      {imported && (
        <InfoBar severity="success" title="The workspace was replaced">
          {imported} The state before the import was backed up first.
        </InfoBar>
      )}

      <SettingGroup title="Export" description="Your data as files you own.">
        {KINDS.map(({ kind, label, note }) => (
          <SettingRow key={kind} title={label} description={note}>
            <Button
              icon={<ArrowDownload20Regular />}
              onClick={() => void startExport(kind)}
              disabled={doExport.isPending}
            >
              Export {label}
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>

      <SettingGroup
        title="Replace this workspace"
        description="To add to it instead, use Add from another product."
      >
        <SettingRow
          title="From a Tessera export"
          description="The file is inspected and you are asked before anything changes."
        >
          <Button
            icon={<ArrowUpload20Regular />}
            onClick={() => void startImport()}
            disabled={doImport.isPending}
          >
            Import JSON…
          </Button>
        </SettingRow>
      </SettingGroup>

      <ConfirmDialog
        open={candidate !== null}
        title="Replace the workspace with this export?"
        confirmLabel="Import and replace"
        danger
        pending={doImport.isPending}
        onConfirm={confirmImport}
        onCancel={() => setCandidate(null)}
      >
        The file holds {candidate?.counts.items} tasks, {candidate?.counts.events} events and{' '}
        {candidate?.counts.blocks} blocks. Everything in the workspace now will be replaced by them.
        A backup of the current state is taken first.
      </ConfirmDialog>
    </>
  );
}
