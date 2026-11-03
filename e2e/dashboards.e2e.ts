import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The figures at the top of each screen: that they read what is there, that the
 * arithmetic is said beside them, and that what can be pressed does what it says.
 */
describe('the figures on each screen', () => {
  let session: Session;

  const goTo = async (label: string) => {
    const { driver } = session;
    await (await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  };

  const value = async (testId: string) => {
    const { driver } = session;
    const tile = await driver.waitFor(testId, () => driver.find(`[data-testid="${testId}"]`));
    return (await tile.find('[data-testid="stat-value"]')).text();
  };

  const press = async (selector: string) => {
    const { driver } = session;
    const control = await driver.waitFor(selector, () => driver.find(selector));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Evening report today at 11pm${Keys.ENTER}`);
    await driver.waitForText('Evening report');
    await input.sendKeys(`Late one tomorrow${Keys.ENTER}`);
    await driver.waitForText('Late one');
    // Nothing typed can make a date that has gone, so this one is moved back.
    await driver.executeAsync(
      `const done = arguments[arguments.length - 1];
       const { invoke } = window.__TAURI_INTERNALS__;
       const yesterday = new Date(Date.now() - 86400000).toISOString();
       invoke('items_list', { collectionId: 'tasks', includeCompleted: true })
         .then((items) => items.find((item) => item.title === 'Late one'))
         .then((item) => invoke('item_set_schedule', {
           id: item.id,
           schedule: { start_at: null, due_at: yesterday, remind_at: null, recurrence_rrule: null, recurrence_mode: null },
         }))
         .then(() => done(), (error) => done(String(error)));`,
      [],
    );
    await input.sendKeys(`Someday${Keys.ENTER}`);
    await driver.waitForText('Someday');
    // The date was changed behind the window's back: open it again to read it.
    await session.restart();
    await session.driver.waitForElement('input[aria-label="New task"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('Today leads with a score, and says how it was reached', async () => {
    const { driver } = session;
    await goTo('Today');
    expect(await value('stat-due')).toBe('1');
    expect(await value('stat-overdue')).toBe('1');
    expect(await value('stat-done')).toBe('0');

    const score = await driver.waitForElement('[data-testid="today-score"]');
    const words = await score.text();
    expect(words).toContain('0 of 2 tasks finished, 1 of them late.');
    expect(words).toContain('Not counted: no clock has been started yet.');
    expect(await (await driver.find('[data-testid="today-word"]')).text()).toBe('Behind');
    await session.screenshot('today-score');
  });

  it('finishing the work moves the score at once', async () => {
    const { driver } = session;
    await press('input[aria-label="Complete Late one"]');
    await driver.waitFor('the task finished today', async () =>
      (await value('stat-done')) === '1' ? true : null,
    );
    const score = await driver.find('[data-testid="today-score"]');
    expect(await score.text()).toContain('1 of 2 tasks finished.');
    await driver.waitForElement('[data-testid="finished-today"]');
  });

  it('Tasks opens on an overview, and a figure shows those tasks', async () => {
    const { driver } = session;
    await goTo('Tasks');
    expect(await value('slice-undated')).toBe('1');
    await press('[data-testid="slice-undated"]');
    await driver.waitFor('only the undated task', async () =>
      (await driver.findAll('input[aria-label^="Complete "]')).length === 1 ? true : null,
    );
    await driver.waitForText('Someday');
    await session.screenshot('tasks-overview');
    // Pressed again, it shows them all.
    await press('[data-testid="slice-undated"]');
    await driver.waitFor('every task again', async () =>
      (await driver.findAll('input[aria-label^="Complete "]')).length > 1 ? true : null,
    );
  });

  it('the overview can be put away, and stays away', async () => {
    const { driver } = session;
    await press('button[aria-label="Hide the overview"]');
    await driver.waitFor('the figures gone', async () =>
      (await driver.findAll('[data-testid="slice-open"]')).length === 0 ? true : null,
    );
    await goTo('Board');
    await goTo('Tasks');
    await driver.waitForElement('button[aria-label="Show the overview"]');
    expect(await driver.findAll('[data-testid="slice-open"]')).toHaveLength(0);
    await press('button[aria-label="Show the overview"]');
    await driver.waitForElement('[data-testid="slice-open"]');
  });

  it('the Board marks what is for today, and can spotlight it', async () => {
    const { driver } = session;
    await goTo('Board');
    const card = await driver.waitFor('the card for today', () =>
      driver.find('article[data-today="today"]'),
    );
    expect(await card.text()).toContain('Evening report');
    const strip = await driver.find('[data-testid="board-today"]');
    expect(await strip.text()).toContain('card');

    const button = await driver.findByXPath('//button[normalize-space(.)="Spotlight today"]');
    await button.click();
    await driver.waitForElement('button[aria-pressed="true"]');
    await session.screenshot('board-spotlight');
    // A task with nothing to do with today is still on the board, dimmed.
    await driver.waitForText('Someday');
    await (await driver.findByXPath('//button[normalize-space(.)="Show all cards"]')).click();
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('the Board does not mark a task with nothing to do with today', async () => {
    const { driver } = session;
    const marked = await driver.findAll('article[data-today]');
    const texts = await Promise.all(marked.map((card) => card.text()));
    expect(texts.some((text) => text.includes('Someday'))).toBe(false);
  });

  it('Review reads the week, and says when there is too little to measure', async () => {
    await goTo('Review');
    expect(await value('review-overdue')).toMatch(/^\d+$/);
    expect(await value('review-accuracy')).toBe('—');
    const { driver } = session;
    const tile = await driver.find('[data-testid="review-accuracy"]');
    expect(await tile.text()).toContain('Needs 3 timed tasks finished');
    expect(await driver.findAll('[data-testid="chart-column"]')).toHaveLength(24);
    await session.screenshot('review-figures');
  });

  it('Reports draws the days, and every number still opens', async () => {
    const { driver } = session;
    await goTo('Reports');
    // Finished work is there, so the report has something to say.
    await driver.waitForElement('[data-testid="report-done"]');
    expect(await driver.findAll('[data-testid="chart-column"]')).toHaveLength(7);
    await driver.waitForElement('[data-figure="completed"]');
    await session.screenshot('reports-figures');
  });
});

describe('a screen that fails', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitForElement('input[aria-label="New task"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says so, keeps the rail alive, and going elsewhere is the way out', async () => {
    const { driver } = session;
    // Something every report renders with, made to throw: a render that fails, on
    // purpose, with nothing about it known to the screen.
    await driver.execute(`
      window.__dates = Date.prototype.toLocaleDateString;
      Date.prototype.toLocaleDateString = () => { throw new Error('Told to fail'); };
    `);
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Reports"]')).click();
    const failed = await driver.waitForElement('[data-testid="screen-failed"]');
    expect(await failed.text()).toContain('Told to fail');
    expect(await failed.text()).toContain('Your work is safe');
    await session.screenshot('screen-failed');

    await driver.execute('Date.prototype.toLocaleDateString = window.__dates');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Tasks"]')).click();
    await driver.waitForElement('input[aria-label="New task"]');
    expect(await driver.findAll('[data-testid="screen-failed"]')).toHaveLength(0);
  });
});

describe('goals as cards', () => {
  let session: Session;

  const press = async (selector: string) => {
    const { driver } = session;
    const control = await driver.waitFor(selector, () => driver.find(selector));
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitForElement('input[aria-label="New task"]');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Goals"]')).click();
    await driver.waitForText('No goals yet');
    await (await driver.findByXPath('//header//button[normalize-space(.)="New goal"]')).click();
    await driver.waitForText('New goal');
    await (await driver.findByXPath('//header//button[normalize-space(.)="New goal"]')).click();
    await driver.waitForText('New goal 2');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('coming back, two goals are two cards with their score, and nothing open', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Tasks"]')).click();
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Goals"]')).click();
    await driver.waitForElement('[data-goal]');
    expect(await driver.findAll('[data-goal]')).toHaveLength(2);
    expect(await driver.findAll('input[aria-label="Goal name"]')).toHaveLength(0);
    expect(await driver.findAll('[role="progressbar"]')).toHaveLength(2);
    await session.screenshot('goals-cards');
  });

  it('pressing one opens it, and pressing it again closes it', async () => {
    const { driver } = session;
    await press('button[aria-label="Open New goal"]');
    await driver.waitForElement('input[aria-label="Goal name"]');
    await press('button[aria-label="Close New goal"]');
    await driver.waitFor('closed again', async () =>
      (await driver.findAll('input[aria-label="Goal name"]')).length === 0 ? true : null,
    );
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('a closed card offers no way to delete the goal by accident', async () => {
    const { driver } = session;
    expect(await driver.findAll('button[aria-label^="Delete New goal"]')).toHaveLength(0);
  });

  it('the figures count the goals', async () => {
    const { driver } = session;
    const tile = await driver.find('[data-testid="goals-track"]');
    expect(await tile.text()).toContain('Of 2 goals');
  });
});
