import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

/**
 * Printing, end to end — the slice's proof of done:
 *
 *   a printed report is the report on screen, paginated, without chrome;
 *   the timeline prints across pages without cutting a bar.
 *
 * The print dialog is the operating system's and no test can drive it, so the
 * page is put into print media through the DevTools protocol and then read the
 * way the printer would: what is displayed, what is not, and where the page
 * breaks are allowed to fall.
 */
describe('printing', () => {
  let session: Session;
  /** Whether the page's own print rules could be found and applied. */
  let canEmulate = true;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  /**
   * Put the page into print media, or take it out.
   *
   * `tauri-driver` speaks WebDriver and nothing else, so there is no way to
   * ask the browser to emulate a medium. Instead the rules the application
   * itself loaded are read back out of `document.styleSheets` — every
   * `@media print` block, including the ones Tailwind compiled from `print:`
   * — and re-applied without their media wrapper. What is exercised is the
   * product's own CSS, not a copy of it written here; what it cannot prove is
   * that a browser applies `@media print` when it prints, which is the
   * browser's promise rather than this product's.
   */
  const media = async (type: 'print' | 'screen') => {
    await session.driver.execute(
      `if (arguments[0] === 'screen') {
         document.querySelectorAll('style[data-print-emulation]').forEach((tag) => tag.remove());
         return true;
       }
       const rules = [];
       // Depth first: Tailwind nests its print variants inside @layer, so a
       // walk that only reads the top level finds the hand-written rules and
       // silently misses every print: utility.
       const walk = (list) => {
         for (const rule of Array.from(list)) {
           const condition = String(rule.conditionText || '');
           if (rule.media !== undefined && condition.includes('print')) {
             for (const inner of Array.from(rule.cssRules)) rules.push(inner.cssText);
           } else if (rule.cssRules !== undefined) {
             walk(rule.cssRules);
           }
         }
       };
       for (const sheet of Array.from(document.styleSheets)) {
         try {
           walk(sheet.cssRules);
         } catch {
           continue;
         }
       }
       const tag = document.createElement('style');
       tag.setAttribute('data-print-emulation', '');
       tag.textContent = rules.join(String.fromCharCode(10));
       document.head.append(tag);
       return rules.length;`,
      [type],
    );
  };

  /** `display` as the page computes it, for the first match or null. */
  const displayOf = (css: string) =>
    session.driver.execute<string | null>(
      `const el = document.querySelector(arguments[0]);
       return el === null ? null : getComputedStyle(el).display;`,
      [css],
    );

  beforeAll(async () => {
    session = await startSession();
    const input = await session.driver.waitForElement('input[aria-label="New task"]');
    for (const line of [
      'Write the brief tomorrow at 10am',
      'Draw the diagram in 3 days',
      'Review it in 5 days',
    ]) {
      await input.sendKeys(`${line}${Keys.ENTER}`);
    }
    await session.driver.waitForText('Review it');
    // Two of them finished, so the report has something to print. Without this
    // the report is empty and every assertion about its rows passes by
    // comparing nothing to nothing.
    for (const title of ['Write the brief', 'Draw the diagram']) {
      const box = await session.driver.waitFor(`the box for ${title}`, () =>
        session.driver.find(`input[aria-label="Complete ${title}"]`),
      );
      await session.driver.execute('arguments[0].click()', [
        { 'element-6066-11e4-a52e-4f735466cecf': box.id },
      ]);
    }

    try {
      await media('print');
      await media('screen');
    } catch {
      canEmulate = false;
    }
  });

  // Print rules hide the rail, so a test that fails while they are applied
  // would take every test after it down with it.
  afterEach(async () => {
    await media('screen').catch(() => undefined);
  });

  afterAll(async () => {
    if (canEmulate) await media('screen').catch(() => undefined);
    await session?.stop();
  });

  it('the page carries print rules, and they can be applied', async () => {
    // If this is ever false the tests below say nothing, so it is stated
    // rather than hidden in a skip nobody reads.
    expect(canEmulate).toBe(true);
    await media('print');
    const applied = await session.driver.execute<number>(
      "return document.querySelectorAll('style[data-print-emulation]').length;",
    );
    expect(applied).toBe(1);
    await media('screen');
  });

  it('a printed report is the report, without the chrome around it', async () => {
    const { driver } = session;
    await goTo('Reports');
    await driver.waitForText('What a week or a month held');

    await media('print');
    // The rail, the tabs and the buttons are not content.
    expect(await displayOf('nav[aria-label="Main"]')).toBe('none');
    expect(await displayOf('.print-hide')).toBe('none');

    // The report itself is still there, and so is its heading.
    const heading = await driver.find('h1');
    expect(await heading.text()).toBe('Reports');
    expect(await displayOf('[data-testid="figure"]')).not.toBe('none');

    // Every figure's rows are on the page whether or not they were opened on
    // screen: the rows are what makes the number worth printing.
    const rows = await driver.findAll('[data-testid="figure-row"]');
    // There is something to print, and every row of it is on the page — the
    // check is worthless against an empty report.
    expect(rows.length).toBeGreaterThan(0);
    const shown = await driver.execute<number>(
      `return Array.from(document.querySelectorAll('[data-testid="figure-row"]'))
         .filter((row) => getComputedStyle(row.parentElement).display !== 'none').length;`,
    );
    expect(shown).toBe(rows.length);
    await session.screenshot('print-report');
  });

  it('the page is ink on paper, whatever the window was', async () => {
    const { driver } = session;
    await media('print');
    const colours = await driver.execute<{ text: string; card: string }>(
      `const root = getComputedStyle(document.documentElement);
       return {
         text: root.getPropertyValue('--fg-primary').trim(),
         card: root.getPropertyValue('--surface-card').trim(),
       };`,
    );
    // The browser gives back what it parsed, and it shortens `#ffffff` to
    // `#fff`; the value is what matters, not how it is spelled.
    const expand = (hex: string) =>
      hex.length === 4
        ? `#${hex[1]!}${hex[1]!}${hex[2]!}${hex[2]!}${hex[3]!}${hex[3]!}`
        : hex.toLowerCase();
    expect({ text: expand(colours.text), card: expand(colours.card) }).toEqual({
      text: '#000000',
      card: '#ffffff',
    });
  });

  it('the timeline swaps its scrolling chart for one made of rows', async () => {
    const { driver } = session;
    await goTo('Tasks');
    await (await driver.findByXPath('//*[@role="tab"][normalize-space(.)="Timeline"]')).click();
    await driver.waitForElement('[role="region"][aria-label="Timeline"]');

    // On screen: the canvas, not the paper rendering.
    expect(await displayOf('[data-print-view="timeline"]')).toBe('none');
    expect(await displayOf('[role="region"][aria-label="Timeline"]')).not.toBe('none');

    await media('print');
    expect(await displayOf('[data-print-view="timeline"]')).not.toBe('none');
    expect(await displayOf('[role="region"][aria-label="Timeline"]')).toBe('none');
    await session.screenshot('print-timeline');
  });

  it('every printed bar is inside its own row, which may not be split', async () => {
    const { driver } = session;
    await media('print');

    const rows = await driver.execute<
      Array<{ bars: number; breakInside: string; barInside: boolean }>
    >(
      `return Array.from(document.querySelectorAll('[data-print-row]')).map((row) => {
         const bars = row.querySelectorAll('[data-print-bar]');
         const bar = bars[0];
         const rowBox = row.getBoundingClientRect();
         const barBox = bar === undefined ? null : bar.getBoundingClientRect();
         return {
           bars: bars.length,
           breakInside: getComputedStyle(row).breakInside,
           barInside:
             barBox === null
               ? false
               : barBox.top >= rowBox.top - 1 && barBox.bottom <= rowBox.bottom + 1,
         };
       });`,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // One bar per row is what makes a page break harmless: the break falls
      // between rows, and a row is never taller than the bar it holds.
      expect(row.bars).toBe(1);
      expect(row.barInside).toBe(true);
      expect(row.breakInside).toBe('avoid');
    }
  });

  it('no printed bar runs off the edge of the page', async () => {
    const { driver } = session;
    await media('print');
    const overflow = await driver.execute<number>(
      `return Array.from(document.querySelectorAll('[data-print-row]')).filter((row) => {
         const track = row.querySelector('[data-print-bar]').parentElement;
         const bar = row.querySelector('[data-print-bar]').getBoundingClientRect();
         const box = track.getBoundingClientRect();
         return bar.left < box.left - 1 || bar.right > box.right + 1;
       }).length;`,
    );
    expect(overflow).toBe(0);
  });
});
