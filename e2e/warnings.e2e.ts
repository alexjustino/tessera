import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * As many warnings as a deadline deserves, like the alarms on a clock. They
 * survive a restart, move with the due time, and one really goes off.
 */
describe('warnings before a task is due', () => {
  let session: Session;

  const setInput = async (selector: string, value: string) => {
    const { driver } = session;
    const field = await driver.waitForElement(selector);
    await driver.execute(
      `const field = arguments[0];
       const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       set.call(field, arguments[1]);
       field.dispatchEvent(new Event('input', { bubbles: true }));
       field.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: field.id }, value],
    );
  };

  const local = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  };

  const inDays = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(10, 0, 0, 0);
    return date;
  };

  const rows = () => session.driver.findAll('ul[aria-label="Warnings"] li');

  const press = async (name: string) =>
    (
      await session.driver.findByXPath(
        `//*[@data-testid="warnings"]//button[normalize-space(.)="${name}"]`,
      )
    ).click();

  // By script, as the other suites do: the control only shows with the pointer over it.
  const open = async () => {
    const { driver } = session;
    const control = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Ship the report"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
    await driver.waitForElement('[role="dialog"]');
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Ship the report${Keys.ENTER}`);
    await driver.waitForText('Ship the report');
    await open();
  });

  afterAll(async () => {
    await session?.stop();
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('asks for a due time first', async () => {
    await session.driver.waitForText('Give it a due time');
  });

  it('takes several, from the presets and at a chosen time', async () => {
    const { driver } = session;
    await setInput('input[aria-label="Due date and time"]', local(inDays(10)));
    await driver.waitForElement('[data-testid="warnings"]');

    await press('1 week before');
    await driver.waitFor('the first', async () => ((await rows()).length === 1 ? true : null));
    await press('3 days before');
    await driver.waitFor('the second', async () => ((await rows()).length === 2 ? true : null));

    await setInput('input[aria-label="A warning at this date and time"]', local(inDays(5)));
    await press('Add');
    await driver.waitFor('the third', async () => ((await rows()).length === 3 ? true : null));
    await session.screenshot('warnings');
  });

  it('refuses one after the task is due', async () => {
    const { driver } = session;
    await setInput('input[aria-label="A warning at this date and time"]', local(inDays(20)));
    await press('Add');
    await driver.waitForText('A warning comes before the task is due.');
    expect((await rows()).length).toBe(3);
  });

  it('keeps them through a restart', async () => {
    await session.restart();
    await open();
    await session.driver.waitFor('all three', async () =>
      (await rows()).length === 3 ? true : null,
    );
  });

  it('moves them with the due time', async () => {
    const { driver } = session;
    const before = await (await driver.find('ul[aria-label="Warnings"] li')).text();
    await setInput('input[aria-label="Due date and time"]', local(inDays(14)));
    await driver.waitFor('the first warning moved', async () => {
      const after = await (await driver.find('ul[aria-label="Warnings"] li')).text();
      // The same distance from the due time, on a different day.
      return after !== before && after.includes('7 days before') ? true : null;
    });
  });

  it('removes one', async () => {
    const { driver } = session;
    await (await driver.find('button[aria-label^="Remove the warning"]')).click();
    await driver.waitFor('two left', async () => ((await rows()).length === 2 ? true : null));
  });

  it('really goes off', async () => {
    const { driver } = session;
    const soon = new Date(Date.now() + 70_000);
    await setInput('input[aria-label="A warning at this date and time"]', local(soon));
    await press('Add');
    await driver.waitFor('it is set', async () => ((await rows()).length === 3 ? true : null));
    // The minute is rounded down by the field, so it fires within seventy seconds.
    await driver.chord(Keys.ESCAPE);
    await new Promise((resolve) => setTimeout(resolve, 75_000));
    await open();
    await driver.waitForText('went off');
  }, 120_000);
});
