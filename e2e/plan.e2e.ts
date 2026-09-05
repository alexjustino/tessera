import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The plan, end to end, on the graph the P2 tests reason about:
 *
 *              ┌── Build it (2h) ──┐
 *   Design (1h)┤                   ├── Ship it (1h)
 *              └── Write docs (30m)┘
 *
 * Four hours through Build, two and a half through Write docs. So the project
 * is four hours long, Write docs has ninety minutes of slack, and the other
 * three decide the end.
 */
describe('the plan', () => {
  let session: Session;

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

  /** Type an estimate the way a person would, and commit it. */
  const estimate = async (text: string) => {
    const { driver } = session;
    const field = await driver.waitForElement('input[aria-label="Estimate"]');
    // Focus first: `blur()` on an element that never had focus fires nothing,
    // and the field commits on blur.
    await driver.execute(
      `const f = arguments[0];
       f.focus();
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, arguments[1]);
       f.dispatchEvent(new Event('input', { bubbles: true }));
       f.blur();`,
      [{ [ELEMENT]: field.id }, text],
    );
  };

  const waitForTask = async (blockerTitle: string) => {
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
    for (const title of ['Design it', 'Build it', 'Write docs', 'Ship it']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says nothing about a plan nobody has estimated', async () => {
    const { driver } = session;
    // Everything would have zero slack, so calling it all critical would be
    // noise. The summary is absent rather than wrong.
    const summaries = await driver.findAllByXPath(
      '//*[contains(normalize-space(.), "of work on the longest route")]',
    );
    expect(summaries.length).toBe(0);
  });

  it('takes an estimate typed the way a person says it', async () => {
    const { driver } = session;
    await openDetail('Design it');
    await estimate('1h');
    await driver.waitFor('the estimate stored', async () => {
      const field = await driver.find('input[aria-label="Estimate"]');
      return (await field.property('value')) === '1h' ? true : null;
    });
    await closeDetail();

    await driver.waitForText('1h of work on the longest route');
  });

  it('builds the graph and computes the length of the longest route', async () => {
    const { driver } = session;
    await openDetail('Build it');
    await estimate('2h');
    await waitForTask('Design it');
    await closeDetail();

    await openDetail('Write docs');
    await estimate('30m');
    await waitForTask('Design it');
    await closeDetail();

    await openDetail('Ship it');
    await estimate('1h');
    await waitForTask('Build it');
    await waitForTask('Write docs');
    await closeDetail();

    // 1h + 2h + 1h through Build it, which is longer than through Write docs.
    await driver.waitForText('4h of work on the longest route, through 3 tasks');
  });

  it('marks what decides the end, and only that', async () => {
    const { driver } = session;
    for (const title of ['Design it', 'Build it', 'Ship it']) {
      const marks = await driver.findAllByXPath(
        `//li[contains(normalize-space(.), "${title}")][not(.//li)]//span[normalize-space(.)="Critical"]`,
      );
      expect(marks.length, `${title} should be critical`).toBe(1);
    }
    const slack = await driver.findAllByXPath(
      '//li[contains(normalize-space(.), "Write docs")][not(.//li)]//span[normalize-space(.)="Critical"]',
    );
    expect(slack.length, 'Write docs has slack and should not be marked').toBe(0);
  });

  it('tells a task with slack exactly how much it has', async () => {
    const { driver } = session;
    await openDetail('Write docs');
    // 4h total, 1h before it, 1h after it, 30m of work: 90 minutes spare.
    await driver.waitForText('1h 30m of slack');
    await closeDetail();

    await openDetail('Build it');
    await driver.waitForText('On the critical path');
    await closeDetail();
  });

  it('a milestone takes no time, whatever its estimate said', async () => {
    const { driver } = session;
    await openDetail('Ship it');
    await (await driver.findByXPath('//*[@role="dialog"]//input[@type="checkbox"]')).click();
    await driver.waitForText('A milestone takes no time.');
    await closeDetail();

    // Ship it contributed an hour; as a milestone it contributes nothing.
    await driver.waitForText('3h of work on the longest route');
    const diamond = await driver.waitFor('the milestone mark', async () => {
      const found = await driver.findAllByXPath(
        '//li[contains(normalize-space(.), "Ship it")][not(.//li)]//*[@title="A milestone"]',
      );
      return found[0] ?? null;
    });
    expect(await diamond.displayed()).toBe(true);
  });

  it('refuses an estimate it cannot read, and keeps the one it had', async () => {
    const { driver } = session;
    await openDetail('Build it');
    await estimate('soon');
    await driver.waitForText('That was not read as a length');

    const field = await driver.find('input[aria-label="Estimate"]');
    expect(await field.property('value')).toBe('soon');
    await closeDetail();

    // The stored plan did not move.
    await driver.waitForText('3h of work on the longest route');
  });

  it('the plan survives a restart', async () => {
    await session.restart();
    await session.driver.waitForText('3h of work on the longest route');
    await openDetail('Build it');
    const field = await session.driver.waitForElement('input[aria-label="Estimate"]');
    expect(await field.property('value')).toBe('2h');
    await closeDetail();
  });
});
