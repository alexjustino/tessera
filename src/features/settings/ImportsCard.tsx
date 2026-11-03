import { ArrowImport20Regular, ArrowUndo20Regular } from '@fluentui/react-icons';
import { useState } from 'react';

import { chooseImportPath } from '@/data/backups';
import { describeError } from '@/data/errors';
import { useImports, useProperties, useUndoImport } from '@/data/hooks';
import {
  chooseCalendarPath,
  chooseCsvPath,
  chooseJsonPath,
  nameFromPath,
  readExportFile,
  readPageFiles,
  readTextFile,
} from '@/data/importing';
import { fromTesseraExport, type ImportPlan } from '@/domain/importing';
import { fromOutlookTasks, looksLikeOutlookTasks } from '@/domain/importers/outlookTasks';
import { fromTodoist, looksLikeTodoist } from '@/domain/importers/todoist';
import { fromIcs, looksLikeIcs } from '@/domain/importers/ics';
import { fromNotion, looksLikeNotion } from '@/domain/importers/notion';
import { fromTrello, looksLikeTrello } from '@/domain/importers/trello';
import { optionsOf } from '@/domain/property';
import { systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { SettingBody, SettingGroup, SettingRow } from '@/ui/Setting';
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
  // The Status options the list shows, so a Trello list called "Done" lands in
  // the column already called Done rather than beside it.
  const properties = useProperties('tasks');
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

  const startTrello = () =>
    begin(
      () => chooseJsonPath('Import a Trello board (JSON)'),
      async (path) => {
        const raw: unknown = JSON.parse(await readTextFile(path));
        if (!looksLikeTrello(raw)) return null;
        const status = (properties.data ?? []).find((property) => property.type === 'status');
        return fromTrello(raw, status === undefined ? [] : optionsOf(status));
      },
      'That file is not a Trello board export. In Trello, open the board menu → More → Print and export → Export as JSON.',
    );

  const startNotion = () =>
    begin(
      () => chooseCsvPath('Import a Notion database (the CSV of an unzipped export)'),
      async (path) => {
        const text = await readTextFile(path);
        if (!looksLikeNotion(text)) return null;
        // Notion names the table after the database and appends a hash; the
        // pages sit in the folder beside it, under the same name.
        const name = nameFromPath(path).replace(/\s+[0-9a-f]{6,}$/i, '');
        return fromNotion(text, name, await readPageFiles(path));
      },
      'That file is not a Notion database export. In Notion, open the database menu → Export → Markdown & CSV, unzip it, and choose the .csv inside.',
    );

  const startCalendar = () =>
    begin(
      () => chooseCalendarPath('Import a calendar (ICS)'),
      async (path) => {
        const text = await readTextFile(path);
        if (!looksLikeIcs(text)) return null;
        // The file names its own calendar when it has one; otherwise the file
        // is the name, which is what a person picked it by.
        return fromIcs(text, nameFromPath(path), systemZone());
      },
      'That file is not a calendar. Export one from your calendar as .ics — in Outlook, Google Calendar or Apple Calendar — and choose it here.',
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
  const starts = {
    tessera: startTessera,
    todoist: startTodoist,
    trello: startTrello,
    notion: startNotion,
    calendar: startCalendar,
    todo: startToDo,
  };

  return (
    <>
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

      <SettingGroup
        title="Add from another product"
        description="Nothing here is replaced. Every import is previewed first and can be undone as one thing."
      >
        {SOURCES(starts).map((source) => (
          <SettingRow key={source.label} title={source.name} description={source.note}>
            <Button icon={<ArrowImport20Regular />} onClick={() => void source.start()}>
              {source.label}
            </Button>
          </SettingRow>
        ))}
      </SettingGroup>

      <SettingGroup title="Recent imports">
        <SettingBody>
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
        </SettingBody>
      </SettingGroup>

      <ImportDialog plan={plan} onClose={() => setPlan(null)} onImported={setDone} />
    </>
  );
}

/** The products a file can come from: what each is, and what to bring. */
function SOURCES(
  starts: Record<
    'tessera' | 'todoist' | 'trello' | 'notion' | 'calendar' | 'todo',
    () => Promise<void>
  >,
) {
  return [
    {
      name: 'Tessera',
      note: "Another workspace's JSON export.",
      label: 'Tessera export…',
      start: starts.tessera,
    },
    {
      name: 'Todoist',
      note: 'The CSV from Export as a template, one file per project.',
      label: 'Todoist project…',
      start: starts.todoist,
    },
    {
      name: 'Trello',
      note: "The board's JSON export. Lists become columns, labels a property.",
      label: 'Trello board…',
      start: starts.trello,
    },
    {
      name: 'Notion',
      note: 'The .csv from an unzipped Markdown & CSV export. Pages become documents.',
      label: 'Notion database…',
      start: starts.notion,
    },
    {
      name: 'A calendar',
      note: 'An .ics file, with its repeats and exceptions.',
      label: 'Calendar (ICS)…',
      start: starts.calendar,
    },
    {
      name: 'Microsoft To Do',
      note: "The Outlook CSV export of the list's Tasks folder.",
      label: 'Microsoft To Do list…',
      start: starts.todo,
    },
  ];
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
