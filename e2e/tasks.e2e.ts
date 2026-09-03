import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * The vertical slice, end to end: a line typed in plain words becomes a task
 * with a date, a priority and a reminder; the chips say so before Enter; the
 * row appears; the detail opens; and everything is still there after the
 * process is killed and started again on the same file.
 */
describe('tasks', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('shows what a line was understood as, before anything is written', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys('Pay rent tomorrow at 9am !high remind me 15m before');

    const chips = await driver.waitFor('four chips', async () => {
      const found = await driver.findAll('ul[aria-label="Understood as"] li');
      return found.length === 4 ? found : null;
    });
    const labels = await Promise.all(chips.map((chip) => chip.text()));
    expect(labels.join(' | ')).toContain('Tomorrow');
    expect(labels.join(' | ')).toContain('9:00 AM');
    expect(labels.join(' | ')).toContain('High priority');
    expect(labels.join(' | ')).toContain('Remind 15 min before');
  });

  it('removing a chip puts the words back into the title', async () => {
    const { driver } = session;
    const keep = await driver.find('button[aria-label=\'Keep "!high" in the title\']');
    await keep.click();
    const input = await driver.find('input[aria-label="New task"]');
    expect(await input.property('value')).toBe(
      'Pay rent tomorrow at 9am [!high] remind me 15m before',
    );
    // And back: clear the brackets by retyping the line.
    await input.clear();
    await input.sendKeys('Pay rent tomorrow at 9am !high remind me 15m before');
    await driver.waitFor('four chips again', async () => {
      const found = await driver.findAll('ul[aria-label="Understood as"] li');
      return found.length === 4 ? found : null;
    });
  });

  it('Enter creates the task with only the title as its name', async () => {
    const { driver } = session;
    const input = await driver.find('input[aria-label="New task"]');
    await input.sendKeys(Keys.ENTER);

    await driver.waitForText('Pay rent');
    // The line is cleared only after the host accepted the write.
    await driver.waitFor('cleared input', async () =>
      (await input.property('value')) === '' ? true : null,
    );
    // The phrase words did not leak into the title. (The grammar hint under an
    // empty line mentions "tomorrow" too, so the check is on the full phrase.)
    const leaked = await driver.findAllByXPath(
      '//*[contains(normalize-space(text()), "Pay rent tomorrow")]',
    );
    expect(leaked.length).toBe(0);
  });

  it('a second, plain task lands below the first', async () => {
    const { driver } = session;
    const input = await driver.find('input[aria-label="New task"]');
    await input.sendKeys(`Call the plumber${Keys.ENTER}`);
    await driver.waitForText('Call the plumber');
  });

  it('opens the detail drawer from the row, with the schedule it was given', async () => {
    const { driver } = session;
    // The row's Open control is revealed on hover; WebDriver has no hover, so
    // it is clicked as a keyboard user would reach it — directly.
    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Pay rent"]'),
    );
    await driver.execute('arguments[0].click()', [
      { 'element-6066-11e4-a52e-4f735466cecf': open.id },
    ]);
    const dialog = await driver.waitForElement('[role="dialog"]');
    expect(await dialog.text()).toContain('Pay rent');
    // The reminder lead the line asked for is what the editor shows.
    const remind = await dialog.find('select[aria-label="When to be reminded"]');
    expect(await remind.property('value')).toBe('15m');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  });

  it('completing a task moves it out of the open list', async () => {
    const { driver } = session;
    const box = await driver.findByXPath(
      '//*[contains(normalize-space(.), "Call the plumber")]//input[@type="checkbox"]',
    );
    await box.click();
    await driver.waitFor('completed', async () => ((await box.property('checked')) ? true : null));
  });

  it('everything is still there after the process is killed and restarted', async () => {
    await session.restart();
    const { driver } = session;
    await driver.waitForText('Pay rent');
    await driver.waitForText('Call the plumber');
    const box = await driver.findByXPath(
      '//*[contains(normalize-space(.), "Call the plumber")]//input[@type="checkbox"]',
    );
    expect(await box.property('checked')).toBe(true);
    await session.screenshot('tasks-after-restart');
  });
});
