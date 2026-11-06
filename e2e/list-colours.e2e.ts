import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface RawCollection {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Lists that say what they are and wear a colour: the line that makes one explains
 * it, a new list takes a colour of its own, the colour can be changed, an empty list
 * says how to fill it, and Today shows a task's list with its colour.
 */
describe('list colours', () => {
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

  const work = async () =>
    (await invoke<RawCollection[]>('collections_list')).find((list) => list.name === 'Work');

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('the line that makes a list says what a list is', async () => {
    const { driver } = session;
    await pressText('New list');
    await driver.waitForElement('input[aria-label="Name of the new list"]');
    await driver.waitForText('A list keeps one kind of work apart');
    await session.screenshot('list-explained');
  });

  it('a new list wears a colour of its own, in the rail', async () => {
    const { driver } = session;
    const name = await driver.find('input[aria-label="Name of the new list"]');
    await name.sendKeys(`Work${Keys.ENTER}`);
    const list = await driver.waitFor('the colour', async () => {
      const found = await work();
      return found?.color ? found : null;
    });
    await driver.waitForElement(`[data-list="${list.id}"] .rounded-full`);
  });

  it('an empty list says how to fill it', async () => {
    const { driver } = session;
    await driver.waitForText('Work is empty');
    await driver.waitForText('#work on any capture line');
  });

  it('the colour can be changed from the list', async () => {
    const { driver } = session;
    await pressText('Colour');
    await press('[role="radiogroup"][aria-label="Colour of Work"] [aria-label="Purple"]');
    await driver.waitFor('purple', async () => ((await work())?.color === 'purple' ? true : null));
  });

  it('Today shows a task’s list with its colour', async () => {
    const list = await work();
    await invoke('item_create', {
      item: { collection_id: list?.id, title: 'Send the invoice', position: 'V' },
    });
    const item = (
      await invoke<Array<{ id: string; title: string }>>('items_list', {
        collectionId: list?.id,
        includeCompleted: true,
      })
    ).find((one) => one.title === 'Send the invoice');
    await invoke('item_set_schedule', {
      id: item?.id,
      schedule: {
        start_at: null,
        due_at: new Date(Date.now() - 3_600_000).toISOString(),
        remind_at: null,
        recurrence_rrule: null,
        recurrence_mode: null,
      },
    });
    await session.restart();
    const { driver } = session;
    await driver.waitFor('the opening to go', async () =>
      (await driver.findAll('#opening')).length === 0 ? true : null,
    );
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Today"]')).click();
    await driver.waitForElement('[data-task-list="Work"] .rounded-full');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('a colour not on the list is refused', async () => {
    const list = await work();
    await expect(invoke('list_color', { id: list?.id, color: '#00ff00' })).rejects.toThrow();
    expect((await work())?.color).toBe('purple');
  });
});
