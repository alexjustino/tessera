import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The Mosaic with real work in it: a task nobody has sized yet says so, a size
 * puts it on the week, and the tiles can be pressed.
 */
describe('using the mosaic', () => {
  let session: Session;

  const committed = () => session.driver.findAll('[role="gridcell"] [data-state="committed"]');

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Size me${Keys.ENTER}`);
    await driver.waitForText('Size me');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Mosaic"]')).click();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says which tasks it cannot count, and a size puts one on the week', async () => {
    const { driver } = session;
    await driver.waitForElement('[data-testid="fill-the-week"]');
    await driver.waitForText('1 task has no estimate yet');
    expect((await committed()).length).toBe(0);
    await session.screenshot('mosaic-fill');

    await (await driver.find('button[aria-label="Size me takes 1h"]')).click();
    await driver.waitFor('the card gone', async () =>
      (await driver.findAll('[data-testid="fill-the-week"]')).length === 0 ? true : null,
    );
    // Late on the last working day the work lands on next week, which is right.
    await driver.waitFor('a committed tile', async () => {
      if ((await committed()).length > 0) return true;
      await (await driver.find('button[aria-label="The week after"]')).click();
      return (await committed()).length > 0 ? true : null;
    });
  });

  it('opens the task from its tile', async () => {
    const { driver } = session;
    const [tile] = await committed();
    await tile?.click();
    await driver.waitForElement('[role="dialog"] input[aria-label="Task name"]');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  });

  it('sets a free hour aside for a task', async () => {
    const { driver } = session;
    const before = (await driver.findAll('[role="gridcell"] [data-state="reserved"]')).length;
    const free = await driver.find('[role="gridcell"][aria-label*=": Free"]');
    await free.click();
    await driver.waitForElement('[role="dialog"]');
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Size me"]')
    ).click();
    await driver.waitFor('a reserved tile', async () =>
      (await driver.findAll('[role="gridcell"] [data-state="reserved"]')).length > before
        ? true
        : null,
    );
  });

  it('says what is in an hour when the pointer or the focus comes to it', async () => {
    const { driver } = session;
    const free = await driver.find('[role="gridcell"][aria-label*=": Free"]');
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: free.id }]);
    const panel = await driver.waitForElement('[data-testid="inspector"]');
    expect(await panel.text()).toContain('Free');
    expect(await panel.text()).toContain('Set this hour aside');
  });

  it('takes a task dragged from the list onto a free hour', async () => {
    const { driver } = session;
    const input = 'input[aria-label="New task"]';
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Tasks"]')).click();
    await (await driver.waitForElement(input)).sendKeys(`Dragged here${Keys.ENTER}`);
    await driver.waitForText('Dragged here');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Mosaic"]')).click();
    const queued = await driver.waitFor('the task in the list', () =>
      driver.findByXPath('//*[@data-testid="task-queue"]//li[contains(., "Dragged here")]'),
    );
    const before = (await driver.findAll('[role="gridcell"] [data-state="reserved"]')).length;
    const free = await driver.find('[role="gridcell"][aria-label*=": Free"]');
    const points = await driver.execute<{
      from: { x: number; y: number };
      to: { x: number; y: number };
    }>(
      `const [source, target] = arguments;
       target.scrollIntoView({ block: 'center' });
       const a = source.getBoundingClientRect();
       const b = target.getBoundingClientRect();
       return {
         from: { x: a.left + 8, y: a.top + a.height / 2 },
         to: { x: b.left + b.width / 2, y: b.top + b.height / 2 },
       };`,
      [{ [ELEMENT]: queued.id }, { [ELEMENT]: free.id }],
    );
    await driver.pointer([
      { type: 'move', ...points.from },
      { type: 'down' },
      { type: 'move', x: (points.from.x + points.to.x) / 2, y: (points.from.y + points.to.y) / 2 },
      { type: 'move', ...points.to },
      { type: 'up' },
    ]);
    await driver.releasePointer();
    await driver.waitFor('a reserved tile', async () =>
      (await driver.findAll('[role="gridcell"] [data-state="reserved"]')).length > before
        ? true
        : null,
    );
  });

  it('shows the weeks behind this one, and pressing one goes there', async () => {
    const { driver } = session;
    const history = await driver.waitForElement('[data-testid="mosaic-history"]');
    const weeks = await driver.findAll('[data-testid="mosaic-history"] button');
    expect(weeks).toHaveLength(16);
    expect(await history.text()).toBe('');
    const shown = await (await driver.find('[data-testid="mosaic-week"]')).text();
    await weeks[0]!.click();
    await driver.waitFor('another week', async () =>
      (await (await driver.find('[data-testid="mosaic-week"]')).text()) !== shown ? true : null,
    );
    await (await driver.find('button[aria-label="This week"]')).click();
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('leaves a tile that has gone alone', async () => {
    const { driver } = session;
    await (await driver.find('button[aria-label="The week before"]')).click();
    await (await driver.find('button[aria-label="The week before"]')).click();
    const gone = await driver.find('[role="gridcell"]');
    await gone.click();
    expect((await driver.findAll('[role="dialog"]')).length).toBe(0);
  });
});
