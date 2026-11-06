import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface RawItem {
  id: string;
  title: string;
  position: string;
  parent_item_id: string | null;
  completed_at: string | null;
}

/**
 * The steps inside a task (ADR-051): added, pasted, ticked, dragged with a real
 * pointer, made into tasks, and started again when the task repeats.
 *
 * A task with steps goes on being one task everywhere that counts tasks.
 */
describe('subtasks', () => {
  let session: Session;

  const invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    const result = await session.driver.executeAsync<T | { __error: string }>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: String(e) }));',
      [command, args],
    );
    if (result !== null && typeof result === 'object' && '__error' in result) {
      throw new Error(result.__error);
    }
    return result as T;
  };

  const press = async (selector: string) => {
    const { driver } = session;
    const control = await driver.waitFor(selector, () => driver.find(selector));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
  };

  const tasks = () =>
    invoke<RawItem[]>('items_list', { collectionId: 'tasks', includeCompleted: true });
  const steps = () => invoke<RawItem[]>('subtasks_list');

  /** The steps in the order the screen shows them. */
  const shown = () =>
    session.driver.execute<string[]>(
      `return [...document.querySelectorAll('[data-subtask] input:not([type=checkbox])')].map((i) => i.value);`,
    );

  /** The opening fades over the first screen; a picture taken under it shows nothing. */
  const settled = () =>
    session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );

  /** Wait for it, and bring it on screen, so the picture shows it. */
  const inView = async (selector: string) => {
    const { driver } = session;
    const found = await driver.waitFor(selector, () => driver.find(selector));
    await driver.execute('arguments[0].scrollIntoView({ block: "center", inline: "center" })', [
      { [ELEMENT]: found.id },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();

  const openTask = async (title: string) => {
    await press(`button[aria-label="Open ${title}"]`);
    await session.driver.waitForElement('[data-testid="subtasks"]');
  };

  const closeTask = async () => {
    const { driver } = session;
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the panel to close', async () =>
      (await driver.findAll('[data-testid="subtasks"]')).length === 0 ? true : null,
    );
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Commission the bay${Keys.ENTER}`);
    await driver.waitForText('Commission the bay');
    await settled();
    await openTask('Commission the bay');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('adds a step, and keeps the line ready for the next', async () => {
    const { driver } = session;
    const line = await driver.waitForElement('input[aria-label="Add a subtask"]');
    await line.sendKeys(`Check the relays${Keys.ENTER}`);
    await driver.waitFor('the step', async () => ((await shown()).length === 1 ? true : null));
    await driver.waitFor('the line to clear', async () =>
      (await line.property('value')) === '' ? true : null,
    );
    await line.sendKeys(`Test the trip${Keys.ENTER}`);
    await driver.waitFor('both steps', async () => ((await shown()).length === 2 ? true : null));
    expect(await shown()).toEqual(['Check the relays', 'Test the trip']);
  });

  it('makes a step of every line of a pasted list, without its marks', async () => {
    const { driver } = session;
    await driver.execute(
      `const input = document.querySelector('input[aria-label="Add a subtask"]');
       const data = new DataTransfer();
       data.setData('text', '- [ ] Sign the sheet\\n- Archive the file\\n');
       input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));`,
    );
    await driver.waitFor('the pasted steps', async () =>
      (await shown()).length === 4 ? true : null,
    );
    expect(await shown()).toEqual([
      'Check the relays',
      'Test the trip',
      'Sign the sheet',
      'Archive the file',
    ]);
  });

  it('says how far along it is, in the panel and on the row', async () => {
    const { driver } = session;
    await press('input[aria-label="Done: Check the relays"]');
    await driver.waitFor('the count', async () => {
      const count = await driver.find('[data-testid="steps-done"]');
      return (await count.text()) === '1 of 4' ? true : null;
    });
    await driver.waitForElement('[aria-label="1 of 4 subtasks done"]');
    await session.screenshot('subtasks');
  });

  it('moves a step with a real pointer, and the order is what is stored', async () => {
    const { driver } = session;
    const middle = (selector: string) =>
      driver.execute<{ x: number; y: number }>(
        `const box = document.querySelector(arguments[0]).getBoundingClientRect();
         return { x: box.left + box.width / 2, y: box.top + box.height / 2 };`,
        [selector],
      );
    const from = await middle('button[aria-label="Move Archive the file"]');
    const to = await middle('button[aria-label="Move Test the trip"]');
    await driver.pointer([
      { type: 'move', x: from.x, y: from.y },
      { type: 'down' },
      { type: 'move', x: from.x, y: from.y - 8 },
      { type: 'move', x: from.x, y: (from.y + to.y) / 2 },
      { type: 'move', x: to.x, y: to.y },
      { type: 'up' },
    ]);
    await driver.releasePointer();

    await driver.waitFor('the new order', async () =>
      (await shown())[1] === 'Archive the file' ? true : null,
    );
    const stored = (await steps()).sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(stored.map((step) => step.title)).toEqual([
      'Check the relays',
      'Archive the file',
      'Test the trip',
      'Sign the sheet',
    ]);
  });

  it('moves a step with the keyboard', async () => {
    const { driver } = session;
    const handle = await driver.waitFor('the handle', () =>
      driver.find('button[aria-label="Move Sign the sheet"]'),
    );
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: handle.id }]);
    await driver.chord(' ');
    await driver.chord(Keys.ARROW_UP);
    await driver.chord(' ');
    await driver.waitFor('the step up one', async () =>
      (await shown())[2] === 'Sign the sheet' ? true : null,
    );
  });

  it('makes a step a task of its own', async () => {
    const { driver } = session;
    await press('button[aria-label="Make Archive the file a task of its own"]');
    await driver.waitFor('the step to go', async () =>
      (await shown()).includes('Archive the file') ? null : true,
    );
    expect((await tasks()).map((task) => task.title)).toContain('Archive the file');
    expect((await steps()).map((step) => step.title)).not.toContain('Archive the file');
  });

  it('offers the finish when the last is ticked, and does not take it', async () => {
    const { driver } = session;
    await press('input[aria-label="Done: Test the trip"]');
    await press('input[aria-label="Done: Sign the sheet"]');
    await driver.waitForElement('[data-testid="steps-finished"]');
    await session.screenshot('subtasks-all-done');

    const parent = (await tasks()).find((task) => task.title === 'Commission the bay');
    expect(parent?.completed_at).toBeNull();
  });

  it('finishes the task when asked', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Finish the task"]')).click();
    await driver.waitFor('the task to finish', async () => {
      const parent = (await tasks()).find((task) => task.title === 'Commission the bay');
      return parent?.completed_at === null ? null : true;
    });
    await driver.waitFor('the offer to go', async () =>
      (await driver.findAll('[data-testid="steps-finished"]')).length === 0 ? true : null,
    );
    await invoke('item_set_completed', {
      id: (await tasks()).find((task) => task.title === 'Commission the bay')?.id,
      completed: false,
    });
    await session.restart();
  });

  it('keeps the steps through a restart, in their order', async () => {
    const { driver } = session;
    await driver.waitForText('Commission the bay');
    await settled();
    await driver.waitForElement('[aria-label="3 of 3 subtasks done"]');
    await openTask('Commission the bay');
    expect(await shown()).toEqual(['Check the relays', 'Sign the sheet', 'Test the trip']);
  });

  it('does not count a step as a task, nor show one in the list', async () => {
    const { driver } = session;
    expect((await tasks()).map((task) => task.title).sort()).toEqual([
      'Archive the file',
      'Commission the bay',
    ]);
    await closeTask();
    const rows = await driver.execute<string[]>(
      `return [...document.querySelectorAll('button[aria-label^="Open "]')].map((b) => b.getAttribute('aria-label'));`,
    );
    expect(rows).not.toContain('Open Check the relays');
  });

  it('finding a step leads to the task it is part of', async () => {
    const hits = await invoke<Array<{ owner_id: string }>>('search', { query: 'relays' });
    const parent = (await tasks()).find((task) => task.title === 'Commission the bay');
    expect(hits.map((hit) => hit.owner_id)).toContain(parent?.id);
  });

  it('starts the steps again when the task repeats', async () => {
    const parent = (await tasks()).find((task) => task.title === 'Commission the bay');
    await invoke('item_complete_occurrence', {
      id: parent?.id,
      nextDueAt: '2031-01-08T12:00:00.000Z',
    });
    expect((await steps()).every((step) => step.completed_at === null)).toBe(true);
  });

  it('deleting the task takes its steps with it', async () => {
    const parent = (await tasks()).find((task) => task.title === 'Commission the bay');
    await invoke('item_delete', { id: parent?.id });
    expect(await steps()).toEqual([]);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('refuses a step inside a step, and says so', async () => {
    const parent = (await tasks())[0];
    const step = await invoke<RawItem>('subtask_add', {
      parentId: parent?.id,
      title: 'A step',
      position: 'a',
    });
    await expect(
      invoke('subtask_add', { parentId: step.id, title: 'Deeper', position: 'a' }),
    ).rejects.toThrow();
    expect((await steps()).map((one) => one.title)).toEqual(['A step']);
  });

  // ── Everywhere else a task is shown ────────────────────────────────────
  it('the row, the card, Now and Focus all say which step is next', async () => {
    await goTo('Tasks');
    const input = await session.driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Pack the van${Keys.ENTER}`);
    await session.driver.waitForText('Pack the van');
    const parent = (await tasks()).find((task) => task.title === 'Pack the van');
    const made: RawItem[] = [];
    for (const [title, position] of [
      ['Find the straps', 'a'],
      ['Load the ladder', 'b'],
      ['Lock the doors', 'c'],
    ] as const) {
      made.push(await invoke<RawItem>('subtask_add', { parentId: parent?.id, title, position }));
    }
    await invoke('item_set_completed', { id: made[0]?.id, completed: true });
    await invoke('time_start', { itemId: parent?.id });
    await session.restart();
    await settled();
    // A restart is a new driver session.
    const { driver } = session;

    // The row.
    await goTo('Tasks');
    await inView('[aria-label="1 of 3 subtasks done"]');
    await session.screenshot('subtasks-row');

    // Now, on Today: the clock is on this task, so this is what is being done.
    await goTo('Today');
    const step = await driver.waitFor('the step on Now', () =>
      driver.find('[data-testid="now-step"]'),
    );
    expect(await step.text()).toBe('Next step, 2 of 3: Load the ladder');
    await session.screenshot('subtasks-now');

    // The card.
    await goTo('Board');
    await inView('article [aria-label="1 of 3 subtasks done"]');
    await session.screenshot('subtasks-board');

    // Focus shows the steps, and a tick there is a tick.
    await goTo('Tasks');
    await openTask('Pack the van');
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Focus on this"]')
    ).click();
    await driver.waitForElement('[data-testid="focus-title"]');
    expect((await driver.findAll('[data-subtask]')).length).toBe(3);
    expect(await driver.findAll('input[aria-label="Add a subtask"]')).toEqual([]);
    await press('input[aria-label="Done: Load the ladder"]');
    await driver.waitFor('the tick stored', async () => {
      const ladder = (await steps()).find((one) => one.title === 'Load the ladder');
      return ladder?.completed_at === null ? null : true;
    });
    await session.screenshot('subtasks-focus');
    await driver.chord(Keys.ESCAPE);
  });
});
