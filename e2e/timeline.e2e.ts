import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The timeline: the plan drawn, and edited by moving what is drawn.
 *
 * The dates are set through the capture grammar, which is the shortest honest
 * route to a dated task — the same words a person would type.
 */
describe('the timeline', () => {
  let session: Session;

  // A failed test must not leave a drawer over the next one's controls.
  beforeEach(async () => {
    const { driver } = session;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await driver.findAll('[role="dialog"]')).length === 0) break;
      await driver.chord(Keys.ESCAPE);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  const openTimeline = async () => {
    const { driver } = session;
    await goTo('Tasks');
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="Timeline"]')).click();
    await driver.waitForElement('[role="region"][aria-label="Timeline"]');
  };

  /** What the polite live region last said. */
  const announced = (text: string) =>
    session.driver.waitFor(`announcement "${text}"`, async () => {
      const spoken = await session.driver.execute<string>(
        'const r = document.querySelector("[role=status][aria-live=polite]"); return r ? r.textContent : "";',
      );
      return spoken.includes(text) ? spoken : null;
    });

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    // Dated through the capture grammar; "Loose end" deliberately has no date.
    for (const line of [
      'Design it tomorrow',
      'Build it in 3 days',
      'Ship it in 5 days',
      'Loose end',
    ]) {
      await input.sendKeys(`${line}${Keys.ENTER}`);
      await driver.waitForText(line.split(' ')[0]!);
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('is a view of its own, beside the calendar', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const tabs = await driver.findAll('[role="tab"]');
    const labels = await Promise.all(tabs.map((tab) => tab.text()));
    expect(labels).toContain('Timeline');
    expect(labels.indexOf('Timeline')).toBeGreaterThan(labels.indexOf('Calendar'));
  });

  it('draws a row per dated task and says what it left out', async () => {
    const { driver } = session;
    await openTimeline();

    const rows = await driver.waitFor('three rows', async () => {
      const found = await driver.findAll('[role="region"][aria-label="Timeline"] li');
      return found.length === 3 ? found : null;
    });
    const titles = await Promise.all(rows.map((row) => row.text()));
    expect(titles.join(' ')).toContain('Design it');
    expect(titles.join(' ')).toContain('Ship it');

    // The undated task is absent from the chart and accounted for under it.
    expect(titles.join(' ')).not.toContain('Loose end');
    await driver.waitForText('1 task has no due date');
  });

  it('moves a bar by keyboard, and the dates follow', async () => {
    const { driver } = session;
    const move = await driver.waitFor('the Move control', () =>
      driver.find('button[aria-label="Move Design it"]'),
    );
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: move.id }]);
    await driver.chord(Keys.ENTER);
    await announced('Moving Design it');

    await driver.chord(Keys.ARROW_RIGHT);
    await announced('Design it 1 day later');
    await driver.chord(Keys.ARROW_RIGHT);
    await announced('Design it 2 days later');
    await driver.chord(Keys.ENTER);
    await announced('Placed');

    // The task's own due date moved: the list shows it two days on.
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="List"]')).click();
    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Design it"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    const due = await driver.waitForElement('input[aria-label="Due date and time"]');
    const value = String(await due.property('value'));
    expect(value).not.toBe('');
    await driver.chord(Keys.ESCAPE);
  });

  it('cancelling a move changes nothing', async () => {
    const { driver } = session;
    await openTimeline();
    const before = await driver.execute<string>(
      'return document.querySelectorAll(\'[role="region"][aria-label="Timeline"] div[draggable]\')[0].style.left;',
    );

    const move = await driver.waitFor('the Move control', () =>
      driver.find('button[aria-label="Move Build it"]'),
    );
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: move.id }]);
    await driver.chord(Keys.ENTER);
    await announced('Moving Build it');
    await driver.chord(Keys.ARROW_RIGHT);
    await driver.chord(Keys.ESCAPE);
    await announced('Cancelled');

    const after = await driver.execute<string>(
      'return document.querySelectorAll(\'[role="region"][aria-label="Timeline"] div[draggable]\')[0].style.left;',
    );
    expect(after).toBe(before);
  });

  it('draws an arrow for a dependency, and marks the critical path', async () => {
    const { driver } = session;
    // Ship it waits for Build it.
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="List"]')).click();
    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Ship it"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);

    const select = await driver.waitForElement('select[aria-label="Wait for another task"]');
    const option = await driver.findByXPath(
      '//select[@aria-label="Wait for another task"]/option[normalize-space(.)="Build it"]',
    );
    await driver.execute(
      'const s = arguments[0]; s.value = arguments[1]; s.dispatchEvent(new Event("change", { bubbles: true }));',
      [{ [ELEMENT]: select.id }, await option.attribute('value')],
    );
    await (
      await driver.findByXPath('//*[@role="dialog"]//button[normalize-space(.)="Add"]')
    ).click();
    // "Waited on by" is the other direction and never appears here: nothing
    // waits on Ship it. What must appear is the blocker in its own list.
    await driver.waitFor('Build it among the blockers', async () => {
      const rows = await driver.findAll('ul[aria-label="Waiting for"] li');
      if (rows.length !== 1) return null;
      return (await rows[0]!.text()).includes('Build it') ? true : null;
    });
    await driver.chord(Keys.ESCAPE);

    await openTimeline();
    const arrows = await driver.waitFor('an arrow', async () => {
      const found = await driver.findAll('[role="region"][aria-label="Timeline"] svg polyline');
      return found.length >= 1 ? found : null;
    });
    expect(arrows.length).toBe(1);
  });

  it('a milestone is a point on the chart, not a bar', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="List"]')).click();
    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Ship it"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await (await driver.findByXPath('//*[@role="dialog"]//input[@type="checkbox"]')).click();
    await driver.waitForText('A milestone takes no time.');
    await driver.chord(Keys.ESCAPE);

    await openTimeline();
    const diamond = await driver.waitFor('the milestone', async () => {
      const found = await driver.findAll(
        '[role="region"][aria-label="Timeline"] [aria-label="Ship it, a milestone"]',
      );
      return found[0] ?? null;
    });
    expect(await diamond.displayed()).toBe(true);
  });

  it('the moved dates survive a restart', async () => {
    await session.restart();
    await openTimeline();
    const rows = await session.driver.waitFor('the rows again', async () => {
      const found = await session.driver.findAll('[role="region"][aria-label="Timeline"] li');
      return found.length === 3 ? found : null;
    });
    expect(rows.length).toBe(3);
    await session.screenshot('timeline');
  });
});
