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

  it('the task says which note is applied to it, on its row and on its card', async () => {
    const { driver } = session;
    await driver.chord(Keys.ESCAPE);
    const chip = await driver.waitFor('the note on the row', () =>
      driver.find('button[aria-label="Open the note Nozomi"]'),
    );
    expect(await chip.text()).toContain('Nozomi');
    await session.screenshot('task-row-note');
    await goTo('Board');
    await driver.waitFor('the note on the card', () =>
      driver.find('button[aria-label="Open the note Nozomi"]'),
    );
    await goTo('Tasks');
  });

  it('pressing it goes to the note, which says what it is applied to', async () => {
    const { driver } = session;
    // Pressed inside the wait: pressing Tasks from Tasks replaces the screen.
    await driver.waitFor('the note pressed', async () => {
      await (await driver.find('button[aria-label="Open the note Nozomi"]')).click();
      return true;
    });
    await driver.waitForElement('button[aria-label="Open the task Nozomi"]');
    const applied = await driver.find('[data-testid="linked-tasks"]');
    expect(await applied.text()).toContain('Applied to');
    await driver.waitForElement('[data-page-applied="1"]');
    await session.screenshot('note-applied');
  });

  it('a note is applied to another task from under its name', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Dragos${Keys.ENTER}`);
    await driver.waitForText('Dragos');
    await goTo('Notes');
    await (
      await driver.waitFor('the Apply button', () =>
        driver.findByXPath('//button[normalize-space(.)="Apply to a task"]'),
      )
    ).click();
    const find = await driver.waitForElement('input[aria-label="Find a task"]');
    await find.sendKeys('drag');
    await (
      await driver.waitFor('the task in the picker', () =>
        driver.findByXPath('//ul[@aria-label="Open tasks"]//button[contains(., "Dragos")]'),
      )
    ).click();
    await driver.waitForElement('button[aria-label="Open the task Dragos"]');
    await driver.waitForElement('[data-page-applied="2"]');
    await goTo('Tasks');
    await driver.waitFor('the note on the new task too', async () =>
      (await driver.findAll('[data-task-note]')).length === 2 ? true : null,
    );
    await goTo('Notes');
    await (
      await driver.waitFor('the way to take it off', () =>
        driver.find('button[aria-label="Take Dragos off this page"]'),
      )
    ).click();
    await driver.waitFor('it taken off', async () =>
      (await driver.findAll('button[aria-label="Open the task Dragos"]')).length === 0
        ? true
        : null,
    );
    await goTo('Tasks');
    await openTask();
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
