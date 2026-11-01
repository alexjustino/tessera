import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The week mosaic (M4), on the real binary.
 *
 * Next week, so the test does not depend on what today is: the default
 * working week (Monday–Friday, 09:00–18:00) gives it 45 tiles. One task —
 * fifty hours, starting next Monday, due next Friday — claims every one of
 * them and is still five hours short. The sentence, the tiles, the legend and
 * the short strip must all say so, and agree.
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

describe('the week mosaic', () => {
  let session: Session;
  const { monday, friday } = nextWeek();

  const setField = async (label: string, value: string, blur = false) => {
    const { driver } = session;
    const field = await driver.waitFor(`the ${label} field`, () =>
      driver.findByXPath(`//*[@role="dialog"]//input[@aria-label="${label}"]`),
    );
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

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Ship the release${Keys.ENTER}`);
    await driver.waitForText('Ship the release');

    const open = await driver.waitFor('the open control', () =>
      driver.find('button[aria-label="Open Ship the release"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
    await setField('Start date and time', `${monday}T09:00`);
    await setField('Due date and time', `${friday}T17:00`);
    await setField('Estimate', '50h', true);
    await driver.waitFor('the estimate stored', async () => {
      const field = await driver.find('input[aria-label="Estimate"]');
      return (await field.property('value')) !== '50h' ? true : null;
    });
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );

    await (await driver.findByXPath('//nav//button[normalize-space(.)="Mosaic"]')).click();
    await driver.waitForElement('[data-testid="mosaic-week"]');
    const after = await driver.find('button[aria-label="The week after"]');
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: after.id }]);
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says the week has 45 tiles and is 5 short, in one sentence', async () => {
    const { driver } = session;
    const tiles = await driver.waitFor('the tile count', () =>
      driver.find('[data-testid="mosaic-tiles"]'),
    );
    expect(await tiles.text()).toBe('45 tiles');
    expect(await (await driver.find('[data-testid="mosaic-short"]')).text()).toBe('5 short');
    const sentence = await (await driver.find('[data-testid="mosaic-summary"]')).text();
    // Every sentence ends before the next begins — the first capture ran two together.
    expect(sentence).toContain('45 tiles. Nothing is on the calendar.');
  });

  it('draws every tile as committed to the task, and the short ones as tiles too', async () => {
    const { driver } = session;
    const committed = await driver.findAll('[role="gridcell"] [data-state="committed"]');
    expect(committed).toHaveLength(45);
    expect(await committed[0]!.text()).toContain('Ship the release');
    // A block names its task once, at its top; the tile below it does not repeat it.
    // Cells are row by row, so index 5 is Monday 10:00, under Monday 09:00.
    expect(await committed[5]!.text()).toBe('');
    const short = await driver.findAll('[data-testid="mosaic-short-tiles"] span');
    expect(short).toHaveLength(5);
    // The legend counts the same tiles the grid draws.
    await driver.waitForText('Committed to estimated work (45)');
  });

  it('names each tile in words, and the arrow keys walk the grid', async () => {
    const { driver } = session;
    const first = await driver.find('[role="gridcell"][tabindex="0"]');
    expect(await first.attribute('aria-label')).toMatch(
      /^Monday 09:00: Committed to estimated work — Ship the release/,
    );
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: first.id }]);
    await driver.chord(Keys.ARROW_RIGHT);
    const right = await driver.execute<string>(
      'return document.activeElement.getAttribute("aria-label")',
    );
    expect(right).toMatch(/^Tuesday 09:00/);
    await driver.chord(Keys.ARROW_DOWN);
    const down = await driver.execute<string>(
      'return document.activeElement.getAttribute("aria-label")',
    );
    expect(down).toMatch(/^Tuesday 10:00/);

    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`mosaic-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);
  });

  it('opens a number onto the rows it was added up from', async () => {
    const { driver } = session;
    const needs = await driver.find('[data-figure="mosaic:needs"] [data-testid="figure-value"]');
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: needs.id }]);
    const row = await driver.waitFor('the row behind the number', () =>
      driver.find('[data-figure="mosaic:needs"] [data-testid="figure-row"]'),
    );
    expect(await row.text()).toContain('Ship the release');
    expect(await row.text()).toContain('50h');
  });
});
