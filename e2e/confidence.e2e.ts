import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Dates with confidence (M2), on the real binary.
 *
 * `fixtures/workspace-history.sqlite3` (built by `make_history.py` from the
 * project's own migrations) holds ten finished one-hour tasks whose tracked
 * time gives a median ratio of 1.25 and an 85th percentile of 1.825, an open
 * task of sixteen hours, and a goal "Launch" counting it.
 *
 * Ten is the sample, so both the goal and the receipt must read as a range,
 * and say what the range stands on. (Below the sample — a fresh workspace —
 * `receipt.e2e.ts` checks that no percentage appears.)
 */
describe('dates with confidence', () => {
  let session: Session;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  /** The forecast in both themes, scrolled into view. */
  const capture = async (name: string, css: string) => {
    const { driver } = session;
    const target = await driver.find(css);
    await driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: target.id },
    ]);
    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`${name}-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);
  };

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-history.sqlite3'),
    });
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('a goal says when it would be done, and as a range drawn from ten finished tasks', async () => {
    const { driver } = session;
    await goTo('Goals');
    await driver.waitForText('Launch');
    const range = await driver.waitFor('the goal forecast range', () =>
      driver.find('[data-testid="forecast-range"]'),
    );
    const text = await range.text();
    expect(text).toContain('Likely by');
    expect(text).toContain('85% sure by');
    expect(text).toContain('from 10 finished tasks');
    expect(await driver.findAll('[data-testid="forecast-sample"]')).toHaveLength(0);
    await capture('confidence-goal', '[data-testid="forecast"]');
  });

  it('the receipt gives the changed task its range too, before anything is saved', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const open = await driver.waitFor('the open control', () =>
      driver.find('button[aria-label="Open Write the launch notes"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');

    const field = await driver.waitForElement('input[aria-label="Estimate"]');
    await driver.execute(
      `const f = arguments[0];
       f.focus();
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, '20h');
       f.dispatchEvent(new Event('input', { bubbles: true }));`,
      [{ [ELEMENT]: field.id }],
    );

    const range = await driver.waitFor('the receipt range', () =>
      driver.find('[data-testid="receipt"] [data-testid="forecast-range"]'),
    );
    expect(await range.text()).toContain('from 10 finished tasks');
    await capture('confidence-receipt', '[data-testid="receipt"]');

    await field.sendKeys(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  });
});
