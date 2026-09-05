import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Time tracking, end to end.
 *
 * The proof this slice exists for is here and cannot be anywhere else: a
 * running timer survives closing the application, because it was never held in
 * memory — it is a row with no end yet. Everything else about the arithmetic is
 * proved by `domain/time`, in a unit test that can name a day in November.
 */
describe('time tracking', () => {
  let session: Session;

  const openDetail = async (title: string) => {
    const { driver } = session;
    const open = await driver.waitFor(`the Open control for ${title}`, () =>
      driver.find(`button[aria-label="Open ${title}"]`),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
  };

  const closeDetail = async () => {
    const { driver } = session;
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  };

  const press = async (label: string) => {
    const { driver } = session;
    const button = await driver.findByXPath(
      `//*[@role="dialog"]//button[normalize-space(.)="${label}"]`,
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: button.id }]);
  };

  /** Is the row for this task wearing the running-clock chip? */
  const rowIsTiming = async (title: string): Promise<boolean> => {
    const { driver } = session;
    return driver.execute<boolean>(
      `const rows = Array.from(document.querySelectorAll('li'));
       const row = rows.find((li) => li.querySelector('button[aria-label="Open ' + arguments[0] + '"]'));
       return row !== undefined && row.textContent.includes('Timing');`,
      [title],
    );
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Draft the report', 'Review the draft']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
  });

  // A test that fails partway leaves its drawer over the next test's controls.
  beforeEach(async () => {
    const { driver } = session;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await driver.findAll('[role="dialog"]')).length === 0) break;
      await driver.chord(Keys.ESCAPE);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('starts a clock on a task, and says so on the row', async () => {
    const { driver } = session;
    await openDetail('Draft the report');
    await driver.waitForText('Nothing tracked yet');

    await press('Start timer');
    await driver.waitForText('Stop');
    await closeDetail();

    await driver.waitFor('the row says it is being timed', async () =>
      (await rowIsTiming('Draft the report')) ? true : null,
    );
    expect(await rowIsTiming('Review the draft')).toBe(false);
  });

  it('warns which task it would interrupt, and then interrupts it', async () => {
    const { driver } = session;
    await openDetail('Review the draft');

    // Named before the button is pressed, not explained after.
    await driver.waitForText('Draft the report');
    await driver.waitForText('Starting here stops it.');

    await press('Start timer');
    await driver.waitForText('Stop');
    await closeDetail();

    await driver.waitFor('the chip moved to the other task', async () =>
      (await rowIsTiming('Review the draft')) && !(await rowIsTiming('Draft the report'))
        ? true
        : null,
    );
  });

  it('the running clock survives closing the application', async () => {
    await session.restart();
    const { driver } = session;

    // Nothing was written down at shutdown and nothing is restored at start:
    // the row with no end is the timer, so it is simply still running.
    await driver.waitFor('still timing after a restart', async () =>
      (await rowIsTiming('Review the draft')) ? true : null,
    );

    await openDetail('Review the draft');
    await driver.waitForText('Stop');

    // The clock is counting from when it started, not from the restart.
    const clock = await driver.findByXPath('//*[@role="dialog"]//span[contains(text(), ":")]');
    const first = await clock.text();
    await driver.waitFor('the clock advances', async () =>
      (await clock.text()) !== first ? true : null,
    );
    await driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: clock.id },
    ]);
    await session.screenshot('time-running-after-restart');
    await closeDetail();
  });

  it('stops, and keeps what it measured', async () => {
    const { driver } = session;
    await openDetail('Review the draft');
    await press('Stop');

    await driver.waitForText('Start timer');
    await driver.waitForGone('Stop');
    await closeDetail();

    await driver.waitFor('no row is being timed', async () =>
      !(await rowIsTiming('Review the draft')) ? true : null,
    );

    // The entry it left behind is listed, and its removal empties the section.
    await openDetail('Review the draft');
    const remove = await driver.waitFor('the entry it recorded', () =>
      driver.find('button[aria-label^="Remove the entry from"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: remove.id }]);
    await driver.waitForText('Nothing tracked yet');
    await closeDetail();
  });
});
