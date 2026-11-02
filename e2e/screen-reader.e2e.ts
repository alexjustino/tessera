import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { focusedElement, focusWindow, publishedTree, type UiaNode } from './uia';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * What a screen reader is given, read from Windows rather than from the page.
 *
 * See `uia.ts`: this reads the UI Automation tree the engine publishes. It uses
 * the split week, because that one fixture has every kind of tile, including
 * the ones whose whole meaning is in their name.
 */

const FIXTURE_MONDAY = new Date(2026, 9, 26);

function weeksBack(): number {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Math.round((monday.getTime() - FIXTURE_MONDAY.getTime()) / (7 * 86_400_000));
}

describe('what a screen reader is given', () => {
  let session: Session;

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  /** The engine publishes its tree lazily, so ask until the wanted node appears. */
  const treeWith = async (what: string, test: (node: UiaNode) => boolean): Promise<UiaNode[]> => {
    let last: UiaNode[] = [];
    for (let attempt = 0; attempt < 15; attempt++) {
      last = await publishedTree();
      if (last.some(test)) return last;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      `${what} was not in the published tree. Named: ${last
        .slice(0, 40)
        .map((n) => n.name)
        .join(' | ')}`,
    );
  };

  beforeAll(async () => {
    session = await startSession({
      seedWorkspace: path.resolve(import.meta.dirname, 'fixtures', 'workspace-split.sqlite3'),
    });
    await session.driver.waitForElement('nav[aria-label="Main"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('the rail is published with every destination named', async () => {
    const tree = await treeWith('the Mosaic button', (n) => n.name === 'Mosaic');
    for (const name of ['Tasks', 'Calendar', 'Mosaic', 'Notes', 'Goals', 'Review', 'Settings']) {
      expect(
        tree.some((n) => n.name === name && n.type === 'ControlType.Button'),
        `${name} as a button`,
      ).toBe(true);
    }
  });

  it('the mosaic is published as a grid, and every kind of tile says itself in words', async () => {
    const { driver } = session;
    await goTo('Mosaic');
    await driver.waitForElement('[data-testid="mosaic-week"]');
    const before = await driver.find('button[aria-label="The week before"]');
    for (let i = 0; i < weeksBack(); i++) {
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: before.id }]);
    }
    await driver.waitForElement('[data-testid="closure-summary"]');

    const tree = await treeWith('a split tile', (n) => n.name.includes('— split'));
    expect(
      tree.some(
        (n) =>
          n.type === 'ControlType.DataGrid' && n.name === 'The working week, one tile per hour',
      ),
      'the grid, named',
    ).toBe(true);

    const cells = tree.filter((n) => n.type === 'ControlType.DataItem').map((n) => n.name);
    expect(
      cells.some((c) => c.includes('planned Draft chapter, lived Draft chapter — closed')),
    ).toBe(true);
    expect(
      cells.some((c) => c.includes('planned Draft chapter, lived Email the team — split')),
    ).toBe(true);
    expect(cells.some((c) => c.includes('planned Draft chapter, nothing tracked — split'))).toBe(
      true,
    );
    expect(cells.some((c) => c.includes('Gone, nothing tracked'))).toBe(true);
  });

  it('the arrow keys move system focus tile by tile, and each tile says where it is', async () => {
    const { driver } = session;
    const first = await driver.find('[role="gridcell"][tabindex="0"]');
    await focusWindow();
    await driver.execute('arguments[0].focus()', [{ [ELEMENT]: first.id }]);

    // System focus follows the page's a moment later; read it too soon and it is
    // still on whatever had it, which is what the release binary's first run hit.
    const atStart = await driver.waitFor('system focus on the first tile', async () => {
      const focused = await focusedElement();
      return focused.type === 'ControlType.DataItem' ? focused : null;
    });
    expect(atStart.name).toMatch(/^Monday /);

    await driver.chord(Keys.ARROW_RIGHT);
    await driver.waitFor('focus on Tuesday', async () =>
      (await focusedElement()).name.startsWith('Tuesday ') ? true : null,
    );
    const right = await focusedElement();
    await driver.chord(Keys.ARROW_DOWN);
    await driver.waitFor('focus an hour later', async () =>
      (await focusedElement()).name !== right.name ? true : null,
    );
    const down = await focusedElement();
    expect(down.type).toBe('ControlType.DataItem');
    expect(down.name).toMatch(/^Tuesday /);
  });

  it('the note editor is a named field, not an anonymous one', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const open = await driver.waitFor('the open control', () =>
      driver.find('button[aria-label="Open Draft chapter"]'),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: open.id }]);
    await driver.waitForElement('[role="dialog"]');

    const name = 'Notes on Draft chapter';
    const tree = await treeWith('the named editor', (n) => n.name === name);
    expect(tree.some((n) => n.name === name)).toBe(true);
  });

  it('the price of an estimate is published as a status, so a reader hears it arrive', async () => {
    const { driver } = session;
    const field = await driver.waitForElement('input[aria-label="Estimate"]');
    await driver.execute(
      `const f = arguments[0];
       f.focus();
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(f, '40h');
       f.dispatchEvent(new Event('input', { bubbles: true }));`,
      [{ [ELEMENT]: field.id }],
    );
    await driver.waitForElement('[data-testid="receipt"]');
    const role = await driver.execute<string | null>(
      'return document.querySelector("[data-testid=receipt] [role=status]")?.getAttribute("role") ?? null',
      [],
    );
    expect(role).toBe('status');
    const tree = await treeWith('the receipt region', (n) => n.name === 'What this would cost');
    expect(tree.some((n) => n.name === 'What this would cost')).toBe(true);
    const estimate = await driver.find('input[aria-label="Estimate"]');
    await estimate.sendKeys(Keys.ESCAPE);
  });
});
