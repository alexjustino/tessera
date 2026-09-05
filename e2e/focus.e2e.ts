import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Focus mode, end to end — the slice's proof of done: one task, its timer,
 * and nothing else on the screen. The navigation rail is gone while it is
 * up, the clock runs on the task shown, Done moves to the next task that is
 * ready, and Escape is the way out.
 */
describe('focus mode', () => {
  let session: Session;

  const openDetail = async (title: string) => {
    const { driver } = session;
    const open = await driver.waitFor(`the Open control for ${title}`, () =>
      driver.find(`button[aria-label="Open ${title}"]`),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
  };

  const railIsShown = async () =>
    (await session.driver.findAll('nav[aria-label="Main"]')).length > 0;

  const focusedTitle = async () =>
    (await session.driver.waitForElement('[data-testid="focus-title"]')).text();

  const press = async (label: string) => {
    const { driver } = session;
    const button = await driver.findByXPath(
      `//*[@data-testid="focus-screen"]//button[normalize-space(.)="${label}"]`,
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: button.id }]);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Draft the plan', 'Review the plan']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('shows one task and nothing else, entered from the task itself', async () => {
    const { driver } = session;
    expect(await railIsShown()).toBe(true);

    await openDetail('Review the plan');
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Focus on this"]')
    ).click();

    await driver.waitForElement('[data-testid="focus-screen"]');
    expect(await focusedTitle()).toBe('Review the plan');
    expect(await railIsShown()).toBe(false);
    // The list is gone too: no row controls anywhere.
    expect((await driver.findAll('button[aria-label^="Open "]')).length).toBe(0);
  });

  it('runs the clock on the task shown', async () => {
    const { driver } = session;
    await press('Start');
    await driver.waitForText('Stop');
    const clock = await driver.waitForElement('[data-testid="focus-clock"]');
    const first = await clock.text();
    await driver.waitFor('the clock advances', async () =>
      (await clock.text()) !== first ? true : null,
    );
    await session.screenshot('focus');
  });

  it('Done moves on to the next task that is ready, and the clock does not follow', async () => {
    const { driver } = session;
    await press('Done');
    await driver.waitFor('the next task is shown', async () =>
      (await focusedTitle()) === 'Draft the plan' ? true : null,
    );
    // A finished task is not being timed; the new one is not started for you.
    await driver.waitForText('Start');
    expect((await driver.findAll('[data-testid="focus-clock"]')).length).toBe(1);
  });

  it('Escape leaves, and the world is where it was', async () => {
    const { driver } = session;
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the rail is back', async () => ((await railIsShown()) ? true : null));
    await driver.waitForText('Draft the plan');
    // Review the plan was completed from focus: its row is ticked. The input
    // is visually hidden by design, so it is found, not waited for on screen.
    const done = await driver.waitFor('the ticked row', () =>
      driver.find('input[aria-label="Complete Review the plan"]'),
    );
    expect(await done.property('checked')).toBe(true);
  });

  it('can be entered from the palette, which picks what is ready', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const search = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await search.sendKeys('focus');
    await driver.waitForText('Focus on one task');
    await driver.chord(Keys.ENTER);

    await driver.waitForElement('[data-testid="focus-screen"]');
    expect(await focusedTitle()).toBe('Draft the plan');
    await press('Leave focus');
    await driver.waitFor('the rail is back', async () => ((await railIsShown()) ? true : null));
  });

  it('says so when nothing is ready to start', async () => {
    const { driver } = session;
    // Finish the last open task from the list, then ask for focus.
    const checkbox = await driver.waitFor('the checkbox', () =>
      driver.find('input[aria-label="Complete Draft the plan"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: checkbox.id }]);
    await driver.waitFor('the task is done', async () =>
      (await checkbox.property('checked')) === true ? true : null,
    );

    await driver.chord(Keys.CONTROL, 'k');
    const search = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await search.sendKeys('focus');
    await driver.waitForText('Focus on one task');
    await driver.chord(Keys.ENTER);

    await driver.waitForText('Nothing is ready to start');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the rail is back', async () => ((await railIsShown()) ? true : null));
  });
});
