import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * A card moved by keyboard, written through to the file.
 *
 * Columns show part of a collection and order keys belong to all of it, so what
 * a drop writes has to be read back from the host: on screen, two cards with one
 * key in different columns look exactly like two cards with two.
 */
describe('the board', () => {
  let session: Session;

  /** Every task's order key, as the host holds it. */
  const positions = () =>
    session.driver.executeAsync<Record<string, string>>(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('items_list', { collectionId: 'tasks', includeCompleted: true })
         .then((items) => done(Object.fromEntries(items.map((item) => [item.title, item.position]))));`,
    );

  /**
   * Pick a card up by its handle, move it one column to the left, and drop it.
   * New tasks start in "No value", the last column. Space, because `Keys.ENTER` is
   * the numeric keypad's key, which the drag library does not listen for.
   */
  const moveLeft = async (title: string) => {
    const { driver } = session;
    const before = await positions();
    const handle = await driver.waitForElement(`button[aria-label="Move ${title}"]`);
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: handle.id }]);
    await driver.chord(' ');
    await driver.chord(Keys.ARROW_LEFT);
    await driver.chord(' ');
    await driver.waitFor(`the new key of ${title}`, async () => {
      const now = await positions();
      return now[title] !== before[title] ? true : null;
    });
  };

  const expectEveryKeyToDiffer = async () => {
    const keys = Object.values(await positions());
    expect(new Set(keys).size).toBe(keys.length);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['First', 'Second', 'Third', 'Fourth']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Board"]')).click();
    await driver.waitForElement('button[aria-label="Move Fourth"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('gives a card dropped into an empty column a key no other card has', async () => {
    // The column has no neighbours to read, which used to mean the first key
    // there is, every time: the one the first task in the list already holds.
    await moveLeft('Fourth');
    await expectEveryKeyToDiffer();
  });

  it('gives a card dropped beside another a key no other card has', async () => {
    await moveLeft('Third');
    await expectEveryKeyToDiffer();
    await moveLeft('Second');
    await expectEveryKeyToDiffer();
    await session.screenshot('board-after-moves');
  });

  it('keeps what was written after the process is killed and restarted', async () => {
    const written = await positions();
    await session.restart();
    await session.driver.waitForElement('input[aria-label="New task"]');
    expect(await positions()).toEqual(written);
  });
});
