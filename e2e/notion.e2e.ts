import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fromNotion } from '../src/domain/importers/notion';
import { reconcile, redirect } from '../src/domain/importing';
import { sequence } from '../src/domain/ordering';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const TABLE = path.resolve(import.meta.dirname, 'fixtures', 'notion-export', 'Work 8f2c1a.csv');

/**
 * Notion, end to end — the slice's proof of done: a database export becomes a
 * collection whose properties keep their types where they can be inferred,
 * and whose pages keep their text.
 *
 * The fixture is a real export's shape: `Work 8f2c1a.csv` beside the folder
 * `Work 8f2c1a/` holding one Markdown file per row. The host reads both
 * through the commands the card calls.
 */
describe('a Notion database', () => {
  let session: Session;

  const invoke = <T>(command: string, args: Record<string, unknown> = {}) =>
    session.driver.executeAsync<T>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  const goTo = async (label: string) => {
    const { driver } = session;
    await (await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  };

  const openDetail = async (title: string) => {
    const { driver } = session;
    const open = await driver.waitFor(`the Open control for ${title}`, () =>
      driver.find(`button[aria-label="Open ${title}"]`),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
  };

  const closeDialogs = async () => {
    const { driver } = session;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await driver.findAll('[role="dialog"]')).length === 0) break;
      await driver.chord(Keys.ESCAPE);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitForElement('input[aria-label="New task"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('imports: every column keeps the type its values agreed on', async () => {
    const { driver } = session;
    const text = await invoke<string>('import_read_text', { path: TABLE });
    const pages = await invoke<{ name: string; text: string }[]>('import_read_pages', {
      path: TABLE,
    });
    // The host found the folder beside the table.
    expect(pages.map((page) => page.name)).toEqual(['Draft the brief d4e5f6', 'Ship it 789abc']);

    // The card reconciles against the destination's properties before it
    // previews: the file's Status column meets this workspace's own.
    const plan = reconcile(redirect(fromNotion(text, 'Work', pages)!, 'Tasks'), [
      {
        name: 'Status',
        type: 'status',
        options: [
          { id: 'todo', label: 'To do', color: null },
          { id: 'doing', label: 'In progress', color: 'info' },
          { id: 'blocked', label: 'Blocked', color: 'danger' },
          { id: 'done', label: 'Done', color: 'success' },
        ],
      },
      { name: 'Priority', type: 'priority', options: [] },
    ]);
    const taskPositions = sequence(null, null, plan.tasks.length);
    const propertyPositions = sequence(null, null, plan.properties!.length);
    const batch = await invoke<
      { summary: { tasks: number; properties_created: number } } | { __error: string }
    >('import_apply', {
      plan: {
        source: plan.source,
        collections: plan.collections.map((collection) => ({ ...collection, position: 'zz' })),
        properties: plan.properties!.map((property, index) => ({
          collection: property.collection,
          name: property.name,
          type: property.type,
          options: property.options ?? [],
          position: propertyPositions[index]!,
        })),
        tasks: plan.tasks.map((task, index) => {
          const blockPositions = sequence(null, null, task.blocks?.length ?? 0);
          return {
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
            blocks: (task.blocks ?? []).map((block, at) => ({
              type: block.type,
              content: block.content,
              position: blockPositions[at]!,
            })),
          };
        }),
        events: [],
      },
    });
    if ('__error' in batch) throw new Error(`import_apply refused: ${batch.__error}`);
    // Owner, Estimate, Due, Done, Link, Tags, Notes — seven columns created;
    // Archive is empty, and Status was adopted by the one already here. It
    // gained nothing: every label in the file — To do, In progress, Done —
    // is a column this workspace already had.
    expect(batch).toMatchObject({
      summary: { tasks: 4, properties_created: 7, properties_extended: 0 },
    });

    await driver.waitForText('Draft the brief');
    await driver.waitForText('Write the notes');
  });

  it('the typed values are on the row, each edited by its own kind of control', async () => {
    const { driver } = session;
    await openDetail('Draft the brief');

    // A number, a date, a checkbox, a link, a select and a multi-select — the
    // types inferred from text, now real controls.
    const estimate = await driver.waitFor('the Estimate field', () =>
      driver.findByXPath('//*[@role="dialog"]//input[@aria-label="Estimate" and @type="number"]'),
    );
    expect(await estimate.property('value')).toBe('3');

    const due = await driver.waitFor('the Due field', () =>
      driver.findByXPath('//*[@role="dialog"]//input[@aria-label="Due" and @type="date"]'),
    );
    expect(await due.property('value')).toBe('2026-09-15');

    const done = await driver.waitFor('the Done field', () =>
      driver.findByXPath('//*[@role="dialog"]//input[@aria-label="Done"]'),
    );
    expect(await done.property('checked')).toBe(true);

    const status = await driver.waitFor('the Status field', () =>
      driver.findByXPath('//*[@role="dialog"]//select[@aria-label="Status"]'),
    );
    // "In progress" from the file is this workspace's own In progress.
    expect(await status.property('value')).toBe('doing');

    const link = await driver.waitFor('the Link field', () =>
      driver.findByXPath('//*[@role="dialog"]//input[@aria-label="Link" and @type="url"]'),
    );
    expect(await link.property('value')).toBe('https://example.com/brief');
    await session.screenshot('notion-values');
    await closeDialogs();
  });

  it('a page becomes the row’s document, with its headings, list and marks', async () => {
    const { driver } = session;
    await openDetail('Draft the brief');
    await driver.waitForText('Three directions, one afternoon.');
    await driver.waitForText('Directions');
    await driver.waitForText('Bold and dark');
    await driver.waitForText('Editorial');

    const ticks = await driver.execute<boolean[]>(
      `return Array.from(document.querySelectorAll('[role="dialog"] ul[data-type="taskList"] input[type="checkbox"]'))
         .map((box) => box.checked);`,
    );
    expect(ticks).toEqual([true, false, false]);

    // The marks survived: a bold word and a link.
    const marks = await driver.execute<{ bold: number; links: string[] }>(
      `const panel = document.querySelector('[role="dialog"]');
       return {
         bold: panel.querySelectorAll('strong').length,
         links: Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href')),
       };`,
    );
    expect(marks.bold).toBeGreaterThan(0);
    expect(marks.links).toContain('https://example.com/style');
    await session.screenshot('notion-page');
    await closeDialogs();

    // The other page kept its quote and its numbered list.
    await openDetail('Ship it');
    await driver.waitForText('Nothing ships on a Friday.');
    await driver.waitForText('Tag the release');
    await closeDialogs();
  });

  it('undo takes the rows and the properties it created', async () => {
    const { driver } = session;
    await goTo('Settings');
    const undo = await driver.waitFor('the Undo control', () =>
      driver.find('button[aria-label^="Undo the import"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: undo.id }]);
    await driver.waitForText('Nothing has been imported yet');

    await goTo('Tasks');
    await driver.waitFor('the list is empty again', async () =>
      (await driver.findAll('button[aria-label^="Open "]')).length === 0 ? true : null,
    );
    // The properties went with them: only the seeded two remain.
    const remaining = await invoke<{ name: string; config: { options?: { id: string }[] } }[]>(
      'properties_list',
      {
        collectionId: 'tasks',
      },
    );
    expect(remaining.map((property) => property.name).sort()).toEqual(['Priority', 'Status']);
    // And the Status property has the four options it started with.
    const status = remaining.find((property) => property.name === 'Status')!;
    expect((status.config.options ?? []).map((option) => option.id)).toEqual([
      'todo',
      'doing',
      'blocked',
      'done',
    ]);
  });
});
