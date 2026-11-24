import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The price of yes (M1), on the real binary.
 *
 * The workspace starts with the default working week — Monday to Friday,
 * 09:00 to 18:00, nine hours a day — and two tasks of nine hours each: "First"
 * due on the first working day from today, "Second" on the one after. Each
 * fills exactly its own day, so the projection is something a person can
 * check: First lands on its day, Second on the next.
 *
 * Typing eighteen hours on First, without leaving the field, must show the
 * receipt — Second pushed a day past its due day — and must save nothing.
 * Escape puts the draft back and the receipt goes away.
 */

function iso(day: Date): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The working days, Monday to Friday, after today: [first, second]. */
function workingDays(): [string, string] {
  const out: string[] = [];
  const day = new Date();
  day.setDate(day.getDate() + 1);
  while (out.length < 2) {
    const weekday = day.getDay();
    if (weekday >= 1 && weekday <= 5) {
      out.push(iso(day));
    }
    day.setDate(day.getDate() + 1);
  }
  return [out[0]!, out[1]!];
}

describe('the price of yes', () => {
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

  /** Put text in the estimate field; commit only when asked to. */
  const typeEstimate = async (text: string, commit: boolean) => {
    const { driver } = session;
    const field = await driver.waitForElement('input[aria-label="Estimate"]');
    await driver.execute(
      `const f = arguments[0];
       f.focus();
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, arguments[1]);
       f.dispatchEvent(new Event('input', { bubbles: true }));
       if (arguments[2]) f.blur();`,
      [{ [ELEMENT]: field.id }, text, commit],
    );
  };

  const setDue = async (day: string) => {
    const { driver } = session;
    const due = await driver.waitFor('the due field', () =>
      driver.findByXPath('//*[@role="dialog"]//input[@aria-label="Due date and time"]'),
    );
    await driver.execute(
      `const field = arguments[0];
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(field, arguments[1]);
       field.dispatchEvent(new Event('input', { bubbles: true }));
       field.dispatchEvent(new Event('change', { bubbles: true }));`,
      [{ [ELEMENT]: due.id }, `${day}T17:00`],
    );
  };

  const storedEstimate = async (expected: string) => {
    const { driver } = session;
    await driver.waitFor(`the stored estimate ${expected}`, async () => {
      const field = await driver.find('input[aria-label="Estimate"]');
      return (await field.property('value')) === expected ? true : null;
    });
  };

  /**
   * The receipt as a person sees it, in both themes: scrolled into view (it
   * sits below the fold of the drawer), captured dark, then light. The theme
   * is set the way the application sets it (`applyTheme`: the `data-theme`
   * attribute), so the drawer and its draft stay open between the two.
   */
  const capture = async (name: string) => {
    const { driver } = session;
    const panel = await driver.find('[data-testid="receipt"]');
    await driver.execute('arguments[0].scrollIntoView({ block: "end" })', [
      { [ELEMENT]: panel.id },
    ]);
    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      // Colour transitions run for up to 300 ms after a theme switch.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`${name}-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);
  };

  const [firstDay, secondDay] = workingDays();

  beforeAll(async () => {
    session = await startSession();
    // Today is taken out, because what is left of it depends on the hour the suite
    // runs at, and the arithmetic below has to be checkable on paper.
    await session.driver.executeAsync(
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__
         .invoke('day_off_set', { day: arguments[0], label: 'Out of the arithmetic' })
         .then(done, (error) => done(String(error)));`,
      [iso(new Date())],
    );
    await session.restart();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['First', 'Second']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }

    await openDetail('First');
    await typeEstimate('9h', true);
    // The estimate field writes a day as eight hours, so nine reads back as 1d 1h.
    await storedEstimate('1d 1h');
    await setDue(firstDay);
    await closeDetail();

    await openDetail('Second');
    await typeEstimate('9h', true);
    await storedEstimate('1d 1h');
    await setDue(secondDay);
    await closeDetail();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('shows no receipt while the estimate is what is stored', async () => {
    const { driver } = session;
    await openDetail('First');
    await storedEstimate('1d 1h');
    expect(await driver.findAll('[data-testid="receipt"]')).toHaveLength(0);
  });

  it('shows the price of eighteen hours before anything is saved', async () => {
    const { driver } = session;
    await typeEstimate('18h', false);

    const shift = await driver.waitFor('the receipt naming Second', () =>
      driver.find('[data-testid="receipt-shift"][data-item]'),
    );
    const line = await shift.text();
    expect(line).toContain('Second');
    expect(line).toContain('+1 day');
    expect(line).toContain('late');

    const cost = await (await driver.find('[data-testid="receipt-cost"]')).text();
    expect(cost).toBe('Claims 9h of free time.');

    const panel = await (await driver.find('[data-testid="receipt"]')).text();
    expect(panel).toContain('Moves 1 task');
    expect(panel).toContain('Nothing has changed yet');
    // The horizon is a year away; its date must say which year.
    expect(panel).toContain(String(new Date().getFullYear() + 1));
    // A fresh workspace has no finished history: no percentage, and it says so (M2).
    expect(await driver.findAll('[data-testid="forecast-range"]')).toHaveLength(0);
    const sample = await (await driver.find('[data-testid="forecast-sample"]')).text();
    expect(sample).toContain('(0 so far)');
    await capture('receipt-late');
  });

  it('saves nothing: Escape puts the draft back and the receipt goes away', async () => {
    const { driver } = session;
    const field = await driver.find('input[aria-label="Estimate"]');
    // Escape resets the draft, and the drawer closes on Escape too.
    await field.sendKeys(Keys.ESCAPE);
    await driver.waitFor('the receipt gone', async () =>
      (await driver.findAll('[data-testid="receipt"]')).length === 0 ? true : null,
    );
    if ((await driver.findAll('[role="dialog"]')).length > 0) await closeDetail();

    await openDetail('First');
    await storedEstimate('1d 1h');
    expect(await driver.findAll('[data-testid="receipt"]')).toHaveLength(0);
    await closeDetail();
  });

  it('a smaller estimate gives time back and moves nothing', async () => {
    const { driver } = session;
    await openDetail('Second');
    await typeEstimate('1h', false);
    await driver.waitForText('It fits. Nothing else moves.');
    const cost = await (await driver.find('[data-testid="receipt-cost"]')).text();
    expect(cost).toBe('Gives back 8h of free time.');
    expect(await driver.findAll('[data-testid="receipt-shift"]')).toHaveLength(0);
    await capture('receipt-fits');
    const field = await driver.find('input[aria-label="Estimate"]');
    await field.sendKeys(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
  });
});
