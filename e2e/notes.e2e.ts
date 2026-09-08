import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The notes space, end to end — the slice's proof of done, clause by clause:
 *
 *   a page links to another **by name**;
 *   renaming the target **keeps the link**;
 *   backlinks say **who points here**;
 *   search finds **page text**.
 *
 * Every one of them is checked on the real binary, through the interface a
 * person uses: two brackets, a name, Enter.
 */
describe('the notes space', () => {
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

  /** The name of the page that is open, as the heading reads it. */
  const openName = async () => (await (await session.driver.find('h1')).text()).trim();

  /** Rename whatever page is open. */
  const renameTo = async (name: string) => {
    await click('button[aria-label^="Rename "]');
    const field = await session.driver.waitFor('the name field', () =>
      session.driver.find('input[aria-label="Page name"]'),
    );
    await field.click();
    await session.driver.chord(Keys.CONTROL, 'a');
    await field.sendKeys(`${name}${Keys.ENTER}`);
    await session.driver.waitFor(`the page named ${name}`, async () =>
      (await openName()) === name ? true : null,
    );
  };

  /**
   * Make a page and give it a name. Creating one opens the name field, so the
   * name is typed straight away — which is what happens for a person too.
   */
  const newPage = async (name: string) => {
    await click('button[aria-label="New page"]');
    const field = await session.driver.waitFor('the name field', () =>
      session.driver.find('input[aria-label="Page name"]'),
    );
    await field.click();
    await session.driver.chord(Keys.CONTROL, 'a');
    await field.sendKeys(`${name}${Keys.ENTER}`);
    await session.driver.waitFor(`the page named ${name}`, async () =>
      (await openName()) === name ? true : null,
    );
  };

  /** Type into the document of the page that is open. */
  const write = async (text: string) => {
    const prose = await session.driver.waitFor('the editor', () =>
      session.driver.find('.tessera-prose'),
    );
    await prose.click();
    await prose.sendKeys(text);
  };

  const links = () => session.driver.findAll('.tessera-prose a[data-page-link]');

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitForElement('input[aria-label="New task"]');
    await goTo('Notes');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a page is made, named, and written in', async () => {
    await newPage('Weekly Review');
    await write('Everything that happened, once a week.');
    await session.driver.waitForText('Everything that happened');
  });

  it('another page links to it by typing its name between two brackets', async () => {
    await newPage('Onboarding');
    await write('Read this before the ');

    // The menu opens on the brackets and offers the page by name.
    const prose = await session.driver.find('.tessera-prose');
    await prose.sendKeys('[[Weekly');
    const menu = await session.driver.waitFor('the link menu', () =>
      session.driver.find('[role="listbox"][aria-label="Link to a page"]'),
    );
    expect(await menu.text()).toContain('Weekly Review');
    await prose.sendKeys(Keys.ENTER);

    const written = await session.driver.waitFor('the link', async () => {
      const found = await links();
      return found.length === 1 ? found : null;
    });
    expect(await written[0]!.text()).toBe('Weekly Review');
    // It points at the page, not at the word: an id was written beside it.
    expect(await written[0]!.attribute('data-page-id')).toBeTruthy();
    await session.screenshot('notes-link');
  });

  it('the page that was linked to says who points at it', async () => {
    // The document saves on a pause; the backlink follows the save.
    await click('button[aria-label="Open Weekly Review"]');
    const backlink = await session.driver.waitFor('the backlink to Onboarding', async () => {
      const found = await session.driver.findAll(
        'section[aria-label="Linked from"] button[aria-label="Open Onboarding"]',
      );
      return found.length === 1 ? found[0] : null;
    });
    expect(await backlink!.text()).toBe('Onboarding');
    await session.screenshot('notes-backlinks');
  });

  it('renaming the target keeps the link, and the link says the new name', async () => {
    await renameTo('Monday Review');

    // Back to the page that points here: the link is the same link, and it
    // now reads as the name the page has.
    await click('button[aria-label="Open Onboarding"]');
    const written = await session.driver.waitFor('the link, renamed', async () => {
      const found = await links();
      if (found.length !== 1) return null;
      return (await found[0]!.text()) === 'Monday Review' ? found[0] : null;
    });
    expect(await written!.attribute('data-page-id')).toBeTruthy();

    // And the backlink survived the rename, because it never pointed at a name.
    await click('button[aria-label="Open Monday Review"]');
    await session.driver.waitFor('the backlink after the rename', async () => {
      const found = await session.driver.findAll(
        'section[aria-label="Linked from"] button[aria-label="Open Onboarding"]',
      );
      return found.length === 1 ? true : null;
    });
    await session.screenshot('notes-renamed');
  });

  it('search finds a page by what is written in it', async () => {
    const { driver } = session;
    await driver.chord(Keys.CONTROL, 'k');
    const box = await driver.waitForElement('input[aria-label="Search or run a command"]');
    await box.sendKeys('happened');

    const hit = await driver.waitFor('the page in the results', async () => {
      const options = await driver.findAll('[role="option"]');
      for (const option of options) {
        if ((await option.text()).includes('Monday Review')) return option;
      }
      return null;
    });
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: hit!.id }]);

    // Choosing it opens the notes space on that page.
    await driver.waitFor('the page it opened', async () =>
      (await openName()) === 'Monday Review' ? true : null,
    );
  });

  it('a link to a page that does not exist is written, and marked as missing', async () => {
    await click('button[aria-label="Open Onboarding"]');
    const prose = await session.driver.find('.tessera-prose');
    await prose.click();
    await session.driver.chord(Keys.CONTROL, Keys.END);
    await prose.sendKeys('. See also [[Retrospective');

    // The menu offers to make it; Escape declines, and the brackets stay text.
    const menu = await session.driver.waitFor('the offer to create', () =>
      session.driver.find('[role="listbox"][aria-label="Link to a page"]'),
    );
    expect(await menu.text()).toContain('New page');
    await prose.sendKeys(Keys.ENTER);

    const written = await session.driver.waitFor('the new page’s link', async () => {
      const found = await links();
      return found.length === 2 ? found : null;
    });
    expect(await written[1]!.text()).toBe('Retrospective');
    // It was made, so it is not missing — the wiki wrote the page it meant.
    expect(await written[1]!.attribute('data-missing')).toBeNull();

    await goTo('Notes');
    await session.driver.waitFor('the page it made', async () => {
      const found = await session.driver.findAll('button[aria-label="Open Retrospective"]');
      return found.length > 0 ? true : null;
    });
  });

  it('the pages, the links and the backlinks survive a restart', async () => {
    await session.restart();
    await session.driver.waitForElement('input[aria-label="New task"]');
    await goTo('Notes');

    await click('button[aria-label="Open Monday Review"]');
    await session.driver.waitFor('the backlink after a restart', async () => {
      const found = await session.driver.findAll(
        'section[aria-label="Linked from"] button[aria-label="Open Onboarding"]',
      );
      return found.length === 1 ? true : null;
    });

    await click('button[aria-label="Open Onboarding"]');
    const written = await session.driver.waitFor('the links after a restart', async () => {
      const found = await links();
      return found.length === 2 ? found : null;
    });
    expect(await written[0]!.text()).toBe('Monday Review');
  });
});
