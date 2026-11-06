import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * A line can say what it is, and one screen gathers them all. A marker is data on
 * the line, so it outlives a restart and is found again from anywhere.
 */
describe('markers', () => {
  let session: Session;

  const prose = () => session.driver.find('.tessera-prose');

  const mark = async (value: string) => {
    const { driver } = session;
    const select = await driver.find('select[aria-label="Marker"]');
    await driver.execute(
      `const field = arguments[0];
       const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
       set.call(field, arguments[1]);
       field.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: select.id }, value],
    );
  };

  const goToNotes = async () =>
    (await session.driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();

  const openMarkedLines = async () =>
    (await session.driver.findByXPath('//button[normalize-space(.)="Marked lines"]')).click();

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitForElement('nav[aria-label="Main"]');
    await goToNotes();
    await (await driver.findByXPath('//button[normalize-space(.)="New page"]')).click();
    await driver.waitForElement('.tessera-prose');
  });

  afterAll(async () => {
    await session?.stop();
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('says how, while nothing is marked', async () => {
    await openMarkedLines();
    await session.driver.waitForText('No marked lines yet');
    await (
      await session.driver.findByXPath('//aside//button[contains(@aria-label, "Open ")]')
    ).click();
    await session.driver.waitForElement('.tessera-prose');
  });

  it('marks a line from the bar, and draws its word', async () => {
    const { driver } = session;
    await (await prose()).click();
    await (await prose()).sendKeys('Ask the vendor about the licence');
    await mark('question');
    await driver.waitForElement('.tessera-prose [data-note-marker="question"]');
    await session.screenshot('marker-line');
  });

  it('marks another with the shortcut, and leaves a new line unmarked', async () => {
    const { driver } = session;
    await (await prose()).sendKeys(`${Keys.ENTER}Renew before Friday`);
    const count = () => driver.findAll('.tessera-prose [data-note-marker]');
    expect((await count()).length).toBe(1);
    await driver.chord(Keys.CONTROL, '2');
    await driver.waitForElement('.tessera-prose [data-note-marker="important"]');
    expect((await count()).length).toBe(2);
  });

  it('gathers them under their markers, on one screen', async () => {
    const { driver } = session;
    // Longer than the save delay, so the document is on disk.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await openMarkedLines();
    const questions = await driver.waitForElement('[data-testid="marker-question"]');
    expect(await questions.text()).toContain('Ask the vendor about the licence');
    const important = await driver.waitForElement('[data-testid="marker-important"]');
    expect(await important.text()).toContain('Renew before Friday');
    await session.screenshot('marked-lines');
  });

  it('goes to where the line was written', async () => {
    const { driver } = session;
    await (
      await driver.findByXPath('//button[contains(normalize-space(.), "Renew before Friday")]')
    ).click();
    await driver.waitForElement('.tessera-prose [data-note-marker="important"]');
  });

  it('keeps them through a restart', async () => {
    await session.restart();
    const { driver } = session;
    await goToNotes();
    await driver.waitForElement('.tessera-prose [data-note-marker="question"]');
    await openMarkedLines();
    await driver.waitForElement('[data-testid="marker-question"]');
  });

  it('takes a marker off with the same key', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//aside//button[contains(@aria-label, "Open ")]')).click();
    const line = await driver.waitForElement('.tessera-prose [data-note-marker="question"]');
    await line.click();
    // The shortcut acts on the line the caret is in: wait for the caret to be there.
    await driver.waitFor('the caret on the line', async () =>
      (await driver.execute<boolean>(
        'const n = window.getSelection()?.anchorNode; return !!(n && (n.nodeType === 3 ? n.parentElement : n)?.closest("[data-note-marker=question]"));',
      ))
        ? true
        : null,
    );
    await driver.chord(Keys.CONTROL, '3');
    await driver.waitFor('the marker gone', async () =>
      (await driver.findAll('.tessera-prose [data-note-marker="question"]')).length === 0
        ? true
        : null,
    );
  });
});
