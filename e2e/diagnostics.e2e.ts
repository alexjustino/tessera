import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * Diagnostics and About: the pipeline states the product makes checkable, and
 * the screen that carries the author's name and the name's story.
 */
describe('diagnostics and about', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a reminder typed in words appears in the scheduler queue', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Submit the form tomorrow at 10am remind me 1h before${Keys.ENTER}`);
    await driver.waitForText('Submit the form');

    await (await driver.findByXPath('//nav//button[normalize-space(.)="Diagnostics"]')).click();
    await driver.waitForText('Reminders');
    const queued = await driver.waitForText('Submit the form');
    expect(await queued.displayed()).toBe(true);
  });

  it('pausing reminders is reflected, and resuming lifts it', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Pause for 1 hour"]')).click();
    await driver.waitForText('Reminders are paused');
    await (await driver.findByXPath('//button[normalize-space(.)="Resume"]')).click();
    await driver.waitForGone('Reminders are paused');
  });

  it('says whether the quick-capture shortcut is live, in a sentence', async () => {
    const { driver } = session;
    await driver.waitForText('Quick capture');
    const card = await driver.waitFor('the capture card verdict', async () => {
      const live = await driver.findAllByXPath('//*[contains(., "The shortcut is live")]');
      const taken = await driver.findAllByXPath('//*[contains(., "could not be registered")]');
      return live.length + taken.length > 0 ? true : null;
    });
    expect(card).toBe(true);
    await driver.waitForText('Ctrl+Alt+Space');
  });

  it('the theme control in Settings switches the theme on the root element', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await driver.waitForText('Kept in your workspace file');
    await (await driver.findByXPath('//*[@role="radio"][normalize-space(.)="dark"]')).click();
    await driver.waitFor('dark theme', async () => {
      const theme = await driver.execute<string | null>(
        'return document.documentElement.getAttribute("data-theme")',
      );
      return theme === 'dark' ? true : null;
    });
    await (await driver.findByXPath('//*[@role="radio"][normalize-space(.)="system"]')).click();
  });

  it('About carries the author and the story of the name', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="About"]')).click();
    await driver.waitForText('Alex Justino');
    await driver.waitForText('Apache');
    const version = await driver.waitForText('0.1.0');
    expect(await version.displayed()).toBe(true);
    await session.screenshot('about');
  });
});
