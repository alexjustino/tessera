import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * A line of notes becomes a task without leaving the note. It is an ordinary task
 * with a date, paired with the page it came from, and the line says so.
 */
describe('a follow-up from a line', () => {
  let session: Session;

  const prose = () => session.driver.find('.tessera-prose');

  const pressFollowUp = async () =>
    (await session.driver.find('button[aria-label="Follow up on this line"]')).click();

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitForElement('nav[aria-label="Main"]');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();
    await (await driver.findByXPath('//button[normalize-space(.)="New page"]')).click();
    await driver.waitForElement('.tessera-prose');
    await (await prose()).click();
    await (await prose()).sendKeys('Send Dragos the quote');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('offers the line as the task, due the next working morning', async () => {
    const { driver } = session;
    await pressFollowUp();
    const name = await driver.waitForElement('input[aria-label="Follow-up task"]');
    expect(await name.property('value')).toBe('Send Dragos the quote');
    const due = await driver.find('input[aria-label="Follow-up due"]');
    expect(String(await due.property('value'))).toContain('T09:00');
    await session.screenshot('follow-up');
  });

  it('makes the task, marks the line and pairs them', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Add follow-up"]')).click();
    await driver.waitForElement('.tessera-prose [data-note-marker="followup"]');
    await driver.waitForElement('button[aria-label="Open the task Send Dragos the quote"]');
    expect(await driver.findAll('[data-testid="follow-up"]')).toHaveLength(0);
  });

  it('is an ordinary task, with its date', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Tasks"]')).click();
    await driver.waitForText('Send Dragos the quote');
    await driver.waitFor('the row', () =>
      driver.find('input[aria-label="Complete Send Dragos the quote"]'),
    );
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('makes nothing when cancelled', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();
    await driver.waitForElement('.tessera-prose');
    await (await prose()).click();
    await pressFollowUp();
    await (
      await driver.findByXPath('//*[@data-testid="follow-up"]//button[normalize-space(.)="Cancel"]')
    ).click();
    await driver.waitFor('the form gone', async () =>
      (await driver.findAll('[data-testid="follow-up"]')).length === 0 ? true : null,
    );
    expect(await driver.findAll('button[aria-label^="Open the task "]')).toHaveLength(1);
  });
});
