import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface RawItem {
  id: string;
  title: string;
  due_at: string | null;
  remind_at: string | null;
}

interface RawEvent {
  id: string;
  starts_at_utc: string;
  ends_at_utc: string;
  item_id: string | null;
}

const DAY = 86_400_000;

/**
 * Replan in one press (ADR-052): late work shown with where it would go, nothing
 * written until the press, one press that moves it all, and one Undo that puts every
 * date back and takes every block away.
 *
 * It reads times from the host rather than the screen, so it does not depend on the
 * day or the hour it runs.
 */
describe('replanning late work', () => {
  let session: Session;
  /** What each late task was due at, and its reminder, as seeded. */
  const seeded = new Map<string, { due: string; remind: string | null }>();

  const invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    const result = await session.driver.executeAsync<T | { __error: string }>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: String(e) }));',
      [command, args],
    );
    if (result !== null && typeof result === 'object' && '__error' in result) {
      throw new Error(result.__error);
    }
    return result as T;
  };

  const pressText = async (text: string) => {
    const { driver } = session;
    const control = await driver.waitFor(text, () =>
      driver.findByXPath(`//button[normalize-space(.)="${text}"]`),
    );
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
  };

  const settled = () =>
    session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();

  const tasks = () =>
    invoke<RawItem[]>('items_list', { collectionId: 'tasks', includeCompleted: true });

  const blocks = async () => {
    const from = new Date(Date.now() - 2 * DAY).toISOString();
    const to = new Date(Date.now() + 40 * DAY).toISOString();
    return (await invoke<RawEvent[]>('events_list', { from, to })).filter(
      (event) => event.item_id !== null,
    );
  };

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    const input = await driver.waitForElement('input[aria-label="New task"]');
    for (const title of ['Send the report', 'Call the vendor', 'Status meeting notes']) {
      await input.sendKeys(`${title}${Keys.ENTER}`);
      await driver.waitForText(title);
    }
    // Nothing typed can make a date that has gone, so the dates are moved back.
    const all = await tasks();
    for (const [index, title] of [
      'Send the report',
      'Call the vendor',
      'Status meeting notes',
    ].entries()) {
      const task = all.find((one) => one.title === title);
      const due = new Date(Date.now() - (2 + index) * DAY).toISOString();
      const remind = index === 0 ? new Date(Date.parse(due) - 3_600_000).toISOString() : null;
      await invoke('item_set_schedule', {
        id: task?.id,
        schedule: {
          start_at: null,
          due_at: due,
          remind_at: remind,
          recurrence_rrule: title === 'Status meeting notes' ? 'FREQ=WEEKLY' : null,
          recurrence_mode: null,
        },
      });
      if (task !== undefined && title !== 'Status meeting notes')
        seeded.set(task.id, { due, remind });
    }
    await session.restart();
    await settled();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says what is late and where each would go, and writes nothing', async () => {
    const { driver } = session;
    await goTo('Today');
    const card = await driver.waitFor('the late card', () => driver.find('[data-testid="replan"]'));
    expect((await card.text()).toLowerCase()).toContain('3 tasks are late');
    expect((await driver.findAll('[data-replan]')).length).toBe(2);
    await driver.waitForText('because they repeat: Status meeting notes');
    await session.screenshot('replan');

    // Nothing has moved yet.
    for (const task of await tasks()) {
      const before = seeded.get(task.id);
      if (before !== undefined) expect(task.due_at).toBe(before.due);
    }
    expect(await blocks()).toEqual([]);
  });

  it('reads clearly in both themes, over the colour Mica gives the window', async () => {
    const { driver } = session;
    const axe = await readFile(
      path.join(import.meta.dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'),
      'utf8',
    );
    await driver.execute(axe);
    const mica = { light: '#f3f3f3', dark: '#202020' };
    for (const theme of ['dark', 'light'] as const) {
      await goTo('Settings');
      await (await driver.findByXPath(`//*[@role="radio"][normalize-space(.)="${theme}"]`)).click();
      await goTo('Today');
      await driver.waitFor('the late card', () => driver.find('[data-testid="replan"]'));
      await driver.execute('document.documentElement.style.backgroundColor = arguments[0]', [
        mica[theme],
      ]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const failures = await driver.executeAsync<string[]>(
        `const done = arguments[arguments.length - 1];
         window.axe.run('[data-testid="replan"]', { runOnly: { type: 'rule', values: ['color-contrast'] } })
           .then((r) => done(r.violations.flatMap((v) => v.nodes.map((n) => n.failureSummary))))
           .catch((e) => done([String(e)]));`,
      );
      await session.screenshot(`replan-${theme}`);
      await driver.execute('document.documentElement.style.backgroundColor = ""');
      expect(failures, theme).toEqual([]);
    }
  });

  it('one press moves every late task to free time, with its date', async () => {
    const { driver } = session;
    await pressText('Replan 2 late tasks');
    await driver.waitForElement('[data-testid="replan-done"]');
    await session.screenshot('replan-done');

    const reserved = await blocks();
    expect(reserved.length).toBeGreaterThanOrEqual(2);
    const now = Date.now() - 60_000;
    for (const block of reserved) expect(Date.parse(block.starts_at_utc)).toBeGreaterThan(now);

    // No two blocks on top of each other.
    const spans = reserved
      .map((block) => [Date.parse(block.starts_at_utc), Date.parse(block.ends_at_utc)] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i]![0]).toBeGreaterThanOrEqual(spans[i - 1]![1]);
    }

    for (const task of await tasks()) {
      const before = seeded.get(task.id);
      if (before === undefined) continue;
      const last = Math.max(
        ...reserved
          .filter((block) => block.item_id === task.id)
          .map((block) => Date.parse(block.ends_at_utc)),
      );
      // Dated no earlier than its last block ends.
      expect(Date.parse(task.due_at ?? '')).toBeGreaterThanOrEqual(last);
      if (before.remind !== null) {
        // The reminder moved by as much as the date.
        expect(Date.parse(task.remind_at ?? '') - Date.parse(task.due_at ?? '')).toBe(
          Date.parse(before.remind) - Date.parse(before.due),
        );
      }
    }

    // The repeating one was left alone.
    const weekly = (await tasks()).find((task) => task.title === 'Status meeting notes');
    expect(Date.parse(weekly?.due_at ?? '')).toBeLessThan(Date.now());
  });

  it('Undo puts every date back exactly, and takes every block away', async () => {
    const { driver } = session;
    await pressText('Undo');
    await driver.waitFor('the card to come back', () => driver.find('[data-testid="replan"]'));
    for (const task of await tasks()) {
      const before = seeded.get(task.id);
      if (before === undefined) continue;
      expect(task.due_at).toBe(before.due);
      expect(task.remind_at).toBe(before.remind);
    }
    expect(await blocks()).toEqual([]);
  });

  it('the calendar offers the same press', async () => {
    const { driver } = session;
    await goTo('Calendar');
    await driver.waitFor('the card on the calendar', () =>
      driver.find('aside [data-testid="replan"]'),
    );
    await session.screenshot('replan-calendar');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('a stale plan is refused whole, and nothing moves', async () => {
    const id = [...seeded.keys()][0];
    await invoke('item_set_completed', { id, completed: true });
    await expect(
      invoke('items_replan', {
        calendarId: 'personal',
        tz: 'UTC',
        changes: [
          {
            item_id: [...seeded.keys()][1],
            due_at: new Date(Date.now() + DAY).toISOString(),
            remind_at: null,
            blocks: [],
          },
          {
            item_id: id,
            due_at: new Date(Date.now() + DAY).toISOString(),
            remind_at: null,
            blocks: [],
          },
        ],
      }),
    ).rejects.toThrow();
    const second = (await tasks()).find((task) => task.id === [...seeded.keys()][1]);
    expect(second?.due_at).toBe(seeded.get([...seeded.keys()][1]!)?.due);
  });

  it('with nothing late, there is no card', async () => {
    for (const task of await tasks()) {
      await invoke('item_set_completed', { id: task.id, completed: true });
    }
    await session.restart();
    await settled();
    await session.driver.waitForElement('input[aria-label="New task"]');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await session.driver.findAll('[data-testid="replan"]')).toEqual([]);
  });
});
