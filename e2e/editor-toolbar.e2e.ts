import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * The formatting bar over a page of notes: it is there without being asked for,
 * it acts on what is selected, and what it does survives a restart.
 */
describe('the formatting bar', () => {
  let session: Session;

  const press = async (label: string) =>
    (
      await session.driver.find(`[data-testid="editor-toolbar"] button[aria-label="${label}"]`)
    ).click();

  const prose = () => session.driver.find('.tessera-prose');

  const html = async () =>
    session.driver.execute<string>('return document.querySelector(".tessera-prose").innerHTML');

  const selectAll = () => session.driver.chord(Keys.CONTROL, 'a');

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitForElement('nav[aria-label="Main"]');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();
    await (await driver.findByXPath('//button[normalize-space(.)="New page"]')).click();
    await driver.waitForElement('.tessera-prose');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('is there, over the page', async () => {
    await session.driver.waitForElement('[role="toolbar"][aria-label="Formatting"]');
    await session.screenshot('editor-toolbar');
  });

  it('marks what is selected, and says so', async () => {
    const { driver } = session;
    await (await prose()).click();
    await (await prose()).sendKeys('Nozomi follow up');
    await selectAll();
    for (const [label, tag] of [
      ['Bold', 'strong'],
      ['Italic', 'em'],
      ['Underline', 'u'],
      ['Highlight', 'mark'],
    ] as const) {
      await press(label);
      await driver.waitFor(`${label} applied`, async () =>
        (await html()).includes(`<${tag}`) ? true : null,
      );
    }
    const bold = await driver.find('button[aria-label="Bold"]');
    expect(await bold.attribute('aria-pressed')).toBe('true');
  });

  it('turns the line into a list', async () => {
    const { driver } = session;
    await press('Bulleted list');
    await driver.waitFor('a list', async () => ((await html()).includes('<ul') ? true : null));
    await session.screenshot('editor-toolbar-marked');
  });

  it('keeps it through a restart', async () => {
    // Longer than the save delay, so the document is on disk.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await session.restart();
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();
    await driver.waitFor('the marks', async () => {
      const found = await driver.findAll('.tessera-prose mark');
      return found.length > 0 ? true : null;
    });
    const text = await html();
    expect(text).toContain('<strong');
    expect(text).toContain('<ul');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('refuses a link that is not a web address', async () => {
    const { driver } = session;
    await (await prose()).click();
    await selectAll();
    await press('Link');
    const field = await driver.waitForElement('input[aria-label="Link address"]');
    await field.sendKeys(`javascript:alert(1)${Keys.ENTER}`);
    await driver.waitForText('A link has to start with http or https.');
    expect(await html()).not.toContain('javascript:');
  });
});
