import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * A task and the notes about it, from either side: start a page from the task,
 * find the task on the page, and the pair outlives a restart.
 */
describe('a task and its notes', () => {
  let session: Session;

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();

  const openTask = async () => {
    const { driver } = session;
    const control = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Nozomi"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
    await driver.waitForElement('[data-testid="linked-notes"]');
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Nozomi${Keys.ENTER}`);
    await driver.waitForText('Nozomi');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens a task by pressing its name', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Nozomi"]')).click();
    await driver.waitForElement('[data-testid="linked-notes"]');
    await session.screenshot('task-notes');
  });

  it('writes notes on the task itself, with the formatting bar', async () => {
    const { driver } = session;
    await driver.waitForElement('[role="dialog"] [data-testid="editor-toolbar"]');
    await driver.waitForElement('[role="dialog"] .tessera-prose');
  });

  it('starts a page from the task, and lands on it', async () => {
    const { driver } = session;
    await (
      await driver.findByXPath('//button[normalize-space(.)="New page for this task"]')
    ).click();
    await driver.waitForElement('[data-testid="linked-tasks"]');
    await driver.waitForElement('button[aria-label="Open the task Nozomi"]');
    await session.screenshot('page-with-task');
  });

  it('goes back to the task from the page', async () => {
    const { driver } = session;
    await (await driver.find('button[aria-label="Open the task Nozomi"]')).click();
    await driver.waitForElement('button[aria-label="Open the page Nozomi"]');
  });

  it('keeps the pair through a restart', async () => {
    await session.restart();
    await openTask();
    await session.driver.waitForElement('button[aria-label="Open the page Nozomi"]');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('parts them without taking either away', async () => {
    const { driver } = session;
    await (await driver.find('button[aria-label="Take Nozomi off this task"]')).click();
    await driver.waitFor('the pair gone', async () =>
      (await driver.findAll('button[aria-label="Open the page Nozomi"]')).length === 0
        ? true
        : null,
    );
    await driver.chord(Keys.ESCAPE);
    await goTo('Notes');
    await driver.waitForElement('[data-testid="linked-tasks"]');
    expect(await driver.findAll('button[aria-label="Open the task Nozomi"]')).toHaveLength(0);
  });
});
