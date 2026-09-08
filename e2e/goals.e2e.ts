import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Goals, end to end — the slice's proof of done:
 *
 *   a goal's progress is the sum of its rows and opens onto them.
 *
 * So the test never reads a number and trusts it. It opens the figure, adds up
 * what is listed, and compares — which is the check ADR-024 exists to make
 * possible for a person, done here by a machine.
 */
describe('goals', () => {
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

  const clickXPath = async (xpath: string) => {
    const element = await session.driver.waitFor(xpath, () => session.driver.findByXPath(xpath));
    await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: element.id }]);
  };

  /** Put a task in the goal that is open. */
  const addTask = async (title: string) => {
    const { driver } = session;
    const select = await driver.waitFor('the task picker', () =>
      driver.find('select[aria-label="Add a task to this goal"]'),
    );
    await driver.execute(
      `const select = arguments[0];
       const option = Array.from(select.options).find((o) => o.text === arguments[1]);
       const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
       setter.call(select, option.value);
       select.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: select.id }, title],
    );
    await clickXPath('//button[normalize-space(.)="Add"]');
    await driver.waitFor(`${title} in the goal`, async () => {
      const found = await driver.findAll(`button[aria-label^="Take ${title} out of"]`);
      return found.length === 1 ? true : null;
    });
  };

  /** The figure's value as the button says it, and the rows behind it. */
  const progress = async () => {
    const { driver } = session;
    const button = await driver.waitFor('the progress figure', () =>
      driver.find('[data-testid="figure"] [data-testid="figure-value"]'),
    );
    return (await button.text()).trim();
  };

  /** Open the figure if it is closed, and hand back its rows. */
  const openFigure = async () => {
    const { driver } = session;
    const button = await driver.waitFor('the progress figure', () =>
      driver.find('[data-testid="figure"] [data-testid="figure-value"]'),
    );
    if ((await button.attribute('aria-expanded')) !== 'true') {
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: button.id }]);
    }
    return driver.findAll('[data-testid="figure-row"]');
  };

  beforeAll(async () => {
    session = await startSession();
    const input = await session.driver.waitForElement('input[aria-label="New task"]');
    // Three tasks, two of them finished: the rows a goal will count.
    for (const title of ['Write the brief', 'Draw the diagram', 'Review it']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await session.driver.waitForText(title);
    }
    for (const title of ['Write the brief', 'Draw the diagram']) {
      await click(`input[aria-label="Complete ${title}"]`);
    }
    await goTo('Goals');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a goal is made, and starts at nothing', async () => {
    await clickXPath('//button[normalize-space(.)="New goal"]');
    await session.driver.waitForText('New goal');
    expect(await progress()).toBe('0 tasks');
  });

  it('its progress is the tasks in it that are finished — and only those', async () => {
    await addTask('Write the brief');
    await session.driver.waitFor('the first task counted', async () =>
      (await progress()) === '1 task' ? true : null,
    );

    await addTask('Review it');
    // Not finished, so it does not count — the goal knows the difference
    // between a task it holds and a task it has finished.
    expect(await progress()).toBe('1 task');

    await addTask('Draw the diagram');
    await session.driver.waitFor('the second finished task counted', async () =>
      (await progress()) === '2 tasks' ? true : null,
    );
  });

  it('the number opens onto the rows it came from, and they add up to it', async () => {
    const rows = await openFigure();
    expect(rows).toHaveLength(2);

    const titles = await Promise.all(rows.map((row) => row.text()));
    expect(titles.join(' ')).toContain('Write the brief');
    expect(titles.join(' ')).toContain('Draw the diagram');
    // The row nobody finished is not among them, however much the goal holds.
    expect(titles.join(' ')).not.toContain('Review it');

    // The claim, checked: the value is the number of rows behind it.
    const shown = await progress();
    expect(shown).toBe(`${rows.length} tasks`);
    await session.screenshot('goals-progress');
  });

  it('finishing another task moves the goal, without anybody telling it to', async () => {
    await goTo('Tasks');
    await click('input[aria-label="Complete Review it"]');
    await goTo('Goals');
    await session.driver.waitFor('the third task counted', async () =>
      (await progress()) === '3 tasks' ? true : null,
    );

    const rows = await openFigure();
    expect(rows).toHaveLength(3);
  });

  it('reaching the target says so, and the bar knows it', async () => {
    const { driver } = session;
    const target = await driver.find('input[aria-label="Target"]');
    await target.click();
    await driver.chord(Keys.CONTROL, 'a');
    await target.sendKeys(`3${Keys.TAB}`);

    await driver.waitForText('Achieved');
    const bar = await driver.find('[role="progressbar"]');
    expect(await bar.attribute('aria-valuenow')).toBe('3');
    expect(await bar.attribute('aria-valuetext')).toBe('3 of 3 tasks');
    await session.screenshot('goals-achieved');
  });

  it('taking a task out takes its row with it', async () => {
    await click('button[aria-label^="Take Review it out of"]');
    await session.driver.waitFor('the goal after the task left', async () =>
      (await progress()) === '2 tasks' ? true : null,
    );
    const rows = await openFigure();
    expect(rows).toHaveLength(2);
  });

  it('the goal and its rows survive a restart', async () => {
    await session.restart();
    await session.driver.waitForElement('input[aria-label="New task"]');
    await goTo('Goals');
    await session.driver.waitFor('the goal after a restart', async () =>
      (await progress()) === '2 tasks' ? true : null,
    );

    // The tasks it holds are still the ones that were put in it.
    const held = await session.driver.findAll('button[aria-label^="Take "]');
    expect(held).toHaveLength(2);
  });
});
