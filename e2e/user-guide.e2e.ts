import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The User Guide (ADR-064): F1 opens it from anywhere, its chapters say what
 * Tessera does with a scene that plays when it comes into view, a search finds a
 * section by its words, and "Try it" goes to the place. Each chapter is
 * photographed in both themes, so a person can read it.
 */
describe('the user guide', () => {
  let session: Session;

  const press = async (xpath: string) => {
    const { driver } = session;
    await driver.waitFor(xpath, async () => {
      const control = await driver.findByXPath(xpath);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const chapterTitle = async () =>
    (await session.driver.waitForElement('#guide-chapter-title')).text();

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens on F1 from anywhere in the window', async () => {
    const { driver } = session;
    await press('//nav//button[normalize-space(.)="Calendar"]');
    await driver.chord(Keys.F1);
    expect(await chapterTitle()).toBe('Getting started');
    const current = await driver.findByXPath('//nav//button[@aria-current="page"]');
    expect(await current.text()).toBe('Guide');
  });

  it('lists every chapter, and plays a scene once it is in view', async () => {
    const { driver } = session;
    const chapters = await driver.findAll('nav[aria-label="Chapters"] li');
    expect(chapters.length).toBe(10);
    const scene = await driver.waitForElement('figure.gs');
    await driver.waitFor('the scene to play', async () =>
      (await scene.attribute('data-state')) === 'playing' ? true : null,
    );
    await press('//figure[contains(@class,"gs")]//button[@aria-label="Replay"]');
    expect(await scene.attribute('data-state')).toBe('playing');
  });

  it('finds a section by its words, and opens it', async () => {
    const { driver } = session;
    const search = await driver.waitForElement('input[aria-label="Search the guide"]');
    await search.sendKeys('journal');
    await press(
      '//section[@aria-label="Search results"]//button[contains(., "Plan my day, and close it")]',
    );
    expect(await chapterTitle()).toBe('The day');
    await driver.waitForElement('[data-section="ritual"] figure[data-scene="ritual"]');
  });

  it('takes the person to the place with Try it', async () => {
    const { driver } = session;
    await press('//*[@data-section="ritual"]//button[normalize-space(.)="Open Today"]');
    await driver.waitForElement('[data-testid="ritual"]');
    const current = await driver.findByXPath('//nav//button[@aria-current="page"]');
    expect(await current.text()).toBe('Today');
  });

  it('is in the palette, and every place in the sidebar is too', async () => {
    const { driver } = session;
    for (const [command, heading] of [
      ['>Go to Reports', 'Reports'],
      ['>Open the Guide', 'Guide'],
    ] as const) {
      await driver.chord(Keys.CONTROL, 'k');
      const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
      await box.sendKeys(command);
      await driver.waitFor(
        'a first option',
        async () => (await driver.findAll('[role="option"]'))[0] ?? null,
      );
      await box.sendKeys(Keys.ENTER);
      await driver.waitFor(`the ${heading} page`, async () => {
        const current = await driver.findAllByXPath('//nav//button[@aria-current="page"]');
        return current.length > 0 && (await current[0]!.text()) === heading ? true : null;
      });
    }
  });

  it('can be read, chapter by chapter, in both themes', async () => {
    const { driver } = session;
    for (const theme of ['light', 'dark'] as const) {
      await press('//nav//button[normalize-space(.)="Settings"]');
      await driver.waitForText('Kept in your workspace file');
      await press(`//*[@role="radio"][normalize-space(.)="${theme}"]`);
      await driver.chord(Keys.F1);
      const count = (await driver.findAll('nav[aria-label="Chapters"] li')).length;
      for (let index = 1; index <= count; index += 1) {
        await press(`(//nav[@aria-label="Chapters"]//button)[${index}]`);
        await driver.waitForElement('#guide-chapter-title');
        // Long enough for the first scene to finish.
        await new Promise((resolve) => setTimeout(resolve, 2600));
        await session.screenshot(`guide-${theme}-${String(index).padStart(2, '0')}`);
      }
    }
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('says so when nothing matches, instead of an empty page', async () => {
    const { driver } = session;
    const search = await driver.waitForElement('input[aria-label="Search the guide"]');
    await search.sendKeys('blockchain');
    await driver.waitForText('Nothing in the guide matches “blockchain”');
    expect((await driver.findAll('section[aria-label="Search results"]')).length).toBe(0);
  });
});
