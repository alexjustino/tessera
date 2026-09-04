import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Reports, end to end — and the slice's proof of done, checked in the real
 * product: every number can be traced to the rows it came from. The test
 * opens a figure, reads the rows the page lists under it, adds them up
 * itself, and compares.
 *
 * The time comes from an entry written by hand, because a clock started and
 * stopped inside a test measures seconds and the report counts minutes.
 */
describe('reports', () => {
  let session: Session;

  const goTo = async (label: string) => {
    const { driver } = session;
    await (await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  };

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

  /** Set a controlled input's value the way React notices. */
  const setValue = async (css: string, value: string) => {
    const { driver } = session;
    const input = await driver.waitForElement(css);
    await driver.execute(
      `const el = arguments[0];
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
       setter.call(el, arguments[1]);
       el.dispatchEvent(new Event('input', { bubbles: true }));`,
      [{ [ELEMENT]: input.id }, value],
    );
  };

  /** Today at a wall-clock hour, as the datetime-local control wants it. */
  const todayAt = (hour: number) => {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:00`;
  };

  /** Parse what the page prints — `2h 30m`, `45m`, `1d 2h` — back to minutes. */
  const minutesOf = (text: string): number => {
    let total = 0;
    for (const [, amount, unit] of text.matchAll(/(\d+)\s*([dhm])/g)) {
      total += Number(amount) * (unit === 'd' ? 480 : unit === 'h' ? 60 : 1);
    }
    return total;
  };

  const figure = async (id: string) => {
    const { driver } = session;
    return driver.waitFor(`the ${id} figure`, () => driver.find(`[data-figure="${id}"]`));
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Write the report', 'File the expenses']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('time can be written by hand, and an end before its start is refused in words', async () => {
    const { driver } = session;
    await openDetail('Write the report');
    const estimate = await driver.waitForElement('input[aria-label="Estimate"]');
    // Focus first: blur on an element that never had focus fires nothing.
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: estimate.id }]);
    await estimate.sendKeys('1h');
    await driver.execute('arguments[0].blur()', [{ [ELEMENT]: estimate.id }]);

    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Add time"]')
    ).click();
    await setValue('input[aria-label="Started"]', todayAt(11));
    await setValue('input[aria-label="Ended"]', todayAt(9));
    await (
      await driver.findByXPath('//form[@aria-label="Add time"]//button[normalize-space(.)="Add"]')
    ).click();
    await driver.waitForText('An entry cannot end before it starts.');

    // Two hours this morning, the right way round.
    await setValue('input[aria-label="Started"]', todayAt(9));
    await setValue('input[aria-label="Ended"]', todayAt(11));
    await (
      await driver.findByXPath('//form[@aria-label="Add time"]//button[normalize-space(.)="Add"]')
    ).click();
    await driver.waitForText('2h tracked');
    await closeDetail();
  });

  it('shows the period, and every figure opens onto the rows it came from', async () => {
    const { driver } = session;
    await goTo('Reports');
    await driver.waitForText('Open any number to see the rows it was added up from.');
    const period = await driver.waitForElement('[data-testid="report-period"]');
    expect((await period.text()).length).toBeGreaterThan(0);

    const tracked = await figure('tracked');
    const value = await tracked.find('[data-testid="figure-value"]');
    expect(minutesOf(await value.text())).toBe(120);

    // The proof: the rows shown under the figure add up to it.
    expect(await value.attribute('aria-expanded')).toBe('false');
    await value.click();
    expect(await value.attribute('aria-expanded')).toBe('true');
    const rows = await tracked.findAll('[data-testid="row-minutes"]');
    expect(rows.length).toBeGreaterThan(0);
    let sum = 0;
    for (const row of rows) sum += minutesOf(await row.text());
    expect(sum).toBe(minutesOf(await value.text()));

    // And the row names the task.
    await driver.waitForText('Write the report');
  });

  it('compares what was tracked against the estimate', async () => {
    const { driver } = session;
    const line = await driver.waitForElement('[data-testid="estimate-line"]');
    const text = await line.text();
    expect(text).toContain('Write the report');
    expect(text).toContain('2h of 1h');
    expect(text).toContain('over 1h');

    const over = await figure('over-estimate');
    expect(await (await over.find('[data-testid="figure-value"]')).text()).toBe('1 task');
  });

  it('counts what was completed, and the count opens onto the tasks', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const checkbox = await driver.waitFor('the checkbox for File the expenses', () =>
      driver.find('input[aria-label="Complete File the expenses"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: checkbox.id }]);

    await goTo('Reports');
    const done = await figure('completed');
    const value = await driver.waitFor('one task done', async () => {
      const button = await done.find('[data-testid="figure-value"]');
      return (await button.text()) === '1 task' ? button : null;
    });
    await value.click();
    const rows = await done.findAll('[data-testid="figure-row"]');
    expect(rows).toHaveLength(1);
    expect(await rows[0]!.text()).toContain('File the expenses');
    await session.screenshot('reports');
  });

  it('the report survives a restart', async () => {
    await session.restart();
    await goTo('Reports');
    const tracked = await figure('tracked');
    expect(minutesOf(await (await tracked.find('[data-testid="figure-value"]')).text())).toBe(120);
  });
});
