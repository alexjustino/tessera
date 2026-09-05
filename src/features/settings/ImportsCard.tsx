import { ArrowImport20Regular, ArrowUndo20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { chooseImportPath } from '@/data/backups';
import { describeError } from '@/data/errors';
import { useImports, useUndoImport } from '@/data/hooks';
import { readExportFile } from '@/data/importing';
import { fromTesseraExport, type ImportPlan } from '@/domain/importing';
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

  const start = async () => {
    setComplaint(null);
    setDone(null);
    const path = await chooseImportPath();
    if (!path) return;
    try {
      const raw = await readExportFile(path);
      const read = fromTesseraExport(raw);
      if (read === null) {
        setComplaint('That file is not a Tessera export.');
        return;
      }
      setPlan(read);
    } catch (error) {
      setComplaint(describeError(error));
    }
  };

  const batches = imports.data ?? [];

  return (
    <Card
      title="Add from another workspace"
      description="Bring in a Tessera export without replacing anything here. Every import can be undone as one thing."
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

        <div>
          <Button icon={<ArrowImport20Regular />} onClick={() => void start()}>
            Add from a Tessera export…
          </Button>
        </div>

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
