import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * The command palette: Ctrl+K opens it, letters rank commands, words find
 * tasks through the index, Enter acts, Escape leaves.
 */
describe('command palette', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Renew the passport in 3 days${Keys.ENTER}`);
    await driver.waitForText('Renew the passport');
    await input.sendKeys(`Book the dentist${Keys.ENTER}`);
    await driver.waitForText('Book the dentist');
  });

  afterAll(async () => {
    await session?.stop();
  });

  // A failed assertion must not leave the palette open for the next test:
  // Ctrl+K toggles, and a stale state would turn one failure into three.
  beforeEach(async () => {
    const { driver } = session;
    const open = await driver.findAll('input[aria-label="Search or run a command"]');
    if (open.length > 0) {
      await driver.chord(Keys.ESCAPE);
      await driver.waitFor('palette closed', async () =>
        (await driver.findAll('input[aria-label="Search or run a command"]')).length === 0
          ? true
          : null,
      );
    }
  });

  it('opens with Ctrl+K onto a grouped menu of every command', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    expect(
      await driver.execute<boolean>('return document.activeElement === arguments[0]', [
        { 'element-6066-11e4-a52e-4f735466cecf': box.id },
      ]),
    ).toBe(true);
    const options = await driver.findAll('[role="option"]');
    expect(options.length).toBeGreaterThanOrEqual(13);
    await driver.waitForText('Go to');
    await driver.waitForText('Appearance');
  });

  it('ranks the obvious command first for a few letters and runs it on Enter', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await box.sendKeys('>diag');
    const first = await driver.waitFor('a first option', async () => {
      const options = await driver.findAll('[role="option"]');
      return options[0] ?? null;
    });
    expect(await first.text()).toContain('Go to Diagnostics');
    await box.sendKeys(Keys.ENTER);
    const current = await driver.waitFor('Diagnostics selected', async () => {
      const active = await driver.findByXPath('//nav//button[@aria-current="page"]');
      return (await active.text()) === 'Diagnostics' ? active : null;
    });
    expect(await current.text()).toBe('Diagnostics');
  });

  it('finds a task through the index and opens it', async () => {
    const { driver } = session;
    await (await driver.find('button[aria-label="Search or run a command"]')).click();
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await box.sendKeys('passp');
    const hit = await driver.waitFor('the task among the results', async () => {
      const options = await driver.findAll('[role="option"]');
      for (const option of options) {
        if ((await option.text()).includes('Renew the passport')) return option;
      }
      return null;
    });
    // The matched word is marked whole — the index highlights the token the
    // prefix found — as an element, not as markup.
    const marks = await hit.findAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(await marks[0]?.text()).toBe('passport');

    await hit.click();
    const dialog = await driver.waitForElement('[role="dialog"]');
    expect(await dialog.text()).toContain('Renew the passport');
    await driver.chord(Keys.ESCAPE);
  });

  it('says so when nothing matches, and Escape closes it', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await box.sendKeys('zzqx');
    await driver.waitForText('Nothing matches');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('palette closed', async () =>
      (await driver.findAll('input[aria-label="Search or run a command"]')).length === 0
        ? true
        : null,
    );
  });

  it('never hands query syntax to the index', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    // A stray quote and bracket would be a syntax error if they reached FTS5.
    await box.sendKeys('dentist ("');
    await driver.waitForText('Book the dentist');
    const errors = await driver.findAllByXPath('//*[contains(., "The search did not answer")]');
    expect(errors.length).toBe(0);
    await driver.chord(Keys.ESCAPE);
  });
});
