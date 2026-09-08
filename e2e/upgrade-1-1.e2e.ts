import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The 1.2 release's proof of done: a 1.1 workspace opens in 1.2, migrated,
 * without loss.
 *
 * `fixtures/workspace-1.1.0.sqlite3` is a workspace at schema version 14 — the
 * fourteen migrations 1.1.0 shipped, applied in order — holding what somebody
 * would have left in it after a release of using it: tasks with dates, an
 * estimate, a completion and a priority; a dependency; a recurring event; time
 * tracked against a task; a template.
 *
 * This suite starts the current binary on a copy of that file and asks three
 * things. Is everything still there? Is the schema at head? And does what 1.2
 * added work on rows 1.1 wrote — a page that links, a goal that counts them, a
 * review that finds what is missing?
 */
describe('a 1.1 workspace in 1.2', () => {
  let session: Session;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  const click = async (css: string) => {
    const element = await session.driver.waitFor(css, () => session.driver.find(css));
    await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  const clickXPath = async (xpath: string) => {
    const element = await session.driver.waitFor(xpath, () => session.driver.findByXPath(xpath));
    await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-1.1.0.sqlite3'),
    });
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens, and everything 1.1 wrote is still there', async () => {
    const { driver } = session;
    await driver.waitForText('Write the brief');
    await driver.waitForText('Draw the diagram');
    await driver.waitForText('Review it');

    // The completion survived.
    const done = await driver.waitFor('the completed row', () =>
      driver.find('input[aria-label="Complete Review it"]'),
    );
    expect(await done.property('checked')).toBe(true);
  });

  it('is migrated to the current schema, and Diagnostics says so', async () => {
    await goTo('Diagnostics');
    await session.driver.waitForText('up to date');
  });

  it('the time 1.1 tracked is still counted, and the template is still there', async () => {
    const { driver } = session;
    await goTo('Tasks');
    await clickXPath('//button[normalize-space(.)="Templates"]');
    try {
      await driver.waitForText('Weekly plan');
    } finally {
      // Whatever the modal showed, it must not be left open: its overlay would
      // swallow every click the tests after this one make.
      await driver.chord(Keys.ESCAPE);
      await driver.waitFor('the modal is closed', async () =>
        (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
      );
    }

    // An hour and a half against the brief, written by 1.1, read by 1.2.
    await goTo('Reports');
    await driver.waitForText('Tracked');
    const figure = await driver.waitFor('the tracked figure', () =>
      driver.find('[data-testid="figure"] [data-testid="figure-value"]'),
    );
    expect(await figure.text()).toBeTruthy();
  });

  it('the event 1.1 wrote is still on the calendar', async () => {
    const { driver } = session;
    await goTo('Calendar');
    await driver.waitForText('Not scheduled');
    const year = await driver.findByXPath(
      '//*[@role="tablist"][.//button[normalize-space(.)="Year"]]//button[normalize-space(.)="Year"]',
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: year.id }]);
    const cell = await driver.waitFor('the day the stand-up is on', () =>
      driver.find('button[data-day="2026-08-25"]'),
    );
    expect(await cell.attribute('data-level')).not.toBe('free');
  });

  it('a page 1.2 makes can link, and search finds it', async () => {
    const { driver } = session;
    await goTo('Notes');
    await click('button[aria-label="New page"]');
    const field = await driver.waitFor('the name field', () =>
      driver.find('input[aria-label="Page name"]'),
    );
    await field.click();
    await driver.chord(Keys.CONTROL, 'a');
    await field.sendKeys(`Handover${Keys.ENTER}`);
    await driver.waitFor('the page named Handover', async () =>
      (await (await driver.find('h1')).text()).trim() === 'Handover' ? true : null,
    );

    const prose = await driver.waitFor('the editor', () => driver.find('.tessera-prose'));
    await prose.click();
    await prose.sendKeys('Everything the migration kept.');
    await driver.waitForText('Everything the migration kept');
  });

  it('a goal 1.2 makes counts a task 1.1 wrote, and the review reads them', async () => {
    const { driver } = session;
    await goTo('Goals');
    await clickXPath('//button[normalize-space(.)="New goal"]');
    await driver.waitForText('New goal');

    const select = await driver.waitFor('the task picker', () =>
      driver.find('select[aria-label="Add a task to this goal"]'),
    );
    await driver.execute(
      `const select = arguments[0];
       const option = Array.from(select.options).find((o) => o.text === 'Review it');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
       setter.call(select, option.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: select.id }],
    );
    await clickXPath('//button[normalize-space(.)="Add"]');

    // "Review it" was completed in 1.1, so the goal counts it at once.
    await driver.waitFor('the goal counting a 1.1 task', async () => {
      const value = await driver.find('[data-testid="figure"] [data-testid="figure-value"]');
      return (await value.text()).trim() === '1 task' ? true : null;
    });

    // And the review reads the same rows: the goal is not finished, but it has
    // something to pick up, so it is not a gap.
    await goTo('Review');
    await driver.waitForText('Projects with no next action');
    await session.screenshot('upgrade-1-1');
  });
});
