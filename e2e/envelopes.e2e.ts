import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Envelopes (M5), on the real binary — and the goal date that never saved.
 *
 * Next week: one task, "Write the chapter", six hours from next Monday. A goal
 * "Thesis" counts it and holds a four-hour envelope. The Mosaic must say the
 * envelope spent six of four hours — two over, recorded, not refused — leave
 * 41 of the week's 45 open hours as margin, and mark the task's tiles as the
 * goal's.
 *
 * The same goal's date is set in the interface and must still be there after
 * leaving the screen: until 1.3 the host dropped `dueDay` as an unknown field.
 */

function nextWeek(): { monday: string; friday: string } {
  const day = new Date();
  day.setDate(day.getDate() + ((8 - day.getDay()) % 7 || 7));
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const friday = new Date(day);
  friday.setDate(day.getDate() + 4);
  return { monday: fmt(day), friday: fmt(friday) };
}

describe('envelopes', () => {
  let session: Session;
  const { monday, friday } = nextWeek();

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  /** Set a field's value as typing would, and leave it when asked. */
  const setField = async (css: string, value: string, blur: boolean) => {
    const { driver } = session;
    const field = await driver.waitFor(css, () => driver.find(css));
    await driver.execute(
      `const f = arguments[0];
       f.focus();
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, arguments[1]);
       f.dispatchEvent(new Event('input', { bubbles: true }));
       f.dispatchEvent(new Event('change', { bubbles: true }));
       if (arguments[2]) f.blur();`,
      [{ [ELEMENT]: field.id }, value, blur],
    );
  };

  const clickXPath = async (xpath: string) => {
    const { driver } = session;
    const element = await driver.waitFor(xpath, () => driver.findByXPath(xpath));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Write the chapter${Keys.ENTER}`);
    await driver.waitForText('Write the chapter');
    await clickXPath('//button[@aria-label="Open Write the chapter"]');
    await driver.waitForElement('[role="dialog"]');
    await setField(
      '[role="dialog"] input[aria-label="Start date and time"]',
      `${monday}T09:00`,
      false,
    );
    await setField(
      '[role="dialog"] input[aria-label="Due date and time"]',
      `${friday}T17:00`,
      false,
    );
    await setField('[role="dialog"] input[aria-label="Estimate"]', '6h', true);
    await driver.waitFor('the estimate stored', async () => {
      const field = await driver.find('input[aria-label="Estimate"]');
      return (await field.property('value')) === '6h' ? true : null;
    });
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );

    await goTo('Goals');
    await clickXPath('//button[normalize-space(.)="New goal"]');
    await setField('input[aria-label="Goal name"]', 'Thesis', true);
    await driver.waitForText('Thesis');
    const picker = await driver.waitFor('the task picker', () =>
      driver.find('select[aria-label="Add a task to this goal"]'),
    );
    await driver.execute(
      `const select = arguments[0];
       const option = Array.from(select.options).find((o) => o.text === 'Write the chapter');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
       setter.call(select, option.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: picker.id }],
    );
    await clickXPath('//button[normalize-space(.)="Add"]');
    await driver.waitFor('the task in the goal', async () =>
      (await driver.findAll('button[aria-label^="Take Write the chapter out of"]')).length === 1
        ? true
        : null,
    );
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a goal date set in the interface is still there after leaving the screen', async () => {
    const { driver } = session;
    await setField('input[aria-label="Due day"]', friday, false);
    // Give the save its round trip, then leave and come back.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await goTo('Review');
    await goTo('Goals');
    const due = await driver.waitFor('the due day field', () =>
      driver.find('input[aria-label="Due day"]'),
    );
    expect(await due.property('value')).toBe(friday);
  });

  it('a goal holds a weekly envelope of hours', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//summary[normalize-space(.)="More details"]')).click();
    await setField('input[aria-label="Hours each week"]', '4', true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await goTo('Review');
    await goTo('Goals');
    const hours = await driver.waitFor('the hours field', () =>
      driver.find('input[aria-label="Hours each week"]'),
    );
    expect(await hours.property('value')).toBe('4');
  });

  it('the Mosaic spends the envelope from the tiles, records going over, and keeps a margin', async () => {
    const { driver } = session;
    await goTo('Mosaic');
    await driver.waitForElement('[data-testid="mosaic-week"]');
    await clickXPath('//button[@aria-label="The week after"]');

    const spent = await driver.waitFor('the envelope line', () =>
      driver.find('[data-envelope] [data-testid="envelope-spent"]'),
    );
    await driver.waitFor('the spend read from the tiles', async () =>
      (await spent.text()) === '6h of 4h — 2h over' ? true : null,
    );
    expect(await (await driver.find('[data-testid="envelopes-margin"]')).text()).toContain('41h');

    // The task's tiles say whose envelope they spend.
    const first = await driver.find('[role="gridcell"][tabindex="0"]');
    expect(await first.attribute('aria-label')).toContain(', for Thesis');

    const card = await driver.find('[data-envelope]');
    await driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: card.id },
    ]);
    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`envelopes-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);
  });
});
