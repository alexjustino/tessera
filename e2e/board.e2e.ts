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

  /** Every task as the host holds it, in the host's order. */
  const tasks = () =>
    session.driver.executeAsync<{ id: string; title: string; position: string }[]>(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('items_list', { collectionId: 'tasks', includeCompleted: true })
         .then(done);`,
    );

  const spoken = () =>
    session.driver.execute<string>(
      'return [...document.querySelectorAll("[aria-live]")].map((region) => region.textContent).join(" ");',
    );

  /**
   * Pick a card up by its handle, walk it left until it is over `droppable`, and drop.
   *
   * Tasks start in "No value", the last column, and an arrow key goes to the
   * nearest thing that way, which is often a card in the same column. So the walk
   * reads where it got to, rather than counting presses. Space, because
   * `Keys.ENTER` is the numeric keypad's key, which the drag library ignores.
   */
  const drag = async (title: string, droppable: string, column: string) => {
    const { driver } = session;
    const keyOf = async () => (await tasks()).find((task) => task.title === title)?.position;
    const before = await keyOf();
    const handle = await driver.waitForElement(`button[aria-label="Move ${title}"]`);
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: handle.id }]);
    await driver.chord(' ');
    await driver.waitFor(`${title} to be picked up`, async () =>
      (await spoken()).includes('was moved over droppable area') ? true : null,
    );
    await driver.waitFor(`${title} to reach ${droppable}`, async () => {
      if ((await spoken()).includes(`moved over droppable area ${droppable}.`)) return true;
      await driver.chord(Keys.ARROW_LEFT);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return null;
    });
    await driver.chord(' ');
    await driver.waitFor(`${title} to be dropped in ${column}`, async () =>
      (await spoken()).includes(`Moved ${title} to ${column}`) ? true : null,
    );
    await driver.waitFor(`the new key of ${title}`, async () =>
      (await keyOf()) !== before ? true : null,
    );
  };

  const expectEveryKeyToDiffer = async () => {
    const keys = (await tasks()).map((task) => `${task.title}=${task.position}`);
    const positions = keys.map((key) => key.split('=')[1]);
    expect(new Set(positions).size, keys.join(' ')).toBe(keys.length);
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
    await drag('Third', 'done', 'Done');
    await expectEveryKeyToDiffer();
  });

  it('gives a card dropped beside another a key no other card has', async () => {
    const third = (await tasks()).find((task) => task.title === 'Third')!;
    await drag('Fourth', third.id, 'Done');
    await expectEveryKeyToDiffer();
    await session.screenshot('board-after-moves');
  });

  it('keeps what was written after the process is killed and restarted', async () => {
    const written = await tasks();
    await session.restart();
    await session.driver.waitForElement('input[aria-label="New task"]');
    expect(await tasks()).toEqual(written);
  });
});
