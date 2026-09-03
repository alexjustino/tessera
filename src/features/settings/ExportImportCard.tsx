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
import { Card } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { InfoBar } from '@/ui/InfoBar';

const KINDS: ReadonlyArray<{ kind: ExportKind; label: string; note: string }> = [
  { kind: 'json', label: 'JSON', note: 'everything, and the only form that imports' },
  { kind: 'markdown', label: 'Markdown', note: 'tasks and notes, readable anywhere' },
  { kind: 'ics', label: 'iCalendar', note: 'events and dated tasks, for Outlook and others' },
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
    <Card
      title="Export and import"
      description="Your data as files you own. Import replaces the workspace; it never merges."
    >
      <div className="flex flex-col gap-3">
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

        <ul className="flex flex-col gap-2">
          {KINDS.map(({ kind, label, note }) => (
            <li key={kind} className="flex items-center gap-3">
              <Button
                icon={<ArrowDownload20Regular />}
                onClick={() => void startExport(kind)}
                disabled={doExport.isPending}
                className="w-44 justify-start"
              >
                Export {label}
              </Button>
              <span className="text-caption text-fg-tertiary">{note}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-stroke-subtle pt-3">
          <Button
            icon={<ArrowUpload20Regular />}
            onClick={() => void startImport()}
            disabled={doImport.isPending}
            className="w-44 justify-start"
          >
            Import JSON…
          </Button>
          <span className="text-caption text-fg-tertiary">
            a Tessera export from this version; the file is inspected before anything changes
          </span>
        </div>
      </div>

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
    </Card>
  );
}
