import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decide, fromTesseraExport, preview } from '../src/domain/importing';
import { sequence } from '../src/domain/ordering';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The import door, end to end — and the slice's proof of done in the real
 * product: an import is previewed, applied in one transaction, and undone;
 * after undo the workspace is what it was.
 *
 * File dialogs cannot be driven from WebDriver, so the file is read through
 * the same command the dialog calls, the plan is made by the same domain code
 * the dialog runs, and the apply goes through the same command. The undo is
 * pressed on the screen, because that is the part a person presses.
 */
describe('the import door', () => {
  let session: Session;
  let scratch: string;

  const invoke = <T>(command: string, args: Record<string, unknown> = {}) =>
    session.driver.executeAsync<T>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  const goTo = async (label: string) => {
    const { driver } = session;
    await (await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  };

  const titles = async (): Promise<string[]> =>
    session.driver.execute<string[]>(
      `return Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
         .map((b) => b.getAttribute('aria-label').slice(5)).sort();`,
    );

  let exportFile = '';

  beforeAll(async () => {
    session = await startSession();
    scratch = await mkdtemp(path.join(tmpdir(), 'tessera-e2e-import-'));
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Renew the passport tomorrow', 'Pack']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
    }
    await driver.waitForText('Renew the passport');
    await driver.waitForText('Pack');

    // The file another workspace would hand over: this one's own export.
    exportFile = path.join(scratch, 'other-workspace.json');
    const exported = await invoke<{ items: number } | { __error: string }>('export_json', {
      path: exportFile,
    });
    expect(exported).toMatchObject({ items: 2 });

    // Then the workspace moves on: one more task the file does not know.
    await input.sendKeys(`Book the flights${Keys.ENTER}`);
    await driver.waitForText('Book the flights');
  });

  afterAll(async () => {
    await session?.stop();
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  });

  it('previews: the two tasks the file holds look like the two already here', async () => {
    const raw = await invoke<unknown>('import_read_export', { path: exportFile });
    const plan = fromTesseraExport(raw);
    expect(plan).not.toBeNull();
    expect(plan!.tasks.map((task) => task.title).sort()).toEqual(['Pack', 'Renew the passport']);

    // The same reading the dialog makes, against what the workspace holds now.
    const document = JSON.parse(await readFile(exportFile, 'utf-8')) as unknown;
    expect(document).toMatchObject({ format: 'tessera-export' });
    const items = await invoke<
      {
        id: string;
        title: string;
        collection_id: string;
        due_at: string | null;
        completed_at: string | null;
      }[]
    >('items_list', { collectionId: null, includeCompleted: true });
    const existing = {
      collections: [{ id: 'tasks', name: 'Tasks', icon: null, color: null, position: 'a' }],
      items: items.map((item) => ({
        id: item.id,
        collectionId: item.collection_id,
        parentItemId: null,
        title: item.title,
        position: 'a',
        startAt: null,
        dueAt: item.due_at,
        remindAt: null,
        recurrenceRule: null,
        recurrenceMode: 'schedule' as const,
        completedAt: item.completed_at,
        estimateMinutes: null,
        isMilestone: false,
        createdAt: '',
        updatedAt: '',
      })),
      events: [],
    };
    const shown = preview(plan!, existing, 'UTC');
    expect(shown.counts.duplicates).toBe(2);
    // Skipping them leaves nothing to import; importing anyway makes copies.
    expect(decide(plan!, shown, true).tasks).toHaveLength(0);
    expect(decide(plan!, shown, false).tasks).toHaveLength(2);
  });

  it('applies as one batch, and the list shows it with an Undo', async () => {
    const { driver } = session;
    const raw = await invoke<unknown>('import_read_export', { path: exportFile });
    const plan = fromTesseraExport(raw)!;
    const before = await titles();
    // Positions must be well-formed order keys: the list sorts by them and
    // refuses a malformed one loudly. The dialog computes them with the same
    // helper; going around the dialog, the test must too.
    const collectionPositions = sequence(null, null, plan.collections.length);
    const taskPositions = sequence(null, null, plan.tasks.length);

    const batch = await invoke<{ id: string; summary: { tasks: number } } | { __error: string }>(
      'import_apply',
      {
        plan: {
          source: plan.source,
          collections: plan.collections.map((c, index) => ({
            ...c,
            position: collectionPositions[index]!,
          })),
          tasks: plan.tasks.map((task, index) => ({
            collection: task.collection,
            title: task.title,
            notes: task.notes,
            position: taskPositions[index]!,
            start_at: task.startAt,
            due_at: task.dueAt,
            completed_at: task.completedAt,
            estimate_minutes: task.estimateMinutes,
            is_milestone: task.isMilestone,
            values: task.values,
          })),
          events: [],
        },
      },
    );
    expect(batch).toMatchObject({ summary: { tasks: 2 } });

    // The apply went around the dialog. The host tells every window the
    // workspace changed, so the list refreshes without anyone asking it to —
    // the first run of this test is what found that it did not.
    await driver.waitFor('the copies are listed', async () =>
      (await titles()).length === before.length + 2 ? true : null,
    );

    await goTo('Settings');
    await driver.waitForText('Recent imports');
    const row = await driver.waitForElement('[data-testid="import-batch"]');
    expect(await row.text()).toContain('2 tasks');
    expect(await row.text()).toContain('a Tessera export');
    await session.screenshot('import-batch');
  });

  it('Undo puts the workspace back: the copies are gone, the rest untouched', async () => {
    const { driver } = session;
    const undo = await driver.waitFor('the Undo control', () =>
      driver.find('button[aria-label^="Undo the import"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: undo.id }]);
    await driver.waitForText('Nothing has been imported yet');

    await goTo('Tasks');
    await driver.waitFor('back to three', async () =>
      (await titles()).length === 3 ? true : null,
    );
    expect(await titles()).toEqual(['Book the flights', 'Pack', 'Renew the passport']);
  });

  it('and the import list is empty after a restart too', async () => {
    await session.restart();
    const { driver } = session;
    await goTo('Settings');
    await driver.waitForText('Nothing has been imported yet');
    expect((await titles()).length).toBe(0); // Settings shows no rows; sanity only
  });
});
