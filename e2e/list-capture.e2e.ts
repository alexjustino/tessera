import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

interface RawItem {
  id: string;
  title: string;
  collection_id: string;
}

/**
 * Capturing into a list and going to one (ADR-053): `#work` on the capture line
 * sends the task to Work and says so before it is written, a hash that names no list
 * stays in the title, and the palette goes to a list by its name.
 */
describe('capturing into a list', () => {
  let session: Session;
  let workId = '';

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

  const all = () => invoke<RawItem[]>('items_list', { collectionId: null, includeCompleted: true });
  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  const heading = () =>
    session.driver.execute<string>('return document.querySelector("main h1")?.textContent ?? ""');
  const settled = () =>
    session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );

  beforeAll(async () => {
    session = await startSession();
    await settled();
    workId = (await invoke<{ id: string }>('list_create', { name: 'Work', position: 'W' })).id;
    await session.restart();
    await settled();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says a #list was understood before anything is written', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys('Draft the plan #work tomorrow');
    const understood = await driver.waitFor('the chips', async () => {
      const list = await driver.find('ul[aria-label="Understood as"]');
      const text = await list.text();
      return text.includes('Work') ? text : null;
    });
    expect(understood).toContain('In');
    expect((await all()).map((item) => item.title)).not.toContain('Draft the plan');
    await session.screenshot('list-capture');
  });

  it('sends the task to that list, named without the hash', async () => {
    const { driver } = session;
    const input = await driver.find('input[placeholder^="Add a task"]');
    await input.sendKeys(Keys.ENTER);
    const task = await driver.waitFor(
      'the task',
      async () => (await all()).find((item) => item.title === 'Draft the plan') ?? null,
    );
    expect(task.collection_id).toBe(workId);
    // It went to Work, so the inbox on screen does not show it.
    expect(await driver.findAll('button[aria-label="Open Draft the plan"]')).toEqual([]);
  });

  it('the palette goes to a list by its name', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await box.sendKeys('>go to work');
    await driver.waitFor('the list among the commands', async () => {
      const options = await driver.findAll('[role="option"]');
      return options.length > 0 && (await options[0]!.text()).includes('Go to Work') ? true : null;
    });
    await box.sendKeys(Keys.ENTER);
    await driver.waitFor('the list on screen', async () =>
      (await heading()) === 'Work' ? true : null,
    );
    // The row's Open control is shown on hover and focus, so it is found, not waited on screen.
    await driver.waitFor('the row', () => driver.find('button[aria-label="Open Draft the plan"]'));
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('a hash that names no list stays in the title, in the list on screen', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Order part #42${Keys.ENTER}`);
    const task = await driver.waitFor(
      'the task',
      async () => (await all()).find((item) => item.title === 'Order part #42') ?? null,
    );
    expect(task.collection_id).toBe('tasks');
  });

  it('with only Tasks, the line does not mention lists', async () => {
    await invoke('item_delete', {
      id: (await all()).find((item) => item.title === 'Draft the plan')?.id,
    });
    await invoke('list_delete', { id: workId });
    await session.restart();
    await settled();
    await goTo('Tasks');
    await session.driver.waitForText('Dates, times, repeats');
    const hint = await session.driver.execute<string>(
      'return [...document.querySelectorAll("p")].find((p) => p.textContent.startsWith("Dates, times"))?.textContent ?? ""',
    );
    expect(hint).not.toContain('#list');
  });
});
