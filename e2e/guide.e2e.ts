import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * The first thing a new workspace asks. It says so where a person lands, marks
 * Settings in the rail until the two answers only they can give are in, and an
 * answer outlives a restart.
 */
describe('getting started', () => {
  let session: Session;

  const button = (name: string, driver = session.driver) =>
    driver.findByXPath(`//button[normalize-space(.)="${name}"]`);

  const settingsAsk = (driver = session.driver) =>
    driver.execute<string | null>(
      `const entry = [...document.querySelectorAll('nav button')]
         .find((candidate) => candidate.textContent.trim() === 'Settings');
       return entry.getAttribute('aria-description');`,
    );

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitForElement('nav[aria-label="Main"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('asks a new workspace for its working hours, and marks Settings in the rail', async () => {
    const { driver } = session;
    await driver.waitForElement('[data-testid="getting-started"]');
    await driver.waitForText('Say when you work');
    await driver.waitForText('4 of 4 left');
    await driver.waitFor('the mark on Settings', async () =>
      ((await settingsAsk()) ?? '').includes('working hours') ? true : null,
    );
    await session.screenshot('guide');
  });

  it('takes an answer from the guide, and moves the question on', async () => {
    const { driver } = session;
    await (await button('My hours are already right')).click();
    await driver.waitForText('3 of 4 left');
    await driver.waitFor('the mark moved on', async () =>
      ((await settingsAsk()) ?? '').includes('days off') ? true : null,
    );
  });

  it('points at the card in Settings, and the card answers it', async () => {
    const { driver } = session;
    await (await button('Add days off')).click();
    await driver.waitForText('Holidays and leave.');
    const day = await driver.waitForElement('input[aria-label="Day off"], input[type="date"]');
    await driver.execute(
      `const input = arguments[0];
       const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       set.call(input, '2027-01-01');
       input.dispatchEvent(new Event('input', { bubbles: true }));`,
      [{ 'element-6066-11e4-a52e-4f735466cecf': day.id }],
    );
    await (await button('Add day off')).click();
    await driver.waitFor('no more questions', async () =>
      (await settingsAsk()) === null ? true : null,
    );
  });

  it('remembers the answers through a restart', async () => {
    await session.restart();
    const { driver } = session;
    await driver.waitForElement('[data-testid="getting-started"]');
    await driver.waitForText('2 of 4 left');
    expect(await settingsAsk(driver)).toBeNull();
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('stays away once hidden, with steps still left', async () => {
    const { driver } = session;
    await (await button('Hide this guide')).click();
    await driver.waitFor('the guide gone', async () =>
      (await driver.findAll('[data-testid="getting-started"]')).length === 0 ? true : null,
    );
    await session.restart();
    await session.driver.waitForElement('nav[aria-label="Main"]');
    await session.driver.waitForElement('input[placeholder^="Add a task"]');
    expect((await session.driver.findAll('[data-testid="getting-started"]')).length).toBe(0);
  });
});
