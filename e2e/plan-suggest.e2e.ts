import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The suggested plan (ADR-046): open work appears on the calendar by itself, and
 * becomes a reservation only when the person takes it or moves it.
 *
 * On the day view, so the test does not depend on which day the suite runs: a task
 * due "in 2 days" is planned from the next working time, which may be days away,
 * and the plan's own summary is what says how much it laid.
 */
describe('a suggested plan on the calendar', () => {
  let session: Session;

  const press = async (selector: string) => {
    const { driver } = session;
    const control = await driver.waitFor(selector, () => driver.find(selector));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
  };

  const invoke = <T>(command: string, args: Record<string, unknown> = {}) =>
    session.driver.executeAsync<T>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: String(e) }));',
      [command, args],
    );

  /** Move the grid along until the plan has blocks on it. */
  const findBlocks = async (selector: string) => {
    const { driver } = session;
    for (let step = 0; step < 8; step += 1) {
      const found = await driver.findAll(selector);
      if (found.length > 0) return found;
      await press('button[aria-label="Next"]');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`no block on the next eight weeks: ${selector}`);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Plan the launch${Keys.ENTER}`);
    await driver.waitForText('Plan the launch');
    await input.sendKeys(`Book the room${Keys.ENTER}`);
    await driver.waitForText('Book the room');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Calendar"]')).click();
    await driver.waitForElement('[data-testid="plan-summary"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('lays open work on the calendar with nobody asking, and writes nothing', async () => {
    const { driver } = session;
    const found = await findBlocks('[data-suggestion]');
    expect(found.length).toBeGreaterThanOrEqual(2);
    await driver.waitForText('so an hour is assumed');
    await session.screenshot('plan-suggested');

    // Nothing is on the calendar until a person says so.
    expect(await invoke<string[]>('time_blocked_items')).toEqual([]);
  });

  it('accepting one reserves it, and only that one', async () => {
    const { driver } = session;
    await press('button[aria-label="Accept the time for Plan the launch"]');
    await driver.waitFor('the reservation', async () =>
      (await invoke<string[]>('time_blocked_items')).length === 1 ? true : null,
    );
    await driver.waitForElement('article[aria-label^="Plan the launch"]');
    expect(await driver.findAll('[data-suggestion]:not(article)')).not.toHaveLength(0);
  });

  it('leaving one out takes it off the plan, and it can come back', async () => {
    const { driver } = session;
    await press('button[aria-label="Leave Book the room out of the plan"]');
    await driver.waitFor('the suggestion gone', async () =>
      (await driver.findAll('button[aria-label^="Suggested: Book the room"]')).length === 0
        ? true
        : null,
    );
    await press('button[aria-label="Bring Book the room back into the plan"]');
    await driver.waitForElement('button[aria-label^="Suggested: Book the room"]');
  });

  it('moving a suggestion by keyboard reserves it where it was put', async () => {
    const { driver } = session;
    await press('button[aria-label="Move the suggestion for Book the room"]');
    await driver.chord(Keys.ARROW_DOWN);
    await driver.chord(Keys.ENTER);
    await driver.waitFor('both reserved', async () =>
      (await invoke<string[]>('time_blocked_items')).length === 2 ? true : null,
    );
    await driver.waitForText('Everything open already has its time set aside');
  });

  it('hiding the suggestions keeps what was accepted, and the choice is remembered', async () => {
    const { driver } = session;
    const hide = await driver.findByXPath('//button[normalize-space(.)="Hide suggestions"]');
    await hide.click();
    await driver.waitForElement('article[aria-label^="Plan the launch"]');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Today"]')).click();
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Calendar"]')).click();
    await driver.waitFor('the button that brings them back', () =>
      driver.findByXPath('//button[normalize-space(.)="Suggest a plan"]'),
    );
  });

  it('coming back to the calendar still fits the working day and opens on it', async () => {
    const { driver } = session;
    const top = await driver.waitFor('the grid scrolled to the working day', async () => {
      const value = await driver.execute<number>(
        'return document.querySelector(\'[aria-label="Calendar grid"]\').scrollTop',
      );
      return value > 0 ? value : null;
    });
    expect(top).toBeGreaterThan(0);
  });
});
