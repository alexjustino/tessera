import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * The Mosaic with real work in it: a task nobody has sized yet says so, a size
 * puts it on the week, and the tiles can be pressed.
 */
describe('using the mosaic', () => {
  let session: Session;

  const committed = () => session.driver.findAll('[role="gridcell"] [data-state="committed"]');

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Size me${Keys.ENTER}`);
    await driver.waitForText('Size me');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Mosaic"]')).click();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says which tasks it cannot count, and a size puts one on the week', async () => {
    const { driver } = session;
    await driver.waitForElement('[data-testid="fill-the-week"]');
    await driver.waitForText('1 task has no estimate yet');
    expect((await committed()).length).toBe(0);
    await session.screenshot('mosaic-fill');

    await (await driver.find('button[aria-label="Size me takes 1h"]')).click();
    await driver.waitFor('the card gone', async () =>
      (await driver.findAll('[data-testid="fill-the-week"]')).length === 0 ? true : null,
    );
    // Late on the last working day the work lands on next week, which is right.
    await driver.waitFor('a committed tile', async () => {
      if ((await committed()).length > 0) return true;
      await (await driver.find('button[aria-label="The week after"]')).click();
      return (await committed()).length > 0 ? true : null;
    });
  });

  it('opens the task from its tile', async () => {
    const { driver } = session;
    const [tile] = await committed();
    await tile?.click();
    await driver.waitForElement('[role="dialog"] input[aria-label="Task name"]');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  });

  it('sets a free hour aside for a task', async () => {
    const { driver } = session;
    const before = (await driver.findAll('[role="gridcell"] [data-state="reserved"]')).length;
    const free = await driver.find('[role="gridcell"][aria-label*=": Free"]');
    await free.click();
    await driver.waitForElement('[role="dialog"]');
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Size me"]')
    ).click();
    await driver.waitFor('a reserved tile', async () =>
      (await driver.findAll('[role="gridcell"] [data-state="reserved"]')).length > before
        ? true
        : null,
    );
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('leaves a tile that has gone alone', async () => {
    const { driver } = session;
    await (await driver.find('button[aria-label="The week before"]')).click();
    await (await driver.find('button[aria-label="The week before"]')).click();
    const gone = await driver.find('[role="gridcell"]');
    await gone.click();
    expect((await driver.findAll('[role="dialog"]')).length).toBe(0);
  });
});
