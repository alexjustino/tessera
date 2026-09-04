import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The year view, end to end: reserve time for a task on today's grid, switch
 * to the year, and find today coloured by what was reserved — with the words
 * to match. Then the map is a way in: a cell opens its day. And, as every
 * slice proves, the picture survives a restart because the data does.
 */
describe('the year view', () => {
  let session: Session;

  const click = async (css: string) => {
    const { driver } = session;
    const element = await driver.waitFor(`${css} to appear`, () => driver.find(css));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  // Two tab strips share the page: the view tabs (List, Board, Calendar…) and
  // the calendar's own scales. Both are tablists; only one offers a Year.
  const clickScale = async (label: string) => {
    const { driver } = session;
    const tab = await driver.findByXPath(
      `//*[@role="tablist"][.//button[normalize-space(.)="Year"]]//button[normalize-space(.)="${label}"]`,
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: tab.id }]);
  };

  /** Today's cell on the map, once the map is drawn. */
  const todayCell = () =>
    session.driver.waitFor('the cell for today', () =>
      session.driver.find('button[data-day][aria-current="date"]'),
    );

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Plan the offsite${Keys.ENTER}`);
    await driver.waitForText('Plan the offsite');

    await (await driver.findByXPath('//nav//button[normalize-space(.)="Calendar"]')).click();
    await driver.waitForText('Not scheduled');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('is a scale of the calendar, drawn as twelve months of days', async () => {
    const { driver } = session;
    await clickScale('Year');

    const summary = await driver.waitForElement('[data-testid="year-summary"]');
    expect(await summary.text()).toContain('reserved of');

    const cells = await driver.findAll('button[data-day]');
    expect([365, 366]).toContain(cells.length);

    // Every cell says its day and its load in words: colour is never alone.
    const today = await todayCell();
    const label = await today.attribute('aria-label');
    expect(label).toMatch(/^Today, /);
    expect(label).toMatch(/not a working day|reserved/);

    await driver.waitForText('Not a working day');
    await driver.waitForText('More than the day has');
  });

  it('colours today by what the calendar reserved on it', async () => {
    const { driver } = session;
    const before = await (await todayCell()).attribute('data-level');
    expect(['free', 'off']).toContain(before);

    // Back to the week, reserve time for the task with the keyboard — it lands
    // on today's first working slot — and return to the year.
    await clickScale('Week');
    await click('button[aria-label="Reserve time for Plan the offsite"]');
    await driver.chord(Keys.ENTER);
    await driver.waitFor('the task left the unscheduled panel', async () =>
      (await driver.findAll('button[aria-label="Reserve time for Plan the offsite"]')).length === 0
        ? true
        : null,
    );

    await clickScale('Year');
    const today = await todayCell();
    const after = await today.attribute('data-level');
    expect(after).not.toBe('free');
    expect(after).not.toBe('off');
    expect(await today.attribute('aria-label')).toContain('reserved');

    // The one coloured cell is the evidence; put it in the frame.
    await driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: today.id },
    ]);
    await session.screenshot('year');
  });

  it('a cell opens its day', async () => {
    const { driver } = session;
    const today = await todayCell();
    const day = await today.attribute('data-day');
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: today.id }]);

    await driver.waitFor('the year gave way to the day', async () =>
      (await driver.findAll('button[data-day]')).length === 0 ? true : null,
    );
    const active = await driver.findByXPath(
      '//*[@role="tablist"][.//button[normalize-space(.)="Year"]]//button[@aria-selected="true"]',
    );
    expect(await active.text()).toBe('Day');

    // The day it opened is the one that was clicked.
    const [year, month, date] = day!.split('-').map(Number);
    const expected = new Date(year!, month! - 1, date!).toLocaleDateString('en-US', {
      weekday: 'long',
    });
    await driver.waitForText(expected);
  });

  it('what was reserved is still on the map after a restart', async () => {
    await session.restart();
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Calendar"]')).click();
    await driver.waitForText('Not scheduled');
    await clickScale('Year');

    const today = await todayCell();
    expect(await today.attribute('data-level')).not.toBe('free');
    expect(await today.attribute('aria-label')).toContain('reserved');
  });
});
