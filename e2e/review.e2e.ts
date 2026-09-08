import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The weekly review, end to end — the slice's proof of done:
 *
 *   the review shows every project without a next action and every task
 *   waiting on nothing, and finishes with neither.
 *
 * "Finishes" is the half that matters. There is nothing to press to say the
 * review is done: the screen says so when the two lists are empty, and the
 * test gets there by fixing the two gaps rather than by dismissing them.
 */
describe('the weekly review', () => {
  let session: Session;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  const click = async (css: string) => {
    const element = await session.driver.waitFor(css, () => session.driver.find(css));
    await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  const clickXPath = async (xpath: string) => {
    const element = await session.driver.waitFor(xpath, () => session.driver.findByXPath(xpath));
    await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  const rowsOf = (list: 'projects' | 'waiting') =>
    session.driver.findAll(`[data-testid="review-${list}"] li`);

  /** Choose an option in a select by the text a person would read. */
  const choose = async (label: string, option: string) => {
    const select = await session.driver.waitFor(label, () =>
      session.driver.find(`select[aria-label="${label}"]`),
    );
    await session.driver.execute(
      `const select = arguments[0];
       const option = Array.from(select.options).find((o) => o.text === arguments[1]);
       const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
       setter.call(select, option.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: select.id }, option],
    );
  };

  beforeAll(async () => {
    session = await startSession();
    const input = await session.driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Sign the contract', 'Start the build', 'Order the parts']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await session.driver.waitForText(title);
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says nothing is waiting when there is nothing to find', async () => {
    await goTo('Review');
    await session.driver.waitForText('Nothing is waiting on you');
  });

  it('finds a task whose blocker has since been finished', async () => {
    const { driver } = session;
    // "Start the build" waits for "Sign the contract".
    await goTo('Tasks');
    await click('button[aria-label="Open Start the build"]');
    await driver.waitForElement('[role="dialog"]');
    await choose('Wait for another task', 'Sign the contract');
    await clickXPath('//*[@role="dialog"]//button[normalize-space(.)="Add"]');
    await driver.waitForText('Waiting for');
    await driver.chord(Keys.ESCAPE);

    // Nothing is free yet: it is waiting for something unfinished.
    await goTo('Review');
    expect(await rowsOf('waiting')).toHaveLength(0);

    // Finishing the blocker frees it, and nothing else announces that.
    await goTo('Tasks');
    await click('input[aria-label="Complete Sign the contract"]');
    await goTo('Review');
    const waiting = await session.driver.waitFor('the freed task', async () => {
      const found = await rowsOf('waiting');
      return found.length === 1 ? found : null;
    });
    expect(await waiting[0]!.text()).toContain('Start the build');
    expect(await waiting[0]!.text()).toContain('was waiting for Sign the contract');
    await session.screenshot('review-gaps');
  });

  it('finds a goal with nothing to pick up next', async () => {
    await goTo('Goals');
    await clickXPath('//button[normalize-space(.)="New goal"]');
    await session.driver.waitForText('New goal');

    await goTo('Review');
    const projects = await session.driver.waitFor('the goal with no next action', async () => {
      const found = await rowsOf('projects');
      return found.length === 1 ? found : null;
    });
    expect(await projects[0]!.text()).toContain('New goal');
    expect(await projects[0]!.text()).toContain('Nothing is in it yet');
  });

  it('finishes with neither, once both are dealt with', async () => {
    const { driver } = session;

    // The goal gets something to pick up.
    await goTo('Goals');
    await choose('Add a task to this goal', 'Order the parts');
    await clickXPath('//button[normalize-space(.)="Add"]');
    await driver.waitFor('the task in the goal', async () => {
      const found = await driver.findAll('button[aria-label^="Take Order the parts out of"]');
      return found.length === 1 ? true : null;
    });

    // And the freed task is picked up: given a day on the calendar.
    await goTo('Tasks');
    await click('button[aria-label="Open Start the build"]');
    await driver.waitForElement('[role="dialog"]');
    const due = await driver.waitFor('the due field', () =>
      driver.findByXPath('//*[@role="dialog"]//input[@aria-label="Due date and time"]'),
    );
    await driver.execute(
      `const field = arguments[0];
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(field, '2026-12-31T09:00');
       field.dispatchEvent(new Event('input', { bubbles: true }));
       field.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: due.id }],
    );
    await driver.chord(Keys.ESCAPE);

    await goTo('Review');
    await driver.waitForText('Nothing is waiting on you');
    expect(await rowsOf('projects')).toHaveLength(0);
    expect(await rowsOf('waiting')).toHaveLength(0);
    await session.screenshot('review-finished');
  });

  it('the working week can be said, and the review counts it', async () => {
    const { driver } = session;
    await goTo('Settings');
    await driver.waitForText('Working hours');

    // Saturday off by default; turning it on adds a day of capacity.
    const before = await driver.findAll('input[aria-label="Saturday starts"]');
    expect(before).toHaveLength(0);

    await click('input[aria-label="Saturday"]');
    await clickXPath('//button[normalize-space(.)="Save working hours"]');
    await driver.waitFor('Saturday saved', async () => {
      const found = await driver.findAll('input[aria-label="Saturday starts"]');
      return found.length === 1 ? true : null;
    });

    await goTo('Review');
    await driver.waitForText('of working time left this week');
  });
});
