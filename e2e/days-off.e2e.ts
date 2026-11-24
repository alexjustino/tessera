import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Days off (M3), on the real binary.
 *
 * A Wednesday of this year — inside the default working week — is made a day
 * off in Settings. The year view must then read it as not a working day;
 * removing it gives it its hours back. The Wednesday is the first of the year,
 * so the test does not depend on what today is.
 */
function firstWednesday(): string {
  const year = new Date().getFullYear();
  const day = new Date(year, 0, 1);
  while (day.getDay() !== 3) day.setDate(day.getDate() + 1);
  return `${year}-01-${String(day.getDate()).padStart(2, '0')}`;
}

describe('days off', () => {
  let session: Session;
  const day = firstWednesday();

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  const yearLevel = async (): Promise<string | null> => {
    const { driver } = session;
    await goTo('Calendar');
    // Wait for the scale tabs themselves: "Not scheduled" only shows when
    // there are unscheduled tasks, and this workspace has none.
    // Pressed until the year is up: pressing Calendar from the calendar replaces the
    // screen, and a tab found a moment before that is gone by the time it is pressed.
    const cell = await driver.waitFor(`the cell for ${day}`, async () => {
      const [found] = await driver.findAll(`button[data-day="${day}"]`);
      if (found !== undefined) return found;
      const year = await driver.findByXPath(
        '//*[@role="tablist"][.//button[normalize-space(.)="Year"]]//button[normalize-space(.)="Year"]',
      );
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: year.id }]);
      return null;
    });
    return cell.attribute('data-level');
  };

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('the calendar shows in a workspace with no tasks at all', async () => {
    // It used to show "Nothing here yet" instead — found by this test's first run.
    expect(await yearLevel()).not.toBeNull();
  });

  it('a Wednesday of the working week has its hours before anything is said', async () => {
    expect(await yearLevel()).not.toBe('off');
  });

  it('a day off added in Settings is listed with its name', async () => {
    const { driver } = session;
    await goTo('Settings');
    await (
      await driver.findByXPath(
        '//nav[@aria-label="Settings sections"]//button[normalize-space(.)="Working time"]',
      )
    ).click();
    await driver.waitForText('Days off');
    const field = await driver.waitForElement('input[aria-label="Day off"]');
    await driver.execute(
      `const f = arguments[0];
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, arguments[1]);
       f.dispatchEvent(new Event('input', { bubbles: true }));
       f.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: field.id }, day],
    );
    const label = await driver.find('input[aria-label="What the day off is"]');
    await label.sendKeys('Company holiday');
    await (await driver.findByXPath('//button[normalize-space(.)="Add day off"]')).click();

    const row = await driver.waitFor('the listed day off', () =>
      driver.find(`[data-day-off="${day}"]`),
    );
    expect(await row.text()).toContain('Company holiday');
    const off = await driver.find(`[data-day-off="${day}"]`);
    await driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: off.id },
    ]);
    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`days-off-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);
  });

  it('the year then reads that day as not a working day', async () => {
    expect(await yearLevel()).toBe('off');
  });

  it('removing the day off gives the day its hours back', async () => {
    const { driver } = session;
    await goTo('Settings');
    await (
      await driver.findByXPath(
        '//nav[@aria-label="Settings sections"]//button[normalize-space(.)="Working time"]',
      )
    ).click();
    const remove = await driver.waitFor('the remove control', () =>
      driver.find(`[data-day-off="${day}"] button`),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: remove.id }]);
    await driver.waitFor('the day off gone', async () =>
      (await driver.findAll(`[data-day-off="${day}"]`)).length === 0 ? true : null,
    );
    expect(await yearLevel()).not.toBe('off');
  });
});
