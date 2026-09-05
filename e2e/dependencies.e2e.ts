import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Dependencies, end to end: state that one task waits for another, see it on
 * the row, take it back, and be refused a loop — by the picker, which does not
 * offer it, and by the host, which would not store it either.
 */
describe('dependencies', () => {
  let session: Session;

  /** Open a task's detail drawer through the control the row offers. */
  const openDetail = async (title: string) => {
    const { driver } = session;
    const open = await driver.waitFor(`the Open control for ${title}`, () =>
      driver.find(`button[aria-label="Open ${title}"]`),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
  };

  const closeDetail = async () => {
    const { driver } = session;
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  };

  /** Choose a blocker in the picker and add it. */
  const waitFor = async (blockerTitle: string) => {
    const { driver } = session;
    const select = await driver.waitForElement('select[aria-label="Wait for another task"]');
    const option = await driver.findByXPath(
      `//select[@aria-label="Wait for another task"]/option[normalize-space(.)="${blockerTitle}"]`,
    );
    const value = await option.attribute('value');
    await driver.execute(
      'const s = arguments[0]; s.value = arguments[1]; s.dispatchEvent(new Event("change", { bubbles: true }));',
      [{ [ELEMENT]: select.id }, value],
    );
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Add"]')
    ).click();
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Design it', 'Build it', 'Ship it']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('states that one task waits for another', async () => {
    const { driver } = session;
    await openDetail('Build it');
    await driver.waitForText('Nothing. This task can start whenever you like.');

    await waitFor('Design it');
    const listed = await driver.waitFor('Design it in the waiting list', async () => {
      const rows = await driver.findAll('ul[aria-label="Waiting for"] li');
      return rows.length === 1 ? rows[0] : null;
    });
    expect(await listed!.text()).toContain('Design it');
    await closeDetail();
  });

  it('the waiting row says so, and the one it waits for does not', async () => {
    const { driver } = session;
    const blocked = await driver.waitFor('the Blocked chip', async () => {
      const chips = await driver.findAllByXPath(
        '//li[contains(normalize-space(.), "Build it")][not(.//li)]//span[normalize-space(.)="Waiting"]',
      );
      return chips[0] ?? null;
    });
    expect(await blocked.displayed()).toBe(true);

    const onBlocker = await driver.findAllByXPath(
      '//li[contains(normalize-space(.), "Design it")][not(.//li)]//span[normalize-space(.)="Waiting"]',
    );
    expect(onBlocker.length).toBe(0);
  });

  it('finishing the blocker releases what waited on it', async () => {
    const { driver } = session;
    const box = await driver.findByXPath(
      '//li[contains(normalize-space(.), "Design it")][not(.//li)]//input[@type="checkbox"]',
    );
    await box.click();
    await driver.waitFor('completed', async () => ((await box.property('checked')) ? true : null));

    await driver.waitFor('the chip is gone', async () => {
      const chips = await driver.findAllByXPath(
        '//li[contains(normalize-space(.), "Build it")][not(.//li)]//span[normalize-space(.)="Waiting"]',
      );
      return chips.length === 0 ? true : null;
    });

    // Undo, so the rest of the file reasons about the graph it built.
    await box.click();
    await driver.waitFor('open again', async () =>
      (await box.property('checked')) === false ? true : null,
    );
  });

  it('the picker will not offer a task that would close a loop', async () => {
    const { driver } = session;
    // Build it waits for Design it. Opening Design it, "Build it" must not be
    // offered as something it could wait for.
    await openDetail('Design it');
    const offered = await driver.findAllByXPath(
      '//select[@aria-label="Wait for another task"]/option',
    );
    const labels = await Promise.all(offered.map((option) => option.text()));
    expect(labels).toContain('Ship it');
    expect(labels).not.toContain('Build it');
    await driver.waitForText('is not offered');
    await closeDetail();
  });

  it('the host refuses a loop even when the picker is bypassed', async () => {
    const { driver } = session;
    // The interface would never send this; storage is the last line, and the
    // last line must hold on its own.
    const [designId, buildId] = await driver.executeAsync<string[]>(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('items_list', { collectionId: 'tasks', includeCompleted: true })
         .then((items) => done([
           items.find((i) => i.title === 'Design it').id,
           items.find((i) => i.title === 'Build it').id,
         ]));`,
    );
    const refusal = await driver.executeAsync<string>(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('dependency_link', { blockerId: arguments[0], blockedId: arguments[1] })
         .then(() => done('stored it'), (e) => done(e && e.message ? e.message : JSON.stringify(e)));`,
      [buildId, designId],
    );
    expect(refusal).toContain('loop');
  });

  it('takes the dependency back, and the row stops saying it is waiting', async () => {
    const { driver } = session;
    await openDetail('Build it');
    await (await driver.findByXPath('//button[@aria-label="Stop waiting for Design it"]')).click();
    await driver.waitForText('Nothing. This task can start whenever you like.');
    await closeDetail();

    await driver.waitFor('no chip anywhere', async () => {
      const chips = await driver.findAllByXPath('//span[normalize-space(.)="Waiting"]');
      return chips.length === 0 ? true : null;
    });
  });

  it('the graph survives a restart', async () => {
    const { driver } = session;
    await openDetail('Ship it');
    await waitFor('Build it');
    await driver.waitForText('Build it');
    await closeDetail();

    await session.restart();
    await session.driver.waitForText('Ship it');
    await openDetail('Ship it');
    const rows = await session.driver.waitFor('the blocker after a restart', async () => {
      const found = await session.driver.findAll('ul[aria-label="Waiting for"] li');
      return found.length === 1 ? found : null;
    });
    expect(await rows[0]!.text()).toContain('Build it');
    await closeDetail();
  });
});
