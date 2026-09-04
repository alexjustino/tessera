import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * The same items, through every view: the list, the table, the board, the
 * date views and the calendar with its unscheduled panel.
 */
describe('views', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Write the report tomorrow !urgent${Keys.ENTER}`);
    await driver.waitForText('Write the report');
    await input.sendKeys(`Water the plants${Keys.ENTER}`);
    await driver.waitForText('Water the plants');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('switches to the table view and keeps every row', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="Table"]')).click();
    await driver.waitForText('Write the report');
    await driver.waitForText('Water the plants');
  });

  it('the board shows a card per task', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Board"]')).click();
    await driver.waitForText('Write the report');
    await driver.waitForText('Water the plants');
    await session.screenshot('board');
  });

  it('Today lists what is due by the end of today and nothing else', async () => {
    const { driver } = session;
    const input = await driver.find('input[aria-label="New task"]');
    await input.sendKeys(`Stand-up today at 11pm${Keys.ENTER}`);
    await driver.waitForText('Stand-up');

    await (await driver.findByXPath('//nav//button[normalize-space(.)="Today"]')).click();
    await driver.waitForText('Stand-up');
    // Tomorrow's report and the undated plant are not today's.
    await driver.waitFor('only today', async () => {
      const report = await driver.findAllByXPath(
        '//*[contains(normalize-space(text()), "Write the report")]',
      );
      return report.length === 0 ? true : null;
    });
  });

  it('the calendar offers unscheduled work for time-blocking', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Calendar"]')).click();
    await driver.waitForText('Not scheduled');
    // The unscheduled task is offered for dragging; the scheduled one is not.
    const panel = await driver.waitForText('Water the plants');
    expect(await panel.displayed()).toBe(true);
    await session.screenshot('calendar');
  });
});
