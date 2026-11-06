import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

interface Box {
  label: string;
  day: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The calendar with a real pointer: press, move, let go, through the input the
 * browser engine actually takes, and nothing dispatched by hand.
 *
 * Dragging here was HTML5 drag and drop, which on Windows the host takes for itself,
 * and it never worked from a mouse. A test that dispatched the events by hand passed
 * all the same. That is what this file is for.
 *
 * It reads where things are from the screen, and makes every hour working time, so it
 * does not depend on the day or the hour it runs (late at night, near midnight, the
 * second block can still land the next day).
 */
describe('moving things on the calendar', () => {
  let session: Session;

  /** Where a block is, and which day it stands in. */
  const boxOf = (title: string) =>
    session.driver.execute<Box | null>(
      `const block = document.querySelector('article[aria-label^="' + arguments[0] + '"]');
       if (block === null) return null;
       const r = block.getBoundingClientRect();
       return { label: block.getAttribute('aria-label'), day: block.closest('[data-day-column]').dataset.dayColumn, top: r.top, bottom: r.bottom, left: r.left, right: r.right };`,
      [title],
    );

  const waitForBox = (title: string) =>
    session.driver.waitFor(`the block for ${title}`, () => boxOf(title));

  const scrollIntoView = (title: string) =>
    session.driver.execute(
      `document.querySelector('article[aria-label^="' + arguments[0] + '"]').scrollIntoView({ block: 'center' });`,
      [title],
    );

  const middle = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

  /** A press that moves through the screen in steps, the way a hand does. */
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await session.driver.pointer([
      { type: 'move', x: from.x, y: from.y },
      { type: 'down' },
      { type: 'move', x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      { type: 'move', x: to.x, y: to.y },
      { type: 'up' },
    ]);
    await session.driver.releasePointer();
  };

  const reserve = async (title: string) => {
    const { driver } = session;
    const button = await driver.waitFor(`the reserve button for ${title}`, () =>
      driver.find(`button[aria-label="Reserve time for ${title}"]`),
    );
    await button.click();
    await driver.waitFor(`${title} reserved`, async () =>
      (await boxOf(title)) === null ? null : true,
    );
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['First job', 'Second job', 'Third job', 'Fourth job']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
    // Every hour of every day is working time, so a reservation lands on the day this
    // runs. With an office week, a Friday afternoon sends the second block to Monday,
    // the calendar follows it there, and the first one is no longer on screen.
    await driver.executeAsync(
      'const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke("work_hours_set", { hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts_minute: 0, ends_minute: 1440 })) }).then(() => done(true), (e) => done(String(e)));',
    );
    // The hours were written behind the window's back: open it again to read them.
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    await (
      await session.driver.findByXPath('//nav//button[normalize-space(.)="Calendar"]')
    ).click();
    await session.driver.waitForElement('[data-testid="plan-summary"]');
    await (
      await session.driver.findByXPath('//button[normalize-space(.)="Hide suggestions"]')
    ).click();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('reserving by hand puts one after the other, never one on top of the other', async () => {
    await reserve('First job');
    await reserve('Second job');
    const first = await waitForBox('First job');
    const second = await waitForBox('Second job');
    expect(second.top >= first.bottom || second.day !== first.day).toBe(true);
    await session.driver.waitForElement('[data-testid="calendar-notice"]');
    await session.screenshot('calendar-reserved');
  });

  it('a block follows the pointer to another hour, and shows where it will land', async () => {
    const { driver } = session;
    await scrollIntoView('First job');
    const before = await waitForBox('First job');
    const from = middle(before);
    const to = { x: from.x, y: from.y + 150 };

    await driver.pointer([
      { type: 'move', x: from.x, y: from.y },
      { type: 'down' },
      { type: 'move', x: from.x, y: from.y + 60 },
      { type: 'move', x: to.x, y: to.y },
    ]);
    const landing = await driver.waitForElement('[data-testid="landing"]');
    expect(await landing.text()).toContain('First job');
    await session.screenshot('calendar-carrying');
    await driver.pointer([{ type: 'up' }]);
    await driver.releasePointer();

    await driver.waitFor('the block moved', async () => {
      const after = await boxOf('First job');
      return after !== null && after.label !== before.label ? true : null;
    });
    expect(await driver.findAll('[data-testid="landing"]')).toHaveLength(0);
  });

  it('a block can go to another day', async () => {
    const { driver } = session;
    const before = await waitForBox('Second job');
    const target = await driver.execute<{ x: number; day: string }>(
      `const columns = [...document.querySelectorAll('[data-day-column]')];
       const here = columns.findIndex((c) => c.dataset.dayColumn === arguments[0]);
       const there = columns[here === columns.length - 1 ? here - 1 : here + 1];
       const r = there.getBoundingClientRect();
       return { x: r.left + r.width / 2, day: there.dataset.dayColumn };`,
      [before.day],
    );
    const from = middle(before);
    await drag(from, { x: target.x, y: from.y });
    await driver.waitFor('the block on the other day', async () =>
      (await boxOf('Second job'))?.day === target.day ? true : null,
    );
  });

  it('its bottom edge changes how long it lasts, and not where it starts', async () => {
    const { driver } = session;
    await scrollIntoView('Second job');
    const before = await waitForBox('Second job');
    const start = before.label.split(', ')[1]?.split(' to ')[0];
    await drag(
      { x: (before.left + before.right) / 2, y: before.bottom - 3 },
      { x: (before.left + before.right) / 2, y: before.bottom + 60 },
    );
    await driver.waitFor('a longer block', async () => {
      const after = await boxOf('Second job');
      return after !== null && after.bottom > before.bottom + 20 ? true : null;
    });
    const after = await waitForBox('Second job');
    expect(after.label.split(', ')[1]?.split(' to ')[0]).toBe(start);
  });

  it('pressing a block opens it, and its hour and length can be typed', async () => {
    const { driver } = session;
    const button = await driver.waitFor('the block', () =>
      driver.find('button[aria-label="Edit First job"]'),
    );
    await button.click();
    await driver.waitForElement('[data-testid="block-editor"]');
    await session.screenshot('calendar-editor');
    await (
      await driver.findByXPath(
        '//*[@data-testid="block-editor"]//*[@role="group"]//button[normalize-space(.)="30m"]',
      )
    ).click();
    const before = await waitForBox('First job');
    await (
      await driver.findByXPath(
        '//*[@data-testid="block-editor"]//button[normalize-space(.)="Save"]',
      )
    ).click();
    await driver.waitFor('the shorter block', async () => {
      const after = await boxOf('First job');
      return after !== null && after.bottom - after.top < before.bottom - before.top ? true : null;
    });
    expect(await driver.findAll('[data-testid="block-editor"]')).toHaveLength(0);
  });

  it('a task can be dragged in from the list', async () => {
    const { driver } = session;
    const grid = await driver.execute<{ x: number; y: number; from: { x: number; y: number } }>(
      `const row = document.querySelector('[data-panel-task] button');
       const task = [...document.querySelectorAll('[data-panel-task]')].find((r) => r.textContent.includes('Third job'));
       const box = task.getBoundingClientRect();
       const column = document.querySelector('article[aria-label^="First job"]').closest('[data-day-column]').getBoundingClientRect();
       const region = document.querySelector('[aria-label="Calendar grid"]').getBoundingClientRect();
       return { x: column.left + column.width / 2, y: region.top + region.height - 40, from: { x: box.left + 12, y: box.top + box.height / 2 } };`,
    );
    await drag(grid.from, { x: grid.x, y: grid.y });
    await waitForBox('Third job');
    await driver.waitFor('it left the list', async () =>
      (await driver.findAll('button[aria-label="Reserve time for Third job"]')).length === 0
        ? true
        : null,
    );
  });

  it('a suggestion can be picked up and put somewhere else, which reserves it there', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//button[normalize-space(.)="Suggest a plan"]')).click();
    const box = await driver.waitFor('the suggestion', async () => {
      const found = await driver.execute<Box | null>(
        `const block = document.querySelector('[data-suggestion]');
         if (block === null) return null;
         block.scrollIntoView({ block: 'center' });
         const r = block.getBoundingClientRect();
         return { label: '', day: block.closest('[data-day-column]').dataset.dayColumn, top: r.top, bottom: r.bottom, left: r.left, right: r.right };`,
      );
      if (found !== null) return found;
      await (await driver.find('button[aria-label="Next"]')).click();
      return null;
    });
    const from = middle(box);
    await drag(from, { x: from.x, y: from.y + 100 });
    await waitForBox('Fourth job');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('nothing invisible takes the press meant for a block', async () => {
    await scrollIntoView('First job');
    const hits = await session.driver.execute<string[]>(
      `const block = document.querySelector('article[aria-label^="First job"]');
       const r = block.getBoundingClientRect();
       const seen = [];
       for (let x = r.left + 2; x < r.right - 2; x += 6) {
         const hit = document.elementFromPoint(x, (r.top + r.bottom) / 2);
         if (getComputedStyle(hit).opacity === '0') seen.push(hit.getAttribute('aria-label'));
       }
       return seen;`,
    );
    expect(hits).toEqual([]);
  });

  it('Escape puts it back where it was', async () => {
    const { driver } = session;
    await scrollIntoView('First job');
    const before = await waitForBox('First job');
    const from = middle(before);
    // Down when there is room below, up when the block sits near the window's foot.
    const room = await driver.execute<number>('return window.innerHeight');
    const to = from.y + 80 < room - 10 ? from.y + 80 : from.y - 80;
    await driver.pointer([
      { type: 'move', x: from.x, y: from.y },
      { type: 'down' },
      { type: 'move', x: from.x, y: to },
    ]);
    await driver.waitForElement('[data-testid="landing"]');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the outline gone', async () =>
      (await driver.findAll('[data-testid="landing"]')).length === 0 ? true : null,
    );
    await driver.pointer([{ type: 'up' }]);
    await driver.releasePointer();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await boxOf('First job'))?.label).toBe(before.label);
    // Letting go after Escape is not a press of whatever is under the pointer.
    expect(await driver.findAll('[data-testid="block-editor"]')).toHaveLength(0);
  });

  it('a press that does not move is a press, not a drag', async () => {
    const { driver } = session;
    await scrollIntoView('First job');
    const before = await waitForBox('First job');
    const from = { x: (before.left + before.right) / 2, y: before.top + 8 };
    await drag(from, from);
    await driver.waitForElement('[data-testid="block-editor"]');
    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('the editor closed', async () =>
      (await driver.findAll('[data-testid="block-editor"]')).length === 0 ? true : null,
    );
    expect((await boxOf('First job'))?.label).toBe(before.label);
  });

  it('letting go off the grid leaves the task where it was', async () => {
    const { driver } = session;
    const input = await driver.find('input[aria-label="New task"]');
    await input.sendKeys(`Fifth job${Keys.ENTER}`);
    const from = await driver.waitFor('the task in the list', () =>
      driver.execute<{ x: number; y: number } | null>(
        `const task = [...document.querySelectorAll('[data-panel-task]')].find((r) => r.textContent.includes('Fifth job'));
         if (!task) return null;
         const box = task.getBoundingClientRect();
         return { x: box.left + 12, y: box.top + box.height / 2 };`,
      ),
    );
    await drag(from, { x: from.x, y: 20 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await boxOf('Fifth job')).toBeNull();
    expect(await driver.findAll('button[aria-label="Reserve time for Fifth job"]')).toHaveLength(1);
  });
});
