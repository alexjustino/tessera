import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface RawPage {
  id: string;
  title: string;
  section_id: string | null;
}

interface RawSection {
  id: string;
  name: string;
  color: string | null;
}

/**
 * A notebook in sections, as OneNote keeps one: a coloured section is made, a page is
 * made in it, a page moves between sections, a section is recoloured, and deleting
 * one sends its pages back to Quick notes without deleting any.
 */
describe('notes in sections', () => {
  let session: Session;

  const invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    const result = await session.driver.executeAsync<T | { __error: string }>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: String(e) }));',
      [command, args],
    );
    if (result !== null && typeof result === 'object' && '__error' in result) {
      throw new Error(result.__error);
    }
    return result as T;
  };

  const press = async (selector: string) => {
    const { driver } = session;
    await driver.waitFor(selector, async () => {
      const control = await driver.find(selector);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const pressText = async (text: string) => {
    const { driver } = session;
    await driver.waitFor(text, async () => {
      const control = await driver.findByXPath(`//button[normalize-space(.)="${text}"]`);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const pages = () => invoke<RawPage[]>('pages_list');
  const sections = () => invoke<RawSection[]>('sections_list');
  const heading = () =>
    session.driver.execute<string>('return document.querySelector("main h1")?.textContent ?? ""');

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitFor('the opening to go', async () =>
      (await driver.findAll('#opening')).length === 0 ? true : null,
    );
    await invoke('page_create', { title: 'Loose thought', position: 'V' });
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    await (await session.driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();
    await session.driver.waitForElement('ul[aria-label="Sections"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a page never filed is in Quick notes', async () => {
    const { driver } = session;
    await driver.waitForElement('[data-section="quick"][aria-current="true"]');
    await driver.waitForElement('button[aria-label="Open Loose thought"]');
  });

  it('makes a coloured section, and lands in it', async () => {
    const { driver } = session;
    await press('button[aria-label="New section"]');
    const name = await driver.waitForElement('input[aria-label="Section name"]');
    await name.sendKeys('Projects');
    await press('[role="radiogroup"][aria-label="Section colour"] [aria-label="Teal"]');
    await pressText('Make the section');
    const made = await driver.waitFor(
      'the section',
      async () => (await sections()).find((section) => section.name === 'Projects') ?? null,
    );
    expect(made.color).toBe('teal');
    await driver.waitForElement(`[data-section="${made.id}"][aria-current="true"]`);
    await driver.waitForText('No pages here yet.');
  });

  it('a new page is made in the section on screen', async () => {
    const { driver } = session;
    await press('button[aria-label="New page"]');
    const page = await driver.waitFor(
      'the page',
      async () =>
        (await pages()).find((one) => one.title !== 'Loose thought' && one.section_id !== null) ??
        null,
    );
    const projects = (await sections()).find((section) => section.name === 'Projects');
    expect(page.section_id).toBe(projects?.id);
    await driver.chord(Keys.ESCAPE);
  });

  it('moves a page to another section from its own header', async () => {
    const { driver } = session;
    await press('[data-section="quick"]');
    await press('button[aria-label="Open Loose thought"]');
    await driver.waitFor('the page', async () =>
      (await heading()) === 'Loose thought' ? true : null,
    );
    const projects = (await sections()).find((section) => section.name === 'Projects');
    await driver.waitFor('the section picker', async () => {
      const select = await driver.find('select[aria-label="Section of Loose thought"]');
      await driver.execute(
        'const s = arguments[0]; s.value = arguments[1]; s.dispatchEvent(new Event("change", { bubbles: true }));',
        [{ [ELEMENT]: select.id }, projects?.id],
      );
      return true;
    });
    await driver.waitFor('the page filed', async () => {
      const moved = (await pages()).find((page) => page.title === 'Loose thought');
      return moved?.section_id === projects?.id ? true : null;
    });
    await driver.waitForElement(`[data-section="${projects?.id}"][aria-current="true"]`);
    await session.screenshot('notes-sections');
  });

  it('recolours a section', async () => {
    const { driver } = session;
    await press('button[aria-label="Edit Projects"]');
    await press('[role="radiogroup"][aria-label="Section colour"] [aria-label="Purple"]');
    await pressText('Save');
    await driver.waitFor('the new colour', async () =>
      (await sections()).find((section) => section.name === 'Projects')?.color === 'purple'
        ? true
        : null,
    );
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('will not take a name already used, or Quick notes', async () => {
    const { driver } = session;
    await press('button[aria-label="New section"]');
    const name = await driver.waitForElement('input[aria-label="Section name"]');
    await name.sendKeys('projects');
    await pressText('Make the section');
    await driver.waitForText('There is already a section with that name.');
    await name.clear();
    await name.sendKeys('Quick notes');
    await pressText('Make the section');
    await driver.waitForText('Quick notes is already there');
    await pressText('Cancel');
    expect((await sections()).length).toBe(1);
  });

  it('deleting a section sends its pages to Quick notes, and deletes none', async () => {
    const { driver } = session;
    const before = (await pages()).length;
    await press('button[aria-label="Edit Projects"]');
    await pressText('Delete…');
    await driver.waitForText('back to Quick notes. No page is deleted.');
    await pressText('Delete the section');
    await driver.waitFor('the section gone', async () =>
      (await sections()).length === 0 ? true : null,
    );
    const after = await pages();
    expect(after.length).toBe(before);
    expect(after.every((page) => page.section_id === null)).toBe(true);
  });
});
