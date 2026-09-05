import { ArrowImport20Regular, ArrowUndo20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { chooseImportPath } from '@/data/backups';
import { describeError } from '@/data/errors';
import { useImports, useUndoImport } from '@/data/hooks';
import { chooseCsvPath, nameFromPath, readExportFile, readTextFile } from '@/data/importing';
import { fromTesseraExport, type ImportPlan } from '@/domain/importing';
import { fromOutlookTasks, looksLikeOutlookTasks } from '@/domain/importers/outlookTasks';
import { fromTodoist, looksLikeTodoist } from '@/domain/importers/todoist';
import { systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { announce } from '@/ui/announce';

import { ImportDialog } from './ImportDialog';

/**
 * The import door, as a card: bring rows in from another workspace without
 * replacing this one, and see — and undo — what each import did.
 *
 * Beside it, the older card still replaces the workspace from an export; the
 * two are different acts and stay two buttons. This one adds.
 */
export function ImportsCard() {
  const imports = useImports();
  const undo = useUndoImport();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [complaint, setComplaint] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const begin = async (
    pick: () => Promise<string | null>,
    read: (path: string) => Promise<ImportPlan | null>,
    complaint: string,
  ) => {
    setComplaint(null);
    setDone(null);
    const path = await pick();
    if (!path) return;
    try {
      const plan = await read(path);
      if (plan === null) {
        setComplaint(complaint);
        return;
      }
      setPlan(plan);
    } catch (error) {
      setComplaint(describeError(error));
    }
  };

  const startTessera = () =>
    begin(
      chooseImportPath,
      async (path) => fromTesseraExport(await readExportFile(path)),
      'That file is not a Tessera export.',
    );

  const startTodoist = () =>
    begin(
      () => chooseCsvPath('Import a Todoist project (CSV)'),
      async (path) => {
        const text = await readTextFile(path);
        return looksLikeTodoist(text) ? fromTodoist(text, nameFromPath(path), systemZone()) : null;
      },
      'That file is not a Todoist project export. In Todoist, open the project menu and choose Export as a template (CSV).',
    );

  const startToDo = () =>
    begin(
      () => chooseCsvPath('Import a Microsoft To Do list (Outlook CSV)'),
      async (path) => {
        const text = await readTextFile(path);
        return looksLikeOutlookTasks(text)
          ? fromOutlookTasks(text, nameFromPath(path), systemZone(), new Date().toISOString())
          : null;
      },
      'That file is not an Outlook task export. In Outlook for Windows: File → Open & Export → Import/Export → Export to a file → Comma Separated Values, and pick the Tasks folder for the list.',
    );

  const batches = imports.data ?? [];

  return (
    <Card
      title="Add from another product"
      description="Bring tasks in from a file without replacing anything here. Every import is previewed first and can be undone as one thing."
    >
      <div className="flex flex-col gap-3">
        {complaint !== null && (
          <InfoBar severity="caution" title="That file cannot be imported">
            {complaint}
          </InfoBar>
        )}
        {undo.error !== null && (
          <InfoBar severity="danger" title="That import could not be undone">
            {describeError(undo.error)}
          </InfoBar>
        )}
        {done !== null && (
          <InfoBar severity="success" title="Imported">
            {done}
          </InfoBar>
        )}

        <ul className="flex flex-col gap-2">
          <li className="flex items-center gap-3">
            <Button
              icon={<ArrowImport20Regular />}
              onClick={() => void startTessera()}
              className="w-56 justify-start"
            >
              Tessera export…
            </Button>
            <span className="text-caption text-fg-tertiary">another workspace's JSON export</span>
          </li>
          <li className="flex items-center gap-3">
            <Button
              icon={<ArrowImport20Regular />}
              onClick={() => void startTodoist()}
              className="w-56 justify-start"
            >
              Todoist project…
            </Button>
            <span className="text-caption text-fg-tertiary">
              the CSV from Export as a template; one file per project
            </span>
          </li>
          <li className="flex items-center gap-3">
            <Button
              icon={<ArrowImport20Regular />}
              onClick={() => void startToDo()}
              className="w-56 justify-start"
            >
              Microsoft To Do list…
            </Button>
            <span className="text-caption text-fg-tertiary">
              the Outlook CSV export of the list's Tasks folder
            </span>
          </li>
        </ul>

        <section aria-label="Recent imports" className="border-t border-stroke-subtle pt-3">
          <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">
            Recent imports
          </h3>
          {batches.length === 0 ? (
            <p className="text-caption text-fg-tertiary">Nothing has been imported yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {batches.map((batch) => (
                <li
                  key={batch.id}
                  className="flex items-center gap-3 text-body text-fg"
                  data-testid="import-batch"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {describeBatch(batch.summary)}{' '}
                    <span className="text-fg-tertiary">from {batch.source}</span>
                  </span>
                  <span className="text-caption text-fg-tertiary tabular-nums">
                    {new Date(batch.importedAt).toLocaleString()}
                  </span>
                  <Button
                    appearance="subtle"
                    icon={<ArrowUndo20Regular />}
                    aria-label={`Undo the import from ${batch.source} on ${new Date(batch.importedAt).toLocaleString()}`}
                    disabled={undo.isPending}
                    onClick={() =>
                      undo.mutate(batch.id, {
                        onSuccess: () => {
                          setDone(null);
                          announce(`Undid the import from ${batch.source}`);
                        },
                      })
                    }
                  >
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ImportDialog plan={plan} onClose={() => setPlan(null)} onImported={setDone} />
    </Card>
  );
}

function describeBatch(summary: { tasks: number; events: number; collections: number }): string {
  const parts: string[] = [];
  if (summary.tasks > 0) parts.push(`${summary.tasks} ${summary.tasks === 1 ? 'task' : 'tasks'}`);
  if (summary.events > 0)
    parts.push(`${summary.events} ${summary.events === 1 ? 'event' : 'events'}`);
  if (summary.collections > 0)
    parts.push(
      `${summary.collections} new ${summary.collections === 1 ? 'collection' : 'collections'}`,
    );
  return parts.length === 0 ? 'Nothing' : parts.join(', ');
}
