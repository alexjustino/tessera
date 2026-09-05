import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redirect } from '../src/domain/importing';
import { fromOutlookTasks } from '../src/domain/importers/outlookTasks';
import { fromTodoist } from '../src/domain/importers/todoist';
import { sequence } from '../src/domain/ordering';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');

/**
 * The first two foreign importers, end to end — the slice's proof of done: a
 * real export from each imports with dates in the right zone, priorities
 * mapped and completions kept, and what cannot map is listed.
 *
 * The files are the committed fixtures, read through the command the card
 * calls and turned into plans by the domain the card runs, then applied
 * through the door. Every import lands in the collection the list shows, as
 * the dialog's default would have it; each is undone at the end.
 */
describe('Todoist and Microsoft To Do', () => {
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

  /** Apply a plan through the door, into the collection the list shows. */
  const applyInto = async (planSource: ReturnType<typeof fromTodoist>) => {
    const plan = redirect(planSource!, 'Tasks');
    const positions = sequence(null, null, plan.tasks.length);
    return invoke<{ id: string; summary: { tasks: number } } | { __error: string }>(
      'import_apply',
      {
        plan: {
          source: plan.source,
          collections: plan.collections.map((c) => ({ ...c, position: 'zz' })),
          tasks: plan.tasks.map((task, index) => ({
            collection: task.collection,
            title: task.title,
            notes: task.notes,
            position: positions[index]!,
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
  };

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitForElement('input[aria-label="New task"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a Todoist project imports: dates in its zone, priorities mapped, what is left out listed', async () => {
    const { driver } = session;
    const text = await invoke<string>('import_read_text', {
      path: path.join(FIXTURES, 'todoist-project.csv'),
    });
    const plan = fromTodoist(text, 'Trip', zone);
    expect(plan).not.toBeNull();
    expect(plan!.tasks).toHaveLength(5);
    expect(plan!.warnings).toHaveLength(4);

    const batch = await applyInto(plan);
    expect(batch).toMatchObject({ summary: { tasks: 5 } });

    await driver.waitForText('Renew the passport');
    await driver.waitForText('Water the plants');

    // The date came through in the file's own zone; the priority as urgent.
    await openDetail('Renew the passport');
    const due = await driver.waitForElement('input[aria-label="Due date and time"]');
    expect(((await due.property('value')) as string).startsWith('2026-09-15T')).toBe(true);
    const priority = await driver.waitFor('the Priority field in the panel', () =>
      driver.findByXPath('//*[@role="dialog"]//select[@aria-label="Priority"]'),
    );
    expect(await priority.property('value')).toBe('urgent');
    await driver.waitForText('Bring two photos');
    await closeDialogs();
  });

  it('a To Do list exported from Outlook imports: completions kept, status mapped', async () => {
    const { driver } = session;
    const text = await invoke<string>('import_read_text', {
      path: path.join(FIXTURES, 'outlook-tasks.csv'),
    });
    const plan = fromOutlookTasks(text, 'Home', zone, new Date().toISOString());
    expect(plan).not.toBeNull();
    expect(plan!.tasks).toHaveLength(4);

    const batch = await applyInto(plan);
    expect(batch).toMatchObject({ summary: { tasks: 4 } });

    await driver.waitForText('Call the dentist');
    const done = await driver.waitFor('the completed row', () =>
      driver.find('input[aria-label="Complete Send the tax forms"]'),
    );
    expect(await done.property('checked')).toBe(true);

    await openDetail('Wait for the plumber');
    const status = await driver.waitFor('the Status field in the panel', () =>
      driver.findByXPath('//*[@role="dialog"]//select[@aria-label="Status"]'),
    );
    expect(await status.property('value')).toBe('blocked');
    await closeDialogs();

    await openDetail('Call the dentist');
    const priority = await driver.waitFor('the Priority field in the panel', () =>
      driver.findByXPath('//*[@role="dialog"]//select[@aria-label="Priority"]'),
    );
    expect(await priority.property('value')).toBe('high');
    await closeDialogs();
    await session.screenshot('importers');
  });

  it('both imports are listed and both can be undone, leaving nothing', async () => {
    const { driver } = session;
    await goTo('Settings');
    await driver.waitForText('Recent imports');
    const rows = await driver.findAll('[data-testid="import-batch"]');
    expect(rows).toHaveLength(2);
    const texts = await Promise.all(rows.map((row) => row.text()));
    expect(texts.join(' ')).toContain('Todoist');
    expect(texts.join(' ')).toContain('Microsoft To Do');

    for (let round = 0; round < 2; round += 1) {
      const undo = await driver.waitFor('an Undo control', () =>
        driver.find('button[aria-label^="Undo the import"]'),
      );
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: undo.id }]);
      await driver.waitFor('one fewer batch', async () =>
        (await driver.findAll('[data-testid="import-batch"]')).length === 1 - round ? true : null,
      );
    }
    await driver.waitForText('Nothing has been imported yet');

    await goTo('Tasks');
    await driver.waitFor('the list is empty again', async () =>
      (await driver.findAll('button[aria-label^="Open "]')).length === 0 ? true : null,
    );
  });
});
