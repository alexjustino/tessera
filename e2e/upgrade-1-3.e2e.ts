import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openDiagnostics, startSession, type Session } from './session';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The 1.4 release's proof of done: a 1.3 workspace opens in 1.4, migrated, without
 * loss, and what 1.4 added works on the rows 1.3 wrote.
 *
 * `fixtures/workspace-1.3.0.sqlite3` (built by `make_1_3.py`) is a workspace at
 * schema 18 — the eighteen migrations 1.3.0 shipped — holding estimated tasks with
 * a dependency and a reminder, tracked time, a page, a goal with an envelope and a
 * day off. 1.4 adds migrations 019 (a goal with no finish line) and 020 (a task and
 * a page paired).
 */
describe('a 1.3 workspace in 1.4', () => {
  let session: Session;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  const openPlan = async () => {
    const { driver } = session;
    const control = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Plan the launch"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
    await driver.waitForElement('[role="dialog"]');
  };

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-1.3.0.sqlite3'),
    });
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens, and every task 1.3 wrote is still there, the finished one finished', async () => {
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
    await openDiagnostics(session);
    await session.driver.waitForText('up to date');
  });

  it('the goal keeps its target, date and envelope, and can become an ongoing focus', async () => {
    const { driver } = session;
    await goTo('Goals');
    await driver.waitForText('Launch');
    await (await driver.findByXPath('//summary[normalize-space(.)="More details"]')).click();
    const hours = await driver.waitFor('the hours field', () =>
      driver.find('input[aria-label="Hours each week"]'),
    );
    expect(await hours.property('value')).toBe('5');
    const due = await driver.find('input[aria-label="Due day"]');
    expect(await due.property('value')).toBe('2027-12-31');

    await (await driver.findByXPath('//button[normalize-space(.)="Ongoing focus"]')).click();
    await driver.waitForText('Ongoing focus, no end date');
    await (
      await driver.findByXPath('//button[normalize-space(.)="Until I reach a target"]')
    ).click();
    await driver.waitForElement('input[aria-label="Target"]');
  });

  it('the page 1.3 wrote keeps its text, and takes a marker and a task', async () => {
    const { driver } = session;
    await goTo('Notes');
    const line = await driver.waitFor('the text', () =>
      driver.findByXPath(
        '//*[contains(@class, "tessera-prose")]//p[contains(., "Everything 1.3")]',
      ),
    );
    await line.click();
    await driver.chord('', '4');
    await driver.waitForElement('.tessera-prose [data-note-marker="decision"]');

    await (await driver.findByXPath('//button[normalize-space(.)="Apply to a task"]')).click();
    await (
      await driver.waitFor('the task in the picker', () =>
        driver.findByXPath(
          '//ul[@aria-label="Open tasks"]//button[contains(., "Plan the launch")]',
        ),
      )
    ).click();
    await driver.waitForElement('button[aria-label="Open the task Plan the launch"]');
  });

  it('a task 1.3 wrote keeps its reminder, and takes warnings beside it', async () => {
    const { driver } = session;
    await goTo('Tasks');
    await openPlan();
    const remind = await driver.waitForElement('select[aria-label="When to be reminded"]');
    expect(await remind.property('value')).toBe('1h');
    await (
      await driver.findByXPath(
        '//*[@data-testid="warnings"]//button[normalize-space(.)="1 day before"]',
      )
    ).click();
    await driver.waitFor('the warning', async () =>
      (await driver.findAll('ul[aria-label="Warnings"] li')).length === 1 ? true : null,
    );
    expect(await remind.property('value')).toBe('1h');
    await driver.waitForElement('button[aria-label="Open the page Handover"]');
    await session.screenshot('upgrade-1-3');
  });
});
