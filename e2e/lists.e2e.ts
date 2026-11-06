import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface RawItem {
  id: string;
  title: string;
  collection_id: string;
}

interface RawCollection {
  id: string;
  name: string;
}

/**
 * Lists (ADR-053): made from the rail, each with its own tasks, board and
 * properties; a task moved between them keeps what fits; Today reads them all;
 * a list is deleted only once it is empty.
 */
describe('lists', () => {
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
    await driver.waitFor(selector, async () => {
      const control = await driver.find(selector);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const pressText = async (text: string) => {
    const { driver } = session;
    await driver.waitFor(text, async () => {
      const control = await driver.findByXPath(`//button[normalize-space(.)="${text}"]`);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  /** Wait for it, and bring it on screen, so the picture shows it. */
  const inView = async (selector: string, text?: string) => {
    const { driver } = session;
    const found = await driver.waitFor(selector, async () => {
      for (const candidate of await driver.findAll(selector)) {
        if (text === undefined || (await candidate.text()).includes(text)) return candidate;
      }
      return null;
    });
    // Into view inside its boxes, and the window itself left where it is.
    await driver.execute(
      'arguments[0].scrollIntoView({ block: "center", inline: "center" }); for (const root of [document.scrollingElement, document.body, document.documentElement]) if (root) root.scrollTop = 0;',
      [{ [ELEMENT]: found.id }],
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  /** Bringing something into view scrolls every box around it; put them all back. */
  const backToTop = () =>
    session.driver.execute(
      'for (const box of [document.scrollingElement, ...document.querySelectorAll("main, nav, [class*=overflow]")]) if (box) { box.scrollTop = 0; box.scrollLeft = 0; }',
    );

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();

  const heading = () =>
    session.driver.execute<string>('return document.querySelector("main h1")?.textContent ?? ""');

  const lists = () => invoke<RawCollection[]>('collections_list');
  const all = () => invoke<RawItem[]>('items_list', { collectionId: null, includeCompleted: true });
  const work = async () => (await lists()).find((list) => list.name === 'Work');

  const addTask = async (title: string) => {
    const { driver } = session;
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`${title}${Keys.ENTER}`);
    await driver.waitForText(title);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitFor('the opening to go', async () =>
      (await driver.findAll('#opening')).length === 0 ? true : null,
    );
    await goTo('Tasks');
    await addTask('Pay the rent');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('makes a list from the rail, and lands on it', async () => {
    const { driver } = session;
    await pressText('New list');
    const name = await driver.waitForElement('input[aria-label="Name of the new list"]');
    await name.sendKeys(`Work${Keys.ENTER}`);
    await driver.waitFor('the list on screen', async () =>
      (await heading()) === 'Work' ? true : null,
    );
    expect(await work()).toBeDefined();
    await driver.waitForElement('[role="group"][aria-label="Lists"] [aria-current="page"]');
  });

  it('a task added there lives there, and not in Tasks', async () => {
    const { driver } = session;
    await addTask('Write the quarterly report');
    const list = await work();
    const report = (await all()).find((item) => item.title === 'Write the quarterly report');
    expect(report?.collection_id).toBe(list?.id);
    await driver.waitForElement('[aria-label="Work, 1 open"]');

    await goTo('Tasks');
    await driver.waitForText('Pay the rent');
    expect(await driver.findAll('button[aria-label="Open Write the quarterly report"]')).toEqual(
      [],
    );
    await session.screenshot('lists-rail');
  });

  it('the Board shows the list on screen, by its own Status', async () => {
    const { driver } = session;
    await press('[data-list]');
    await driver.waitFor('Work', async () => ((await heading()) === 'Work' ? true : null));
    await goTo('Board');
    await driver.waitFor('the board of Work', async () =>
      (await heading()) === 'Board · Work' ? true : null,
    );
    await inView('article', 'Write the quarterly report');
    await session.screenshot('lists-board');
    await backToTop();
  });

  it('moves a task to another list, and its Status goes with it', async () => {
    const { driver } = session;
    const rent = (await all()).find((item) => item.title === 'Pay the rent');
    await invoke('property_value_set', {
      itemId: rent?.id,
      propertyId: 'tasks.status',
      value: 'doing',
    });
    await goTo('Tasks');
    await press('button[aria-label="Open Pay the rent"]');
    const list = await work();
    await driver.waitFor('the list picker', async () => {
      const select = await driver.find('[role="dialog"] select[id^="list-of-"]');
      await driver.execute(
        'const s = arguments[0]; s.value = arguments[1]; s.dispatchEvent(new Event("change", { bubbles: true }));',
        [{ [ELEMENT]: select.id }, list?.id],
      );
      return true;
    });
    await driver.waitFor('the task moved', async () => {
      const moved = (await all()).find((item) => item.title === 'Pay the rent');
      return moved?.collection_id === list?.id ? true : null;
    });
    const values = await invoke<Array<{ item_id: string; value: unknown }>>(
      'property_values_list',
      { collectionId: list?.id },
    );
    expect(values.find((row) => row.item_id === rent?.id)?.value).toBe('doing');
    await driver.chord(Keys.ESCAPE);
  });

  it('Today reads every list, and says which one a task is in', async () => {
    const report = (await all()).find((item) => item.title === 'Write the quarterly report');
    await invoke('item_set_schedule', {
      id: report?.id,
      schedule: {
        start_at: null,
        due_at: new Date(Date.now() - 3_600_000).toISOString(),
        remind_at: null,
        recurrence_rrule: null,
        recurrence_mode: null,
      },
    });
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    await goTo('Today');
    await session.driver.waitForText('Write the quarterly report');
    await inView('[data-task-list="Work"]');
    await session.screenshot('lists-today');
    await backToTop();
  });

  it('finding a task opens it in its own list', async () => {
    const { driver } = session;
    await goTo('Tasks');
    await (await driver.find('button[aria-label="Search or run a command"]')).click();
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await box.sendKeys('quarterly');
    const hit = await driver.waitFor('the task among the results', async () => {
      for (const option of await driver.findAll('[role="option"]')) {
        if ((await option.text()).includes('Write the quarterly report')) return option;
      }
      return null;
    });
    await hit.click();
    const dialog = await driver.waitForElement('[role="dialog"]');
    expect(await dialog.text()).toContain('Write the quarterly report');
    expect(await heading()).toBe('Work');
    await driver.chord(Keys.ESCAPE);
  });

  it('renames a list', async () => {
    const { driver } = session;
    await pressText('Rename list');
    const field = await driver.waitForElement('input[aria-label="New name of the list"]');
    await field.clear();
    await field.sendKeys(`Office${Keys.ENTER}`);
    await driver.waitFor('the new name', async () =>
      (await heading()) === 'Office' ? true : null,
    );
    expect((await lists()).map((list) => list.name)).toContain('Office');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('will not delete a list that holds tasks, and says what is in the way', async () => {
    const { driver } = session;
    await pressText('Delete list');
    await driver.waitForText('Office still holds 2 tasks. Move or delete them first.');
    expect((await lists()).map((list) => list.name)).toContain('Office');
    expect(await driver.findAll('[role="dialog"]')).toEqual([]);
  });

  it('will not take a name another list has', async () => {
    const { driver } = session;
    await pressText('New list');
    const name = await driver.waitForElement('input[aria-label="Name of the new list"]');
    await name.sendKeys(`office${Keys.ENTER}`);
    await driver.waitForText('There is already a list with that name.');
    expect((await lists()).length).toBe(2);
    await name.sendKeys(Keys.ESCAPE);
  });

  it('deletes an empty list once asked, and goes back to Tasks', async () => {
    for (const item of await all()) await invoke('item_delete', { id: item.id });
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    await goTo('Tasks');
    await press('[data-list]');
    await session.driver.waitFor('Office', async () =>
      (await heading()) === 'Office' ? true : null,
    );
    await pressText('Delete list');
    await pressText('Delete the list');
    await session.driver.waitFor('back on Tasks', async () =>
      (await heading()) === 'Tasks' ? true : null,
    );
    expect((await lists()).map((list) => list.name)).toEqual(['Tasks']);
    expect(await session.driver.findAll('[data-list]')).toEqual([]);
  });
});
