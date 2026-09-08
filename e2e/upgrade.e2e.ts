import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The release's proof of done: a 1.0 workspace opens in 1.1, migrated,
 * without loss.
 *
 * `fixtures/workspace-1.0.0.sqlite3` is a workspace at schema version 7 — the
 * seven migrations 1.0.0 shipped, applied in order, with a few rows a person
 * might have left in it: tasks with a date, a completion and a priority, and
 * an event. This suite starts the current binary on a copy of that file and
 * checks three things: what was there is still there, the schema is at head,
 * and the features 1.1 added work on rows 1.0 wrote.
 */
describe('a 1.0 workspace in 1.1', () => {
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

  const closeDialogs = async () => {
    const { driver } = session;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await driver.findAll('[role="dialog"]')).length === 0) break;
      await driver.chord(Keys.ESCAPE);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-1.0.0.sqlite3'),
    });
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens, and everything 1.0 wrote is still there', async () => {
    const { driver } = session;
    await driver.waitForText('Renew the passport');
    await driver.waitForText('Book the flights');
    await driver.waitForText('Pack');

    // The completion survived, and the property value with it.
    const done = await driver.waitFor('the completed row', () =>
      driver.find('input[aria-label="Complete Book the flights"]'),
    );
    expect(await done.property('checked')).toBe(true);
    await openDetail('Renew the passport');
    const priority = await driver.waitFor('the Priority field in the panel', () =>
      driver.findByXPath('//*[@role="dialog"]//select[@aria-label="Priority"]'),
    );
    expect(await priority.property('value')).toBe('high');
    await closeDialogs();
  });

  it('is migrated to the current schema, and Diagnostics says so', async () => {
    const { driver } = session;
    await goTo('Diagnostics');
    await driver.waitForText('up to date');
    await goTo('Tasks');
  });

  it('the event 1.0 wrote is on the calendar', async () => {
    const { driver } = session;
    await goTo('Calendar');
    await driver.waitForText('Not scheduled');
    // The week and the agenda show what is near today; the fixture's event is
    // wherever the fixture put it, so the year is the scale that finds it.
    const year = await driver.findByXPath(
      '//*[@role="tablist"][.//button[normalize-space(.)="Year"]]//button[normalize-space(.)="Year"]',
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: year.id }]);
    // 16 September 2026 carries an hour: it is not "free" on the map.
    const cell = await driver.waitFor('the day the dentist is on', () =>
      driver.find('button[data-day="2026-09-16"]'),
    );
    expect(await cell.attribute('data-level')).not.toBe('free');
    expect(await cell.attribute('data-level')).not.toBe('off');
    await goTo('Tasks');
  });

  it('what 1.1 added works on rows 1.0 wrote', async () => {
    const { driver } = session;
    // A dependency (P1) between two old tasks.
    await openDetail('Pack');
    const select = await driver.waitForElement('select[aria-label="Wait for another task"]');
    const option = await driver.findByXPath(
      '//select[@aria-label="Wait for another task"]/option[normalize-space(.)="Renew the passport"]',
    );
    const value = await option.attribute('value');
    await driver.execute(
      'const s = arguments[0]; s.value = arguments[1]; s.dispatchEvent(new Event("change", { bubbles: true }));',
      [{ [ELEMENT]: select.id }, value],
    );
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Add"]')
    ).click();
    // On the waiting task's own panel the proof is the control to undo it.
    await driver.waitFor('Pack waits for Renew the passport', () =>
      driver.find('button[aria-label="Stop waiting for Renew the passport"]'),
    );

    // A clock (P4) on an old task.
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Start timer"]')
    ).click();
    await driver.waitForText('Stop');
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Stop"]')
    ).click();
    await driver.waitForText('Start timer');
    await closeDialogs();

    // The report (P6) opens over it. A few seconds round to no minutes, so the
    // page may honestly say nothing happened; what matters is that it reads
    // the old workspace without complaint.
    await goTo('Reports');
    await driver.waitForElement('[data-testid="report-period"]');
    await session.screenshot('upgrade-reports');
    for (const complaint of ['The report could not be read', 'A figure does not add up']) {
      expect(
        (await driver.findAllByXPath(`//*[contains(normalize-space(.), "${complaint}")]`)).length,
        complaint,
      ).toBe(0);
    }
    await goTo('Tasks');
  });

  it('and it is all still there after a restart', async () => {
    await session.restart();
    const { driver } = session;
    await driver.waitForText('Renew the passport');
    await driver.waitForText('Pack');
    await driver.waitFor('Pack still waits', async () => {
      const waiting = await driver.execute<boolean>(
        `const rows = Array.from(document.querySelectorAll('li'));
         const row = rows.find((li) => li.querySelector('button[aria-label="Open Pack"]'));
         return row !== undefined && row.textContent.includes('Waiting');`,
      );
      return waiting ? true : null;
    });
  });
});
