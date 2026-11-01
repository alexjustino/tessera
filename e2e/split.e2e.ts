import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The split tile (M6), on the real binary.
 *
 * `fixtures/workspace-split.sqlite3` (built by `make_split.py`) holds the week
 * of Monday 26 October 2026: three hours set aside for "Draft chapter", one of
 * them tracked on it (closed), one tracked on "Email the team" and one with
 * nothing tracked (both split), plus an hour of unplanned tracking.
 *
 * The mosaic opens on this week; the test walks back to that one, however
 * many weeks ago it is, so it does not depend on the day it runs.
 */

const FIXTURE_MONDAY = new Date(2026, 9, 26); // local midnight, 26 Oct 2026

function weeksBack(): number {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Math.round((monday.getTime() - FIXTURE_MONDAY.getTime()) / (7 * 86_400_000));
}

describe('the split tile', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-split.sqlite3'),
    });
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Mosaic"]')).click();
    await driver.waitForElement('[data-testid="mosaic-week"]');
    const before = await driver.find('button[aria-label="The week before"]');
    for (let i = 0; i < weeksBack(); i++) {
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: before.id }]);
    }
    await driver.waitFor('the fixture week', async () =>
      (await (await driver.find('[data-testid="mosaic-week"]')).text()).includes('2026') &&
      (await driver.findAll('[data-testid="closure-summary"]')).length === 1
        ? true
        : null,
    );
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('counts three hours set aside, and one that closed', async () => {
    const { driver } = session;
    const summary = await (await driver.find('[data-testid="closure-summary"]')).text();
    expect(summary).toContain('Of 3 hours set aside for a task, 1 closed');
    expect(summary).toContain('33%');
    // A zero is said in words, never as "0m".
    const sentence = await (await driver.find('[data-testid="mosaic-summary"]')).text();
    expect(sentence).not.toContain(' 0m');
  });

  it('draws the closed hour whole and the others split, and names both halves', async () => {
    const { driver } = session;
    expect(await driver.findAll('[role="gridcell"] [data-state="closed"]')).toHaveLength(1);
    expect(await driver.findAll('[role="gridcell"] [data-state="split"]')).toHaveLength(2);
    // The legend counts what the grid draws.
    await driver.waitForText('Closed — plan matched (1)');
    await driver.waitForText('Split — plan above, life below (2)');
    await driver.waitForText('Time tracked (1)');

    const split = await driver.find('[role="gridcell"] [data-state="split"]');
    await driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: split.id },
    ]);
    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`split-grid-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);

    const labels = await driver.execute<string[]>(
      'return Array.from(document.querySelectorAll("[role=gridcell][aria-label]")).map((c) => c.getAttribute("aria-label"))',
      [],
    );
    expect(
      labels.some((l) => l.includes('planned Draft chapter, lived Draft chapter — closed')),
    ).toBe(true);
    expect(
      labels.some((l) => l.includes('planned Draft chapter, lived Email the team — split')),
    ).toBe(true);
    expect(labels.some((l) => l.includes('planned Draft chapter, nothing tracked — split'))).toBe(
      true,
    );
  });

  it('opens the figure onto the hours that did not close', async () => {
    const { driver } = session;
    const value = await driver.find('[data-figure="mosaic:open"] [data-testid="figure-value"]');
    expect(await value.text()).toBe('2 hours');
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: value.id }]);
    const rows = await driver.waitFor('the open rows', async () => {
      const found = await driver.findAll('[data-figure="mosaic:open"] [data-testid="figure-row"]');
      return found.length === 2 ? found : null;
    });
    const texts = await Promise.all(rows.map((row) => row.text()));
    expect(texts.join(' | ')).toContain('lived Email the team');
    expect(texts.join(' | ')).toContain('nothing tracked');

    const card = await driver.find('[data-testid="closure-summary"]');
    await driver.execute('arguments[0].scrollIntoView({ block: "start" })', [
      { [ELEMENT]: card.id },
    ]);
    for (const theme of ['dark', 'light'] as const) {
      await driver.execute('document.documentElement.setAttribute("data-theme", arguments[0])', [
        theme,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.screenshot(`split-${theme}`);
    }
    await driver.execute('document.documentElement.removeAttribute("data-theme")', []);
  });
});
