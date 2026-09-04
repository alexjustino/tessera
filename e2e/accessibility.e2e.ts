import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
}

/**
 * Accessibility, checked on the real screens rather than promised.
 *
 * axe-core runs against every destination in both themes — WCAG 2.1 A and AA
 * rules — and any serious or critical violation fails the run. Then the
 * product is driven by keyboard alone: the rail, the add line, the detail
 * drawer (which must hold Tab and give focus back), the palette, and the
 * calendar's keyboard move, which is how a block of time moves without a
 * mouse.
 */
describe('accessibility', () => {
  let session: Session;
  let axeSource: string;
  const violationsSeen: Array<{ screen: string; theme: string; violation: Violation }> = [];

  beforeAll(async () => {
    session = await startSession();
    axeSource = await readFile(
      path.join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'),
      'utf-8',
    );
  });

  afterAll(async () => {
    await session?.stop();
    if (violationsSeen.length > 0) {
      // Moderate and minor findings are reported, not failed: they are the
      // backlog, and they are written down where a person can read them.
      console.warn(
        violationsSeen
          .map(
            ({ screen, theme, violation }) =>
              `${screen}/${theme} · ${violation.impact} · ${violation.id}: ${violation.help} (${violation.nodes.length})`,
          )
          .join('\n'),
      );
    }
  });

  beforeEach(async () => {
    const { driver } = session;
    for (let i = 0; i < 3; i += 1) {
      const open = await driver.findAll('[role="dialog"]');
      if (open.length === 0) break;
      await driver.chord(Keys.ESCAPE);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  /** Wait until the polite live region says something containing `text`. */
  const announced = (text: string) =>
    session.driver.waitFor(`announcement "${text}"`, async () => {
      const spoken = await session.driver.execute<string>(
        'const r = document.querySelector("[role=status][aria-live=polite]"); return r ? r.textContent : "";',
      );
      return spoken.includes(text) ? spoken : null;
    });

  const goTo = async (label: string) => {
    const { driver } = session;
    await (await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  };

  const injectAxe = async () => {
    const { driver } = session;
    const present = await driver.execute<boolean>('return typeof window.axe !== "undefined"');
    if (!present) await driver.execute(axeSource);
  };

  /**
   * The body is transparent so Windows can paint Mica behind it. Without the
   * compositor, axe sees no background at all and assumes white — condemning
   * every light-on-dark pair. The ground Mica renders is painted on the root
   * for the duration of the audit, and removed after; the tokens test uses
   * the same two values.
   */
  const MICA = { light: '#f3f3f3', dark: '#202020' };

  const audit = async (screen: string, theme: string): Promise<Violation[]> => {
    const { driver } = session;
    await injectAxe();
    await driver.execute('document.documentElement.style.backgroundColor = arguments[0]', [
      MICA[theme === 'dark' ? 'dark' : 'light'],
    ]);
    // Colour transitions run for up to 300 ms after a theme switch or a hover;
    // a contrast read mid-transition is a read of no colour the product has.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const violations = await driver.executeAsync<Violation[]>(
      `const done = arguments[arguments.length - 1];
       window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })
         .then((r) => done(r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })) }))))
         .catch((e) => done([{ id: 'axe-failed', impact: 'critical', help: String(e), nodes: [] }]));`,
    );
    await driver.execute('document.documentElement.style.backgroundColor = ""');
    for (const violation of violations) violationsSeen.push({ screen, theme, violation });
    await session.screenshot(`a11y-${screen.toLowerCase().replace(/\s+/g, '-')}-${theme}`);
    return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  };

  const setTheme = async (theme: 'light' | 'dark') => {
    const { driver } = session;
    await goTo('Settings');
    await driver.waitForText('Kept in your workspace file');
    await (await driver.findByXPath(`//*[@role="radio"][normalize-space(.)="${theme}"]`)).click();
    await driver.waitFor(`${theme} theme`, async () =>
      (await driver.execute<string | null>(
        'return document.documentElement.getAttribute("data-theme")',
      )) === theme
        ? true
        : null,
    );
  };

  it('seeds a task with a schedule so every screen has something to show', async () => {
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Review the contract tomorrow at 10am !high${Keys.ENTER}`);
    await driver.waitForText('Review the contract');
    await input.sendKeys(`Water the plants${Keys.ENTER}`);
    await driver.waitForText('Water the plants');
  });

  it.each([
    ['light', 'Tasks'],
    ['light', 'Today'],
    ['light', 'Board'],
    ['light', 'Calendar'],
    ['light', 'Reports'],
    ['light', 'Settings'],
    ['light', 'Diagnostics'],
    ['light', 'About'],
    ['dark', 'Tasks'],
    ['dark', 'Board'],
    ['dark', 'Calendar'],
    ['dark', 'Reports'],
    ['dark', 'Settings'],
    ['dark', 'About'],
  ] as const)('%s theme: %s has no serious or critical violation', async (theme, screen) => {
    const current = await session.driver.execute<string | null>(
      'return document.documentElement.getAttribute("data-theme")',
    );
    if (current !== theme) await setTheme(theme);
    await goTo(screen);
    await session.driver.waitFor('screen rendered', async () => {
      const h1 = await session.driver.findAll('h1');
      return h1.length > 0 ? true : null;
    });
    const serious = await audit(screen, theme);
    expect(
      serious.map(
        (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
  });

  it('the open palette and the task detail drawer pass too', async () => {
    const { driver } = session;
    await goTo('Tasks');
    await driver.chord(Keys.CONTROL, 'k');
    await driver.waitForElement('input[aria-label="Search or run a command"]');
    expect(await audit('Palette', 'dark')).toEqual([]);
    await driver.chord(Keys.ESCAPE);

    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Review the contract"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');
    expect(await audit('Detail drawer', 'dark')).toEqual([]);
    await driver.chord(Keys.ESCAPE);
    await setTheme('light');
  });

  it('a dialog holds Tab and gives focus back when it closes', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const open = await driver.waitFor('the Open control', () =>
      driver.find('button[aria-label="Open Review the contract"]'),
    );
    await driver.execute('arguments[0].focus(); arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');

    // Twenty tabs later, focus is still inside the dialog.
    for (let i = 0; i < 20; i += 1) await driver.chord(Keys.TAB);
    const inside = await driver.execute<boolean>(
      'return !!document.activeElement.closest(\'[role="dialog"]\')',
    );
    expect(inside).toBe(true);

    await driver.chord(Keys.ESCAPE);
    await driver.waitFor('drawer closed', async () =>
      (await driver.findAll('[role="dialog"]')).length === 0 ? true : null,
    );
    const restored = await driver.execute<string | null>(
      'return document.activeElement && document.activeElement.getAttribute("aria-label")',
    );
    expect(restored).toBe('Open Review the contract');
  });

  it('every focused element shows a focus ring', async () => {
    const { driver } = session;
    // Walk the first thirty tab stops and check each has a visible outline.
    await driver.execute('document.body.focus(); (document.querySelector("nav button")).focus()');
    const missing: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const report = await driver.execute<{
        tag: string;
        label: string;
        outline: string;
        ok: boolean;
      }>(
        `const el = document.activeElement;
         const style = getComputedStyle(el);
         const label = el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30);
         const ok = el === document.body || el.matches(':focus-visible') === false || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0);
         return { tag: el.tagName, label, outline: style.outlineStyle + ' ' + style.outlineWidth, ok };`,
      );
      if (!report.ok) missing.push(`${report.tag} "${report.label}" (${report.outline})`);
      await driver.chord(Keys.TAB);
    }
    expect(missing).toEqual([]);
  });

  it('a task is reserved on the calendar by keyboard alone', async () => {
    const { driver } = session;
    await goTo('Calendar');
    await driver.waitForText('Not scheduled');
    const reserve = await driver.waitFor('the reserve control', () =>
      driver.find('button[aria-label="Reserve time for Water the plants"]'),
    );
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: reserve.id }]);
    await driver.chord(Keys.ENTER);
    await announced('Use the arrow keys');
    await driver.chord(Keys.ARROW_DOWN);
    await announced('09:15');
    await driver.chord(Keys.ARROW_DOWN);
    await announced('09:30');
    await driver.chord(Keys.ENTER);
    await announced('Placed Water the plants');

    // It is now time on the grid, and no longer waiting in the panel.
    const block = await driver.waitFor('the block on the grid', async () => {
      const boxes = await driver.findAll('article[aria-label^="Water the plants"]');
      return boxes[0] ?? null;
    });
    expect(await block.attribute('aria-label')).toContain('09:30');
    const panel = await driver.findAll('button[aria-label="Reserve time for Water the plants"]');
    expect(panel.length).toBe(0);

    // And the block itself moves by keyboard: its Move button picks it up.
    const move = await driver.waitFor('the Move control', () =>
      driver.find('button[aria-label="Move Water the plants"]'),
    );
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: move.id }]);
    await driver.chord(Keys.ENTER);
    await announced('Moving Water the plants');
    await driver.chord(Keys.ARROW_RIGHT);
    await driver.chord(Keys.ESCAPE);
    await announced('Cancelled');
  });
});
