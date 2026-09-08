import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redirect } from '../src/domain/importing';
import { fromTrello } from '../src/domain/importers/trello';
import { sequence } from '../src/domain/ordering';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures', 'trello-board.json');

/** The seeded Status options, as the card reads them from the workspace. */
const SEEDED_STATUS = [
  { id: 'todo', label: 'To do', color: null, group: 'todo' as const },
  { id: 'doing', label: 'In progress', color: 'info', group: 'doing' as const },
  { id: 'blocked', label: 'Blocked', color: 'danger', group: 'doing' as const },
  { id: 'done', label: 'Done', color: 'success', group: 'done' as const },
];

/**
 * Trello, end to end — the slice's proof of done: a board becomes a board.
 * The same columns (lists become Status options, reusing the ones already
 * there by name), the same cards in the same order, labels as a property,
 * checklists as real checklist blocks. And undo puts the Status options back
 * exactly, so the board has its four columns again.
 */
describe('a Trello board', () => {
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

  it('imports: lists become columns, cards keep their order, checklists are checklists', async () => {
    const { driver } = session;
    const raw: unknown = JSON.parse(await readFile(FIXTURE, 'utf-8'));
    const plan = redirect(fromTrello(raw, SEEDED_STATUS)!, 'Tasks');
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Pick a typeface',
      'Write the copy',
      'Sketch the new home page',
      'Set up the repository',
    ]);

    const taskPositions = sequence(null, null, plan.tasks.length);
    const propertyPositions = sequence(null, null, plan.properties!.length);
    const batch = await invoke<
      | { summary: { tasks: number; properties_created: number; properties_extended: number } }
      | { __error: string }
    >('import_apply', {
      plan: {
        source: plan.source,
        collections: plan.collections.map((c) => ({ ...c, position: 'zz' })),
        properties: plan.properties!.map((property, index) => ({
          collection: property.collection,
          name: property.name,
          type: property.type,
          options: property.options,
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
    expect(batch).toMatchObject({
      summary: { tasks: 4, properties_created: 1, properties_extended: 1 },
    });

    await driver.waitForText('Sketch the new home page');
    // The completed card is ticked.
    const done = await driver.waitFor('the completed row', () =>
      driver.find('input[aria-label="Complete Set up the repository"]'),
    );
    expect(await done.property('checked')).toBe(true);

    // The description and the checklist are in the card's document.
    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Sketch the new home page"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
    await driver.waitForText('Three directions, one afternoon.');
    await driver.waitForText('Directions');
    await driver.waitForText('Bold and dark');
    await driver.waitForText('Light and airy');
    // A real checklist: the first item is ticked, the others are not.
    const ticks = await driver.execute<boolean[]>(
      `return Array.from(document.querySelectorAll('[role="dialog"] ul[data-type="taskList"] input[type="checkbox"]'))
         .map((box) => box.checked);`,
    );
    expect(ticks).toEqual([true, false, false]);
    // The labels arrived as a property with the card's two labels.
    await driver.waitForText('Design');
    await driver.waitForText('Urgent');
    await session.screenshot('trello-card');
    await closeDialogs();
  });

  it('the board has the Trello columns beside its own, with the cards in them', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="Board"]')).click();
    await driver.waitForText('Ideas');
    await driver.waitForText('Review');
    const headings = await driver.execute<string>('return document.body.innerText');
    // Same columns: the two lists that were new, and Done / In progress reused.
    for (const name of ['To do', 'In progress', 'Ideas', 'Review', 'Done']) {
      expect(headings).toContain(name);
    }
    await session.screenshot('trello-board');
  });

  it('undo puts the board back: the Trello columns are gone, the four remain', async () => {
    const { driver } = session;
    await goTo('Settings');
    const undo = await driver.waitFor('the Undo control', () =>
      driver.find('button[aria-label^="Undo the import"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: undo.id }]);
    await driver.waitForText('Nothing has been imported yet');

    // With no cards left the page shows its empty state rather than the
    // columns, so what is checked is the absence: no Trello column, no card.
    //
    // Read from the board, not from the window. The whole page's text includes
    // the navigation rail, and the day a destination was called "Review" this
    // assertion started failing for a column that had gone.
    await goTo('Board');
    await driver.waitFor('the Trello columns are gone', async () => {
      const text = await driver.execute<string | null>(
        `const board = document.querySelector('[role="region"][aria-label="Board"]');
         return board === null ? null : board.innerText;`,
      );
      if (text === null) return true; // No board at all: no columns either.
      return !text.includes('Review') && !text.includes('Ideas') ? true : null;
    });
    expect((await driver.findAll('button[aria-label^="Open "]')).length).toBe(0);
  });
});
