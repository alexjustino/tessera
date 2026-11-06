import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Marked lines that know when their work is done: a To do line is ticked where it
 * is written, a Follow up line is done when its task is, and Marked lines goes to the
 * exact line it lists.
 */
describe('marked lines that are done', () => {
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

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  const settled = () =>
    session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
  const prose = () => session.driver.find('.tessera-prose');

  const openPage = async () => {
    const { driver } = session;
    await goTo('Notes');
    await driver.waitFor('the page', async () => {
      // Notes opens again on the page that was open, so it may already be there.
      const open = await driver.execute<string>(
        'return document.querySelector("main h1")?.textContent ?? ""',
      );
      if (open === 'Vendor call') return true;
      const button = await driver.findByXPath('//button[normalize-space(.)="Vendor call"]');
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: button.id }]);
      return true;
    });
    await driver.waitForElement('.tessera-prose');
  };

  /** Wait for the editor's save, which runs a moment after typing stops. */
  const saved = (text: string) =>
    session.driver.waitFor(`"${text}" saved`, async () => {
      const pages = await invoke<Array<{ id: string; title: string }>>('pages_list');
      const page = pages.find((one) => one.title === 'Vendor call');
      const blocks = await invoke<Array<{ content: unknown }>>('blocks_list', {
        ownerKind: 'page',
        ownerId: page?.id,
      });
      return JSON.stringify(blocks).includes(text) ? blocks : null;
    });

  beforeAll(async () => {
    session = await startSession();
    await settled();
    await invoke('page_create', { title: 'Vendor call', position: 'V' });
    await session.restart();
    await settled();
    await openPage();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a To do line carries a tick, and ticking it is saved', async () => {
    const { driver } = session;
    await (await prose()).click();
    await (await prose()).sendKeys('Call the vendor');
    await driver.chord(Keys.CONTROL, '1');
    const tick = await driver.waitFor('the tick', () =>
      driver.find('input[aria-label="Done: Call the vendor"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: tick.id }]);
    await driver.waitForElement('.tessera-prose [data-note-marker="todo"][data-note-done="true"]');
    await saved('"noteDone":true');
  });

  it('a Follow up line is done when its task is', async () => {
    const { driver } = session;
    await (await prose()).sendKeys(`${Keys.ENTER}Send the quote`);
    await (await driver.find('button[aria-label="Follow up on this line"]')).click();
    await driver.waitForElement('input[aria-label="Follow-up task"]');
    await (await driver.findByXPath('//button[normalize-space(.)="Add follow-up"]')).click();
    await driver.waitForElement('.tessera-prose [data-note-marker="followup"]');
    await saved('"noteTask"');

    // Not done while its task is open.
    expect(
      await driver.findAll('.tessera-prose [data-note-marker="followup"][data-note-done="true"]'),
    ).toEqual([]);

    const task = (
      await invoke<Array<{ id: string; title: string }>>('items_list', {
        collectionId: null,
        includeCompleted: true,
      })
    ).find((item) => item.title === 'Send the quote');
    await invoke('item_set_completed', { id: task?.id, completed: true });
    await session.restart();
    await settled();
    await openPage();
    await session.driver.waitForElement(
      '.tessera-prose [data-note-marker="followup"][data-note-done="true"]',
    );
    await session.screenshot('notes-done');
  });

  it('the tick survived the restart', async () => {
    const tick = await session.driver.waitFor('the tick', () =>
      session.driver.find('input[aria-label="Done: Call the vendor"]'),
    );
    expect(await tick.property('checked')).toBe(true);
  });

  it('Marked lines says which are done, and goes to the exact line', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Marked lines"]')).click();
    await driver.waitForElement('[data-testid="marker-followup"]');
    const done = await driver.findAll('[data-line-done="true"]');
    expect(done.length).toBe(2);
    await session.screenshot('marked-lines-done');

    await driver.waitFor('the line', async () => {
      const line = await driver.findByXPath(
        '//*[@data-testid="marker-followup"]//button[contains(., "Send the quote")]',
      );
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: line.id }]);
      return true;
    });
    await driver.waitFor('the caret on the line', async () => {
      const at = await driver.execute<string>(
        'const n = window.getSelection()?.anchorNode; return (n?.nodeType === 3 ? n.parentElement : n)?.closest("p, h1, h2, h3")?.textContent ?? ""',
      );
      return at.includes('Send the quote') ? true : null;
    });
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('a Question has no tick, and is never done', async () => {
    const { driver } = session;
    const editor = await prose();
    await editor.click();
    await driver.chord(Keys.CONTROL, Keys.END);
    await editor.sendKeys(`${Keys.ENTER}Is the price final`);
    await driver.chord(Keys.CONTROL, '3');
    await driver.waitForElement('.tessera-prose [data-note-marker="question"]');
    expect(await driver.findAll('input[aria-label="Done: Is the price final"]')).toEqual([]);
    expect(
      await driver.findAll('.tessera-prose [data-note-marker="question"][data-note-done="true"]'),
    ).toEqual([]);
  });
});
