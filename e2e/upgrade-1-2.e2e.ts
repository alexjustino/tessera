import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The 1.3 release's proof of done: a 1.2 workspace opens in 1.3, migrated,
 * without loss — and what 1.3 added works on the rows 1.2 wrote.
 *
 * `fixtures/workspace-1.2.0.sqlite3` (built by `make_1_2.py`) is a workspace at
 * schema 16 — the sixteen migrations 1.2.0 shipped — holding estimated tasks
 * with a dependency and a finished one, tracked time, a recurring stand-up, a
 * page and a goal. 1.3 adds migrations 017 (days off) and 018 (envelopes).
 */
describe('a 1.2 workspace in 1.3', () => {
  let session: Session;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-1.2.0.sqlite3'),
    });
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens, and every task 1.2 wrote is still there, the finished one finished', async () => {
    const { driver } = session;
    await driver.waitForText('Plan the launch');
    await driver.waitForText('Write the notes');
    await driver.waitForText('Book the room');
    const done = await driver.waitFor('the finished row', () =>
      driver.find('input[aria-label="Complete Book the room"]'),
    );
    expect(await done.property('checked')).toBe(true);
  });

  it('is migrated to the current schema, and Diagnostics says so', async () => {
    await goTo('Diagnostics');
    await session.driver.waitForText('up to date');
  });

  it('the page 1.2 wrote is still there with its text', async () => {
    const { driver } = session;
    await goTo('Notes');
    await driver.waitForText('Everything 1.2 wrote.');
  });

  it('the goal 1.2 wrote gets a forecast, and an envelope can be given to it', async () => {
    const { driver } = session;
    await goTo('Goals');
    await driver.waitForText('Launch');
    await driver.waitFor('the goal forecast', () => driver.find('[data-testid="forecast"]'));

    await (await driver.findByXPath('//summary[normalize-space(.)="More details"]')).click();
    const hours = await driver.waitFor('the hours field', () =>
      driver.find('input[aria-label="Hours each week"]'),
    );
    await driver.execute(
      `const f = arguments[0];
       f.focus();
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, '5');
       f.dispatchEvent(new Event('input', { bubbles: true }));
       f.blur();`,
      [{ [ELEMENT]: hours.id }],
    );
    await goTo('Mosaic');
    await driver.waitFor('the envelope in the Mosaic', () => driver.find('[data-envelope]'));
  });

  it('the Mosaic lays the week, and a day off can be added on top of 1.2 rows', async () => {
    const { driver } = session;
    await driver.waitForElement('[data-testid="mosaic-summary"]');
    await goTo('Settings');
    await driver.waitForText('Days off');
    const field = await driver.waitForElement('input[aria-label="Day off"]');
    await driver.execute(
      `const f = arguments[0];
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, '2027-12-24');
       f.dispatchEvent(new Event('input', { bubbles: true }));
       f.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: field.id }],
    );
    await (await driver.findByXPath('//button[normalize-space(.)="Add day off"]')).click();
    await driver.waitFor('the day off listed', () => driver.find('[data-day-off="2027-12-24"]'));
    await session.screenshot('upgrade-1-2');
  });
});
