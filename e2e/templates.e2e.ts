import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Templates, end to end — the slice's proof of done in the real product: a
 * template with dependencies keeps them, with the dates rebased.
 *
 * Two dated tasks, one waiting for the other, are saved as a template and
 * deleted. The template is applied a month later. The tasks are back, the
 * second still waits for the first, and its due date moved by a month.
 */
describe('templates', () => {
  let session: Session;

  const click = async (css: string) => {
    const { driver } = session;
    const element = await driver.waitFor(`${css} to appear`, () => driver.find(css));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
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

  /** Choose a blocker in the detail panel's picker and add it. */
  const waitFor = async (blockerTitle: string) => {
    const { driver } = session;
    const select = await driver.waitForElement('select[aria-label="Wait for another task"]');
    const option = await driver.findByXPath(
      `//select[@aria-label="Wait for another task"]/option[normalize-space(.)="${blockerTitle}"]`,
    );
    const value = await option.attribute('value');
    await driver.execute(
      'const s = arguments[0]; s.value = arguments[1]; s.dispatchEvent(new Event("change", { bubbles: true }));',
      [{ [ELEMENT]: select.id }, value],
    );
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Add"]')
    ).click();
  };

  /** Set a controlled input's value the way React notices. */
  const setValue = async (css: string, value: string) => {
    const { driver } = session;
    const input = await driver.waitForElement(css);
    await driver.execute(
      `const el = arguments[0];
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(el, arguments[1]);
       el.dispatchEvent(new Event('input', { bubbles: true }));`,
      [{ [ELEMENT]: input.id }, value],
    );
  };

  /** The due date shown in a task's detail, as the control holds it (`YYYY-MM-DDTHH:MM`). */
  const dueOf = async (title: string): Promise<string> => {
    const { driver } = session;
    await openDetail(title);
    const due = await driver.waitForElement('input[aria-label="Due date and time"]');
    const value = (await due.property('value')) as string;
    await closeDialogs();
    return value;
  };

  const localDay = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  let originalDue = '';

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    // The capture grammar gives them dates: tomorrow, and three days out.
    await input.sendKeys(`Design it tomorrow at 9am${Keys.ENTER}`);
    await driver.waitForText('Design it');
    await input.sendKeys(`Build it in 3 days${Keys.ENTER}`);
    await driver.waitForText('Build it');

    await openDetail('Build it');
    await waitFor('Design it');
    await driver.waitForText('Design it');
    await closeDialogs();
    originalDue = await dueOf('Build it');
    expect(originalDue).not.toBe('');
  });

  beforeEach(closeDialogs);

  afterAll(async () => {
    await session?.stop();
  });

  it('saves what the view shows as a template, and says what it holds', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Templates"]')).click();
    await driver.waitForText('Save what is shown');

    const preview = await driver.waitForElement('[data-testid="template-preview"]');
    expect(await preview.text()).toContain('2 tasks · 1 dependency');

    const nameField = await driver.waitForElement('input[aria-label="Template name"]');
    await nameField.sendKeys('Launch');
    await (await driver.findByXPath('//button[normalize-space(.)="Save as template"]')).click();

    const saved = await driver.waitForElement('[data-testid="template"]');
    expect(await saved.text()).toContain('Launch');
    expect(await saved.text()).toContain('2 tasks · 1 dependency');
  });

  it('makes the tasks again on another day, links kept and dates rebased', async () => {
    const { driver } = session;
    // Remove the originals so the only Design it and Build it are the new ones.
    for (const title of ['Build it', 'Design it']) {
      await click(`button[aria-label="Delete ${title}"]`);
      await driver.waitFor(`${title} gone`, async () =>
        (await driver.findAll(`button[aria-label="Open ${title}"]`)).length === 0 ? true : null,
      );
    }

    await (await driver.findByXPath('//button[normalize-space(.)="Templates"]')).click();
    await driver.waitForText('Make tasks from');

    // A month from tomorrow — the template's anchor is Design it, tomorrow.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const later = new Date(tomorrow);
    later.setDate(later.getDate() + 30);
    await setValue('input[aria-label="Starting on"]', localDay(later));
    await click('button[aria-label="Make tasks from Launch"]');

    await driver.waitFor('the dialog closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
    await driver.waitForText('Design it');
    await driver.waitForText('Build it');

    // The dependency came with it: Build it is waiting again.
    await driver.waitFor('Build it waits', async () => {
      const waiting = await driver.execute<boolean>(
        `const rows = Array.from(document.querySelectorAll('li'));
         const row = rows.find((li) => li.querySelector('button[aria-label="Open Build it"]'));
         return row !== undefined && row.textContent.includes('Waiting');`,
      );
      return waiting ? true : null;
    });

    // And the dates moved by exactly thirty days, keeping the time of day.
    const rebased = await dueOf('Build it');
    const [originalDay, originalTime] = originalDue.split('T');
    const [rebasedDay, rebasedTime] = rebased.split('T');
    expect(rebasedTime).toBe(originalTime);
    const shifted = new Date(`${originalDay}T00:00`);
    shifted.setDate(shifted.getDate() + 30);
    expect(rebasedDay).toBe(localDay(shifted));
    await session.screenshot('templates');
  });

  it('the template and what it made survive a restart', async () => {
    await session.restart();
    const { driver } = session;
    await driver.waitForText('Build it');
    await (await driver.findByXPath('//button[normalize-space(.)="Templates"]')).click();
    const kept = await driver.waitForElement('[data-testid="template"]');
    expect(await kept.text()).toContain('Launch');
  });

  it('a template can be deleted, and what it made stays', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Templates"]')).click();
    await click('button[aria-label="Delete the template Launch"]');
    await driver.waitForText('No templates yet');
    await closeDialogs();
    await driver.waitForText('Build it');
  });
});
